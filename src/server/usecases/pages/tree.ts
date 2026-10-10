// The page tree of a space: list, create, move, delete (RD-056).
import { planMove, suggestUniqueTitle, type PageDetail, type PageSummary } from "@/domain/documents";
import { CycleError, NotFoundError, ValidationError } from "@/domain/errors";
import { t } from "@/copy";
import { emptyDocument } from "@/editor/schema";
import type { Actor } from "@/server/authz/actor";
import { authorizeSpace } from "@/server/authz/space-permission";
import {
  applyOrdinals,
  createPage as insertPage,
  getPage,
  listPages,
  listTitlesInSpace,
  softDeleteSubtree,
} from "@/server/repositories/documents";
import { setWatching as setWatchingRow } from "@/server/repositories/social";
import { lockTree, rootDb, transaction } from "@/server/repositories/transaction";
import { insertVersion } from "@/server/repositories/versions";
import type { SpaceView } from "@/server/usecases/spaces";
import { auditPage, isWellFormedId, requireTitle, reread, resolvePage, toPageDetail, toPageSummary } from "./shared";

export interface PageTree {
  readonly space: SpaceView;
  /** The whole live tree, flat, ordered by ordinal within parentId (08 §3). */
  readonly pages: readonly PageSummary[];
}

/** The space's live pages the actor can see. NotFound when the space is not visible. */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages: the whole tree as a flat PageSummary[]); RD-056
export async function listPageTree(actor: Actor, spaceKey: string): Promise<PageTree> {
  const space = await authorizeSpace(actor, spaceKey, "VIEW");
  const rows = await listPages(rootDb, actor.id, space.id);
  return { space, pages: rows.map(toPageSummary) };
}

export interface CreatePageInput {
  /** Omitted: `Untitled`, `Untitled 2`, … (RD-056, RD-067). */
  readonly title?: string | undefined;
  /** Omitted or null: the root of the space. */
  readonly parentId?: string | null | undefined;
}

/**
 * Creates a page immediately (RD-056): the row, an empty first version, and a watch for its
 * creator (RD-061), in one transaction with the audit row. Needs space EDIT.
 */
// spec: docs/specs/09-decision-log.md sections RD-056 (Create makes the page immediately), RD-061 (creator watches), RD-067 (made-up titles); 08 §3 (POST /pages)
export async function createPage(actor: Actor, spaceKey: string, input: CreatePageInput = {}): Promise<PageDetail> {
  const space = await authorizeSpace(actor, spaceKey, "EDIT");
  const explicitTitle = input.title === undefined ? null : requireTitle(input.title);
  const parentId = input.parentId ?? null;
  if (parentId !== null && !isWellFormedId(parentId)) {
    throw new ValidationError([{ path: "parentId", message: "must be a page in this space" }]);
  }

  const page = await transaction(async (tx) => {
    if (!(await lockTree(tx, space.id))) throw new NotFoundError("Space");
    if (parentId !== null) {
      const parent = await getPage(tx, actor.id, parentId);
      if (!parent || parent.spaceId !== space.id) {
        throw new ValidationError([{ path: "parentId", message: "must be a page in this space" }]);
      }
    }
    const title = explicitTitle ?? suggestUniqueTitle(t("page.untitled"), await listTitlesInSpace(tx, actor.id, space.id));
    const created = await insertPage(tx, { spaceId: space.id, parentId, title, createdById: actor.id });
    const version = await insertVersion(tx, {
      documentId: created.id,
      title,
      content: emptyDocument(),
      authorId: actor.id,
      message: null,
    });
    await setWatchingRow(tx, created.id, actor.id, true);
    await auditPage(tx, actor, space.id, created.id, "page.create", {
      title,
      parentId,
      ordinal: created.ordinal,
      version: version.number,
      titleSuggested: explicitTitle === null,
    });
    return reread(tx, actor, created.id);
  });
  return toPageDetail(page, space);
}

export interface MovePageInput {
  /** The new parent, or null for the root of the space. */
  readonly parentId: string | null;
  /** 0-based position among the new siblings, the moved page left out; rounded down, then clamped (RD-067). */
  readonly index: number;
}

/**
 * Reparents and reorders a page within its space (RD-056). The tree lock is taken BEFORE the
 * tree is read, so the plan cannot be computed from a stale tree (RD-070).
 */
// spec: docs/specs/09-decision-log.md sections RD-056 (moving within one space; dense ordinals; no cycles), RD-067, RD-070 (lock order); 08 §3 (POST /pages/{id}/move)
export async function movePage(actor: Actor, spaceKey: string, pageId: string, input: MovePageInput): Promise<PageDetail> {
  const { space } = await resolvePage(actor, spaceKey, pageId, "EDIT");
  if (input.parentId !== null && !isWellFormedId(input.parentId)) {
    throw new ValidationError([{ path: "parentId", message: "must be a page in this space" }]);
  }

  const page = await transaction(async (tx) => {
    if (!(await lockTree(tx, space.id))) throw new NotFoundError("Space");
    const pages = await listPages(tx, actor.id, space.id);
    const plan = planMove({ pages, id: pageId, parentId: input.parentId, index: input.index });
    if (!plan.ok) {
      switch (plan.reason) {
        case "UNKNOWN_PAGE":
          throw new NotFoundError("Page");
        case "UNKNOWN_PARENT":
          throw new ValidationError([{ path: "parentId", message: "must be a page in this space" }]);
        case "CYCLE":
          throw new CycleError();
      }
    }
    const before = pages.find((p) => p.id === pageId);
    if (plan.changes.length > 0) {
      await applyOrdinals(tx, space.id, plan.changes);
      const after = plan.changes.find((c) => c.id === pageId);
      await auditPage(tx, actor, space.id, pageId, "page.move", {
        from: { parentId: before?.parentId ?? null, ordinal: before?.ordinal ?? null },
        to: { parentId: input.parentId, ordinal: after?.ordinal ?? before?.ordinal ?? null },
        index: input.index,
        renumbered: plan.changes.length,
      });
    }
    return reread(tx, actor, pageId);
  });
  return toPageDetail(page, space);
}

export interface DeletePageResult {
  /** The page itself and every live descendant (RD-056). */
  readonly deletedCount: number;
}

/** Soft-deletes the page and its whole live subtree (RD-056), with the count on the audit row. */
// spec: docs/specs/09-decision-log.md section RD-056 (deleting is soft and takes the subtree); 08 §3 (DELETE /pages/{id}: { deletedCount })
export async function deletePage(actor: Actor, spaceKey: string, pageId: string): Promise<DeletePageResult> {
  const { space } = await resolvePage(actor, spaceKey, pageId, "EDIT");
  const deletedCount = await transaction(async (tx) => {
    if (!(await lockTree(tx, space.id))) throw new NotFoundError("Space");
    // Re-read under the lock: the audit row records the page as it was deleted.
    const page = await getPage(tx, actor.id, pageId);
    if (!page || page.spaceId !== space.id) throw new NotFoundError("Page");
    const count = await softDeleteSubtree(tx, { documentId: page.id, deletedById: actor.id });
    await auditPage(tx, actor, space.id, page.id, "page.delete", {
      title: page.title,
      parentId: page.parentId,
      deletedCount: count,
    });
    return count;
  });
  return { deletedCount };
}

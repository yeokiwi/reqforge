// Pages (the UI's name for documents, RD-032): the tree, its titles, creation, moves and soft
// deletion. Every read takes the viewer and applies `pageVisibleSql` — an invisible page is
// indistinguishable from a missing one (null / left out, never "forbidden"). Writes are keyed
// by id and trust the use case to have authorised them (space EDIT, spec 07 §2.4); they still
// re-check liveness and space membership of the rows they touch.
import { Prisma } from "@prisma/client";
import { NotFoundError } from "@/domain/errors";
import { mapDbError } from "./db-errors";
import { clientOf, type Client } from "./internal";
import { pageVisibleSql } from "./page-visibility";
import { lockTree, type Db, type Tx } from "./transaction";
import type { UserRef } from "./types";

/** One live page as the tree lists it (spec 08 §3.1 `PageSummary`, with Dates). */
export interface PageRow {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly ordinal: number;
  /** The current version's number. */
  readonly currentVersion: number;
  /** The current version's createdAt. */
  readonly lastModifiedAt: Date;
}

export interface PageAncestor {
  readonly id: string;
  readonly title: string;
}

/** One live page with what the page view needs (spec 08 §3.1 `PageDetail`, minus permissions). */
export interface PageRecord extends PageRow {
  readonly spaceId: string;
  readonly spaceKey: string;
  readonly currentVersionId: string;
  readonly classification: string | null;
  readonly createdBy: UserRef;
  readonly createdAt: Date;
  /** The current version's author. */
  readonly lastModifiedBy: UserRef;
  /** Live pages below this one — what a delete would take with it (RD-056). */
  readonly descendantCount: number;
  /** Root first, excluding the page itself. */
  readonly ancestors: readonly PageAncestor[];
  /** For the viewer. */
  readonly watching: boolean;
  readonly favourite: boolean;
  readonly hasDraft: boolean;
}

/** One row of a move plan — exactly the domain's `planMove` change shape. */
export interface OrdinalChange {
  readonly id: string;
  readonly parentId: string | null;
  readonly ordinal: number;
}

export interface NewPage {
  readonly spaceId: string;
  /** Null for the root of the space. Must be a live page of the same space. */
  readonly parentId: string | null;
  /** Already normalised and checked by the use case; the database re-checks length and uniqueness. */
  readonly title: string;
  readonly createdById: string;
}

/** Live descendants of `rootId` (excluding it), as a scalar subquery. Children share the space (trigger). */
function descendantCountSql(rootId: Prisma.Sql, spaceId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`WITH RECURSIVE sub ("id") AS (
      SELECT c."id" FROM "Document" c
      WHERE c."spaceId" = ${spaceId} AND c."parentId" = ${rootId} AND c."deletedAt" IS NULL
      UNION
      SELECT c."id" FROM "Document" c JOIN sub ON c."parentId" = sub."id"
      WHERE c."spaceId" = ${spaceId} AND c."deletedAt" IS NULL)
    SELECT count(*)::int FROM sub`;
}

/** Sibling-list condition, written so that the (spaceId, parentId, ordinal) index applies. */
function siblingsOf(spaceId: string, parentId: string | null): Prisma.Sql {
  return parentId === null
    ? Prisma.sql`"spaceId" = ${spaceId} AND "parentId" IS NULL AND "deletedAt" IS NULL`
    : Prisma.sql`"spaceId" = ${spaceId} AND "parentId" = ${parentId} AND "deletedAt" IS NULL`;
}

/**
 * The whole live tree of a space, flat, ordered by parent then `ordinal` (ties: title in code
 * point order, then id — as the domain's compareSiblings). Empty when the viewer cannot see the
 * space, or when it has no pages.
 */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages); docs/specs/07-permissions-and-limits.md section 2.2 (rule X2); RD-056
export async function listPages(db: Db, viewerId: string, spaceId: string): Promise<readonly PageRow[]> {
  const rows = await clientOf(db).$queryRaw<PageRow[]>`
    SELECT d."id", d."title", d."parentId", d."ordinal",
           v."number" AS "currentVersion", v."createdAt" AS "lastModifiedAt"
    FROM "Document" d
    JOIN "DocumentVersion" v ON v."id" = d."currentVersionId"
    WHERE d."spaceId" = ${spaceId} AND d."deletedAt" IS NULL AND ${pageVisibleSql(viewerId)}
    ORDER BY d."parentId" NULLS FIRST, d."ordinal", d."title" COLLATE "C", d."id"`;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    parentId: r.parentId,
    ordinal: r.ordinal,
    currentVersion: r.currentVersion,
    lastModifiedAt: r.lastModifiedAt,
  }));
}

interface PageRecordRow {
  id: string;
  spaceId: string;
  spaceKey: string;
  title: string;
  parentId: string | null;
  ordinal: number;
  classification: string | null;
  createdAt: Date;
  createdById: string;
  createdByName: string;
  currentVersionId: string;
  currentVersion: number;
  lastModifiedAt: Date;
  lastModifiedById: string;
  lastModifiedByName: string;
  descendantCount: number;
  ancestors: unknown;
  watching: boolean;
  favourite: boolean;
  hasDraft: boolean;
}

function toAncestors(value: unknown): PageAncestor[] {
  if (!Array.isArray(value)) return [];
  const out: PageAncestor[] = [];
  for (const item of value as unknown[]) {
    if (typeof item === "object" && item !== null) {
      const { id, title } = item as Record<string, unknown>;
      if (typeof id === "string" && typeof title === "string") out.push({ id, title });
    }
  }
  return out;
}

/**
 * One live page, or null when it does not exist, is deleted, or the viewer cannot see it —
 * the three are indistinguishable (rule X2, RD-051). One statement, so one snapshot.
 */
// spec: docs/specs/08-api-surface.md section 3.1 (PageDetail); docs/specs/07-permissions-and-limits.md section 2.2 (rule X2); RD-056
export async function getPage(db: Db, viewerId: string, documentId: string): Promise<PageRecord | null> {
  const rows = await clientOf(db).$queryRaw<PageRecordRow[]>`
    SELECT d."id", d."spaceId", s."key" AS "spaceKey", d."title", d."parentId", d."ordinal",
           d."classification", d."createdAt",
           cb."id" AS "createdById", cb."name" AS "createdByName",
           v."id" AS "currentVersionId", v."number" AS "currentVersion", v."createdAt" AS "lastModifiedAt",
           mb."id" AS "lastModifiedById", mb."name" AS "lastModifiedByName",
           (${descendantCountSql(Prisma.sql`d."id"`, Prisma.sql`d."spaceId"`)}) AS "descendantCount",
           (WITH RECURSIVE up ("id", "title", "parentId", "depth") AS (
              SELECT p."id", p."title", p."parentId", 1 FROM "Document" p WHERE p."id" = d."parentId"
              UNION ALL
              SELECT p."id", p."title", p."parentId", up."depth" + 1
              FROM "Document" p JOIN up ON p."id" = up."parentId"
              WHERE up."depth" < 1000)
            SELECT COALESCE(json_agg(json_build_object('id', up."id", 'title', up."title") ORDER BY up."depth" DESC), '[]'::json)
            FROM up) AS "ancestors",
           EXISTS (SELECT 1 FROM "DocumentWatch" w WHERE w."documentId" = d."id" AND w."userId" = ${viewerId}) AS "watching",
           EXISTS (SELECT 1 FROM "DocumentFavourite" f WHERE f."documentId" = d."id" AND f."userId" = ${viewerId}) AS "favourite",
           EXISTS (SELECT 1 FROM "DocumentDraft" dr WHERE dr."documentId" = d."id" AND dr."userId" = ${viewerId}) AS "hasDraft"
    FROM "Document" d
    JOIN "Space" s ON s."id" = d."spaceId"
    JOIN "User" cb ON cb."id" = d."createdById"
    JOIN "DocumentVersion" v ON v."id" = d."currentVersionId"
    JOIN "User" mb ON mb."id" = v."authorId"
    WHERE d."id" = ${documentId} AND d."deletedAt" IS NULL AND ${pageVisibleSql(viewerId)}`;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    spaceId: r.spaceId,
    spaceKey: r.spaceKey,
    title: r.title,
    parentId: r.parentId,
    ordinal: r.ordinal,
    classification: r.classification,
    createdAt: r.createdAt,
    createdBy: { id: r.createdById, name: r.createdByName },
    currentVersionId: r.currentVersionId,
    currentVersion: r.currentVersion,
    lastModifiedAt: r.lastModifiedAt,
    lastModifiedBy: { id: r.lastModifiedById, name: r.lastModifiedByName },
    descendantCount: r.descendantCount,
    ancestors: toAncestors(r.ancestors),
    watching: r.watching,
    favourite: r.favourite,
    hasDraft: r.hasDraft,
  };
}

/**
 * How many live pages are below this one (excluding it): the count the Delete confirmation
 * names (RD-056). Null when the page is missing, deleted or invisible to the viewer. Counts
 * every live descendant — a delete takes them all.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (the confirmation names how many pages will go); 08 §3.1 descendantCount
export async function countLiveDescendants(db: Db, viewerId: string, documentId: string): Promise<number | null> {
  const rows = await clientOf(db).$queryRaw<{ count: number }[]>`
    SELECT (${descendantCountSql(Prisma.sql`d."id"`, Prisma.sql`d."spaceId"`)}) AS "count"
    FROM "Document" d
    WHERE d."id" = ${documentId} AND d."deletedAt" IS NULL AND ${pageVisibleSql(viewerId)}`;
  return rows[0]?.count ?? null;
}

/** Titles of the live pages of a space the viewer can see — input to the domain's suggestUniqueTitle. */
// spec: docs/specs/09-decision-log.md section RD-056 (`Untitled`, `Untitled 2`, … if taken; Copy of <title>, made unique)
export async function listTitlesInSpace(db: Db, viewerId: string, spaceId: string): Promise<readonly string[]> {
  const rows = await clientOf(db).$queryRaw<{ title: string }[]>`
    SELECT d."title" FROM "Document" d
    WHERE d."spaceId" = ${spaceId} AND d."deletedAt" IS NULL AND ${pageVisibleSql(viewerId)}`;
  return rows.map((r) => r.title);
}

async function requireLiveParent(client: Client, spaceId: string, parentId: string): Promise<void> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Document" WHERE "id" = ${parentId} AND "spaceId" = ${spaceId} AND "deletedAt" IS NULL`;
  if (rows.length === 0) throw new NotFoundError("Page");
}

/**
 * Inserts a page row at the END of its sibling list, under the space's tree lock. The row has
 * no current version yet: the caller must insert the first one with `insertVersion` in the
 * same transaction (that sets the current pointer). Throws NotFoundError for an unknown space
 * or a parent that is not a live page of the space, TitleTakenError, ValidationError.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (Create makes the page immediately; dense ordinals; unique titles)
export async function createPage(tx: Tx, input: NewPage): Promise<{ readonly id: string; readonly ordinal: number }> {
  const client = clientOf(tx);
  if (!(await lockTree(tx, input.spaceId))) throw new NotFoundError("Space");
  if (input.parentId !== null) await requireLiveParent(client, input.spaceId, input.parentId);
  const [next] = await client.$queryRaw<{ ordinal: number }[]>`
    SELECT COALESCE(MAX("ordinal") + 1, 0)::int AS "ordinal" FROM "Document"
    WHERE ${siblingsOf(input.spaceId, input.parentId)}`;
  const ordinal = next?.ordinal ?? 0;
  try {
    const row = await client.document.create({
      data: {
        spaceId: input.spaceId,
        parentId: input.parentId,
        title: input.title,
        ordinal,
        createdById: input.createdById,
      },
      select: { id: true },
    });
    return { id: row.id, ordinal };
  } catch (e) {
    throw mapDbError(e);
  }
}

/**
 * Sets a live page's title WITHOUT creating a version. RD-056 says a rename creates a version,
 * and `insertVersion` already sets the page's title with it — so this is only for keeping the
 * row in step with a version written in the same transaction. Throws NotFoundError,
 * TitleTakenError, ValidationError.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (titles unique per space among live pages)
export async function setTitle(db: Db, documentId: string, title: string): Promise<void> {
  try {
    const { count } = await clientOf(db).document.updateMany({
      where: { id: documentId, deletedAt: null },
      data: { title },
    });
    if (count === 0) throw new NotFoundError("Page");
  } catch (e) {
    throw mapDbError(e);
  }
}

/**
 * Applies a move plan (the domain's planMove `changes`) inside the space's tree lock. Every
 * page named, and every new parent, must be a live page of `spaceId` (else NotFoundError).
 *
 * Order, so that no intermediate state can trip the tree guard: when more than one page
 * changes parent, those pages are first detached to the root (removing edges cannot make a
 * cycle); then ordinals are written in one statement (it does not touch parentId, so the
 * trigger does not fire); then each moved page is attached to its new parent. Every edge that
 * exists at any point is then an edge of the old tree or of the new one, so if the new tree is
 * acyclic no step sees a cycle — and if it is not, the database refuses (CycleError). Titles
 * are not touched, so the unique-title index cannot fire.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (moving within one space; dense ordinals; no cycles); 08 §3 (POST /pages/{id}/move)
export async function applyOrdinals(tx: Tx, spaceId: string, changes: readonly OrdinalChange[]): Promise<void> {
  if (changes.length === 0) return;
  const client = clientOf(tx);
  if (!(await lockTree(tx, spaceId))) throw new NotFoundError("Space");

  const ids = [...new Set(changes.map((c) => c.id))];
  const current = await client.$queryRaw<{ id: string; parentId: string | null }[]>`
    SELECT "id", "parentId" FROM "Document"
    WHERE "id" IN (${Prisma.join(ids)}) AND "spaceId" = ${spaceId} AND "deletedAt" IS NULL`;
  if (current.length !== ids.length) throw new NotFoundError("Page");
  const parentOf = new Map(current.map((r) => [r.id, r.parentId]));

  const targets = [...new Set(changes.map((c) => c.parentId).filter((p): p is string => p !== null))];
  if (targets.length > 0) {
    const live = await client.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Document"
      WHERE "id" IN (${Prisma.join(targets)}) AND "spaceId" = ${spaceId} AND "deletedAt" IS NULL`;
    if (live.length !== targets.length) throw new NotFoundError("Page");
  }

  const reparented = changes.filter((c) => parentOf.get(c.id) !== c.parentId);
  try {
    if (reparented.length > 1) {
      await client.$executeRaw`
        UPDATE "Document" SET "parentId" = NULL WHERE "id" IN (${Prisma.join(reparented.map((c) => c.id))})`;
    }
    const values = Prisma.join(changes.map((c) => Prisma.sql`(${c.id}, ${c.ordinal}::int)`));
    await client.$executeRaw`
      UPDATE "Document" d SET "ordinal" = v."ordinal"
      FROM (VALUES ${values}) AS v ("id", "ordinal")
      WHERE d."id" = v."id" AND d."ordinal" IS DISTINCT FROM v."ordinal"`;
    for (const c of reparented) {
      await client.$executeRaw`UPDATE "Document" SET "parentId" = ${c.parentId} WHERE "id" = ${c.id}`;
    }
  } catch (e) {
    throw mapDbError(e);
  }
}

export interface SoftDelete {
  readonly documentId: string;
  readonly deletedById: string;
  /** Defaults to now. Every page of the subtree gets this same instant. */
  readonly at?: Date;
}

/**
 * Soft-deletes a live page and every live page below it, in one statement, under the space's
 * tree lock: all get the same `deletedAt`, `deletedById` and `deletedRootId` (= the page the
 * user deleted), so Trash can restore the subtree as a unit. The surviving siblings of the
 * deleted page are renumbered 0…n−1 to keep ordinals dense. Returns how many pages were
 * deleted, the page itself included. NotFoundError when the page is missing or already deleted.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (deleting is soft and takes the subtree; a deleted page's title is free); 08 §3 (DELETE /pages/{id})
export async function softDeleteSubtree(tx: Tx, input: SoftDelete): Promise<number> {
  const client = clientOf(tx);
  const at = input.at ?? new Date();
  const [found] = await client.$queryRaw<{ spaceId: string }[]>`
    SELECT "spaceId" FROM "Document" WHERE "id" = ${input.documentId} AND "deletedAt" IS NULL`;
  if (!found) throw new NotFoundError("Page");
  await lockTree(tx, found.spaceId);
  // Re-read under the lock: a move or delete may have committed while we waited.
  const [root] = await client.$queryRaw<{ parentId: string | null }[]>`
    SELECT "parentId" FROM "Document" WHERE "id" = ${input.documentId} AND "deletedAt" IS NULL`;
  if (!root) throw new NotFoundError("Page");

  const count = await client.$executeRaw`
    WITH RECURSIVE sub ("id") AS (
      SELECT "id" FROM "Document" WHERE "id" = ${input.documentId} AND "deletedAt" IS NULL
      UNION
      SELECT c."id" FROM "Document" c JOIN sub ON c."parentId" = sub."id"
      WHERE c."spaceId" = ${found.spaceId} AND c."deletedAt" IS NULL)
    UPDATE "Document" d
    SET "deletedAt" = ${at}, "deletedById" = ${input.deletedById}, "deletedRootId" = ${input.documentId}
    FROM sub WHERE d."id" = sub."id"`;

  await client.$executeRaw`
    WITH ranked AS (
      SELECT "id", (row_number() OVER (ORDER BY "ordinal", "title" COLLATE "C", "id") - 1)::int AS "rank"
      FROM "Document" WHERE ${siblingsOf(found.spaceId, root.parentId)})
    UPDATE "Document" d SET "ordinal" = ranked."rank"
    FROM ranked WHERE d."id" = ranked."id" AND d."ordinal" <> ranked."rank"`;
  return count;
}

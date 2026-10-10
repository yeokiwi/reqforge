// Update (publish) and rename: the two ways a page's current version changes by editing
// (RD-055, RD-056). Both append an immutable version under the page lock.
import { resolvePublish, type PageDetail, type PublishRequest, type PublishResponse } from "@/domain/documents";
import { NotFoundError, ValidationError, VersionConflictError } from "@/domain/errors";
import { t } from "@/copy";
import type { Actor } from "@/server/authz/actor";
import { authorizeSpace } from "@/server/authz/space-permission";
import { allAttachmentIdsForPage } from "@/server/repositories/attachments";
import { deleteDraft } from "@/server/repositories/drafts";
import { watcherCount } from "@/server/repositories/social";
import { lockPage, rootDb, transaction } from "@/server/repositories/transaction";
import { getVersion, insertVersion } from "@/server/repositories/versions";
import {
  auditPage,
  canonicalContent,
  changeNote,
  findPageInSpace,
  isVersionNumber,
  requireTitle,
  reread,
  toPageDetail,
  toVersionSummary,
} from "./shared";

/**
 * Update: validates and canonicalises the content BEFORE any lock, then — under the page lock —
 * refuses a stale base unless `overwrite` (VERSION_CONFLICT carrying the current number),
 * appends the next version, deletes the publisher's draft and writes the audit row with the
 * watcher count `Notify watchers` would reach (RD-061). A title clash is TITLE_TAKEN from the
 * database's unique index.
 */
// spec: docs/specs/09-decision-log.md sections RD-055 (Update; concurrency), RD-061 (notify watchers recorded), RD-063 (canonical content); 08 §3 (PUT /pages/{id}), §3.2
export async function publishPage(actor: Actor, spaceKey: string, pageId: string, input: PublishRequest): Promise<PublishResponse> {
  const space = await authorizeSpace(actor, spaceKey, "EDIT");
  const title = requireTitle(input.title);
  const message = changeNote(input.message);
  if (!isVersionNumber(input.baseVersion)) {
    throw new ValidationError([{ path: "baseVersion", message: "must be a positive integer" }]);
  }
  const page = await findPageInSpace(rootDb, actor, space, pageId);
  const content = canonicalContent(input.content, await allAttachmentIdsForPage(rootDb, actor.id, page.id));
  const overwrite = input.overwrite === true;
  const notifyWatchers = input.notifyWatchers === true;

  const result = await transaction(async (tx) => {
    const locked = await lockPage(tx, page.id);
    if (!locked || locked.deleted || locked.spaceId !== space.id || locked.currentVersion === null) {
      throw new NotFoundError("Page");
    }
    const current = locked.currentVersion;
    if (resolvePublish({ baseVersion: input.baseVersion, currentVersion: current, overwrite }) === "CONFLICT") {
      throw new VersionConflictError(current);
    }
    const version = await insertVersion(tx, { documentId: page.id, title, content, authorId: actor.id, message });
    const draftDeleted = await deleteDraft(tx, page.id, actor.id);
    const watchers = await watcherCount(tx, page.id, { excludeUserId: actor.id });
    await auditPage(tx, actor, space.id, page.id, "page.update", {
      version: version.number,
      baseVersion: input.baseVersion,
      overwrite,
      overwrote: input.baseVersion !== current ? current : null,
      title,
      previousTitle: locked.title,
      message,
      notifyWatchers,
      watcherCount: watchers,
      draftDeleted,
    });
    return { record: await reread(tx, actor, page.id), version };
  });
  return { page: toPageDetail(result.record, space), version: toVersionSummary(result.version), diagnostics: [] };
}

export interface RenamePageInput {
  readonly title: string;
}

/**
 * Rename creates a version with the same content, the new title and the note
 * `Renamed from "<old>"` (RD-056). Renaming to the current title (exactly, after
 * normalisation) changes nothing and returns the page as it is.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (renaming creates a version); 08 §3 (PATCH /pages/{id})
export async function renamePage(actor: Actor, spaceKey: string, pageId: string, input: RenamePageInput): Promise<PageDetail> {
  const space = await authorizeSpace(actor, spaceKey, "EDIT");
  const title = requireTitle(input.title);
  const page = await findPageInSpace(rootDb, actor, space, pageId);

  const record = await transaction(async (tx) => {
    const locked = await lockPage(tx, page.id);
    if (!locked || locked.deleted || locked.spaceId !== space.id || locked.currentVersion === null) {
      throw new NotFoundError("Page");
    }
    if (locked.title === title) return reread(tx, actor, page.id);
    const current = await getVersion(tx, actor.id, page.id, locked.currentVersion);
    if (!current) throw new NotFoundError("Page");
    const version = await insertVersion(tx, {
      documentId: page.id,
      title,
      content: current.content,
      authorId: actor.id,
      message: t("history.renamedNote", { old: locked.title }),
    });
    await auditPage(tx, actor, space.id, page.id, "page.rename", { from: locked.title, to: title, version: version.number });
    return reread(tx, actor, page.id);
  });
  return toPageDetail(record, space);
}

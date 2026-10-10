// Copy one page (RD-056) — with the attachments its images reference (RD-058).
import { copyTitle, type PageDetail } from "@/domain/documents";
import { NotFoundError } from "@/domain/errors";
import { t } from "@/copy";
import type { Actor } from "@/server/authz/actor";
import { authorizeSpace } from "@/server/authz/space-permission";
import {
  allAttachmentIdsForPage,
  getAttachmentForRead,
  insertAttachment,
  softDeleteAttachment,
  type AttachmentContent,
} from "@/server/repositories/attachments";
import { createPage as insertPage, listTitlesInSpace } from "@/server/repositories/documents";
import { setWatching as setWatchingRow } from "@/server/repositories/social";
import { lockTree, rootDb, transaction } from "@/server/repositories/transaction";
import { getVersion as readVersion, insertVersion } from "@/server/repositories/versions";
import { imageAttachmentIds, rewriteImageAttachments, type CopiedAttachment } from "./copy-content";
import { auditPage, canonicalContent, findPageInSpace, requireTitle, reread, toPageDetail } from "./shared";

/** Copying moves up to many 10 MiB attachments inside one transaction. */
const COPY_TIMEOUT_MS = 60_000;

export interface CopyPageInput {
  /** Omitted: `Copy of <title>`, made unique (RD-056, RD-067). */
  readonly title?: string | undefined;
}

/**
 * Copies ONE page (not its descendants) under the same parent, at the end of its siblings, as
 * `Copy of <title>` made unique. Its first version holds the source's current content, with
 * every image re-pointed at a copy of its attachment made on the new page (same bytes, same
 * name, hidden if the original was hidden) — an image may only reference its own page's
 * attachments (RD-058), so without this the copy could never be published again. The copier
 * watches the copy (RD-061). Needs space EDIT.
 */
// spec: docs/specs/09-decision-log.md sections RD-056 (Copy duplicates one page as `Copy of <title>`), RD-058, RD-061; 08 §3 (POST /pages/{id}/copy)
export async function copyPage(actor: Actor, spaceKey: string, pageId: string, input: CopyPageInput = {}): Promise<PageDetail> {
  const space = await authorizeSpace(actor, spaceKey, "EDIT");
  const explicitTitle = input.title === undefined ? null : requireTitle(input.title);
  const source = await findPageInSpace(rootDb, actor, space, pageId);
  const version = await readVersion(rootDb, actor.id, source.id, source.currentVersion);
  if (!version) throw new NotFoundError("Page");

  // Outside any lock: canonicalise the source against its own attachments, and fetch the bytes
  // of each one an image references (live or hidden: a hidden attachment still renders, RD-058).
  const content = canonicalContent(version.content, await allAttachmentIdsForPage(rootDb, actor.id, source.id));
  const files: AttachmentContent[] = [];
  for (const id of [...imageAttachmentIds(content)].sort()) {
    const file = await getAttachmentForRead(rootDb, actor.id, id);
    if (!file || file.documentId !== source.id) throw new NotFoundError("Page");
    files.push(file);
  }

  const record = await transaction(
    async (tx) => {
      if (!(await lockTree(tx, space.id))) throw new NotFoundError("Space");
      const title =
        explicitTitle ??
        copyTitle(source.title, await listTitlesInSpace(tx, actor.id, space.id), (original) => t("page.copyOf", { title: original }));
      const created = await insertPage(tx, { spaceId: space.id, parentId: source.parentId, title, createdById: actor.id });

      const copies = new Map<string, CopiedAttachment>();
      for (const file of files) {
        const row = await insertAttachment(tx, {
          documentId: created.id,
          filename: file.filename,
          contentType: file.contentType,
          data: file.data,
          uploadedById: actor.id,
        });
        if (file.deletedAt !== null) await softDeleteAttachment(tx, created.id, row.id);
        copies.set(file.id, { id: row.id, filename: row.filename });
      }

      const first = await insertVersion(tx, {
        documentId: created.id,
        title,
        content: rewriteImageAttachments(content, copies),
        authorId: actor.id,
        message: null,
      });
      await setWatchingRow(tx, created.id, actor.id, true);
      await auditPage(tx, actor, space.id, created.id, "page.copy", {
        sourceId: source.id,
        sourceVersion: version.number,
        title,
        parentId: source.parentId,
        ordinal: created.ordinal,
        version: first.number,
        attachments: [...copies].map(([from, to]) => ({ from, to: to.id })),
      });
      return reread(tx, actor, created.id);
    },
    { timeoutMs: COPY_TIMEOUT_MS },
  );
  return toPageDetail(record, space);
}

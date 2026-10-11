// Copy one page (RD-056) — with the attachments its images reference (RD-058).
import { copyTitle, type PageDetail } from "@/domain/documents";
import { NotFoundError, TooLargeError } from "@/domain/errors";
import { t } from "@/copy";
import type { Actor } from "@/server/authz/actor";
import {
  allAttachmentIdsForPage,
  getAttachmentForRead,
  insertAttachment,
  listAttachments,
  softDeleteAttachment,
} from "@/server/repositories/attachments";
import { createPage as insertPage, getPage, listTitlesInSpace } from "@/server/repositories/documents";
import { setWatching as setWatchingRow } from "@/server/repositories/social";
import { lockTree, rootDb, transaction } from "@/server/repositories/transaction";
import { getVersion as readVersion, insertVersion } from "@/server/repositories/versions";
import { imageAttachmentIds, rewriteImageAttachments, type CopiedAttachment } from "./copy-content";
import { auditPage, canonicalContent, requireTitle, reread, resolvePage, toPageDetail } from "./shared";

/**
 * The most attachment bytes one copy may carry. A copy runs inside the request and re-inserts
 * the bytes while it holds the space's tree lock — every create, move and delete in the space
 * waits for it — so its cost must be bounded (07 §5). 50 MiB is five attachments at the 10 MiB
 * limit (RD-058), and took about 3.6 s to copy on the development database.
 */
// spec: docs/specs/07-permissions-and-limits.md sections 4 (a hard limit names itself) and 5 (budget); RD-056, RD-058
export const COPY_ATTACHMENT_BYTES_MAX = 50 * 1024 * 1024;

/** Comfortably above what COPY_ATTACHMENT_BYTES_MAX costs, for a slow database. */
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
 *
 * Cost: the attachments the images reference may total at most COPY_ATTACHMENT_BYTES_MAX, else
 * TOO_LARGE naming that limit — decided from the live attachments' sizes before any lock, and
 * from the running total while copying (a hidden attachment's size is only known once read).
 * Bytes are read only under the tree lock and ONE attachment at a time, each released before
 * the next is read: a copy holds one attachment in memory, and concurrent copies in one space,
 * which queue on the lock before reading anything, hold one between them.
 */
// spec: docs/specs/09-decision-log.md sections RD-056 (Copy duplicates one page as `Copy of <title>`), RD-058, RD-061, RD-070 (lock order); 08 §3 (POST /pages/{id}/copy); 07 §5
export async function copyPage(actor: Actor, spaceKey: string, pageId: string, input: CopyPageInput = {}): Promise<PageDetail> {
  const { space, page: source } = await resolvePage(actor, spaceKey, pageId, "EDIT");
  const explicitTitle = input.title === undefined ? null : requireTitle(input.title);
  const version = await readVersion(rootDb, actor.id, source.id, source.currentVersion);
  if (!version) throw new NotFoundError("Page");

  // Outside any lock, and without loading any bytes: canonicalise the source against its own
  // attachments, and refuse early when its live referenced attachments alone are over the limit.
  const content = canonicalContent(version.content, await allAttachmentIdsForPage(rootDb, actor.id, source.id));
  const referenced = [...imageAttachmentIds(content)].sort();
  if (referenced.length > 0) {
    const wanted = new Set(referenced);
    const live = (await listAttachments(rootDb, actor.id, source.id)) ?? [];
    const liveBytes = live.filter((a) => wanted.has(a.id)).reduce((sum, a) => sum + a.size, 0);
    if (liveBytes > COPY_ATTACHMENT_BYTES_MAX) throw new TooLargeError(COPY_ATTACHMENT_BYTES_MAX);
  }

  const record = await transaction(
    async (tx) => {
      if (!(await lockTree(tx, space.id))) throw new NotFoundError("Space");
      // Re-read under the lock: a delete may have committed while we waited (RD-070).
      const current = await getPage(tx, actor.id, source.id);
      if (!current || current.spaceId !== space.id) throw new NotFoundError("Page");
      const title =
        explicitTitle ??
        copyTitle(source.title, await listTitlesInSpace(tx, actor.id, space.id), (original) => t("page.copyOf", { title: original }));
      const created = await insertPage(tx, { spaceId: space.id, parentId: source.parentId, title, createdById: actor.id });

      const copies = new Map<string, CopiedAttachment>();
      let copiedBytes = 0;
      for (const id of referenced) {
        // Live or hidden: a hidden attachment still renders (RD-058).
        const file = await getAttachmentForRead(tx, actor.id, id);
        if (!file || file.documentId !== source.id) throw new NotFoundError("Page");
        copiedBytes += file.size;
        if (copiedBytes > COPY_ATTACHMENT_BYTES_MAX) throw new TooLargeError(COPY_ATTACHMENT_BYTES_MAX);
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
        attachmentBytes: copiedBytes,
      });
      return reread(tx, actor, created.id);
    },
    { timeoutMs: COPY_TIMEOUT_MS },
  );
  return toPageDetail(record, space);
}

// Files and images on a page (RD-058, RD-071).
import { LIMITS, classifyAttachment, sanitizeFilename, sniffImageType, type AttachmentRef } from "@/domain/documents";
import { NotFoundError, TooLargeError, UnsupportedMediaError, ValidationError } from "@/domain/errors";
import type { Actor } from "@/server/authz/actor";
import { authorizeSpace } from "@/server/authz/space-permission";
import {
  getAttachmentForRead,
  insertAttachment,
  listAttachments as readAttachments,
  sha256Hex,
  softDeleteAttachment,
} from "@/server/repositories/attachments";
import { lockPage, rootDb, transaction } from "@/server/repositories/transaction";
import { auditAttachment, findPageInSpace, isImageContentType, isWellFormedId, resolvePage, toAttachmentRef } from "./shared";

/** Upload transactions carry up to 10 MiB. */
const UPLOAD_TIMEOUT_MS = 30_000;

/** The page's live attachments, newest first. Needs space VIEW. */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}/attachments: live attachments, newest first)
export async function listAttachments(actor: Actor, spaceKey: string, pageId: string): Promise<AttachmentRef[]> {
  const { page } = await resolvePage(actor, spaceKey, pageId, "VIEW");
  const rows = await readAttachments(rootDb, actor.id, page.id);
  if (!rows) throw new NotFoundError("Page");
  return rows.map(toAttachmentRef);
}

export interface AttachmentUploadInput {
  /** As the client named it; sanitised before it is stored (RD-071). */
  readonly filename: string;
  /** What the client declared. Only ever used to REFUSE (SVG), never to accept an image. */
  readonly declaredContentType?: string | null | undefined;
  readonly bytes: Uint8Array;
}

/**
 * Stores an upload on the page. The class is decided from the bytes (RD-071): SVG is refused
 * (UNSUPPORTED_MEDIA), an empty file is VALIDATION at `file`, over 10 MiB is TOO_LARGE; a
 * verified PNG/JPEG/GIF/WebP is an image, anything else a download stored as
 * application/octet-stream. Needs space EDIT.
 */
// spec: docs/specs/09-decision-log.md sections RD-058 (files, images and attachments), RD-071 (detection, file names); 08 §3 (POST /pages/{id}/attachments), §3.2
export async function uploadAttachment(
  actor: Actor,
  spaceKey: string,
  pageId: string,
  upload: AttachmentUploadInput,
): Promise<AttachmentRef> {
  const space = await authorizeSpace(actor, spaceKey, "EDIT");
  const filename = sanitizeFilename(upload.filename);
  const kind = classifyAttachment({ filename: upload.filename, declaredContentType: upload.declaredContentType ?? null, bytes: upload.bytes });
  if (kind.kind === "rejected") {
    switch (kind.reason) {
      case "SVG":
        throw new UnsupportedMediaError("attachment type: SVG images are refused");
      case "EMPTY":
        throw new ValidationError([{ path: "file", message: "must not be empty" }]);
      case "TOO_LARGE":
        throw new TooLargeError(LIMITS.attachmentMaxBytes);
    }
  }
  const page = await findPageInSpace(rootDb, actor, space, pageId);
  const sha256 = sha256Hex(upload.bytes);

  const row = await transaction(
    async (tx) => {
      const locked = await lockPage(tx, page.id);
      if (!locked || locked.deleted || locked.spaceId !== space.id) throw new NotFoundError("Page");
      const stored = await insertAttachment(tx, {
        documentId: page.id,
        filename,
        contentType: kind.contentType,
        data: upload.bytes,
        uploadedById: actor.id,
      });
      await auditAttachment(tx, actor, space.id, stored.id, "attachment.upload", {
        pageId: page.id,
        filename: stored.filename,
        contentType: stored.contentType,
        size: stored.size,
        sha256,
      });
      return stored;
    },
    { timeoutMs: UPLOAD_TIMEOUT_MS },
  );
  return toAttachmentRef(row);
}

/**
 * Hides an attachment (RD-058: the bytes stay, old versions still render it). Idempotent: a
 * second call changes nothing and writes no second audit row. Needs space EDIT.
 */
// spec: docs/specs/09-decision-log.md section RD-058 (deleting an attachment hides it); 08 §3 (DELETE /pages/{id}/attachments/{attachmentId})
export async function hideAttachment(actor: Actor, spaceKey: string, pageId: string, attachmentId: string): Promise<void> {
  const { space, page } = await resolvePage(actor, spaceKey, pageId, "EDIT");
  if (!isWellFormedId(attachmentId)) throw new NotFoundError("Attachment");
  await transaction(async (tx) => {
    const result = await softDeleteAttachment(tx, page.id, attachmentId);
    if (result === "not_found") throw new NotFoundError("Attachment");
    if (result === "hidden") {
      await auditAttachment(tx, actor, space.id, attachmentId, "attachment.delete", { pageId: page.id });
    }
  });
}

export interface AttachmentDownload {
  readonly id: string;
  readonly filename: string;
  /** "image" only for a stored verified image type whose bytes still prove it (RD-071). */
  readonly kind: "image" | "file";
  /** The stored verified type for an image; application/octet-stream for everything else. */
  readonly contentType: string;
  readonly size: number;
  readonly sha256: string;
  readonly data: Uint8Array;
}

/**
 * The bytes of an attachment for a caller who can view its page (space VIEW, rule X2): a hidden
 * attachment of a live page is still served, an attachment of a deleted or invisible page is
 * NotFound (RD-070).
 */
// spec: docs/specs/09-decision-log.md sections RD-058 (every read checks space VIEW on the page), RD-070, RD-071; 08 §3 (GET /api/v1/attachments/{attachmentId}/{filename})
export async function readAttachment(actor: Actor, attachmentId: string): Promise<AttachmentDownload> {
  if (!isWellFormedId(attachmentId)) throw new NotFoundError("Attachment");
  const row = await getAttachmentForRead(rootDb, actor.id, attachmentId);
  if (!row) throw new NotFoundError("Attachment");
  const image = isImageContentType(row.contentType) && sniffImageType(row.data) === row.contentType;
  return {
    id: row.id,
    filename: row.filename,
    kind: image ? "image" : "file",
    contentType: image ? row.contentType : "application/octet-stream",
    size: row.size,
    sha256: row.sha256,
    data: row.data,
  };
}

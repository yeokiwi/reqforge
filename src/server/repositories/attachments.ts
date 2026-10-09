// Attachments (RD-058): bytes in the database, content-addressed by SHA-256, at most 10 MiB,
// immutable except `deletedAt`. Hiding an attachment keeps its bytes, because past versions
// of the page still reference them.
import { createHash } from "node:crypto";
import { TooLargeError, ValidationError } from "@/domain/errors";
import { mapDbError } from "./db-errors";
import { clientOf } from "./internal";
import { pageVisibleSql } from "./page-visibility";
import type { Db } from "./transaction";
import type { UserRef } from "./types";

/**
 * The database's limit (the `Attachment_size_matches` CHECK). The domain's
 * LIMITS.attachmentMaxBytes states the same number; the use case checks first, this module
 * only reports a refusal with the right limit.
 */
export const ATTACHMENT_MAX_BYTES = 10_485_760;

export interface AttachmentRow {
  readonly id: string;
  readonly documentId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  /** Lower-case hex SHA-256 of the bytes. */
  readonly sha256: string;
  readonly uploadedBy: UserRef;
  readonly createdAt: Date;
  /** Set when hidden from the page's list (the bytes stay). */
  readonly deletedAt: Date | null;
}

export interface AttachmentContent extends AttachmentRow {
  readonly spaceId: string;
  readonly data: Uint8Array;
}

export interface NewAttachment {
  readonly documentId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly data: Uint8Array;
  readonly uploadedById: string;
  /** Defaults to now. */
  readonly at?: Date;
}

/** Lower-case hex SHA-256 — the content address of an attachment. */
// spec: docs/specs/09-decision-log.md section RD-058 (content-addressed by SHA-256)
export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

interface AttachmentDbRow {
  id: string;
  documentId: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: Date;
  deletedAt: Date | null;
  uploadedById: string;
  uploadedByName: string;
}

function toRow(r: AttachmentDbRow): AttachmentRow {
  return {
    id: r.id,
    documentId: r.documentId,
    filename: r.filename,
    contentType: r.contentType,
    size: r.size,
    sha256: r.sha256,
    uploadedBy: { id: r.uploadedById, name: r.uploadedByName },
    createdAt: r.createdAt,
    deletedAt: r.deletedAt,
  };
}

/**
 * Stores an upload. The hash and size are computed here from the bytes; the database checks
 * them (size 1 byte – 10 MiB, hash format). Classification (image or not, SVG refused) is
 * the use case's, before this is called. Throws TooLargeError, ValidationError, NotFoundError.
 */
// spec: docs/specs/09-decision-log.md section RD-058 (bytes in the database, content-addressed, at most 10 MiB); 08 §3 (POST /pages/{id}/attachments)
export async function insertAttachment(db: Db, input: NewAttachment): Promise<AttachmentRow> {
  const data = new Uint8Array(input.data);
  try {
    const row = await clientOf(db).attachment.create({
      data: {
        documentId: input.documentId,
        filename: input.filename,
        contentType: input.contentType,
        size: data.byteLength,
        sha256: sha256Hex(data),
        data,
        uploadedById: input.uploadedById,
        ...(input.at ? { createdAt: input.at } : {}),
      },
      select: {
        id: true,
        documentId: true,
        filename: true,
        contentType: true,
        size: true,
        sha256: true,
        createdAt: true,
        deletedAt: true,
        uploadedBy: { select: { id: true, name: true } },
      },
    });
    return { ...row, uploadedBy: { id: row.uploadedBy.id, name: row.uploadedBy.name } };
  } catch (e) {
    const mapped = mapDbError(e);
    if (mapped instanceof ValidationError && mapped.errors.some((x) => x.path === "file") && data.byteLength > ATTACHMENT_MAX_BYTES) {
      throw new TooLargeError(ATTACHMENT_MAX_BYTES);
    }
    throw mapped;
  }
}

/**
 * The live (not hidden) attachments of a live page the viewer can see, newest first. Null
 * when the page is missing, deleted or invisible.
 */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}/attachments: live attachments, newest first); rule X2
export async function listAttachments(db: Db, viewerId: string, documentId: string): Promise<readonly AttachmentRow[] | null> {
  const client = clientOf(db);
  const page = await client.$queryRaw<{ id: string }[]>`
    SELECT d."id" FROM "Document" d
    WHERE d."id" = ${documentId} AND d."deletedAt" IS NULL AND ${pageVisibleSql(viewerId)}`;
  if (page.length === 0) return null;
  const rows = await client.$queryRaw<AttachmentDbRow[]>`
    SELECT a."id", a."documentId", a."filename", a."contentType", a."size", a."sha256", a."createdAt", a."deletedAt",
           u."id" AS "uploadedById", u."name" AS "uploadedByName"
    FROM "Attachment" a JOIN "User" u ON u."id" = a."uploadedById"
    WHERE a."documentId" = ${documentId} AND a."deletedAt" IS NULL
    ORDER BY a."createdAt" DESC, a."id" DESC`;
  return rows.map(toRow);
}

/**
 * Bytes and metadata for serving `/api/v1/attachments/{id}/{filename}`, or null when the
 * attachment does not exist or the viewer cannot see its page. Hidden attachments ARE
 * returned (`deletedAt` set): old versions of the page still show them. The page itself must
 * be live — a deleted page's content is not served.
 */
// spec: docs/specs/09-decision-log.md section RD-058 (every read checks space VIEW on the page; deleting hides, the bytes stay); rule X2
export async function getAttachmentForRead(db: Db, viewerId: string, attachmentId: string): Promise<AttachmentContent | null> {
  const rows = await clientOf(db).$queryRaw<(AttachmentDbRow & { spaceId: string; data: Uint8Array })[]>`
    SELECT a."id", a."documentId", a."filename", a."contentType", a."size", a."sha256", a."createdAt", a."deletedAt",
           a."data", d."spaceId", u."id" AS "uploadedById", u."name" AS "uploadedByName"
    FROM "Attachment" a
    JOIN "Document" d ON d."id" = a."documentId"
    JOIN "User" u ON u."id" = a."uploadedById"
    WHERE a."id" = ${attachmentId} AND d."deletedAt" IS NULL AND ${pageVisibleSql(viewerId)}`;
  const r = rows[0];
  if (!r) return null;
  return { ...toRow(r), spaceId: r.spaceId, data: new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength) };
}

/**
 * Ids of every attachment of the page, live AND hidden — the set an image node in published
 * content may reference (RD-058: only attachments on the same page). Empty when the page is
 * missing, deleted or invisible to the viewer.
 */
// spec: docs/specs/09-decision-log.md section RD-058 (an image node may only reference an attachment on the same page)
export async function allAttachmentIdsForPage(db: Db, viewerId: string, documentId: string): Promise<ReadonlySet<string>> {
  const rows = await clientOf(db).$queryRaw<{ id: string }[]>`
    SELECT a."id" FROM "Attachment" a JOIN "Document" d ON d."id" = a."documentId"
    WHERE a."documentId" = ${documentId} AND d."deletedAt" IS NULL AND ${pageVisibleSql(viewerId)}`;
  return new Set(rows.map((r) => r.id));
}

export type HideResult = "hidden" | "already_hidden" | "not_found";

/**
 * Hides an attachment of the given page (sets `deletedAt`; the bytes stay). Idempotent: a
 * second call reports `already_hidden` and keeps the first `deletedAt`.
 */
// spec: docs/specs/09-decision-log.md section RD-058 (deleting an attachment hides it); 08 §3 (DELETE /pages/{id}/attachments/{attachmentId})
export async function softDeleteAttachment(db: Db, documentId: string, attachmentId: string, at: Date = new Date()): Promise<HideResult> {
  const client = clientOf(db);
  const { count } = await client.attachment.updateMany({
    where: { id: attachmentId, documentId, deletedAt: null },
    data: { deletedAt: at },
  });
  if (count > 0) return "hidden";
  const exists = await client.attachment.count({ where: { id: attachmentId, documentId } });
  return exists > 0 ? "already_hidden" : "not_found";
}

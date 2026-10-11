// The REST calls behind the `···` menu's dialogs (08 section 3), in one place, with the response
// bodies read defensively. Each throws the ApiError of src/ui/api-client.ts on failure; a success
// body of the wrong shape is UNEXPECTED_RESPONSE. The integration test sends these very calls to
// the real route handlers, so the bodies here and the API's schemas cannot drift apart.
// spec: docs/specs/08-api-surface.md section 3 (attachments, copy, move, delete); docs/specs/09-decision-log.md section RD-072 (response bodies)
import type { AttachmentRef } from "@/domain/documents/api-types";
import { ApiError, type FetchLike, callApi, spaceUrls } from "@/ui/api-client";
import type { MoveBody } from "./move-targets";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unexpected(): ApiError {
  return new ApiError("UNEXPECTED_RESPONSE", 200);
}

/** Where attachment bytes are served (RD-058); anything else is not a link this dialog will draw. */
const ATTACHMENT_URL_PREFIX = "/api/v1/attachments/";

/** One AttachmentRef from the wire, or null when it is not one. */
export function parseAttachment(value: unknown): AttachmentRef | null {
  if (!isRecord(value)) return null;
  const { id, filename, contentType, size, url, image, uploadedBy, createdAt } = value;
  if (typeof id !== "string" || typeof filename !== "string" || typeof contentType !== "string") return null;
  if (typeof size !== "number" || !Number.isFinite(size) || typeof image !== "boolean" || typeof createdAt !== "string") return null;
  if (typeof url !== "string" || !url.startsWith(ATTACHMENT_URL_PREFIX)) return null;
  if (!isRecord(uploadedBy) || typeof uploadedBy.id !== "string" || typeof uploadedBy.name !== "string") return null;
  return { id, filename, contentType, size, url, image, uploadedBy: { id: uploadedBy.id, name: uploadedBy.name }, createdAt };
}

/** `GET …/attachments`: the page's live attachments, newest first (08 section 3). */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}/attachments)
export async function fetchAttachments(spaceKey: string, pageId: string, fetchImpl?: FetchLike): Promise<AttachmentRef[]> {
  const body = await callApi("GET", spaceUrls(spaceKey).attachments(pageId), undefined, fetchImpl);
  if (!Array.isArray(body)) throw unexpected();
  const parsed = body.map(parseAttachment);
  if (parsed.some((item) => item === null)) throw unexpected();
  return parsed as AttachmentRef[];
}

/** `POST …/attachments`: multipart/form-data with one `file` field (EDIT), 201 AttachmentRef. */
// spec: docs/specs/08-api-surface.md section 3 (POST /pages/{id}/attachments: multipart/form-data, field file); RD-058
export async function requestUpload(spaceKey: string, pageId: string, file: Blob, filename: string, fetchImpl?: FetchLike): Promise<void> {
  const form = new FormData();
  form.append("file", file, filename);
  await callApi("POST", spaceUrls(spaceKey).attachments(pageId), form, fetchImpl);
}

/** `DELETE …/attachments/{id}`: hides it; the bytes stay (RD-058), 204. */
// spec: docs/specs/08-api-surface.md section 3 (DELETE /pages/{id}/attachments/{attachmentId}); RD-058
export async function requestHide(spaceKey: string, pageId: string, attachmentId: string, fetchImpl?: FetchLike): Promise<void> {
  await callApi("DELETE", spaceUrls(spaceKey).attachment(pageId, attachmentId), undefined, fetchImpl);
}

/**
 * `POST …/copy` with `{ title }` (EDIT), 201 PageDetail. Resolves to the new page's id — or null
 * when the server said 201 but the body has no id: the copy exists, so this is not a failure to
 * retry (a retry would make a second copy).
 */
// spec: docs/specs/08-api-surface.md section 3 (POST /pages/{id}/copy: { title? }); RD-056, RD-072
export async function requestCopy(spaceKey: string, pageId: string, title: string, fetchImpl?: FetchLike): Promise<string | null> {
  const body = await callApi("POST", spaceUrls(spaceKey).copy(pageId), { title }, fetchImpl);
  return isRecord(body) && typeof body.id === "string" && body.id !== "" ? body.id : null;
}

/** `POST …/move` with `{ parentId, index }` (EDIT), 200 PageDetail. */
// spec: docs/specs/08-api-surface.md section 3 (POST /pages/{id}/move: { parentId: string | null, index: number }); RD-056, RD-072
export async function requestMove(spaceKey: string, pageId: string, move: MoveBody, fetchImpl?: FetchLike): Promise<void> {
  await callApi("POST", spaceUrls(spaceKey).move(pageId), { parentId: move.parentId, index: move.index }, fetchImpl);
}

/** `DELETE …/pages/{id}`: soft-deletes the page and its subtree (EDIT), 200 `{ deletedCount }`. */
// spec: docs/specs/08-api-surface.md section 3 (DELETE /pages/{id}); RD-056, RD-072
export async function requestDelete(spaceKey: string, pageId: string, fetchImpl?: FetchLike): Promise<number | null> {
  const body = await callApi("DELETE", spaceUrls(spaceKey).page(pageId), undefined, fetchImpl);
  return isRecord(body) && typeof body.deletedCount === "number" ? body.deletedCount : null;
}

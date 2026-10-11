// Request bodies, read as a STREAM under a hard cap: a body is never buffered past the cap,
// whatever its Content-Length says (a declared length over the cap is refused early; an
// absent or understated one does not help, because the count is of bytes actually read).
import type { z } from "zod";
import { LIMITS } from "@/domain/documents";
import { TooLargeError, UnsupportedMediaError, ValidationError, type ValidationIssue } from "@/domain/errors";

const ENVELOPE = 64 * 1024;

/**
 * The most a JSON body may weigh ON THE WIRE. This is a transport bound that keeps a request's
 * memory finite, NOT the content limit: the 5 MiB of RD-063 is the parsed content measured as
 * compact UTF-8 (RD-068), and validateDocumentJson decides it, so a document weighs the same
 * however the client encoded it. Escaping every non-ASCII character as `\uXXXX` (Python's
 * `json.dumps` default) at most triples a document — two-byte characters and surrogate pairs
 * are the worst case — so the bound is 3 × 5 MiB plus 64 KiB for the rest of the body.
 * Pretty-printing inflates too (indent 2 of a dense table is about 3.2×); such a body is
 * accepted while it fits. A body over the bound is TOO_LARGE with the documented 5 MiB limit.
 */
// spec: docs/specs/08-api-surface.md section 3.2 (TOO_LARGE: content over 5 MiB); docs/specs/09-decision-log.md sections RD-063, RD-068 (size is UTF-8 bytes of the JSON)
export const JSON_BODY_CAP = 3 * LIMITS.contentMaxBytes + ENVELOPE;
/** A multipart upload may carry a 10 MiB file plus 64 KiB of framing (RD-058). */
export const UPLOAD_BODY_CAP = LIMITS.attachmentMaxBytes + ENVELOPE;

/** The media type of a Content-Type value, lower-cased, without parameters. */
export function mediaType(contentType: string | null): string | null {
  if (contentType === null) return null;
  const essence = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  return essence === "" ? null : essence;
}

/**
 * The body's bytes, aborting as soon as more than `cap` have arrived. `limit` is the number the
 * TooLargeError reports — the documented limit (08 §3.2), not the cap with its envelope.
 */
export async function readCapped(request: Request, cap: number, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared.trim()) > cap) {
    await request.body?.cancel().catch(() => undefined);
    throw new TooLargeError(limit);
  }
  const body = request.body;
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => undefined);
        throw new TooLargeError(limit);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * A JSON request body: Content-Type must be application/json (415 otherwise), at most
 * JSON_BODY_CAP bytes (413 with limit 5 MiB), valid UTF-8 and valid JSON (422 otherwise). Whether
 * the CONTENT is over 5 MiB is decided after parsing, by the use case (canonicalContent).
 */
// spec: docs/specs/08-api-surface.md section 3.2 (UNSUPPORTED_MEDIA: a non-JSON body; TOO_LARGE: content over 5 MiB); RD-063
export async function readJsonBody(request: Request): Promise<unknown> {
  if (mediaType(request.headers.get("content-type")) !== "application/json") {
    await request.body?.cancel().catch(() => undefined);
    throw new UnsupportedMediaError("request body: expected application/json");
  }
  const bytes = await readCapped(request, JSON_BODY_CAP, LIMITS.contentMaxBytes);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ValidationError([{ path: "", message: "The body is not valid UTF-8" }]);
  }
  if (text.trim() === "") throw new ValidationError([{ path: "", message: "The body is empty; expected a JSON object" }]);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError([{ path: "", message: "The body is not valid JSON" }]);
  }
}

/**
 * For endpoints whose body is all optional fields (create, copy): a request with no body and
 * no Content-Type reads as `{}`; anything else goes through readJsonBody.
 */
export async function readOptionalJsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") === null) {
    const bytes = await readCapped(request, JSON_BODY_CAP, LIMITS.contentMaxBytes);
    if (bytes.byteLength === 0) return {};
    throw new UnsupportedMediaError("request body: expected application/json");
  }
  return readJsonBody(request);
}

export interface UploadedFile {
  readonly filename: string;
  /** What the client declared; only ever used to refuse SVG (RD-071). */
  readonly declaredContentType: string | null;
  readonly bytes: Uint8Array;
}

/**
 * The `file` field of a multipart/form-data upload (415 for any other media type). The body is
 * read under UPLOAD_BODY_CAP (413 with limit 10 MiB) BEFORE it is parsed, and the already-capped
 * bytes are what the multipart parser sees.
 */
// spec: docs/specs/08-api-surface.md section 3 (POST /pages/{id}/attachments: multipart/form-data, field file), section 3.2; RD-058
export async function readUploadedFile(request: Request): Promise<UploadedFile> {
  const contentType = request.headers.get("content-type");
  if (mediaType(contentType) !== "multipart/form-data" || contentType === null) {
    await request.body?.cancel().catch(() => undefined);
    throw new UnsupportedMediaError("request body: expected multipart/form-data");
  }
  const bytes = await readCapped(request, UPLOAD_BODY_CAP, LIMITS.attachmentMaxBytes);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new ValidationError([{ path: "file", message: "The multipart body could not be read" }]);
  }
  const files = form.getAll("file");
  const file = files[0];
  if (files.length !== 1 || file === undefined || typeof file === "string") {
    throw new ValidationError([{ path: "file", message: "Exactly one file is required in the field 'file'" }]);
  }
  return {
    filename: file.name,
    declaredContentType: file.type === "" ? null : file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

const MAX_ISSUES = 50;

/** Parses with a zod schema; failures become ValidationError with dotted paths (`content.0.attrs`). */
// spec: docs/specs/08-api-surface.md section 3.2 (VALIDATION, errors: { path, message }[])
export function parseWith<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.output<S>;
  const errors: ValidationIssue[] = result.error.issues
    .slice(0, MAX_ISSUES)
    .map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
  throw new ValidationError(errors);
}

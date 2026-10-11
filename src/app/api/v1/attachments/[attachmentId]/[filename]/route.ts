// GET /api/v1/attachments/{attachmentId}/{filename} — the bytes (VIEW on the page's space)
//
// Images (verified from their bytes) go inline with their stored type; everything else is an
// application/octet-stream download. The {filename} segment is cosmetic: it is never compared
// with the stored name (no 404 on a mismatch) and never echoed into a header.
// spec: docs/specs/08-api-surface.md section 3; docs/specs/09-decision-log.md sections RD-058, RD-071
import { contentDisposition } from "@/domain/documents";
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { readAttachment } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { attachmentId: string; filename: string };

/** Whether an If-None-Match header names this entity tag (weak comparison, RFC 9110 §13.1.2). */
function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  return ifNoneMatch.split(",").some((candidate) => {
    const tag = candidate.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

// spec: docs/specs/09-decision-log.md sections RD-058 (every read checks space VIEW on the page), RD-070 (a deleted page's attachments are not found)
export const GET = apiRoute<Params>(async ({ request, actor, params }) => {
  // The visibility check (readAttachment) comes before any conditional answer: a 304 must not
  // confirm that an attachment the caller cannot see exists.
  const file = await readAttachment(actor, params.attachmentId);
  const etag = `"${file.sha256}"`;
  const headers = new Headers({
    "Content-Disposition": contentDisposition(file.kind, file.filename),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    // `no-cache`: a browser may keep the bytes but must ask before every use, so EVERY read runs
    // the check above — a cached copy cannot outlive a sign-out, a removed membership or a deleted
    // page. The ETag keeps the asking cheap: a 304, decided after the check.
    "Cache-Control": "private, no-cache",
    ETag: etag,
  });
  if (matches(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  headers.set("Content-Type", file.contentType);
  headers.set("Content-Length", String(file.data.byteLength));
  return new Response(new Uint8Array(file.data), { status: 200, headers });
});

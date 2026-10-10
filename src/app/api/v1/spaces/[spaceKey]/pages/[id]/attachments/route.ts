// GET  /api/v1/spaces/{spaceKey}/pages/{id}/attachments — live attachments, newest first (VIEW)
// POST /api/v1/spaces/{spaceKey}/pages/{id}/attachments — multipart/form-data, field `file` (EDIT), 201
// spec: docs/specs/08-api-surface.md section 3; RD-058, RD-071
import { readUploadedFile } from "@/app/api/v1/_lib/body";
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { json } from "@/app/api/v1/_lib/respond";
import { listAttachments, uploadAttachment } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string; id: string };

export const GET = apiRoute<Params>(async ({ actor, params }) => {
  return json(await listAttachments(actor, params.spaceKey, params.id));
});

export const POST = apiRoute<Params>(async ({ request, actor, params }) => {
  const file = await readUploadedFile(request);
  return json(await uploadAttachment(actor, params.spaceKey, params.id, file), 201);
});

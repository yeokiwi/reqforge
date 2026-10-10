// DELETE /api/v1/spaces/{spaceKey}/pages/{id}/attachments/{attachmentId} — hides it; the bytes stay (EDIT), 204
// spec: docs/specs/08-api-surface.md section 3; RD-058
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { noContent } from "@/app/api/v1/_lib/respond";
import { hideAttachment } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string; id: string; attachmentId: string };

export const DELETE = apiRoute<Params>(async ({ actor, params }) => {
  await hideAttachment(actor, params.spaceKey, params.id, params.attachmentId);
  return noContent();
});

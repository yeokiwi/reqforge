// GET    /api/v1/spaces/{spaceKey}/pages/{id}/draft — { draft: Draft | null } (EDIT)
// PUT    /api/v1/spaces/{spaceKey}/pages/{id}/draft — autosave (EDIT)
// DELETE /api/v1/spaces/{spaceKey}/pages/{id}/draft — revert to last published, idempotent 204 (EDIT)
// spec: docs/specs/08-api-surface.md section 3; RD-055
import { parseWith, readJsonBody } from "@/app/api/v1/_lib/body";
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { json, noContent } from "@/app/api/v1/_lib/respond";
import { draftBody } from "@/app/api/v1/_lib/schemas";
import { discardDraft, getDraft, saveDraft } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string; id: string };

export const GET = apiRoute<Params>(async ({ actor, params }) => {
  return json({ draft: await getDraft(actor, params.spaceKey, params.id) });
});

export const PUT = apiRoute<Params>(async ({ request, actor, params }) => {
  const body = parseWith(draftBody, await readJsonBody(request));
  return json(await saveDraft(actor, params.spaceKey, params.id, body));
});

export const DELETE = apiRoute<Params>(async ({ actor, params }) => {
  await discardDraft(actor, params.spaceKey, params.id);
  return noContent();
});

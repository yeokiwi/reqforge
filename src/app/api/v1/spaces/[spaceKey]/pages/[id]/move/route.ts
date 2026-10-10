// POST /api/v1/spaces/{spaceKey}/pages/{id}/move — { parentId, index } within the space (EDIT)
// spec: docs/specs/08-api-surface.md section 3; RD-056, RD-067
import { parseWith, readJsonBody } from "@/app/api/v1/_lib/body";
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { json } from "@/app/api/v1/_lib/respond";
import { moveBody } from "@/app/api/v1/_lib/schemas";
import { movePage } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string; id: string };

export const POST = apiRoute<Params>(async ({ request, actor, params }) => {
  const body = parseWith(moveBody, await readJsonBody(request));
  return json(await movePage(actor, params.spaceKey, params.id, body));
});

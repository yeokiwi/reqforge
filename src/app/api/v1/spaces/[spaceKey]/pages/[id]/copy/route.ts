// POST /api/v1/spaces/{spaceKey}/pages/{id}/copy — { title? }; copies the page only (EDIT), 201
// spec: docs/specs/08-api-surface.md section 3; RD-056, RD-058
import { parseWith, readOptionalJsonBody } from "@/app/api/v1/_lib/body";
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { json } from "@/app/api/v1/_lib/respond";
import { copyBody } from "@/app/api/v1/_lib/schemas";
import { copyPage } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string; id: string };

export const POST = apiRoute<Params>(async ({ request, actor, params }) => {
  const body = parseWith(copyBody, await readOptionalJsonBody(request));
  return json(await copyPage(actor, params.spaceKey, params.id, body), 201);
});

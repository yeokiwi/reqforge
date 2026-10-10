// GET  /api/v1/spaces/{spaceKey}/pages — the whole tree, flat (VIEW)
// POST /api/v1/spaces/{spaceKey}/pages — create a page (EDIT), 201
// spec: docs/specs/08-api-surface.md section 3; RD-056
import { readOptionalJsonBody, parseWith } from "@/app/api/v1/_lib/body";
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { json } from "@/app/api/v1/_lib/respond";
import { createPageBody } from "@/app/api/v1/_lib/schemas";
import { createPage, listPageTree } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string };

export const GET = apiRoute<Params>(async ({ actor, params }) => {
  const { pages } = await listPageTree(actor, params.spaceKey);
  return json(pages);
});

export const POST = apiRoute<Params>(async ({ request, actor, params }) => {
  const body = parseWith(createPageBody, await readOptionalJsonBody(request));
  return json(await createPage(actor, params.spaceKey, body), 201);
});

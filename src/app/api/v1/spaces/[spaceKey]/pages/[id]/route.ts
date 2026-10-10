// GET    /api/v1/spaces/{spaceKey}/pages/{id}[?version=N][&format=html] — the page (VIEW)
// PUT    /api/v1/spaces/{spaceKey}/pages/{id} — publish a new version (EDIT)
// PATCH  /api/v1/spaces/{spaceKey}/pages/{id} — rename, which creates a version (EDIT)
// DELETE /api/v1/spaces/{spaceKey}/pages/{id} — soft-delete the subtree (EDIT)
// spec: docs/specs/08-api-surface.md section 3; RD-055, RD-056, RD-069
import type { GetPageResponse } from "@/domain/documents";
import { renderDocumentHtml } from "@/editor/render/to-html";
import { parseWith, readJsonBody } from "@/app/api/v1/_lib/body";
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { json } from "@/app/api/v1/_lib/respond";
import { formatQuery, publishBody, renameBody, versionQuery } from "@/app/api/v1/_lib/schemas";
import { deletePage, getPageView, publishPage, renamePage } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string; id: string };

export const GET = apiRoute<Params>(async ({ request, actor, params }) => {
  const query = new URL(request.url).searchParams;
  const version = versionQuery(query.get("version"));
  const format = formatQuery(query.get("format"));
  const view = await getPageView(actor, params.spaceKey, params.id, version);
  if (format === "html") {
    // RENDER_UNSUPPORTED from the serialiser surfaces as a 500 with that code (08 §3).
    return new Response(renderDocumentHtml(view.version.content), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }
  const body: GetPageResponse = { page: view.page, version: view.version };
  return json(body);
});

export const PUT = apiRoute<Params>(async ({ request, actor, params }) => {
  const body = parseWith(publishBody, await readJsonBody(request));
  return json(await publishPage(actor, params.spaceKey, params.id, { ...body, message: body.message ?? undefined }));
});

export const PATCH = apiRoute<Params>(async ({ request, actor, params }) => {
  const body = parseWith(renameBody, await readJsonBody(request));
  return json(await renamePage(actor, params.spaceKey, params.id, body));
});

export const DELETE = apiRoute<Params>(async ({ actor, params }) => {
  return json(await deletePage(actor, params.spaceKey, params.id));
});

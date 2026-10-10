// GET    /api/v1/spaces/{spaceKey}/pages/{id}/versions/{n} — VersionDetail (VIEW)
// DELETE /api/v1/spaces/{spaceKey}/pages/{id}/versions/{n} — delete one version (ADMIN), 204
// spec: docs/specs/08-api-surface.md section 3; RD-060
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { json, noContent } from "@/app/api/v1/_lib/respond";
import { versionSegment } from "@/app/api/v1/_lib/schemas";
import { deleteVersion, getVersion } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string; id: string; n: string };

export const GET = apiRoute<Params>(async ({ actor, params }) => {
  return json(await getVersion(actor, params.spaceKey, params.id, versionSegment(params.n)));
});

export const DELETE = apiRoute<Params>(async ({ actor, params }) => {
  await deleteVersion(actor, params.spaceKey, params.id, versionSegment(params.n));
  return noContent();
});

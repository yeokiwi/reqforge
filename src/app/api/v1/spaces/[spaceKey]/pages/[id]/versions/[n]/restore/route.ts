// POST /api/v1/spaces/{spaceKey}/pages/{id}/versions/{n}/restore — a new version from an old one (EDIT)
// spec: docs/specs/08-api-surface.md section 3; RD-060
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { json } from "@/app/api/v1/_lib/respond";
import { versionSegment } from "@/app/api/v1/_lib/schemas";
import { restoreVersion } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string; id: string; n: string };

export const POST = apiRoute<Params>(async ({ actor, params }) => {
  return json(await restoreVersion(actor, params.spaceKey, params.id, versionSegment(params.n)));
});

// GET /api/v1/spaces/{spaceKey}/pages/{id}/versions — VersionSummary[], newest first (VIEW)
// spec: docs/specs/08-api-surface.md section 3; RD-060
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { json } from "@/app/api/v1/_lib/respond";
import { listVersions } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string; id: string };

export const GET = apiRoute<Params>(async ({ actor, params }) => {
  return json(await listVersions(actor, params.spaceKey, params.id));
});

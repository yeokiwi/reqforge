// POST /api/v1/spaces/{spaceKey}/pages/{id}/presence — heartbeat; { others: UserRef[] } (VIEW)
// spec: docs/specs/08-api-surface.md section 3; RD-062
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { json } from "@/app/api/v1/_lib/respond";
import { heartbeatPresence } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string; id: string };

export const POST = apiRoute<Params>(async ({ actor, params }) => {
  return json(await heartbeatPresence(actor, params.spaceKey, params.id));
});

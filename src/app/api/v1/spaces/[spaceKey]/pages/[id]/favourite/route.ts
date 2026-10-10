// PUT / DELETE /api/v1/spaces/{spaceKey}/pages/{id}/favourite — `Save for later`, idempotent 204 (VIEW)
// spec: docs/specs/08-api-surface.md section 3; RD-061
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { noContent } from "@/app/api/v1/_lib/respond";
import { setFavourite } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string; id: string };

export const PUT = apiRoute<Params>(async ({ actor, params }) => {
  await setFavourite(actor, params.spaceKey, params.id, true);
  return noContent();
});

export const DELETE = apiRoute<Params>(async ({ actor, params }) => {
  await setFavourite(actor, params.spaceKey, params.id, false);
  return noContent();
});

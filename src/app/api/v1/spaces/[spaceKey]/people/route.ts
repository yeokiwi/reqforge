// GET /api/v1/spaces/{spaceKey}/people?q= — up to 10 people who can view the space, by name (VIEW)
// spec: docs/specs/08-api-surface.md section 3 (GET /people); 10 §5.5
import { apiRoute } from "@/app/api/v1/_lib/handler";
import { json } from "@/app/api/v1/_lib/respond";
import { listPeople } from "@/server/usecases/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { spaceKey: string };

export const GET = apiRoute<Params>(async ({ request, actor, params }) => {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return json({ people: await listPeople(actor, params.spaceKey, q) });
});

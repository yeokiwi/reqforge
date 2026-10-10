// Any /api/v1 path no route serves: a problem+json 404 (spec 08 §3.2), not the app's HTML
// not-found page, so an API client always gets the error shape it branches on.
//
// Next matches every concrete route (static and dynamic segments) before a catch-all, so this
// never shadows a real route. It goes through apiRoute like every other handler: a
// state-changing request still needs a same-site Origin (403 ORIGIN_MISMATCH) and every request
// a valid session (401 UNAUTHENTICATED) before it is told the path does not exist — an unknown
// path is never a weaker gate than a known one.
// spec: docs/specs/08-api-surface.md sections 1 and 3.2 (NOT_FOUND); docs/specs/09-decision-log.md section RD-064
import { NotFoundError } from "@/domain/errors";
import { apiRoute } from "@/app/api/v1/_lib/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { path: string[] };

const notFound = apiRoute<Params>(async () => {
  throw new NotFoundError("Resource");
});

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;

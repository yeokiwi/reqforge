// Any /api/v1 path no route serves: a problem+json 404, not the app's HTML not-found page, so
// API clients always get the error shape of spec 08 §3.2. Next matches every concrete route
// before this catch-all.
import { NotFoundError } from "@/domain/errors";
import { problemResponse } from "@/app/api/v1/_lib/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function notFound(): Promise<Response> {
  return problemResponse(new NotFoundError("Resource"));
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;

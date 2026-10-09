import { NextResponse } from "next/server";
import { checkHealth } from "@/server/usecases/health";

export const dynamic = "force-dynamic";

/** Readiness probe for Docker, CI and load balancers. Unauthenticated; reveals nothing sensitive. */
export async function GET() {
  const health = await checkHealth();
  return NextResponse.json(health, { status: health.status === "ok" ? 200 : 503 });
}

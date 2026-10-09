import { pingDatabase } from "@/server/repositories/health";

export interface Health {
  readonly status: "ok" | "degraded";
  readonly database: boolean;
}

export async function checkHealth(): Promise<Health> {
  const database = await pingDatabase();
  return { status: database ? "ok" : "degraded", database };
}

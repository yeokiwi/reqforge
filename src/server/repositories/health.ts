import { prisma } from "./client";

/** True when the database answers a trivial query. Never throws. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

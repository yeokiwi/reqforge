import { PrismaClient } from "@prisma/client";

// One client per process. Kept on globalThis so Next's dev-mode module reloads do not open
// a new connection pool on every edit.
const globalForPrisma = globalThis as unknown as { __reqforgePrisma?: PrismaClient };

export const prisma: PrismaClient = (globalForPrisma.__reqforgePrisma ??= new PrismaClient({
  log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
}));

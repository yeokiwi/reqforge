import { PrismaClient } from "@prisma/client";

// One client per process. Kept on globalThis so Next's dev-mode module reloads do not open
// a new connection pool on every edit.
const globalForPrisma = globalThis as unknown as { __reqforgePrisma?: PrismaClient };

// Prisma's own "error" log is off on purpose: every refusal the database makes on our behalf
// (TITLE_TAKEN's unique violation, a tree-guard trigger) is an expected outcome that `mapDbError`
// turns into a typed error, and Prisma would print each as a multi-line stack. Genuine faults
// surface as exceptions and are logged where they are handled (`problemResponse`, Next).
export const prisma: PrismaClient = (globalForPrisma.__reqforgePrisma ??= new PrismaClient({
  log: process.env.NODE_ENV === "production" ? [] : ["warn"],
}));

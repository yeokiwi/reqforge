import { PrismaClient } from '@prisma/client';

/**
 * The single Prisma client. CLAUDE.md: "Database access goes through
 * `src/server/repositories/**`. No Prisma client imports in route handlers or components."
 */
const globalForPrisma = globalThis as unknown as { reqforgePrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.reqforgePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.reqforgePrisma = prisma;
}

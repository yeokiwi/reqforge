import { PrismaClient } from '@prisma/client';

/**
 * The single Prisma client. CLAUDE.md: "Database access goes through
 * `src/server/repositories/**`. No Prisma client imports in route handlers or components."
 */
const globalForPrisma = globalThis as unknown as { reqforgePrisma?: PrismaClient };

/**
 * PRISMA_QUERY_EVENTS=1 makes the client emit a `query` event per statement, which the
 * no-N+1 test counts (spec 04 §2.5: "Never N+1"). It is off everywhere else.
 */
const queryEvents = process.env.PRISMA_QUERY_EVENTS === '1';

function createClient(): PrismaClient {
  if (queryEvents) {
    return new PrismaClient({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.reqforgePrisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.reqforgePrisma = prisma;
}

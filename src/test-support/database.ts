// Helpers for tests that need a real Postgres (integration and e2e).
//
// Safety: these helpers TRUNCATE every table. They refuse to touch any database whose name
// does not end in `_test` or `_e2e`, so pointing them at a development database by mistake
// fails loudly instead of wiping it.
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const SAFE_NAME = /^[a-z][a-z0-9_]*_(test|e2e)$/;

export const DEFAULT_TEST_DATABASE_URL = "postgresql://reqforge:reqforge@localhost:5432/reqforge_test?schema=public";
export const DEFAULT_E2E_DATABASE_URL = "postgresql://reqforge:reqforge@localhost:5432/reqforge_e2e?schema=public";

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

export function assertDisposableDatabase(url: string): void {
  const name = databaseName(url);
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      `Refusing to use database "${name}" for tests: its name must end in _test or _e2e ` +
        "because tests truncate every table.",
    );
  }
}

/** Creates the database if it does not exist (needs CREATE DATABASE on the server). */
export async function ensureDatabase(url: string): Promise<void> {
  assertDisposableDatabase(url);
  const name = databaseName(url);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const prisma = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  try {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS exists`;
    // The name passed SAFE_NAME above, so interpolating it into DDL is safe.
    if (!rows[0]?.exists) await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await prisma.$disconnect();
  }
}

/** Applies every migration (`prisma migrate deploy`) to the given database. */
export function migrateDatabase(url: string): void {
  assertDisposableDatabase(url);
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

/** Empties every table except Prisma's own bookkeeping. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  assertDisposableDatabase(url);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename.replace(/"/g, '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

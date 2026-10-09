import { DEFAULT_TEST_DATABASE_URL, ensureDatabase, migrateDatabase } from "./database";

// Runs once before the integration project: make sure the throwaway database exists and
// is migrated. TEST_DATABASE_URL overrides the default; vitest.config.ts passes the same
// value to the test workers as DATABASE_URL.
export async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  await ensureDatabase(url);
  migrateDatabase(url);
}

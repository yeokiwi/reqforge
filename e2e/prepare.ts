// Runs before the e2e web server starts (see playwright.config.ts): create the throwaway
// database if needed and migrate it. Tests reset and seed it themselves, per test.
import { DEFAULT_E2E_DATABASE_URL, ensureDatabase, migrateDatabase } from "../src/test-support/database";

async function main(): Promise<void> {
  const url = process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;
  await ensureDatabase(url);
  migrateDatabase(url);
  console.log("e2e database ready");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

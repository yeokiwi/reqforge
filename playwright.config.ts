import { defineConfig, devices } from "@playwright/test";
import { DEFAULT_E2E_DATABASE_URL } from "./src/test-support/database";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;

// The tests reset and seed the database themselves, and both the test process and the web
// server must point at the same throwaway database.
process.env.DATABASE_URL = DATABASE_URL;

export default defineConfig({
  testDir: "e2e",
  // One database, one server-side login throttle: tests run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1920, height: 1080 }, // the GUI review gate compares at 1920×1080 (PLAN.md)
  },
  webServer: {
    // Prepare the database, build, then serve the production bundle — what ships is what is tested.
    command: `pnpm exec tsx e2e/prepare.ts && pnpm build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { DATABASE_URL, NODE_ENV: "production" },
  },
});

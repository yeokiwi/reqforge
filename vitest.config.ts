import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { DEFAULT_TEST_DATABASE_URL } from "./src/test-support/database";

const alias = { "@": path.resolve(__dirname, "src") };

// Two projects:
//   unit        — pure and DB-free; this is what `pnpm verify` runs.
//   integration — needs Postgres; CI runs it in its own step (`pnpm test:integration`, which
//                 passes --no-file-parallelism because every file shares one database).
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          setupFiles: ["./src/test-support/vitest-setup.ts"],
          include: ["src/**/__tests__/**/*.test.{ts,tsx}", "scripts/__tests__/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
        },
      },
      {
        // The JSX transform is here too: API integration tests reach the server renderer
        // (`?format=html`), which is TSX.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/__tests__/**/*.integration.test.ts"],
          globalSetup: ["./src/test-support/integration-global-setup.ts"],
          env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL },
          testTimeout: 30_000,
        },
      },
    ],
  },
});

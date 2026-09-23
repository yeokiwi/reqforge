import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The performance suite (spec 07 §5, RD-073). Separate from `pnpm verify` so it runs alone:
 * a budget measured while forty other test files share the database measures them too.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/perf/**/*.perf.ts'],
    globals: false,
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 1_800_000,
  },
});

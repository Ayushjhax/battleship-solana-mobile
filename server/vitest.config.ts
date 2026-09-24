import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// tsx (dev/start) resolves the @engine/* path alias from tsconfig.json
// natively; Vite/vitest does not, so it needs the same mapping here.
export default defineConfig({
  test: {
    // src/**: the original co-located unit tests.
    // tests/**: the structured suite (unit / integration / regression).
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    /**
     * Files run ONE AT A TIME, on purpose.
     *
     * This suite mixes two kinds of test that cannot share a CPU:
     *   - socket tests (room.test.ts, matchmaker.test.ts) whose assertions ride
     *     on real wall-clock timers — a 4 s forfeit clock waited on for 6 s
     *   - PGlite integration tests (city-db, city-api, raid-db, raid-api) that
     *     each boot a full WASM Postgres and saturate a core doing it
     *
     * In parallel the second starves the first, and room.test.ts's "still
     * forfeits the absentee when only one of the two returns" times out waiting
     * for a message that the server did send, just late. That is a false
     * failure: the code is correct and the test is correct.
     *
     * The alternative was to widen the socket tests' timeouts, which hides real
     * slowness, or to shrink the forfeit clock, which weakens the assertion.
     * Serial costs ~35 s of wall time per run and changes no test at all.
     */
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('../src/engine', import.meta.url)),
    },
  },
});

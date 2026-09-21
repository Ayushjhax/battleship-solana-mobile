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

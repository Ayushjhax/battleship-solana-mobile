import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// tsx (dev/start) resolves the @engine/* path alias from tsconfig.json
// natively; Vite/vitest does not, so it needs the same mapping here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('../src/engine', import.meta.url)),
    },
  },
});

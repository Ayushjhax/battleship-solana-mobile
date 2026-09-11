import { defineConfig } from 'vitest/config';

// The engine is pure TypeScript: it runs under plain Node with zero React Native
// shims. Placement's zustand store is included because it is also renderer-free
// and its fuel/refund invariants are part of the rules boundary.
export default defineConfig({
  test: {
    include: ['src/engine/**/*.test.ts', 'src/state/__tests__/placement.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The engine is pure TypeScript: it runs under plain Node with zero React Native
// shims. Placement's zustand store is included because it is also renderer-free
// and its fuel/refund invariants are part of the rules boundary. The match
// client (P13) is too — real sockets against a fake server that speaks the
// frozen protocol; only src/net/api.ts (Supabase) is mocked there.
export default defineConfig({
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: [
      'src/engine/**/*.test.ts',
      'src/state/__tests__/*.test.ts',
      'src/features/offline/**/*.test.ts',
      'src/features/demo/**/*.test.ts',
      // The placement -> match boundary: pure, and the one place a player's
      // arranged board can be silently swapped for another.
      'src/features/battle/**/*.test.ts',
      'src/net/__tests__/*.test.ts',
    ],
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 15000,
  },
});

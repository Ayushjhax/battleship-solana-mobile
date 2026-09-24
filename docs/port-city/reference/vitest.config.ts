/**
 * The reference has no config of its own, so `vitest run` used to walk up to
 * `my-app/vitest.config.ts`, inherit that include list, find no files under
 * THIS directory and exit 0 — a suite that never ran. DECISIONS.md D9 recorded
 * the trap; this file is the fix. Run it with `npm test` from this folder.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});

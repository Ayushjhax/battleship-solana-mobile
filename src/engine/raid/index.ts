/**
 * Harbour raids — the public surface for `@engine/raid`.
 *
 * Like `@engine/city`, deliberately NOT re-exported from src/engine/index.ts:
 * that barrel uses `export *` and names like `startRaid`, `settleRaid` and
 * `HARBOUR_CAPS` have no business in the match engine's vocabulary.
 */
export * from './types';
export * from './raid';
export * from './view';
export * from './harbour';
export * from './scoring';

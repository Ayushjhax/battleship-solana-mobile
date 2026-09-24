/**
 * The Port City rules — the public surface for `@engine/city`.
 *
 * Deliberately NOT re-exported from src/engine/index.ts: that barrel uses
 * `export *`, and names like `collect`, `settle` and `maxLevel` would collide
 * with the match engine's vocabulary. Import from '@engine/city' instead.
 */
export * from './types';
export * from './catalogue';
export * from './settle';
export * from './actions';
export * from './migrate';
export * from './research';

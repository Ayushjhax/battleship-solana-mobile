/**
 * Cosmetics — the public surface for `@engine/cosmetics`.
 *
 * Not re-exported from src/engine/index.ts, like city, raid, fleets and
 * bounties: that barrel uses `export *` and `DEFAULTS` would collide.
 */
export * from './catalogue';
export * from './contrast';
export * from './visibility';

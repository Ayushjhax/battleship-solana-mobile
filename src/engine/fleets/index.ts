/**
 * Fleets — the public surface for `@engine/fleets`.
 *
 * ⚠ Not to be confused with `@engine/fleet` (SINGULAR), which is the eight
 * ships. See ./types.ts's header. Deliberately NOT re-exported from
 * src/engine/index.ts, for the same reason city and raid are not: that barrel
 * uses `export *`, and `FLEET_ROLES` has no business in the match engine's
 * vocabulary next to `FLEET_SPEC`.
 */
export * from './types';
export * from './roles';
export * from './donations';
export * from './war';
export * from './matchmaking';
export * from './chat';
export * from './raidPolicy';
export * from './flagHall';

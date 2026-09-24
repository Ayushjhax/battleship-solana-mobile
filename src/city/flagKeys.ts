/**
 * The Port City feature-flag names — data, no imports.
 *
 * Split out of `features.ts` because that file imports `./api`, which reaches
 * expo-sqlite's localStorage shim at module scope and cannot load under
 * vitest's node environment (DECISIONS.md D18). The NAMES are just strings,
 * and they are worth asserting on: the client and the server each keep their
 * own list, and a typo in either is a feature that silently never turns on.
 *
 * `server/src/features.ts` holds the mirror. A test pins the two together.
 */
export const CITY_FLAGS = [
  'portCity.core',
  'portCity.cosmetics',
  'portCity.bounties',
  'portCity.academy',
  'portCity.raids',
  'portCity.fleets',
  'portCity.gazette',
  'portCity.voyages',
  'portCity.captains',
  'portCity.seas',
  'portCity.worldBoss',
  'portCity.empire',
] as const;

export type CityFlag = (typeof CITY_FLAGS)[number];

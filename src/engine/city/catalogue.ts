/**
 * The city catalogue — ONE exported table, transcribed from
 * docs/port-city/NUMBERS.md. Do not tune a number here: change NUMBERS.md (or
 * rather the reference simulation that generates it) and move both together.
 *
 * `catalogueChecksum()` plus the cross-file test in __tests__/catalogue.test.ts
 * are what stop a number moving by accident — the same discipline
 * src/engine/__tests__/ranks.test.ts applies to the rank ladder.
 *
 * PURITY: imports only this folder's types. See ./types.ts.
 */
import type { BuildingId, BuildingSpec, CityState, LevelSpec } from './types';

/** Minutes in an hour and a day, so the table reads like NUMBERS.md does. */
const h = 60;
const d = 24 * 60;

export const CITY_CATALOGUE: Readonly<Record<BuildingId, BuildingSpec>> = {
  admiralty: {
    id: 'admiralty',
    name: 'Admiralty',
    kind: 'core',
    levels: [
      { steel: 0, coins: 0, minutes: 0, reqAdmiralty: 0 },
      { steel: 300, coins: 100, minutes: 2, reqAdmiralty: 1 },
      { steel: 900, coins: 300, minutes: 30, reqAdmiralty: 2 },
      { steel: 3_000, coins: 1_000, minutes: 3 * h, reqAdmiralty: 3 },
      { steel: 9_000, coins: 3_000, minutes: 10 * h, reqAdmiralty: 4 },
      { steel: 22_000, coins: 7_000, minutes: 20 * h, reqAdmiralty: 5 },
      { steel: 50_000, coins: 15_000, minutes: 36 * h, reqAdmiralty: 6 },
      { steel: 110_000, coins: 32_000, minutes: 3 * d, reqAdmiralty: 7 },
    ],
  },
  scrapyard: {
    id: 'scrapyard',
    name: 'Scrapyard',
    kind: 'core',
    levels: [
      { steel: 0, coins: 0, minutes: 0, reqAdmiralty: 0, value: 0 },
      { steel: 600, coins: 150, minutes: 30, reqAdmiralty: 2, value: 5 },
      { steel: 2_000, coins: 500, minutes: 2 * h, reqAdmiralty: 3, value: 10 },
      { steel: 6_000, coins: 1_500, minutes: 8 * h, reqAdmiralty: 4, value: 15 },
      { steel: 15_000, coins: 4_000, minutes: 16 * h, reqAdmiralty: 5, value: 20 },
      { steel: 35_000, coins: 9_000, minutes: 1 * d, reqAdmiralty: 6, value: 25 },
    ],
  },
  fish_market: {
    id: 'fish_market',
    name: 'Fish Market',
    kind: 'producer',
    produces: 'coins',
    capacityHours: 12,
    levels: [
      { steel: 150, coins: 0, minutes: 1, reqAdmiralty: 1, value: 12 },
      { steel: 500, coins: 100, minutes: 15, reqAdmiralty: 2, value: 18 },
      { steel: 1_400, coins: 350, minutes: 1 * h, reqAdmiralty: 3, value: 26 },
      { steel: 3_500, coins: 900, minutes: 4 * h, reqAdmiralty: 4, value: 38 },
      { steel: 8_000, coins: 2_200, minutes: 9 * h, reqAdmiralty: 5, value: 54 },
      { steel: 18_000, coins: 5_000, minutes: 18 * h, reqAdmiralty: 6, value: 74 },
      { steel: 38_000, coins: 10_000, minutes: 32 * h, reqAdmiralty: 7, value: 98 },
      { steel: 75_000, coins: 20_000, minutes: 2 * d, reqAdmiralty: 8, value: 128 },
    ],
  },
  foundry: {
    id: 'foundry',
    name: 'Foundry',
    kind: 'producer',
    produces: 'steel',
    capacityHours: 12,
    levels: [
      { steel: 150, coins: 0, minutes: 2, reqAdmiralty: 2, value: 20 },
      { steel: 700, coins: 150, minutes: 20, reqAdmiralty: 2, value: 30 },
      { steel: 1_800, coins: 400, minutes: 90, reqAdmiralty: 3, value: 44 },
      { steel: 4_500, coins: 1_000, minutes: 5 * h, reqAdmiralty: 4, value: 62 },
      { steel: 10_000, coins: 2_400, minutes: 11 * h, reqAdmiralty: 5, value: 86 },
      { steel: 22_000, coins: 5_500, minutes: 20 * h, reqAdmiralty: 6, value: 118 },
      { steel: 45_000, coins: 11_000, minutes: 36 * h, reqAdmiralty: 7, value: 158 },
      { steel: 88_000, coins: 22_000, minutes: 60 * h, reqAdmiralty: 8, value: 206 },
    ],
  },
  shipyard: {
    id: 'shipyard',
    name: 'Shipyard',
    kind: 'feature',
    feature: 'cosmetics',
    levels: [
      { steel: 300, coins: 200, minutes: 10, reqAdmiralty: 1, value: 1 },
      { steel: 1_500, coins: 800, minutes: 2 * h, reqAdmiralty: 3, value: 2 },
      { steel: 6_000, coins: 3_000, minutes: 10 * h, reqAdmiralty: 5, value: 3 },
      { steel: 20_000, coins: 9_000, minutes: 1 * d, reqAdmiralty: 7, value: 4 },
    ],
  },
  stationery: {
    id: 'stationery',
    name: "Stationer's Shop",
    kind: 'feature',
    feature: 'cosmetics',
    levels: [
      { steel: 400, coins: 250, minutes: 15, reqAdmiralty: 2, value: 1 },
      { steel: 1_800, coins: 900, minutes: 3 * h, reqAdmiralty: 4, value: 2 },
      { steel: 7_000, coins: 3_500, minutes: 12 * h, reqAdmiralty: 6, value: 3 },
      { steel: 22_000, coins: 10_000, minutes: 1 * d, reqAdmiralty: 8, value: 4 },
    ],
  },
  harbour_office: {
    id: 'harbour_office',
    name: "Harbour Master's Office",
    kind: 'feature',
    feature: 'bounties',
    levels: [
      { steel: 250, coins: 100, minutes: 5, reqAdmiralty: 1, value: 3 },
      { steel: 2_000, coins: 700, minutes: 4 * h, reqAdmiralty: 3, value: 4 },
      { steel: 9_000, coins: 3_500, minutes: 16 * h, reqAdmiralty: 5, value: 5 },
    ],
  },
  naval_academy: {
    id: 'naval_academy',
    name: 'Naval Academy',
    kind: 'feature',
    feature: 'academy',
    levels: [
      { steel: 2_500, coins: 800, minutes: 2 * h, reqAdmiralty: 3, value: 1 },
      { steel: 6_000, coins: 2_000, minutes: 8 * h, reqAdmiralty: 4, value: 2 },
      { steel: 14_000, coins: 5_000, minutes: 20 * h, reqAdmiralty: 5, value: 3 },
      { steel: 32_000, coins: 12_000, minutes: 36 * h, reqAdmiralty: 6, value: 4 },
      { steel: 70_000, coins: 25_000, minutes: 60 * h, reqAdmiralty: 7, value: 5 },
    ],
  },
  coastal_command: {
    id: 'coastal_command',
    name: 'Coastal Command',
    kind: 'feature',
    feature: 'raids',
    levels: [
      { steel: 2_000, coins: 600, minutes: 1 * h, reqAdmiralty: 3, value: 50 },
      { steel: 5_000, coins: 1_600, minutes: 6 * h, reqAdmiralty: 4, value: 70 },
      { steel: 12_000, coins: 4_000, minutes: 14 * h, reqAdmiralty: 5, value: 90 },
      { steel: 28_000, coins: 9_000, minutes: 1 * d, reqAdmiralty: 6, value: 110 },
      { steel: 60_000, coins: 18_000, minutes: 2 * d, reqAdmiralty: 7, value: 130 },
      { steel: 120_000, coins: 36_000, minutes: 3 * d, reqAdmiralty: 8, value: 150 },
    ],
  },
  armory: {
    id: 'armory',
    name: 'Armory',
    kind: 'feature',
    feature: 'raids',
    levels: [
      { steel: 1_800, coins: 600, minutes: 1 * h, reqAdmiralty: 3, value: 40 },
      { steel: 4_500, coins: 1_500, minutes: 6 * h, reqAdmiralty: 4, value: 60 },
      { steel: 11_000, coins: 3_800, minutes: 14 * h, reqAdmiralty: 5, value: 80 },
      { steel: 26_000, coins: 8_500, minutes: 1 * d, reqAdmiralty: 6, value: 100 },
      { steel: 55_000, coins: 17_000, minutes: 2 * d, reqAdmiralty: 7, value: 120 },
    ],
  },
  fleet_hall: {
    id: 'fleet_hall',
    name: 'Fleet Hall',
    kind: 'feature',
    feature: 'fleets',
    levels: [
      { steel: 5_000, coins: 2_000, minutes: 4 * h, reqAdmiralty: 4, value: 20 },
      { steel: 12_000, coins: 5_000, minutes: 12 * h, reqAdmiralty: 5, value: 30 },
      { steel: 28_000, coins: 11_000, minutes: 1 * d, reqAdmiralty: 6, value: 40 },
      { steel: 60_000, coins: 22_000, minutes: 2 * d, reqAdmiralty: 7, value: 50 },
      { steel: 120_000, coins: 45_000, minutes: 3 * d, reqAdmiralty: 8, value: 60 },
    ],
  },
  newsstand: {
    id: 'newsstand',
    name: 'Newsstand',
    kind: 'feature',
    feature: 'gazette',
    levels: [
      { steel: 500, coins: 200, minutes: 20, reqAdmiralty: 2, value: 1 },
      { steel: 3_000, coins: 1_200, minutes: 6 * h, reqAdmiralty: 4, value: 2 },
      { steel: 12_000, coins: 5_000, minutes: 18 * h, reqAdmiralty: 6, value: 3 },
    ],
  },
  trade_docks: {
    id: 'trade_docks',
    name: 'Trade Docks',
    kind: 'feature',
    feature: 'voyages',
    levels: [
      { steel: 4_000, coins: 1_500, minutes: 3 * h, reqAdmiralty: 4, value: 1 },
      { steel: 14_000, coins: 5_000, minutes: 16 * h, reqAdmiralty: 6, value: 2 },
      { steel: 40_000, coins: 15_000, minutes: 2 * d, reqAdmiralty: 8, value: 3 },
    ],
  },
  officers_club: {
    id: 'officers_club',
    name: "Officers' Club",
    kind: 'feature',
    feature: 'captains',
    levels: [
      { steel: 10_000, coins: 4_000, minutes: 10 * h, reqAdmiralty: 5, value: 1 },
      { steel: 26_000, coins: 10_000, minutes: 1 * d, reqAdmiralty: 6, value: 2 },
      { steel: 60_000, coins: 24_000, minutes: 2 * d, reqAdmiralty: 7, value: 3 },
    ],
  },
  lighthouse: {
    id: 'lighthouse',
    name: 'Lighthouse',
    kind: 'feature',
    feature: 'seas',
    levels: [
      { steel: 9_000, coins: 3_500, minutes: 8 * h, reqAdmiralty: 5, value: 1 },
      { steel: 22_000, coins: 8_000, minutes: 20 * h, reqAdmiralty: 6, value: 2 },
      { steel: 48_000, coins: 18_000, minutes: 2 * d, reqAdmiralty: 7, value: 3 },
      { steel: 100_000, coins: 38_000, minutes: 3 * d, reqAdmiralty: 8, value: 4 },
    ],
  },
};

/** Every id in the catalogue, in a stable order. */
export const BUILDING_IDS = Object.keys(CITY_CATALOGUE) as readonly BuildingId[];

export function isBuildingId(id: string): id is BuildingId {
  return Object.prototype.hasOwnProperty.call(CITY_CATALOGUE, id);
}

export function maxLevel(id: BuildingId): number {
  return CITY_CATALOGUE[id].levels.length;
}

/** The spec for the level a building is CURRENTLY at, or null at level 0. */
export function specAtLevel(id: BuildingId, level: number): LevelSpec | null {
  if (level <= 0 || level > maxLevel(id)) return null;
  return CITY_CATALOGUE[id].levels[level - 1] ?? null;
}

/** What it costs to reach the next level, or null at max. */
export function nextLevelSpec(state: CityState, id: BuildingId): LevelSpec | null {
  const target = state.buildings[id].level + 1;
  if (target > maxLevel(id)) return null;
  return CITY_CATALOGUE[id].levels[target - 1] ?? null;
}

/** Production per hour at a level. 0 for anything that is not a producer. */
export function rateOf(id: BuildingId, level: number): number {
  if (CITY_CATALOGUE[id].kind !== 'producer') return 0;
  return specAtLevel(id, level)?.value ?? 0;
}

/** How much a collector holds before it stops: rate x capacityHours. */
export function capacityOf(id: BuildingId, level: number): number {
  const spec = CITY_CATALOGUE[id];
  return spec.capacityHours ? rateOf(id, level) * spec.capacityHours : 0;
}

/** The Scrapyard's salvage bonus, as a whole percentage. */
export function salvageBonusPercent(scrapyardLevel: number): number {
  return specAtLevel('scrapyard', scrapyardLevel)?.value ?? 0;
}

// ---------------------------------------------------------------------------
// The numbers that are not per-building
// ---------------------------------------------------------------------------

/** NUMBERS.md > Salvage. */
export const STARTING_GRANT = { steel: 400, gems: 50 } as const;
export const SALVAGE_PER_CELL = 5;

/** part-01 §2.2 — offline/hot-seat matches that still pay salvage, per UTC day. */
export const OFFLINE_REWARD_CAP = 10;

/**
 * NUMBERS.md > Dock workers. Indexed by how many you already have, so
 * WORKER_GEM_COST[2] is the price of the third. Two are free.
 */
export const WORKER_GEM_COST: readonly number[] = [0, 0, 100, 250];
export const WORKER_ADMIRALTY_REQ: readonly number[] = [0, 0, 3, 5];
export const MAX_WORKERS = WORKER_GEM_COST.length;

/** part-01 §2.6 — gems granted for completing each Admiralty level. */
export const ADMIRALTY_GEM_GRANT: Readonly<Record<number, number>> = {
  2: 10,
  3: 15,
  4: 25,
  5: 40,
  6: 60,
  7: 90,
  8: 150,
};

/**
 * part-01 §2.7 — cumulative gem back-pay for ranks a profile has already
 * reached. Keyed by the rank's cumulative point threshold from
 * src/engine/ranks.ts, which this module may not import (purity), so
 * __tests__/catalogue.test.ts pins the two against each other.
 */
export const RANK_GEM_BACKPAY: readonly { readonly points: number; readonly gems: number }[] = [
  { points: 100, gems: 10 }, // Seaman Apprentice
  { points: 400, gems: 20 }, // Petty Officer Second Class
  { points: 1_000, gems: 40 }, // Chief Ship Petty Officer
  { points: 3_000, gems: 80 }, // Captain
  { points: 10_000, gems: 150 }, // Vice-admiral
];

/** Total back-pay owed to a profile at `rankPoints`. Cumulative, so it sums. */
export function rankBackPayGems(rankPoints: number): number {
  let total = 0;
  for (const band of RANK_GEM_BACKPAY) if (rankPoints >= band.points) total += band.gems;
  return total;
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

/**
 * A canonical serialisation of every number in the table. Field order is fixed
 * here rather than taken from Object.keys, so a reordering of the literal
 * cannot change the checksum while a value change always does.
 */
export function catalogueFingerprint(): string {
  const parts: string[] = [];
  for (const id of BUILDING_IDS) {
    const spec = CITY_CATALOGUE[id];
    parts.push(`${spec.id}|${spec.kind}|${spec.produces ?? '-'}|${spec.capacityHours ?? 0}|${spec.feature ?? '-'}`);
    for (const level of spec.levels) {
      parts.push(`${level.steel},${level.coins},${level.minutes},${level.reqAdmiralty},${level.value ?? '-'}`);
    }
  }
  parts.push(`grant:${STARTING_GRANT.steel},${STARTING_GRANT.gems}`);
  parts.push(`salvage:${SALVAGE_PER_CELL}`);
  parts.push(`offlineCap:${OFFLINE_REWARD_CAP}`);
  parts.push(`workers:${WORKER_GEM_COST.join('/')};${WORKER_ADMIRALTY_REQ.join('/')}`);
  parts.push(`admiraltyGems:${Object.keys(ADMIRALTY_GEM_GRANT).map((k) => `${k}=${ADMIRALTY_GEM_GRANT[Number(k)]}`).join(',')}`);
  parts.push(`backpay:${RANK_GEM_BACKPAY.map((b) => `${b.points}=${b.gems}`).join(',')}`);
  return parts.join(';');
}

/**
 * FNV-1a over the fingerprint. The engine may not import hashString from
 * src/ui (purity), so the same eight lines live here.
 */
export function catalogueChecksum(): number {
  const key = catalogueFingerprint();
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

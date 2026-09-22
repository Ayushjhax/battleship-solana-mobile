// Port City economy (Part 1). Pure rules: every function takes `now` (server
// time, ms) and never reads a clock itself.

export type BuildingId =
  | 'admiralty'
  | 'scrapyard'
  | 'fish_market'
  | 'foundry'
  | 'shipyard'
  | 'stationery'
  | 'harbour_office'
  | 'naval_academy'
  | 'coastal_command'
  | 'armory'
  | 'fleet_hall'
  | 'newsstand'
  | 'trade_docks'
  | 'officers_club'
  | 'lighthouse';

export type LevelSpec = {
  steel: number;
  coins: number;
  minutes: number;
  reqAdmiralty: number;
  /** Production per hour for producers, effect value for the rest. */
  value?: number;
};

export type BuildingSpec = {
  id: BuildingId;
  name: string;
  kind: 'core' | 'producer' | 'feature';
  produces?: 'coins' | 'steel';
  capacityHours?: number;
  feature?: string; // feature flag that must be on for the plot to appear
  levels: LevelSpec[]; // index 0 = cost of reaching level 1
};

const h = 60;
const d = 24 * 60;

export const CATALOGUE: Record<BuildingId, BuildingSpec> = {
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

export const maxLevel = (id: BuildingId) => CATALOGUE[id].levels.length;

// ------------------------------------------------------------------ state ---

export type BuildingState = {
  level: number; // 0 = not built yet
  upgrading?: { toLevel: number; startedAt: number; endsAt: number };
  stored: number;
  lastAccrualAt: number;
};

export type CityState = {
  coins: number;
  steel: number;
  gems: number;
  workers: number;
  scrapPile: number; // salvage waiting in the Scrapyard
  buildings: Record<BuildingId, BuildingState>;
  updatedAt: number;
};

export const STARTING_GRANT = { steel: 400, gems: 50 };

export function newCity(now: number, coins = 0): CityState {
  const buildings = {} as Record<BuildingId, BuildingState>;
  for (const id of Object.keys(CATALOGUE) as BuildingId[])
    buildings[id] = { level: 0, stored: 0, lastAccrualAt: now };
  buildings.admiralty.level = 1;
  buildings.scrapyard.level = 1;
  return {
    coins,
    steel: STARTING_GRANT.steel,
    gems: STARTING_GRANT.gems,
    workers: 2,
    scrapPile: 0,
    buildings,
    updatedAt: now,
  };
}

export const busyWorkers = (s: CityState) =>
  (Object.keys(s.buildings) as BuildingId[]).filter((id) => s.buildings[id].upgrading).length;

export const freeWorkers = (s: CityState) => s.workers - busyWorkers(s);

export const rateOf = (id: BuildingId, level: number) =>
  level > 0 ? CATALOGUE[id].levels[level - 1].value ?? 0 : 0;

export const capacityOf = (id: BuildingId, level: number) => {
  const spec = CATALOGUE[id];
  return spec.capacityHours ? rateOf(id, level) * spec.capacityHours : 0;
};

function accrueTo(s: CityState, id: BuildingId, upto: number) {
  const spec = CATALOGUE[id];
  if (spec.kind !== 'producer') return;
  const b = s.buildings[id];
  if (b.level === 0) {
    b.lastAccrualAt = upto;
    return;
  }
  const rate = rateOf(id, b.level);
  const cap = capacityOf(id, b.level);
  if (upto <= b.lastAccrualAt || rate <= 0) return;
  if (b.stored >= cap) {
    b.lastAccrualAt = upto;
    return;
  }
  const produced = Math.floor((rate * (upto - b.lastAccrualAt)) / 3_600_000);
  const add = Math.min(produced, cap - b.stored);
  b.stored += add;
  if (b.stored >= cap) b.lastAccrualAt = upto;
  else b.lastAccrualAt += Math.ceil((add * 3_600_000) / rate);
}

/** Completes every finished upgrade in time order and accrues production around them. */
export function settle(s: CityState, now: number): CityState {
  const ids = Object.keys(s.buildings) as BuildingId[];
  for (;;) {
    const due = ids
      .filter((id) => s.buildings[id].upgrading && s.buildings[id].upgrading!.endsAt <= now)
      .sort((a, b) => s.buildings[a].upgrading!.endsAt - s.buildings[b].upgrading!.endsAt);
    if (!due.length) break;
    const id = due[0];
    const at = s.buildings[id].upgrading!.endsAt;
    for (const p of ids) accrueTo(s, p, at);
    s.buildings[id].level = s.buildings[id].upgrading!.toLevel;
    s.buildings[id].upgrading = undefined;
  }
  for (const p of ids) accrueTo(s, p, now);
  s.updatedAt = now;
  return s;
}

export type CityError =
  | 'unknown-building'
  | 'max-level'
  | 'already-upgrading'
  | 'no-free-worker'
  | 'needs-admiralty'
  | 'not-enough-steel'
  | 'not-enough-coins'
  | 'not-enough-gems'
  | 'not-upgrading'
  | 'nothing-to-collect'
  | 'feature-off';

export function nextLevelSpec(s: CityState, id: BuildingId): LevelSpec | null {
  const b = s.buildings[id];
  const target = b.level + 1;
  if (target > maxLevel(id)) return null;
  return CATALOGUE[id].levels[target - 1];
}

export function canStart(
  s: CityState,
  id: BuildingId,
  now: number,
  features: Set<string> = new Set(['cosmetics', 'bounties', 'academy', 'raids', 'fleets', 'gazette', 'voyages', 'captains', 'seas']),
): CityError | null {
  if (!CATALOGUE[id]) return 'unknown-building';
  const spec = CATALOGUE[id];
  if (spec.feature && !features.has(spec.feature)) return 'feature-off';
  const b = s.buildings[id];
  if (b.upgrading) return 'already-upgrading';
  const next = nextLevelSpec(s, id);
  if (!next) return 'max-level';
  if (s.buildings.admiralty.level < next.reqAdmiralty) return 'needs-admiralty';
  if (freeWorkers(s) <= 0) return 'no-free-worker';
  if (s.steel < next.steel) return 'not-enough-steel';
  if (s.coins < next.coins) return 'not-enough-coins';
  return null;
}

export function startUpgrade(s: CityState, id: BuildingId, now: number): CityError | null {
  settle(s, now);
  const err = canStart(s, id, now);
  if (err) return err;
  const next = nextLevelSpec(s, id)!;
  // Starting work on a producer empties it first, so nothing is lost.
  if (CATALOGUE[id].kind === 'producer') collect(s, id, now);
  s.steel -= next.steel;
  s.coins -= next.coins;
  s.buildings[id].upgrading = {
    toLevel: s.buildings[id].level + 1,
    startedAt: now,
    endsAt: now + next.minutes * 60_000,
  };
  return null;
}

/** Gems to finish now. The last minute is free. */
export function speedUpGems(secondsRemaining: number): number {
  if (secondsRemaining <= 60) return 0;
  return Math.ceil(2 * Math.sqrt(secondsRemaining / 60));
}

export function speedUp(s: CityState, id: BuildingId, now: number): CityError | null {
  settle(s, now);
  const b = s.buildings[id];
  if (!b.upgrading) return 'not-upgrading';
  const cost = speedUpGems(Math.max(0, (b.upgrading.endsAt - now) / 1000));
  if (s.gems < cost) return 'not-enough-gems';
  s.gems -= cost;
  b.upgrading.endsAt = now;
  settle(s, now);
  return null;
}

export function cancelUpgrade(s: CityState, id: BuildingId, now: number): CityError | null {
  settle(s, now);
  const b = s.buildings[id];
  if (!b.upgrading) return 'not-upgrading';
  const spec = CATALOGUE[id].levels[b.upgrading.toLevel - 1];
  s.steel += Math.floor(spec.steel / 2);
  s.coins += Math.floor(spec.coins / 2);
  b.upgrading = undefined;
  return null;
}

export function collect(s: CityState, id: BuildingId, now: number): number {
  settle(s, now);
  const spec = CATALOGUE[id];
  const b = s.buildings[id];
  if (spec.kind !== 'producer' || b.stored <= 0) return 0;
  const amount = b.stored;
  if (spec.produces === 'coins') s.coins += amount;
  else s.steel += amount;
  b.stored = 0;
  return amount;
}

export function collectScrap(s: CityState, now: number): number {
  settle(s, now);
  const amount = s.scrapPile;
  s.steel += amount;
  s.scrapPile = 0;
  return amount;
}

export const SALVAGE_PER_CELL = 5;

/** 5 steel per cell of every enemy ship you sank, plus the Scrapyard bonus. */
export function salvageFor(sunkShipLengths: number[], scrapyardLevel: number): number {
  const base = sunkShipLengths.reduce((n, len) => n + len * SALVAGE_PER_CELL, 0);
  const bonus = scrapyardLevel > 0 ? CATALOGUE.scrapyard.levels[scrapyardLevel - 1].value ?? 0 : 0;
  return Math.floor((base * (100 + bonus)) / 100);
}

export function creditSalvage(s: CityState, sunkShipLengths: number[], now: number): number {
  settle(s, now);
  const amount = salvageFor(sunkShipLengths, s.buildings.scrapyard.level);
  s.scrapPile += amount;
  return amount;
}

export const WORKER_GEM_COST = [0, 0, 100, 250]; // third worker, fourth worker
export const WORKER_ADMIRALTY_REQ = [0, 0, 3, 5];

export function buyWorker(s: CityState, now: number): CityError | null {
  settle(s, now);
  const nextIndex = s.workers; // 2 -> buys the third
  if (nextIndex >= WORKER_GEM_COST.length) return 'max-level';
  if (s.buildings.admiralty.level < WORKER_ADMIRALTY_REQ[nextIndex]) return 'needs-admiralty';
  const cost = WORKER_GEM_COST[nextIndex];
  if (s.gems < cost) return 'not-enough-gems';
  s.gems -= cost;
  s.workers += 1;
  return null;
}

// --------------------------------------------------------------- raiding ----

/** What a raider can take, by the defender's Admiralty level. */
export const VAULT_PROTECTION: Record<number, { coins: number; steel: number }> = {
  1: { coins: 500, steel: 1_000 },
  2: { coins: 800, steel: 1_600 },
  3: { coins: 1_200, steel: 2_500 },
  4: { coins: 2_500, steel: 5_000 },
  5: { coins: 6_000, steel: 12_000 },
  6: { coins: 12_000, steel: 25_000 },
  7: { coins: 25_000, steel: 50_000 },
  8: { coins: 50_000, steel: 100_000 },
};

export const LOOT_CAP: Record<number, { coins: number; steel: number }> = {
  1: { coins: 100, steel: 200 },
  2: { coins: 150, steel: 300 },
  3: { coins: 250, steel: 500 },
  4: { coins: 450, steel: 900 },
  5: { coins: 850, steel: 1_700 },
  6: { coins: 1_600, steel: 3_200 },
  7: { coins: 2_800, steel: 5_600 },
  8: { coins: 4_500, steel: 9_000 },
};

export const WALLET_LOOT_RATE = 0.1;
export const STORE_LOOT_RATE = 0.5; // uncollected production and scrap pile

export function lootPool(s: CityState, now: number) {
  settle(s, now);
  const a = s.buildings.admiralty.level;
  const prot = VAULT_PROTECTION[a] ?? VAULT_PROTECTION[1];
  const cap = LOOT_CAP[a] ?? LOOT_CAP[1];
  const walletCoins = Math.max(0, s.coins - prot.coins) * WALLET_LOOT_RATE;
  const walletSteel = Math.max(0, s.steel - prot.steel) * WALLET_LOOT_RATE;
  const storeCoins = s.buildings.fish_market.stored * STORE_LOOT_RATE;
  const storeSteel = (s.buildings.foundry.stored + s.scrapPile) * STORE_LOOT_RATE;
  return {
    coins: Math.min(cap.coins, Math.floor(walletCoins + storeCoins)),
    steel: Math.min(cap.steel, Math.floor(walletSteel + storeSteel)),
  };
}

export const STAR_BONUS = [0, 40, 120, 300]; // steel handed out by the Admiralty, not by the defender

export function lootEarned(pool: { coins: number; steel: number }, destruction: number, stars: number) {
  return {
    coins: Math.floor(pool.coins * destruction),
    steel: Math.floor(pool.steel * destruction) + STAR_BONUS[stars],
  };
}

/** Renown: a separate ladder that can fall, so lifetime rank points stay untouched. */
export function renownDelta(attacker: number, defender: number, stars: number) {
  const diff = defender - attacker;
  const win = Math.max(5, Math.min(40, Math.round(20 + diff / 12)));
  const lose = Math.max(4, Math.min(30, Math.round(14 - diff / 15)));
  if (stars > 0) {
    const gain = Math.max(1, Math.round((win * stars) / 3));
    return { attacker: gain, defender: -gain };
  }
  return { attacker: -lose, defender: lose };
}

export function shieldHours(destruction: number): number {
  if (destruction >= 1) return 14;
  if (destruction >= 0.7) return 10;
  if (destruction >= 0.4) return 6;
  return 0;
}

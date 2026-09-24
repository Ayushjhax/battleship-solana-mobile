/**
 * Every city action — part-01 §2. Pure: `now` is a parameter, nothing reads a
 * clock, nothing draws a random number, and no action mutates its input.
 *
 * Each action settles first, then validates, then applies. On success it hands
 * back a whole new world plus the ledger rows the server must write and the
 * telemetry to emit; on failure a typed code and nothing else. There is no
 * halfway state — the server either commits the whole result or none of it.
 *
 * FLOOR, NEVER CLAMP (§2.1): an action that cannot be paid for is refused. No
 * balance is ever driven negative and then clamped back.
 */
import {
  CITY_CATALOGUE,
  MAX_WORKERS,
  OFFLINE_REWARD_CAP,
  SALVAGE_PER_CELL,
  STARTING_GRANT,
  WORKER_ADMIRALTY_REQ,
  WORKER_GEM_COST,
  maxLevel,
  nextLevelSpec,
  salvageBonusPercent,
} from './catalogue';
import { openWorld, sealWorld, settleDraft, type Draft } from './settle';
import type {
  BuildingId,
  CityActionResult,
  CityError,
  CityState,
  CityTelemetryEvent,
  CityWorld,
  LedgerDelta,
  Resource,
  SalvageMode,
  ShipClassName,
} from './types';

/** Feature names (minus the `portCity.` prefix) that gate a plot. */
export type FeatureSet = ReadonlySet<string>;

/** Part 1 ships with only the core flag on, so every gated plot is closed. */
export const CORE_ONLY: FeatureSet = new Set<string>();

const MINUTE_MS = 60_000;

function fail(error: CityError): CityActionResult {
  return { ok: false, error };
}

function done(draft: Draft, ledger: LedgerDelta[], events: CityTelemetryEvent[]): CityActionResult {
  return { ok: true, world: sealWorld(draft), ledger, events };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** A fresh city: Admiralty 1, Scrapyard 1, everything else 0, two workers. */
export function newCity(now: number, day: string): CityState {
  const buildings = {} as CityState['buildings'];
  const writable = buildings as Record<BuildingId, CityState['buildings'][BuildingId]>;
  for (const id of Object.keys(CITY_CATALOGUE) as BuildingId[]) {
    writable[id] = { level: 0, stored: 0, lastAccrualAt: now, carry: 0 };
  }
  writable.admiralty = { level: 1, stored: 0, lastAccrualAt: now, carry: 0 };
  writable.scrapyard = { level: 1, stored: 0, lastAccrualAt: now, carry: 0 };
  return {
    version: 1,
    cityVersion: 0,
    workers: 2,
    scrapPile: 0,
    scrapWrecks: [],
    buildings,
    updatedAt: now,
    offlineRewardsToday: { day, count: 0 },
  };
}

export function busyWorkers(city: CityState): number {
  return (Object.keys(city.buildings) as BuildingId[]).filter(
    (id) => city.buildings[id].upgrading !== undefined,
  ).length;
}

export function freeWorkers(city: CityState): number {
  return city.workers - busyWorkers(city);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

/** Why the next level cannot be started, or null. Checked in §2.3's order. */
export function canStart(
  world: CityWorld,
  id: BuildingId,
  features: FeatureSet,
): CityError | null {
  const spec = CITY_CATALOGUE[id];
  if (!spec) return 'unknown-building';
  if (spec.feature && !features.has(spec.feature)) return 'feature-off';
  if (world.city.buildings[id].upgrading) return 'already-upgrading';
  const next = nextLevelSpec(world.city, id);
  if (!next) return 'max-level';
  if (world.city.buildings.admiralty.level < next.reqAdmiralty) return 'needs-admiralty';
  if (freeWorkers(world.city) <= 0) return 'no-free-worker';
  if (world.wallet.steel < next.steel) return 'not-enough-steel';
  if (world.wallet.coins < next.coins) return 'not-enough-coins';
  return null;
}

export function startUpgrade(
  world: CityWorld,
  id: BuildingId,
  now: number,
  features: FeatureSet = CORE_ONLY,
): CityActionResult {
  if (!CITY_CATALOGUE[id]) return fail('unknown-building');

  const draft = openWorld(world);
  const ledger: LedgerDelta[] = [];
  const events: CityTelemetryEvent[] = [];
  settleDraft(draft, now, ledger, events);

  const settled = sealWorld(draft);
  const problem = canStart(settled, id, features);
  if (problem) return fail(problem);

  const next = nextLevelSpec(settled.city, id);
  if (!next) return fail('max-level');

  // §2.3 — starting work on a collector empties it first, so nothing is lost.
  if (CITY_CATALOGUE[id].kind === 'producer') {
    collectInto(draft, id, ledger, events);
  }

  draft.steel -= next.steel;
  draft.coins -= next.coins;
  const toLevel = draft.buildings[id].level + 1;
  draft.buildings[id].upgrading = {
    toLevel,
    startedAt: now,
    endsAt: now + next.minutes * MINUTE_MS,
  };

  ledger.push({
    reason: 'build',
    ref: `${id}:${toLevel}`,
    dCoins: -next.coins,
    dSteel: -next.steel,
    dGems: 0,
  });
  events.push({
    type: 'city_build_started',
    buildingId: id,
    toLevel,
    steel: next.steel,
    coins: next.coins,
    seconds: next.minutes * 60,
  });

  return done(draft, ledger, events);
}

// ---------------------------------------------------------------------------
// speed up
// ---------------------------------------------------------------------------

/** NUMBERS.md > Finishing a job early. The last minute is free. */
export function speedUpGems(secondsRemaining: number): number {
  if (secondsRemaining <= 60) return 0;
  return Math.ceil(2 * Math.sqrt(secondsRemaining / 60));
}

export function speedUp(world: CityWorld, id: BuildingId, now: number): CityActionResult {
  if (!CITY_CATALOGUE[id]) return fail('unknown-building');

  const draft = openWorld(world);
  const ledger: LedgerDelta[] = [];
  const events: CityTelemetryEvent[] = [];
  settleDraft(draft, now, ledger, events);

  const job = draft.buildings[id].upgrading;
  if (!job) return fail('not-upgrading');

  const secondsRemaining = Math.max(0, (job.endsAt - now) / 1000);
  const cost = speedUpGems(secondsRemaining);
  if (draft.gems < cost) return fail('not-enough-gems');

  draft.gems -= cost;
  draft.buildings[id].upgrading = { ...job, endsAt: now };
  if (cost > 0) {
    ledger.push({ reason: 'speedup', ref: `${id}:${job.toLevel}`, dCoins: 0, dSteel: 0, dGems: -cost });
  }
  events.push({
    type: 'city_speedup',
    buildingId: id,
    gems: cost,
    secondsSaved: Math.round(secondsRemaining),
  });

  // Finish it here, so the response already shows the completed building.
  settleDraft(draft, now, ledger, events, true);
  return done(draft, ledger, events);
}

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

/**
 * §2.3 — half the steel and half the coins back, FLOORED, and the worker is
 * freed. See DECISIONS.md D2: the reference's own test asserts ceil, but both
 * the prose and the reference implementation floor.
 */
export function cancelUpgrade(world: CityWorld, id: BuildingId, now: number): CityActionResult {
  if (!CITY_CATALOGUE[id]) return fail('unknown-building');

  const draft = openWorld(world);
  const ledger: LedgerDelta[] = [];
  const events: CityTelemetryEvent[] = [];
  settleDraft(draft, now, ledger, events);

  const job = draft.buildings[id].upgrading;
  if (!job) return fail('not-upgrading');

  const spec = CITY_CATALOGUE[id].levels[job.toLevel - 1];
  if (!spec) return fail('unknown-building');

  const steelBack = Math.floor(spec.steel / 2);
  const coinsBack = Math.floor(spec.coins / 2);
  draft.steel += steelBack;
  draft.coins += coinsBack;
  draft.buildings[id].upgrading = undefined;

  ledger.push({
    reason: 'cancel',
    ref: `${id}:${job.toLevel}`,
    dCoins: coinsBack,
    dSteel: steelBack,
    dGems: 0,
  });
  events.push({ type: 'city_cancel', buildingId: id });

  return done(draft, ledger, events);
}

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

/** Moves one collector's pile into the wallet. Returns what moved. */
function collectInto(
  draft: Draft,
  id: BuildingId,
  ledger: LedgerDelta[],
  events: CityTelemetryEvent[],
): number {
  const spec = CITY_CATALOGUE[id];
  const b = draft.buildings[id];
  if (spec.kind !== 'producer' || b.stored <= 0) return 0;

  const amount = b.stored;
  const resource: Resource = spec.produces === 'coins' ? 'coins' : 'steel';
  if (resource === 'coins') draft.coins += amount;
  else draft.steel += amount;
  b.stored = 0;

  ledger.push({
    reason: 'collect',
    ref: id,
    dCoins: resource === 'coins' ? amount : 0,
    dSteel: resource === 'steel' ? amount : 0,
    dGems: 0,
  });
  events.push({ type: 'city_collect', buildingId: id, amount, resource });
  return amount;
}

/** Moves the Scrapyard pile into the wallet. Returns what moved. */
function collectScrapInto(
  draft: Draft,
  ledger: LedgerDelta[],
  events: CityTelemetryEvent[],
): number {
  const amount = draft.scrapPile;
  if (amount <= 0) return 0;
  draft.steel += amount;
  draft.scrapPile = 0;
  // The wrecks dissolve into the steel (part-02 §6).
  draft.scrapWrecks = [];
  ledger.push({ reason: 'collect_scrap', ref: 'scrapyard', dCoins: 0, dSteel: amount, dGems: 0 });
  events.push({ type: 'city_scrap_collected', amount });
  return amount;
}

/** One collector, or `scrapyard` for the salvage pile (§4). */
export function collect(world: CityWorld, id: BuildingId, now: number): CityActionResult {
  if (!CITY_CATALOGUE[id]) return fail('unknown-building');

  const draft = openWorld(world);
  const ledger: LedgerDelta[] = [];
  const events: CityTelemetryEvent[] = [];
  settleDraft(draft, now, ledger, events);

  const moved =
    id === 'scrapyard'
      ? collectScrapInto(draft, ledger, events)
      : collectInto(draft, id, ledger, events);
  if (moved <= 0) return fail('nothing-to-collect');

  return done(draft, ledger, events);
}

/** Every collector plus the pile, one ledger row each (§4). */
export function collectAll(world: CityWorld, now: number): CityActionResult {
  const draft = openWorld(world);
  const ledger: LedgerDelta[] = [];
  const events: CityTelemetryEvent[] = [];
  settleDraft(draft, now, ledger, events);

  let moved = 0;
  for (const id of Object.keys(CITY_CATALOGUE) as BuildingId[]) {
    if (CITY_CATALOGUE[id].kind === 'producer') moved += collectInto(draft, id, ledger, events);
  }
  moved += collectScrapInto(draft, ledger, events);
  if (moved <= 0) return fail('nothing-to-collect');

  return done(draft, ledger, events);
}

// ---------------------------------------------------------------------------
// workers
// ---------------------------------------------------------------------------

export function buyWorker(world: CityWorld, now: number): CityActionResult {
  const draft = openWorld(world);
  const ledger: LedgerDelta[] = [];
  const events: CityTelemetryEvent[] = [];
  settleDraft(draft, now, ledger, events);

  const index = draft.workers; // 2 buys the third
  if (index >= MAX_WORKERS) return fail('max-level');

  const required = WORKER_ADMIRALTY_REQ[index] ?? 0;
  if (draft.buildings.admiralty.level < required) return fail('needs-admiralty');

  const cost = WORKER_GEM_COST[index] ?? 0;
  if (draft.gems < cost) return fail('not-enough-gems');

  draft.gems -= cost;
  draft.workers += 1;
  ledger.push({ reason: 'worker', ref: `worker:${index + 1}`, dCoins: 0, dSteel: 0, dGems: -cost });
  events.push({ type: 'city_worker_bought', index: index + 1, gems: cost });

  return done(draft, ledger, events);
}

// ---------------------------------------------------------------------------
// salvage
// ---------------------------------------------------------------------------

/**
 * §2.2 — 5 steel per cell of every enemy ship you sank, times the Scrapyard
 * bonus, rounded down. Ships you only damaged pay nothing.
 */
export function salvageFor(sunkShipLengths: readonly number[], scrapyardLevel: number): number {
  const base = sunkShipLengths.reduce((n, len) => n + len * SALVAGE_PER_CELL, 0);
  const bonus = salvageBonusPercent(scrapyardLevel);
  return Math.floor((base * (100 + bonus)) / 100);
}

export interface SalvageOutcome {
  readonly world: CityWorld;
  readonly ledger: readonly LedgerDelta[];
  readonly events: readonly CityTelemetryEvent[];
  /** What actually landed in the pile — 0 when the daily cap is spent. */
  readonly credited: number;
  readonly capped: boolean;
}

/**
 * Credits salvage into the Scrapyard pile, never the wallet (§2.2). Online and
 * bot matches always pay; AI and hot-seat matches stop after
 * OFFLINE_REWARD_CAP per UTC day (DECISIONS D7, D8). The tutorial never calls
 * this at all.
 */
export function creditSalvage(
  world: CityWorld,
  sunkShipLengths: readonly number[],
  mode: SalvageMode,
  matchId: string,
  now: number,
  utcDay: string,
  wrecks: readonly ShipClassName[] = [],
): SalvageOutcome {
  const draft = openWorld(world);
  const ledger: LedgerDelta[] = [];
  const events: CityTelemetryEvent[] = [];
  settleDraft(draft, now, ledger, events);

  const limited = mode === 'ai' || mode === 'hotseat';
  if (limited && draft.offlineRewardsToday.day !== utcDay) {
    draft.offlineRewardsToday = { day: utcDay, count: 0 };
  }

  if (limited && draft.offlineRewardsToday.count >= OFFLINE_REWARD_CAP) {
    events.push({ type: 'offline_reward_cap_hit', day: utcDay });
    return {
      world: sealWorld(draft),
      ledger,
      events,
      credited: 0,
      capped: true,
    };
  }

  const amount = salvageFor(sunkShipLengths, draft.buildings.scrapyard.level);
  if (limited) {
    draft.offlineRewardsToday = {
      day: utcDay,
      count: draft.offlineRewardsToday.count + 1,
    };
  }

  if (amount > 0) {
    draft.scrapPile += amount;
    if (wrecks.length > 0) {
      draft.scrapWrecks = [...wrecks, ...draft.scrapWrecks].slice(
        0,
        scrapDisplaySlots(draft.buildings.scrapyard.level),
      );
    }
    ledger.push({ reason: 'salvage', ref: matchId, dCoins: 0, dSteel: 0, dGems: 0 });
    events.push({ type: 'salvage_credited', matchId, amount, mode });
  }

  return { world: sealWorld(draft), ledger, events, credited: amount, capped: false };
}

// ---------------------------------------------------------------------------
// selectors the client and the server both want
// ---------------------------------------------------------------------------

/**
 * How many wrecks the Scrapyard displays at a level — part-02 §6's "up to the
 * level's display slots". The doc does not give a number; DECISIONS D19 sets
 * it at 2 + level, so L1 shows three and L6 shows eight.
 */
export function scrapDisplaySlots(scrapyardLevel: number): number {
  return Math.max(1, 2 + scrapyardLevel);
}

/** Milliseconds left on a job, clamped at 0 (§6: never a negative timer). */
export function msRemaining(city: CityState, id: BuildingId, now: number): number {
  const job = city.buildings[id].upgrading;
  if (!job) return 0;
  return Math.max(0, job.endsAt - now);
}

/** What a collector is holding right now, without mutating anything. */
export function collectableAt(world: CityWorld, now: number): { total: number; ids: BuildingId[] } {
  const draft = openWorld(world);
  settleDraft(draft, now, [], []);
  const ids: BuildingId[] = [];
  let total = 0;
  for (const id of Object.keys(CITY_CATALOGUE) as BuildingId[]) {
    if (CITY_CATALOGUE[id].kind === 'producer' && draft.buildings[id].stored > 0) {
      ids.push(id);
      total += draft.buildings[id].stored;
    }
  }
  if (draft.scrapPile > 0) {
    ids.push('scrapyard');
    total += draft.scrapPile;
  }
  return { total, ids };
}

export { STARTING_GRANT, maxLevel };

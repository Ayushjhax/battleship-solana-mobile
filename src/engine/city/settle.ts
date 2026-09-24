/**
 * Settle-on-read — part-01 §2.3 and §2.4.
 *
 * Nothing in the city runs on a timer. Every read and every write calls
 * settle(world, now) first, which completes every finished upgrade in
 * CHRONOLOGICAL order and accrues production around each completion, so a
 * collector that levelled up mid-window produces at the old rate up to
 * `endsAt` and the new rate after it.
 *
 * settle is not purely a city operation: completing an Admiralty level grants
 * gems (§2.6), which moves the wallet and must appear in the ledger. So it
 * returns deltas alongside the new world, exactly like an action does.
 *
 * ACCRUAL PRECISION. Production is integer and must not lose a fraction:
 * §2.4 requires that settling every 30 seconds and settling once after five
 * hours give the identical number, and §9.3 makes it an acceptance criterion.
 *
 * This does NOT use the reference implementation's algorithm. The reference
 * (docs/port-city/reference/src/city.ts:294-314) advances the anchor by
 * `Math.ceil(add * 3_600_000 / rate)`, which is exact only when the rate
 * divides an hour evenly. Its own tests only ever exercise 12/h and 18/h,
 * which do. At 26/h (Fish Market level 3) the rounding makes accrual
 * path-dependent and loses a unit: settling every 30 s for five hours yields
 * 129 where settling once yields 130. Verified, then fixed here.
 *
 * Instead the leftover is CARRIED, in units of (unit x milliseconds-per-hour):
 *
 *     total    = carry + rate * elapsedMs
 *     produced = floor(total / 3_600_000)
 *     carry'   = total - produced * 3_600_000
 *
 * `rate * elapsedMs` splits additively over any chopping of the interval and
 * the carry accumulates exactly, so the result is path-independent by
 * construction, at every rate, with integer arithmetic throughout. See
 * DECISIONS.md D13.
 */
import { CITY_CATALOGUE, ADMIRALTY_GEM_GRANT, capacityOf, rateOf } from './catalogue';
import type {
  BuildingId,
  BuildingState,
  CityState,
  CityTelemetryEvent,
  CityWorld,
  LedgerDelta,
  ShipClassName,
  Wallet,
} from './types';

const MS_PER_HOUR = 3_600_000;

export interface SettleResult {
  readonly world: CityWorld;
  readonly ledger: readonly LedgerDelta[];
  readonly events: readonly CityTelemetryEvent[];
}

/** A mutable copy to work on; sealed back into a frozen CityWorld at the end. */
interface Draft {
  version: number;
  cityVersion: number;
  workers: number;
  scrapPile: number;
  scrapWrecks: readonly ShipClassName[];
  buildings: Record<BuildingId, { level: number; upgrading?: BuildingState['upgrading']; stored: number; lastAccrualAt: number; carry: number }>;
  updatedAt: number;
  offlineRewardsToday: { day: string; count: number };
  coins: number;
  steel: number;
  gems: number;
}

export function openWorld(world: CityWorld): Draft {
  const buildings = {} as Draft['buildings'];
  for (const id of Object.keys(world.city.buildings) as BuildingId[]) {
    const b = world.city.buildings[id];
    buildings[id] = {
      level: b.level,
      ...(b.upgrading ? { upgrading: { ...b.upgrading } } : {}),
      stored: b.stored,
      lastAccrualAt: b.lastAccrualAt,
      carry: b.carry ?? 0,
    };
  }
  return {
    version: world.city.version,
    cityVersion: world.city.cityVersion,
    workers: world.city.workers,
    scrapPile: world.city.scrapPile,
    scrapWrecks: world.city.scrapWrecks ?? [],
    buildings,
    updatedAt: world.city.updatedAt,
    offlineRewardsToday: { ...world.city.offlineRewardsToday },
    coins: world.wallet.coins,
    steel: world.wallet.steel,
    gems: world.wallet.gems,
  };
}

export function sealWorld(draft: Draft): CityWorld {
  const buildings = {} as Record<BuildingId, BuildingState>;
  for (const id of Object.keys(draft.buildings) as BuildingId[]) {
    const b = draft.buildings[id];
    buildings[id] = {
      level: b.level,
      ...(b.upgrading ? { upgrading: { ...b.upgrading } } : {}),
      stored: b.stored,
      lastAccrualAt: b.lastAccrualAt,
      carry: b.carry,
    };
  }
  const city: CityState = {
    version: draft.version,
    cityVersion: draft.cityVersion,
    workers: draft.workers,
    scrapPile: draft.scrapPile,
    scrapWrecks: draft.scrapWrecks,
    buildings,
    updatedAt: draft.updatedAt,
    offlineRewardsToday: { ...draft.offlineRewardsToday },
  };
  const wallet: Wallet = { coins: draft.coins, steel: draft.steel, gems: draft.gems };
  return { city, wallet };
}

/**
 * Accrue one producer up to `upto`. Produces whole units only and advances
 * lastAccrualAt by the time those units took, so the remainder carries.
 */
export function accrueTo(draft: Draft, id: BuildingId, upto: number): void {
  if (CITY_CATALOGUE[id].kind !== 'producer') return;
  const b = draft.buildings[id];

  // Not built yet: there is nothing to produce, and the clock simply follows.
  if (b.level === 0) {
    b.lastAccrualAt = upto;
    b.carry = 0;
    return;
  }

  const rate = rateOf(id, b.level);
  const cap = capacityOf(id, b.level);

  // §6: a `now` before `updatedAt` is a no-op, never negative production.
  if (upto <= b.lastAccrualAt || rate <= 0) return;

  // Already full: the overflow time is lost on purpose (§2.4).
  if (b.stored >= cap) {
    b.lastAccrualAt = upto;
    b.carry = 0;
    return;
  }

  // Exact, path-independent accrual. `total` is production measured in
  // (units x MS_PER_HOUR), so chopping the interval splits it additively and
  // the leftover is carried rather than rounded away.
  const total = b.carry + rate * (upto - b.lastAccrualAt);
  const produced = Math.floor(total / MS_PER_HOUR);
  const add = Math.min(produced, cap - b.stored);

  b.stored += add;
  b.lastAccrualAt = upto;
  b.carry = b.stored >= cap ? 0 : total - produced * MS_PER_HOUR;
}

/** Ids whose job has finished by `now`, soonest first. */
function dueAt(draft: Draft, now: number): BuildingId[] {
  return (Object.keys(draft.buildings) as BuildingId[])
    .filter((id) => {
      const job = draft.buildings[id].upgrading;
      return job !== undefined && job.endsAt <= now;
    })
    .sort((a, b) => {
      const ja = draft.buildings[a].upgrading;
      const jb = draft.buildings[b].upgrading;
      return (ja ? ja.endsAt : 0) - (jb ? jb.endsAt : 0);
    });
}

/**
 * The in-place half, so actions can settle a draft they are already holding
 * without sealing and reopening it.
 */
export function settleDraft(
  draft: Draft,
  now: number,
  ledger: LedgerDelta[],
  events: CityTelemetryEvent[],
  viaSpeedup = false,
): void {
  const ids = Object.keys(draft.buildings) as BuildingId[];

  for (;;) {
    const due = dueAt(draft, now);
    const id = due[0];
    if (id === undefined) break;

    const job = draft.buildings[id].upgrading;
    if (!job) break;
    const at = job.endsAt;

    // Production up to the completion instant runs at the OLD level.
    for (const producer of ids) accrueTo(draft, producer, at);

    draft.buildings[id].level = job.toLevel;
    draft.buildings[id].upgrading = undefined;
    events.push({
      type: 'city_build_finished',
      buildingId: id,
      level: job.toLevel,
      viaSpeedup,
    });

    // §2.6 — completing an Admiralty level pays gems.
    if (id === 'admiralty') {
      const gems = ADMIRALTY_GEM_GRANT[job.toLevel] ?? 0;
      if (gems > 0) {
        draft.gems += gems;
        ledger.push({
          reason: 'admiralty_gems',
          ref: `admiralty:${job.toLevel}`,
          dCoins: 0,
          dSteel: 0,
          dGems: gems,
        });
      }
    }
  }

  for (const producer of ids) accrueTo(draft, producer, now);
  if (now > draft.updatedAt) draft.updatedAt = now;
}

/** The pure entry point: settle a world forward to `now`. */
export function settle(world: CityWorld, now: number): SettleResult {
  const draft = openWorld(world);
  const ledger: LedgerDelta[] = [];
  const events: CityTelemetryEvent[] = [];
  settleDraft(draft, now, ledger, events);
  return { world: sealWorld(draft), ledger, events };
}

export type { Draft };

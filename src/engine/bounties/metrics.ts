/**
 * The metric evaluator — part-04 §1, tested by §5.1.
 *
 * §1: "`metric` is evaluated **only on the server**, from the match event log
 * for online matches and from the reported result for offline ones, in the
 * same transaction that credits points, coins and salvage. The client never
 * reports progress; it renders what it is told."
 *
 * So this module takes a MATCH SUMMARY — facts the server already has — and
 * returns how far each metric advanced. It never takes a progress number from
 * anywhere, which is what makes §6.2's "can never be advanced by a client
 * claim" true by construction: there is no parameter to put one in.
 *
 * §5.1 asks for "a crafted match event log advances exactly the right
 * contracts, and a match that does not qualify advances none", so every
 * evaluator is a separate function with its own test.
 */
import type { MatchEvent } from '../types';
import type { ContractMetric } from './catalogue';

/**
 * Everything the evaluator may look at. Deliberately a SUMMARY and not the
 * raw state: the facts are extracted once, in `summarise()`, so a metric
 * cannot accidentally depend on something the offline path does not have.
 */
export interface MatchSummary {
  readonly won: boolean;
  readonly online: boolean;
  readonly difficulty: 'easy' | 'normal' | 'hard' | null;
  /** My ships still afloat at the end. */
  readonly shipsAfloat: number;
  /** Did I buy any arsenal at all? */
  readonly boughtArsenal: boolean;
  /** Events I caused, in order. The offline path reports the same shape. */
  readonly events: readonly MatchEvent[];
}

export interface CitySummary {
  readonly steelCollected: number;
  readonly upgradesFinished: number;
  readonly admiraltyLevel: number;
  readonly scrapyardCollections: number;
}

export interface RaidSummary {
  readonly stars: number;
  readonly steelTaken: number;
  /** A raid on ME that ended under 2 stars — §1's "defend successfully". */
  readonly defended: number;
  readonly threeStarred: number;
}

export type MetricSource =
  | { readonly kind: 'match'; readonly match: MatchSummary }
  | { readonly kind: 'city'; readonly city: CitySummary }
  | { readonly kind: 'raid'; readonly raid: RaidSummary };

// ---------------------------------------------------------------------------
// Event helpers — read the log the way the metric means it
// ---------------------------------------------------------------------------

function count(events: readonly MatchEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

function sunkOfClass(events: readonly MatchEvent[], shipClass: string): number {
  return events.filter(
    (event) => event.type === 'SUNK' && (event as { shipClass?: string }).shipClass === shipClass,
  ).length;
}

/**
 * Events that CLOSE a weapon's window.
 *
 * A weapon's sinks are the SUNK events between its own event and the next
 * action. `ARSENAL_USED` and `TURN_CHANGED` are the real boundaries in this
 * engine — there is no `SHOT_FIRED` in `MatchEvent` (that is a client-side FX
 * event from `src/fx`), which the compiler pointed out when this file first
 * tried to use one.
 */
const CLOSERS: readonly string[] = ['ARSENAL_USED', 'TURN_CHANGED', 'GAME_OVER'];

/**
 * Sinks attributed to a weapon. A weapon's SUNK events are the ones that
 * arrive between its own event and the next action — the engine emits them in
 * one batch, which is exactly what "sank it with a torpedo" means.
 */
function sinksBy(events: readonly MatchEvent[], weaponEvent: string): number {
  let sinks = 0;
  let armed = false;
  for (const event of events) {
    if (event.type === weaponEvent) {
      armed = true;
      continue;
    }
    if (armed && event.type === 'SUNK') sinks++;
    else if (armed && CLOSERS.includes(event.type)) armed = false;
  }
  return sinks;
}

/** The most sinks any ONE use of a weapon produced. §1's "2 ships with one". */
function bestSingleUse(events: readonly MatchEvent[], weaponEvent: string): number {
  let best = 0;
  let current = 0;
  let armed = false;
  for (const event of events) {
    if (event.type === weaponEvent) {
      best = Math.max(best, current);
      current = 0;
      armed = true;
      continue;
    }
    if (!armed) continue;
    if (event.type === 'SUNK') current++;
    else if (CLOSERS.includes(event.type)) {
      best = Math.max(best, current);
      current = 0;
      armed = false;
    }
  }
  return Math.max(best, current);
}

/**
 * §1 — "sink 2 ships with one Atomic Bomber". The engine emits one
 * `BOMB_DROPPED` carrying `kind`, so the atomic run is the SUNK events after a
 * drop whose kind is `atomicBomber` — a plain bomber's drop does not count.
 */
export function bestAtomicRun(events: readonly MatchEvent[]): number {
  let best = 0;
  let current = 0;
  let armed = false;
  for (const event of events) {
    if (event.type === 'BOMB_DROPPED') {
      best = Math.max(best, current);
      current = 0;
      armed = (event as { kind?: string }).kind === 'atomicBomber';
      continue;
    }
    if (!armed) continue;
    if (event.type === 'SUNK') current++;
    else if (CLOSERS.includes(event.type)) {
      best = Math.max(best, current);
      current = 0;
      armed = false;
    }
  }
  return Math.max(best, current);
}

/** The longest unbroken run of HITs — §1's "run of 5 hits in one turn". */
export function longestHitRun(events: readonly MatchEvent[]): number {
  let best = 0;
  let run = 0;
  for (const event of events) {
    if (event.type === 'HIT' || event.type === 'SUNK') {
      if (event.type === 'HIT') run++;
    } else if (event.type === 'MISS' || event.type === 'MINE_TRIGGERED') {
      best = Math.max(best, run);
      run = 0;
    }
  }
  return Math.max(best, run);
}

/**
 * The most planes any ONE gun downed in a match.
 *
 * §1 asks "down 2 planes with the same gun", which is this `>= 2`. It is a
 * count rather than a boolean because the Gazette's `gun-triple` headline
 * (part-09 §1) needs the number to put in the sentence, and forking this
 * reading would mean two places to fix when the event vocabulary moves.
 */
export function bestSameGunDowns(events: readonly MatchEvent[]): number {
  const byCell = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'AIRCRAFT_DOWNED') continue;
    // The engine names it `gunAt` — the GUN's cell, which is the thing that
    // has to be the same twice for §1's "the same gun".
    const at = (event as { gunAt?: { r: number; c: number } }).gunAt;
    if (!at) continue;
    const key = `${at.r},${at.c}`;
    byCell.set(key, (byCell.get(key) ?? 0) + 1);
  }
  let best = 0;
  for (const n of byCell.values()) best = Math.max(best, n);
  return best;
}

/** §1 — "down 2 planes with the same gun in one match". */
function sameGunDoubles(events: readonly MatchEvent[]): boolean {
  return bestSameGunDowns(events) >= 2;
}

/** §1 — "use the radar and hit a ship inside that 3x3 on your next shot". */
function radarThenHit(events: readonly MatchEvent[]): boolean {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event?.type !== 'RADAR_RESULT') continue;
    const at = (event as { at?: { r: number; c: number } }).at;
    if (!at) continue;

    // The next resolved shot.
    for (let j = i + 1; j < events.length; j++) {
      const next = events[j]!;
      if (next.type === 'MISS') break;
      if (next.type === 'HIT' || next.type === 'SUNK') {
        const hitAt = (next as { at?: { r: number; c: number }; cells?: { r: number; c: number }[] }).at;
        if (!hitAt) break;
        if (Math.abs(hitAt.r - at.r) <= 1 && Math.abs(hitAt.c - at.c) <= 1) return true;
        break;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The evaluators — one per metric, all exhaustive
// ---------------------------------------------------------------------------

/**
 * How far this source advances this metric. Zero for a metric the source
 * cannot speak to, which is why a city collection never advances a battle
 * contract and vice versa.
 */
export function advance(metric: ContractMetric, source: MetricSource): number {
  if (source.kind === 'match') return fromMatch(metric, source.match);
  if (source.kind === 'city') return fromCity(metric, source.city);
  return fromRaid(metric, source.raid);
}

function fromMatch(metric: ContractMetric, m: MatchSummary): number {
  switch (metric) {
    case 'matches_won':
      return m.won ? 1 : 0;
    case 'online_won':
      return m.won && m.online ? 1 : 0;
    case 'battleships_sunk':
      return sunkOfClass(m.events, 'battleship');
    case 'torpedo_sinks':
      return sinksBy(m.events, 'TORPEDO_RUN');
    case 'atomic_double':
      return bestAtomicRun(m.events) >= 2 ? 1 : 0;
    case 'submarine_sinks':
      return sinksBy(m.events, 'SUBMARINE_SURFACED');
    case 'aa_downs':
      return count(m.events, 'AIRCRAFT_DOWNED');
    case 'gun_double':
      return sameGunDoubles(m.events) ? 1 : 0;
    case 'mine_stops':
      return count(m.events, 'MINE_TRIGGERED');
    case 'win_with_4_afloat':
      return m.won && m.shipsAfloat >= 4 ? 1 : 0;
    case 'run_of_5':
      return longestHitRun(m.events) >= 5 ? 1 : 0;
    case 'win_no_arsenal':
      return m.won && !m.boughtArsenal ? 1 : 0;
    case 'beat_hard_ai':
      return m.won && m.difficulty === 'hard' ? 1 : 0;
    case 'radar_then_hit':
      return radarThenHit(m.events) ? 1 : 0;
    default:
      // A city or raid metric. A match does not advance it, and saying so
      // explicitly beats falling through to a default that might.
      return 0;
  }
}

function fromCity(metric: ContractMetric, city: CitySummary): number {
  switch (metric) {
    case 'steel_collected':
      return Math.max(0, city.steelCollected);
    case 'upgrades_finished':
      return Math.max(0, city.upgradesFinished);
    case 'scrapyard_collected':
      return Math.max(0, city.scrapyardCollections);
    case 'admiralty_level':
      // A LEVEL, not a count: the progress IS the level, so a player at
      // Admiralty 5 completes "reach Admiralty 5" the moment it is issued.
      return Math.max(0, city.admiraltyLevel);
    default:
      return 0;
  }
}

function fromRaid(metric: ContractMetric, raid: RaidSummary): number {
  switch (metric) {
    case 'raid_stars':
      return Math.max(0, raid.stars);
    case 'raid_steel':
      return Math.max(0, raid.steelTaken);
    case 'defended':
      return Math.max(0, raid.defended);
    case 'three_starred':
      return Math.max(0, raid.threeStarred);
    default:
      return 0;
  }
}

/**
 * §1 — "Hot-seat and offline matches count toward contracts only under the
 * same daily cap as salvage."
 *
 * The decision is made ONCE per settlement (`offline_slot_take` in migration
 * 0019) and handed here, rather than each consumer asking — which would burn
 * three slots for one match. §5.5: "The 11th offline match of the day advances
 * no contracts and no ink but still pays coins."
 */
export function countsTowardContracts(source: MetricSource, withinDailyCap: boolean): boolean {
  if (source.kind !== 'match') return true;
  return source.match.online || withinDailyCap;
}

/** Every deltas the server will apply, for one source. */
export interface ContractDelta {
  readonly contractId: string;
  readonly delta: number;
}

export function deltasFor(
  active: readonly { contractId: string; metric: ContractMetric }[],
  source: MetricSource,
  withinDailyCap = true,
): ContractDelta[] {
  if (!countsTowardContracts(source, withinDailyCap)) return [];
  return active
    .map((row) => ({ contractId: row.contractId, delta: advance(row.metric, source) }))
    .filter((row) => row.delta > 0);
}

/**
 * Trade voyages — part-09 §3.
 *
 * "Rewards scale with Trade Docks level and are rolled **server-side at send
 *  time** (so the player cannot reroll by reinstalling), revealed on return."
 *
 * That parenthesis is the design. The roll happens once, in
 * `rollReward(route, level, rng)`, and the SERVER stores the result on the
 * voyage row at send. `/voyage/collect` reads it; it never rolls. A reinstall
 * loses nothing and gains nothing.
 */
import type { Rng } from '../rng';
import { LOSS_SHARE, WIN_BONUS } from './skirmish';

export const ROUTES = ['coral-bay', 'saltmarsh', 'iron-point', 'far-isles'] as const;
export type RouteId = (typeof ROUTES)[number];

export interface Route {
  readonly id: RouteId;
  readonly name: string;
  readonly hours: number;
  readonly coins: number;
  readonly steel: number;
  /** §3's "pirate risk" column, 0..1. */
  readonly risk: number;
  readonly gemChance: number;
  readonly cosmeticChance: number;
}

/** §3's table, verbatim. */
export const ROUTE_TABLE: readonly Route[] = [
  { id: 'coral-bay', name: 'Coral Bay', hours: 1, coins: 120, steel: 150, risk: 0.05, gemChance: 0, cosmeticChance: 0 },
  { id: 'saltmarsh', name: 'Saltmarsh', hours: 4, coins: 400, steel: 500, risk: 0.1, gemChance: 0, cosmeticChance: 0 },
  { id: 'iron-point', name: 'Iron Point', hours: 8, coins: 900, steel: 1_100, risk: 0.15, gemChance: 0.15, cosmeticChance: 0 },
  { id: 'far-isles', name: 'Far Isles', hours: 12, coins: 1_500, steel: 1_900, risk: 0.2, gemChance: 0.3, cosmeticChance: 0.05 },
];

export function routeById(id: string): Route | null {
  return ROUTE_TABLE.find((r) => r.id === id) ?? null;
}

/** §3 — "Merchant ships = Trade Docks level (1 / 2 / 3 slots)." */
export function voyageSlots(tradeDocksLevel: number): number {
  return Math.max(0, Math.min(Math.trunc(tradeDocksLevel), 3));
}

/**
 * §3 — "Rewards scale with Trade Docks level". A level-3 dock earns half again
 * what a level-1 does, which is what makes upgrading it worth the steel.
 */
export function levelMultiplier(tradeDocksLevel: number): number {
  return 1 + 0.25 * Math.max(0, Math.min(tradeDocksLevel, 3) - 1);
}

export interface VoyageReward {
  readonly coins: number;
  readonly steel: number;
  readonly gems: number;
  readonly cosmetic: string | null;
  /** Rolled at the same moment, for the same reason (§3). */
  readonly pirate: boolean;
}

/**
 * THE ROLL. Called once, at send time, on the server.
 *
 * §3 — "120 coins **or** 150 steel": a route pays one or the other, not both,
 * which is what makes the four routes feel different rather than just bigger.
 */
export function rollReward(route: Route, tradeDocksLevel: number, rng: Rng): VoyageReward {
  const scale = levelMultiplier(tradeDocksLevel);
  const paysCoins = rng.int(2) === 0;

  return {
    coins: paysCoins ? Math.floor(route.coins * scale) : 0,
    steel: paysCoins ? 0 : Math.floor(route.steel * scale),
    gems: route.gemChance > 0 && rng.next() < route.gemChance ? 5 + rng.int(6) : 0,
    cosmetic: null,
    pirate: rng.next() < route.risk,
  };
}

export function returnsAt(route: Route, sentAt: number): number {
  return sentAt + route.hours * 3_600_000;
}

export type VoyageState = 'sailing' | 'attacked' | 'collected' | 'lost';

export interface Voyage {
  readonly id: string;
  readonly route: RouteId;
  readonly slot: number;
  readonly sentAt: number;
  readonly returnsAt: number;
  readonly reward: VoyageReward;
  readonly state: VoyageState;
}

export type CollectError = 'not-back-yet' | 'already-collected' | 'under-attack' | 'not-found';

export interface CollectCheck {
  readonly ok: boolean;
  readonly error: CollectError | null;
}

/** §5.6 — "a voyage cannot be collected early". */
export function canCollect(voyage: Voyage, now: number): CollectCheck {
  if (voyage.state === 'collected') return { ok: false, error: 'already-collected' };
  if (now < voyage.returnsAt) return { ok: false, error: 'not-back-yet' };
  // An attacked voyage is collected through the skirmish, not directly.
  if (voyage.state === 'attacked' || (voyage.reward.pirate && voyage.state === 'sailing')) {
    return { ok: false, error: 'under-attack' };
  }
  return { ok: true, error: null };
}

/**
 * What a voyage actually pays.
 *
 * §3 — "Win → full cargo plus a 25% bonus. Lose or ignore it for 24 h → half
 * cargo." And, from this part's own reasoning: a log that does not replay is
 * indistinguishable from not playing, so it pays half too.
 */
export type SkirmishResult = 'won' | 'lost' | 'ignored' | 'unverified' | 'none';

export function payout(reward: VoyageReward, result: SkirmishResult): VoyageReward {
  const scale =
    result === 'won' ? 1 + WIN_BONUS : result === 'none' ? 1 : LOSS_SHARE;

  return {
    coins: Math.floor(reward.coins * scale),
    steel: Math.floor(reward.steel * scale),
    gems: Math.floor(reward.gems * scale),
    cosmetic: reward.cosmetic,
    pirate: reward.pirate,
  };
}

/** §3 — "ignore it for 24 h". */
export const SKIRMISH_GRACE_MS = 24 * 3_600_000;

export function skirmishExpired(returnsAt: number, now: number): boolean {
  return now - returnsAt >= SKIRMISH_GRACE_MS;
}

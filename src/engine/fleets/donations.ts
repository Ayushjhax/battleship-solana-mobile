/**
 * Donations and reinforcements — part-08 §3, tested by §7.2.
 *
 * THE RANKED INTEGRITY RULE LIVES IN THIS FILE.
 *
 * §3: "Reinforcements are usable **only in raids and wars**, never in a ranked
 * match — that is the ranked integrity rule, and there is a test for it."
 * §8.2: "Nothing a fleet gives a player can enter a ranked match."
 *
 * `usableReinforcements()` is the one function that decides, it is a `switch`
 * over a four-value union, and every arm has a test. Everything else in the
 * feature — the client's kit builder, the server's raid opener — asks it.
 * There is no second place where a reinforcement could be added to a layout,
 * and that is deliberate: a rule with one implementation is a rule you can
 * check, and this one protects the ranked ladder.
 */
import { specFor } from '../arsenal';
import { RAID_KIT_KINDS } from '../raid';
import type { ArsenalKind } from '../types';
import type { LayoutContext, Reinforcement } from './types';

// ---------------------------------------------------------------------------
// THE RULE
// ---------------------------------------------------------------------------

/**
 * Which reinforcements may be used, in this context.
 *
 * Ranked gets an EMPTY ARRAY. Not a filtered list, not a warning — nothing.
 * The caller cannot accidentally use a truthy value, and a future context
 * added to the union is a TypeScript error here (the switch is exhaustive)
 * rather than a silent grant.
 */
export function usableReinforcements(
  context: LayoutContext,
  held: readonly Reinforcement[],
): readonly Reinforcement[] {
  switch (context) {
    case 'ranked':
      // §3, §8.2. The whole rule, in one line.
      return [];
    case 'raid':
    case 'war':
    case 'friendly':
      return held;
    default: {
      // Exhaustiveness: a new LayoutContext must be classified here, and the
      // safe default if someone bypasses the type system is "none".
      const never: never = context;
      void never;
      return [];
    }
  }
}

/** The same question, as a boolean, for a button's disabled state. */
export function reinforcementsAllowed(context: LayoutContext): boolean {
  return usableReinforcements(context, [{ id: 'x', item: 'bomber', fuel: 0, donorId: 'd', filledAt: 0 }])
    .length > 0;
}

// ---------------------------------------------------------------------------
// The commission (§3)
// ---------------------------------------------------------------------------

/** §3 — "commissioning the item with coins: `fuel × 6` coins (a bomber = 180)". */
export const COMMISSION_COINS_PER_FUEL = 6;

/** §3 — "The donor earns fleet merit ... and 50 steel." */
export const DONOR_STEEL = 50;
export const DONOR_MERIT = 1;

/** §3 — "A member posts a request ... once every 30 minutes." */
export const REQUEST_COOLDOWN_MS = 30 * 60 * 1_000;

/** A request nobody fills stops taking up the slot after a day. */
export const REQUEST_EXPIRY_MS = 24 * 60 * 60 * 1_000;

export function commissionCost(item: ArsenalKind): number {
  return specFor(item).cost * COMMISSION_COINS_PER_FUEL;
}

/** §3's worked example, as a guard against the constant drifting. */
export function bomberCommissionCost(): number {
  return commissionCost('bomber');
}

// ---------------------------------------------------------------------------
// Capacity (§3)
// ---------------------------------------------------------------------------

/**
 * §3 — "Reinforcement capacity = Fleet Hall value (20 / 30 / 40 / 50 / 60
 * fuel-worth)."
 *
 * Those ARE the Fleet Hall's `value` entries in src/engine/city/catalogue.ts,
 * so this table is not a second copy of them — `reinforcementCapacity()` is
 * handed the level and returns the same numbers the catalogue holds. A test
 * pins the two together, because a catalogue edit that did not reach here
 * would quietly change a cap nobody was looking at.
 */
export const REINFORCEMENT_CAPACITY: readonly number[] = [0, 20, 30, 40, 50, 60];

export function reinforcementCapacity(fleetHallLevel: number): number {
  const index = Math.max(0, Math.min(Math.trunc(fleetHallLevel), REINFORCEMENT_CAPACITY.length - 1));
  return REINFORCEMENT_CAPACITY[index] ?? 0;
}

export function reinforcementFuelHeld(held: readonly Reinforcement[]): number {
  return held.reduce((n, r) => n + r.fuel, 0);
}

export interface CapacityCheck {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly used: number;
  readonly capacity: number;
}

/** Is there room for one more of this item? */
export function hasRoomFor(
  held: readonly Reinforcement[],
  item: ArsenalKind,
  fleetHallLevel: number,
): CapacityCheck {
  const capacity = reinforcementCapacity(fleetHallLevel);
  const used = reinforcementFuelHeld(held);
  const cost = specFor(item).cost;
  if (capacity === 0) {
    return { ok: false, reason: 'Build the Fleet Hall before asking for help.', used, capacity };
  }
  if (used + cost > capacity) {
    return {
      ok: false,
      reason: `Your slots hold ${capacity} fuel; ${used} is already spoken for.`,
      used,
      capacity,
    };
  }
  return { ok: true, reason: null, used, capacity };
}

// ---------------------------------------------------------------------------
// Requesting (§3)
// ---------------------------------------------------------------------------

export interface RequestCheck {
  readonly ok: boolean;
  readonly reason: string | null;
  /** When they may ask again, for the countdown. */
  readonly nextAllowedAt: number | null;
}

/**
 * §3 — one offensive item, once every 30 minutes, and only what the Armory
 * could carry anyway (the kit kinds from Part 6 §4 — a fleetmate cannot post
 * you a mine, because a mine defends a harbour and does not raid one).
 */
export function canRequest(
  item: ArsenalKind,
  lastRequestAt: number | null,
  now: number,
): RequestCheck {
  if (!RAID_KIT_KINDS.includes(item)) {
    return { ok: false, reason: 'Fleetmates send weapons, not defences.', nextAllowedAt: null };
  }
  if (lastRequestAt !== null) {
    const next = lastRequestAt + REQUEST_COOLDOWN_MS;
    if (now < next) {
      const minutes = Math.ceil((next - now) / 60_000);
      return {
        ok: false,
        reason: `You asked recently. ${minutes} minute${minutes === 1 ? '' : 's'} yet.`,
        nextAllowedAt: next,
      };
    }
  }
  return { ok: true, reason: null, nextAllowedAt: null };
}

export interface FillCheck {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly cost: number;
}

/** §3 — any member fills it; the donor pays the coins. */
export function canFill(
  request: { requesterId: string; donorId: string | null; item: string },
  donorId: string,
  donorCoins: number,
): FillCheck {
  const cost = commissionCost(request.item as ArsenalKind);
  if (request.donorId !== null) {
    return { ok: false, reason: 'Somebody beat you to it.', cost };
  }
  if (request.requesterId === donorId) {
    return { ok: false, reason: 'You cannot commission your own.', cost };
  }
  if (donorCoins < cost) {
    return { ok: false, reason: `That one costs ${cost} coins.`, cost };
  }
  return { ok: true, reason: null, cost };
}

/** What the fill moves. The SERVER applies it; this only computes it. */
export interface FillOutcome {
  readonly donorCoins: number;
  readonly donorSteel: number;
  readonly donorMerit: number;
  readonly cost: number;
}

export function fillOutcome(item: ArsenalKind): FillOutcome {
  const cost = commissionCost(item);
  return {
    donorCoins: -cost,
    donorSteel: DONOR_STEEL,
    donorMerit: DONOR_MERIT,
    cost,
  };
}

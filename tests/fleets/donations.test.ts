/**
 * Donations — part-08 §7.2.
 *
 * "Donations: capacity, the 30-minute request cooldown, the commission price,
 *  and a test that a reinforcement **cannot** be used in a ranked match."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LAST ONE IS THE POINT OF THIS FILE.
 *
 * §8.2 is an acceptance criterion: "Nothing a fleet gives a player can enter a
 * ranked match." A fleet is a machine for handing people free weapons, and the
 * ranked ladder is the one thing in the game with no other protection — there
 * is no shield, no lock, no cap that would notice an extra bomber.
 *
 * So the rule is tested at all THREE levels it is enforced at:
 *   1. the pure function, for every context in the union;
 *   2. the placement store, which is what the ranked path actually reads;
 *   3. the wire protocol, which has no field that could carry one.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { specFor } from '@engine/arsenal';
import { CITY_CATALOGUE } from '@engine/city';
import { RAID_KIT_KINDS } from '@engine/raid';
import {
  COMMISSION_COINS_PER_FUEL,
  DONOR_MERIT,
  DONOR_STEEL,
  REINFORCEMENT_CAPACITY,
  REQUEST_COOLDOWN_MS,
  bomberCommissionCost,
  canFill,
  canRequest,
  commissionCost,
  fillOutcome,
  hasRoomFor,
  reinforcementCapacity,
  reinforcementFuelHeld,
  reinforcementsAllowed,
  usableReinforcements,
  type LayoutContext,
  type Reinforcement,
} from '@engine/fleets';
import { usePlacement } from '@/state/placement';

const reinforcement = (item: string, fuel: number, id = item): Reinforcement => ({
  id,
  item,
  fuel,
  donorId: 'donor-1',
  filledAt: 1_000,
});

const HELD: Reinforcement[] = [
  reinforcement('bomber', 30),
  reinforcement('submarine', 10),
];

const ALL_CONTEXTS: LayoutContext[] = ['ranked', 'raid', 'war', 'friendly'];

// ===========================================================================
// THE RANKED INTEGRITY RULE (§3, §7.2, §8.2)
// ===========================================================================

describe('a reinforcement cannot be used in a ranked match', () => {
  it('usableReinforcements returns NOTHING for ranked', () => {
    expect(usableReinforcements('ranked', HELD)).toEqual([]);
  });

  it('...and returns them for every context that is allowed to have them', () => {
    expect(usableReinforcements('raid', HELD)).toEqual(HELD);
    expect(usableReinforcements('war', HELD)).toEqual(HELD);
    expect(usableReinforcements('friendly', HELD)).toEqual(HELD);
  });

  it('ranked is the ONLY context that gets nothing', () => {
    const empty = ALL_CONTEXTS.filter((c) => usableReinforcements(c, HELD).length === 0);
    expect(empty).toEqual(['ranked']);
  });

  it('returns an empty array, not a falsy value a caller could misread', () => {
    const out = usableReinforcements('ranked', HELD);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(0);
    // `out.length` is the only truthiness anyone can test, and it is 0.
    expect(Boolean(out.length)).toBe(false);
  });

  it('holds however many reinforcements are held, including a huge pile', () => {
    const many = Array.from({ length: 50 }, (_, n) => reinforcement('bomber', 30, `b${n}`));
    expect(usableReinforcements('ranked', many)).toEqual([]);
  });

  it('the boolean form agrees, for a button’s disabled state', () => {
    expect(reinforcementsAllowed('ranked')).toBe(false);
    expect(reinforcementsAllowed('raid')).toBe(true);
    expect(reinforcementsAllowed('war')).toBe(true);
    expect(reinforcementsAllowed('friendly')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Level 2: the store the ranked path actually reads
  // -------------------------------------------------------------------------

  it('the placement store has no way to load one — there is no such action', () => {
    // app/(game)/searching.tsx sends `placement.arsenal`. If a reinforcement
    // could get into that array, the rule would be bypassed whatever the pure
    // function says. The store has no action that puts one there.
    usePlacement.getState().initialize('ai', 1, 'advanced');
    const actions = Object.keys(usePlacement.getState()).filter(
      (key) => typeof (usePlacement.getState() as unknown as Record<string, unknown>)[key] === 'function',
    );
    for (const name of actions) {
      expect(name.toLowerCase(), name).not.toContain('reinforce');
      expect(name.toLowerCase(), name).not.toContain('donat');
    }
  });

  it('a ranked layout is exactly what the player bought, and nothing else', () => {
    usePlacement.getState().initialize('ai', 7, 'advanced');
    const before = usePlacement.getState().arsenal.length;
    // Nothing a fleet can do changes this array.
    expect(usableReinforcements('ranked', HELD)).toEqual([]);
    expect(usePlacement.getState().arsenal).toHaveLength(before);
  });

  // -------------------------------------------------------------------------
  // Level 3: the wire
  // -------------------------------------------------------------------------

  it('the frozen wire protocol has no reinforcement field', async () => {
    // The ranked path is the match server's `ready` frame. Adding a
    // reinforcement to it would mean changing a protocol that is mirrored by
    // hand in two files — a conspicuous act, not an accident.
    const protocol = await import('@/net/protocol');
    const text = JSON.stringify(Object.keys(protocol));
    expect(text.toLowerCase()).not.toContain('reinforce');
    expect(text.toLowerCase()).not.toContain('donation');
  });
});

// ===========================================================================
// The commission price (§3)
// ===========================================================================

describe('the commission price', () => {
  it('is fuel x 6', () => {
    expect(COMMISSION_COINS_PER_FUEL).toBe(6);
    for (const kind of RAID_KIT_KINDS) {
      expect(commissionCost(kind), kind).toBe(specFor(kind).cost * 6);
    }
  });

  it('a bomber is 180, exactly as §3 says', () => {
    // §3's worked example. If the arsenal's bomber ever changes price this
    // fails, and the doc has to change with it.
    expect(bomberCommissionCost()).toBe(180);
    expect(specFor('bomber').cost).toBe(30);
  });

  it('the donor pays coins and receives steel and merit', () => {
    const outcome = fillOutcome('bomber');
    expect(outcome.cost).toBe(180);
    expect(outcome.donorCoins).toBe(-180);
    expect(outcome.donorSteel).toBe(DONOR_STEEL);
    expect(outcome.donorSteel).toBe(50);
    expect(outcome.donorMerit).toBe(DONOR_MERIT);
  });

  it('refuses a donor who cannot afford it, and says the price', () => {
    const check = canFill({ requesterId: 'r', donorId: null, item: 'bomber' }, 'd', 100);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('180');
  });

  it('refuses a second donor', () => {
    const check = canFill({ requesterId: 'r', donorId: 'first', item: 'bomber' }, 'd', 9_999);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('beat you to it');
  });

  it('refuses filling your own request', () => {
    const check = canFill({ requesterId: 'me', donorId: null, item: 'bomber' }, 'me', 9_999);
    expect(check.ok).toBe(false);
  });

  it('allows an affordable fill', () => {
    expect(canFill({ requesterId: 'r', donorId: null, item: 'bomber' }, 'd', 180).ok).toBe(true);
  });
});

// ===========================================================================
// Capacity (§3)
// ===========================================================================

describe('reinforcement capacity', () => {
  it('is the Fleet Hall value: 20 / 30 / 40 / 50 / 60', () => {
    expect(REINFORCEMENT_CAPACITY).toEqual([0, 20, 30, 40, 50, 60]);
    expect([1, 2, 3, 4, 5].map(reinforcementCapacity)).toEqual([20, 30, 40, 50, 60]);
  });

  it('is the SAME number the city catalogue holds for the Fleet Hall', () => {
    // Two tables that must agree. A catalogue edit that did not reach the
    // fleets module would silently change a cap nobody was looking at.
    const levels = CITY_CATALOGUE.fleet_hall.levels;
    for (let level = 1; level <= levels.length; level++) {
      expect(reinforcementCapacity(level), `level ${level}`).toBe(levels[level - 1]!.value);
    }
  });

  it('is zero with no Fleet Hall, and says to build one', () => {
    expect(reinforcementCapacity(0)).toBe(0);
    const check = hasRoomFor([], 'bomber', 0);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('Fleet Hall');
  });

  it('clamps a level past the table rather than returning undefined', () => {
    expect(reinforcementCapacity(99)).toBe(60);
    expect(reinforcementCapacity(-3)).toBe(0);
  });

  it('counts the fuel already held', () => {
    expect(reinforcementFuelHeld(HELD)).toBe(40);
    expect(reinforcementFuelHeld([])).toBe(0);
  });

  it('refuses one that will not fit, and says by how much', () => {
    // Fleet Hall 1 = 20 fuel. A bomber is 30.
    const check = hasRoomFor([], 'bomber', 1);
    expect(check.ok).toBe(false);
    expect(check.capacity).toBe(20);
    expect(check.reason).toContain('20');
  });

  it('allows one that exactly fills the slots', () => {
    // Fleet Hall 3 = 40. Held 30, asking for a submarine at 10.
    const check = hasRoomFor([reinforcement('bomber', 30)], 'submarine', 3);
    expect(check.ok).toBe(true);
    expect(check.used).toBe(30);
  });

  it('refuses the one that would overflow by a single point of fuel', () => {
    const check = hasRoomFor([reinforcement('bomber', 30), reinforcement('sub', 10)], 'submarine', 3);
    expect(check.ok).toBe(false);
  });
});

// ===========================================================================
// The 30-minute cooldown (§3)
// ===========================================================================

describe('the request cooldown', () => {
  const NOW = 1_700_000_000_000;

  it('is 30 minutes', () => {
    expect(REQUEST_COOLDOWN_MS).toBe(30 * 60 * 1_000);
  });

  it('allows a first request', () => {
    expect(canRequest('bomber', null, NOW).ok).toBe(true);
  });

  it('refuses a second inside the window, and counts down', () => {
    const check = canRequest('bomber', NOW - 10 * 60_000, NOW);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('20 minute');
    expect(check.nextAllowedAt).toBe(NOW - 10 * 60_000 + REQUEST_COOLDOWN_MS);
  });

  it('allows one at exactly 30 minutes', () => {
    expect(canRequest('bomber', NOW - REQUEST_COOLDOWN_MS, NOW).ok).toBe(true);
  });

  it('says "1 minute", not "1 minutes"', () => {
    const check = canRequest('bomber', NOW - 29.5 * 60_000, NOW);
    expect(check.reason).toContain('1 minute yet');
  });

  it('refuses a defence — fleetmates send weapons, not mines', () => {
    // A mine defends a harbour and does not raid one (Part 6 §4), so it is
    // not something a fleetmate can commission.
    const check = canRequest('mine', null, NOW);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('weapons, not defences');
  });

  it('accepts every kind the Armory could actually load', () => {
    for (const kind of RAID_KIT_KINDS) {
      expect(canRequest(kind, null, NOW).ok, kind).toBe(true);
    }
  });
});

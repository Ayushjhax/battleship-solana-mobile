/**
 * Hardening pass §2 — the voyage route table, previously exercised only from
 * the server suite, is pure rules and belongs in the app suite too.
 *
 * The load-bearing rule is §3's "rewards are rolled server-side at send time":
 * `rollReward` is the only place randomness enters a voyage, so these pin the
 * coin-or-steel choice, the level scaling, the gem/pirate rolls and the
 * collectability gates.
 */
import { describe, expect, it } from 'vitest';
import type { Rng } from '@engine/rng';
import {
  canCollect,
  levelMultiplier,
  payout,
  returnsAt,
  rollReward,
  routeById,
  ROUTE_TABLE,
  skirmishExpired,
  SKIRMISH_GRACE_MS,
  voyageSlots,
  type Voyage,
  type VoyageReward,
} from '@engine/voyages';

/** A scripted RNG: exact ints, then exact floats, in call order. */
function scriptedRng(ints: readonly number[], floats: readonly number[]): Rng {
  const i = [...ints];
  const f = [...floats];
  return {
    next: () => f.shift() ?? 0,
    int: (maxExclusive) => {
      const value = i.shift() ?? 0;
      if (value >= maxExclusive) throw new Error(`scripted int ${value} >= ${maxExclusive}`);
      return value;
    },
    pick: (arr) => arr[0] as never,
    shuffle: (arr) => [...arr],
  };
}

const cargo: VoyageReward = { coins: 400, steel: 500, gems: 8, cosmetic: null, pirate: false };

describe('the route table', () => {
  it('finds a route by id and returns null for an unknown one', () => {
    expect(routeById('coral-bay')?.coins).toBe(120);
    expect(routeById('far-isles')?.hours).toBe(12);
    expect(routeById('atlantis')).toBeNull();
    expect(ROUTE_TABLE).toHaveLength(4);
  });

  it('unlocks one slot per Trade Docks level, capped at three', () => {
    expect(voyageSlots(-1)).toBe(0);
    expect(voyageSlots(0)).toBe(0);
    expect(voyageSlots(1)).toBe(1);
    expect(voyageSlots(2.9)).toBe(2);
    expect(voyageSlots(3)).toBe(3);
    expect(voyageSlots(9)).toBe(3);
  });

  it('scales rewards by +25% per level above 1, capped at level 3', () => {
    expect(levelMultiplier(0)).toBe(1);
    expect(levelMultiplier(1)).toBe(1);
    expect(levelMultiplier(2)).toBe(1.25);
    expect(levelMultiplier(3)).toBe(1.5);
    expect(levelMultiplier(9)).toBe(1.5);
  });
});

describe('rollReward — §3’s one server-side roll', () => {
  const coral = routeById('coral-bay')!;
  const iron = routeById('iron-point')!;
  const far = routeById('far-isles')!;

  it('pays coins OR steel, never both', () => {
    const coins = rollReward(coral, 1, scriptedRng([0], [0.99]));
    expect(coins).toMatchObject({ coins: 120, steel: 0, gems: 0, pirate: false });
    const steel = rollReward(coral, 1, scriptedRng([1], [0.99]));
    expect(steel).toMatchObject({ coins: 0, steel: 150, gems: 0 });
  });

  it('scales the chosen currency by the dock level', () => {
    expect(rollReward(coral, 3, scriptedRng([0], [0.99])).coins).toBe(180);
    expect(rollReward(coral, 3, scriptedRng([1], [0.99])).steel).toBe(225);
  });

  it('rolls gems only on the routes that offer them', () => {
    // Iron Point: gemChance 0.15, so a 0.10 roll wins 5 + int(6) gems.
    const gems = rollReward(iron, 2, scriptedRng([0, 5], [0.1, 0.99]));
    expect(gems.gems).toBe(10);
    expect(gems.coins).toBe(1125);
    // Coral Bay has no gem chance, so the roll is never consumed.
    expect(rollReward(coral, 1, scriptedRng([0], [0.1, 0.99])).gems).toBe(0);
  });

  it('rolls the pirate risk and never a cosmetic (the route table ships none)', () => {
    expect(rollReward(far, 1, scriptedRng([0], [0.99, 0.01])).pirate).toBe(true);
    expect(rollReward(far, 1, scriptedRng([0], [0.99, 0.99])).pirate).toBe(false);
    expect(rollReward(far, 1, scriptedRng([0], [0.99, 0.99])).cosmetic).toBeNull();
  });
});

describe('returning and collecting', () => {
  const coral = routeById('coral-bay')!;
  const sentAt = 1_000_000;

  function voyage(over: Partial<Voyage> = {}): Voyage {
    return {
      id: 'v1',
      route: 'coral-bay',
      slot: 1,
      sentAt,
      returnsAt: returnsAt(coral, sentAt),
      reward: { coins: 120, steel: 0, gems: 0, cosmetic: null, pirate: false },
      state: 'sailing',
      ...over,
    };
  }

  it('returns at exactly the route’s hours', () => {
    expect(returnsAt(coral, sentAt) - sentAt).toBe(3_600_000);
  });

  it('gates collection by state and clock', () => {
    expect(canCollect(voyage(), sentAt)).toMatchObject({ ok: false, error: 'not-back-yet' });
    expect(canCollect(voyage(), returnsAt(coral, sentAt))).toMatchObject({ ok: true, error: null });
    expect(canCollect(voyage({ state: 'collected' }), sentAt + 10 * 3_600_000)).toMatchObject({
      error: 'already-collected',
    });
    expect(canCollect(voyage({ state: 'attacked' }), sentAt + 10 * 3_600_000)).toMatchObject({
      error: 'under-attack',
    });
    expect(
      canCollect(
        voyage({ reward: { ...voyage().reward, pirate: true } }),
        returnsAt(coral, sentAt) + 1,
      ),
    ).toMatchObject({ error: 'under-attack' });
  });

  it('pays full +25% for a win, half for anything else, and full for an untouched cargo', () => {
    expect(payout(cargo, 'won')).toMatchObject({ coins: 500, steel: 625, gems: 10 });
    expect(payout(cargo, 'lost')).toMatchObject({ coins: 200, steel: 250, gems: 4 });
    expect(payout(cargo, 'ignored')).toMatchObject({ coins: 200, steel: 250 });
    expect(payout(cargo, 'unverified')).toEqual(payout(cargo, 'lost'));
    expect(payout(cargo, 'none')).toMatchObject({ coins: 400, steel: 500, gems: 8 });
  });

  it('expires the skirmish window exactly 24 h after return', () => {
    const back = returnsAt(coral, sentAt);
    expect(skirmishExpired(back, back + SKIRMISH_GRACE_MS - 1)).toBe(false);
    expect(skirmishExpired(back, back + SKIRMISH_GRACE_MS)).toBe(true);
  });
});

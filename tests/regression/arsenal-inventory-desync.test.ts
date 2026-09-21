/**
 * Regression: "If I quickly double tap an arsenal item (for example AA Gun),
 * its available count is reduced twice, but only one item is actually placed
 * on the board. This leaves the arsenal count and board state out of sync, so
 * the player cannot finish placement and the match cannot start."
 *
 * Two separate faults produced it:
 *
 *  1. `buyArsenal` set `pendingArsenalId` to whatever it had just bought. A
 *     second tap before the first item was given a cell bought another and
 *     overwrote the id, stranding the first — fuel spent on an item with no
 *     square, invisible and unplaceable.
 *  2. ShopCard's `atCap` / `affordable` guards read `count` and `remaining`
 *     from props, which are a render behind. Two taps inside one frame both
 *     saw the stale figures, so the component could not stop it either.
 *
 * The invariant these pin: at most one purchased item may be without a cell at
 * any moment, and it is always the one `pendingArsenalId` points at. Anything
 * else is the stuck state above.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { specFor } from '../../src/engine/arsenal';
import { usePlacement } from '../../src/state/placement';

/** Items that need a board cell — the ones that can strand. */
const PLACEABLE = ['aaGun', 'mine', 'radar'] as const;

/**
 * The stuck state, stated once: a placeable item exists that has no cell and
 * is not the pending one, so nothing in the UI can ever resolve it.
 */
function strandedItems() {
  const { arsenal, pendingArsenalId } = usePlacement.getState();
  return arsenal.filter(
    (item) =>
      specFor(item.kind).placement === 'own board' &&
      item.at === undefined &&
      item.id !== pendingArsenalId,
  );
}

/** Fuel spent must always equal the cost of what is actually in the arsenal. */
function fuelIsConsistent() {
  const { arsenal, fuelSpent } = usePlacement.getState();
  return fuelSpent === arsenal.reduce((sum, item) => sum + specFor(item.kind).cost, 0);
}

beforeEach(() => {
  usePlacement.getState().initialize('ai', 1, 'advanced');
});

describe('rapid taps can never strand an item', () => {
  it.each(PLACEABLE)('%s: ten taps in one frame leave exactly one unplaced', (kind) => {
    for (let tap = 0; tap < 10; tap += 1) usePlacement.getState().buyArsenal(kind);

    const unplaced = usePlacement
      .getState()
      .arsenal.filter((item) => item.at === undefined);

    expect(unplaced).toHaveLength(1);
    expect(unplaced[0]?.id).toBe(usePlacement.getState().pendingArsenalId);
    expect(strandedItems()).toEqual([]);
  });

  it.each(PLACEABLE)('%s: one placement consumes exactly one purchase', (kind) => {
    usePlacement.getState().buyArsenal(kind);
    usePlacement.getState().buyArsenal(kind);
    const cost = specFor(kind).cost;

    usePlacement.getState().placePendingArsenal({ r: 3, c: 3 });

    const owned = usePlacement.getState().arsenal.filter((item) => item.kind === kind);
    expect(owned).toHaveLength(1);
    expect(owned[0]?.at).toEqual({ r: 3, c: 3 });
    expect(usePlacement.getState().fuelSpent).toBe(cost);
  });

  it('interleaved buy/place cycles stay consistent', () => {
    const cells = [
      { r: 0, c: 0 },
      { r: 2, c: 2 },
      { r: 4, c: 4 },
    ];
    for (const at of cells) {
      // Double-tap every time, as a fast player does.
      usePlacement.getState().buyArsenal('mine');
      usePlacement.getState().buyArsenal('mine');
      usePlacement.getState().placePendingArsenal(at);

      expect(strandedItems()).toEqual([]);
      expect(fuelIsConsistent()).toBe(true);
    }

    const mines = usePlacement.getState().arsenal.filter((item) => item.kind === 'mine');
    expect(mines).toHaveLength(cells.length);
    expect(mines.every((item) => item.at !== undefined)).toBe(true);
  });

  it('keeps fuel equal to what is actually owned after a tap storm', () => {
    for (let tap = 0; tap < 25; tap += 1) {
      usePlacement.getState().buyArsenal('aaGun');
      usePlacement.getState().buyArsenal('radar');
      usePlacement.getState().buyArsenal('mine');
    }

    expect(fuelIsConsistent()).toBe(true);
    expect(strandedItems()).toEqual([]);
  });
});

describe('the engine caps still hold under a tap storm', () => {
  it.each(PLACEABLE)('%s never exceeds its maximum', (kind) => {
    const max = specFor(kind).max;

    for (let round = 0; round < max + 5; round += 1) {
      usePlacement.getState().buyArsenal(kind);
      usePlacement.getState().placePendingArsenal({ r: round % 10, c: (round * 3) % 10 });
    }

    const owned = usePlacement.getState().arsenal.filter((item) => item.kind === kind);
    expect(owned.length).toBeLessThanOrEqual(max);
  });

  it('never spends more fuel than the budget', () => {
    const kinds = ['aaGun', 'mine', 'radar', 'bomber', 'atomicBomber'] as const;
    for (let round = 0; round < 40; round += 1) {
      for (const kind of kinds) {
        usePlacement.getState().buyArsenal(kind);
        usePlacement.getState().placePendingArsenal({ r: round % 10, c: (round * 7) % 10 });
      }
    }

    const { fuelSpent, fuelBudget } = usePlacement.getState();
    expect(fuelSpent).toBeLessThanOrEqual(fuelBudget);
    expect(fuelIsConsistent()).toBe(true);
  });
});

describe('placement can always be completed', () => {
  it('an unplaced item is always resolvable — place it or cancel it', () => {
    usePlacement.getState().buyArsenal('aaGun');
    usePlacement.getState().buyArsenal('aaGun');

    // Whatever happened, the one unplaced item is reachable by both routes.
    const pending = usePlacement.getState().pendingArsenalId;
    expect(pending).not.toBeNull();

    usePlacement.getState().cancelPendingArsenal();

    expect(usePlacement.getState().pendingArsenalId).toBeNull();
    expect(usePlacement.getState().arsenal.filter((i) => i.at === undefined)).toEqual([]);
    expect(fuelIsConsistent()).toBe(true);
  });

  it('sellPlacedArsenal clears a pending item too, so nothing is left behind', () => {
    usePlacement.getState().buyArsenal('mine');
    usePlacement.getState().placePendingArsenal({ r: 1, c: 1 });
    usePlacement.getState().buyArsenal('mine');

    usePlacement.getState().sellPlacedArsenal();

    expect(usePlacement.getState().arsenal).toEqual([]);
    expect(usePlacement.getState().pendingArsenalId).toBeNull();
    expect(usePlacement.getState().fuelSpent).toBe(0);
  });

  it('a rejected purchase changes nothing at all', () => {
    usePlacement.getState().buyArsenal('aaGun');
    const before = {
      arsenal: usePlacement.getState().arsenal,
      fuelSpent: usePlacement.getState().fuelSpent,
      pendingArsenalId: usePlacement.getState().pendingArsenalId,
    };

    const rejected = usePlacement.getState().buyArsenal('aaGun');

    expect(rejected.ok).toBe(false);
    expect(usePlacement.getState().arsenal).toBe(before.arsenal);
    expect(usePlacement.getState().fuelSpent).toBe(before.fuelSpent);
    expect(usePlacement.getState().pendingArsenalId).toBe(before.pendingArsenalId);
  });
});

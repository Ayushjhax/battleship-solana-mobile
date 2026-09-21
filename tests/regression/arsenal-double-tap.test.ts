/**
 * Regression: "Double tap of arsenal item messes up in the placement."
 *
 * `buyArsenal` set `pendingArsenalId` to whatever it had just bought. A second
 * tap before the first item was given a cell bought another one and overwrote
 * that id, so the first purchase was stranded: fuel had been spent, the item
 * existed on the board with no `at`, nothing referenced it, and it could never
 * be placed or cancelled. The fuel bar dropped with no item to show for it.
 *
 * Only the three items that need a square behave this way — aaGun, mine and
 * radar. The rest are bought straight into the loadout, so tapping them twice
 * is two ordinary purchases and must keep working.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { usePlacement } from '../../src/state/placement';

const PLACEABLE = ['aaGun', 'mine', 'radar'] as const;

function reset(ruleset: 'classic' | 'advanced' = 'advanced') {
  usePlacement.getState().initialize('ai', 1, ruleset);
}

beforeEach(() => {
  reset();
});

describe('buying a cell-placed item twice', () => {
  it.each(PLACEABLE)('refuses the second %s while the first is unplaced', (kind) => {
    const first = usePlacement.getState().buyArsenal(kind);
    expect(first.ok).toBe(true);
    const pendingAfterFirst = usePlacement.getState().pendingArsenalId;
    const fuelAfterFirst = usePlacement.getState().fuelSpent;

    const second = usePlacement.getState().buyArsenal(kind);

    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/place the current item first/i);
    // The first purchase is still the one waiting, and nothing extra was spent.
    expect(usePlacement.getState().pendingArsenalId).toBe(pendingAfterFirst);
    expect(usePlacement.getState().fuelSpent).toBe(fuelAfterFirst);
  });

  it('never strands an unplaced item on the board', () => {
    usePlacement.getState().buyArsenal('aaGun');
    usePlacement.getState().buyArsenal('aaGun');
    usePlacement.getState().buyArsenal('aaGun');

    const unplaced = usePlacement.getState().arsenal.filter((item) => item.at === undefined);
    const pending = usePlacement.getState().pendingArsenalId;

    // Exactly one item is unplaced, and it is the one being pointed at.
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0]?.id).toBe(pending);
  });

  it('charges fuel exactly once for a double tap', () => {
    const before = usePlacement.getState().fuelSpent;

    usePlacement.getState().buyArsenal('mine');
    const afterOne = usePlacement.getState().fuelSpent;
    usePlacement.getState().buyArsenal('mine');
    const afterTwo = usePlacement.getState().fuelSpent;

    expect(afterOne).toBeGreaterThan(before);
    expect(afterTwo).toBe(afterOne);
  });

  it('surfaces a reason the placement screen can show', () => {
    usePlacement.getState().buyArsenal('radar');
    usePlacement.getState().buyArsenal('radar');

    expect(usePlacement.getState().validationReason).toMatch(/place the current item first/i);
  });

  it('allows the next purchase once the first is placed', () => {
    usePlacement.getState().buyArsenal('mine');
    const placed = usePlacement.getState().placePendingArsenal({ r: 4, c: 4 });
    expect(placed.ok).toBe(true);
    expect(usePlacement.getState().pendingArsenalId).toBeNull();

    const second = usePlacement.getState().buyArsenal('mine');

    expect(second.ok).toBe(true);
    expect(usePlacement.getState().pendingArsenalId).not.toBeNull();
  });

  it('allows the next purchase once the first is cancelled', () => {
    usePlacement.getState().buyArsenal('aaGun');
    const fuelWithPending = usePlacement.getState().fuelSpent;
    usePlacement.getState().cancelPendingArsenal();

    expect(usePlacement.getState().pendingArsenalId).toBeNull();
    expect(usePlacement.getState().fuelSpent).toBeLessThan(fuelWithPending);
    expect(usePlacement.getState().buyArsenal('aaGun').ok).toBe(true);
  });

  it('refuses a different kind too — the block is about the pending slot', () => {
    usePlacement.getState().buyArsenal('aaGun');

    expect(usePlacement.getState().buyArsenal('mine').ok).toBe(false);
    expect(usePlacement.getState().buyArsenal('radar').ok).toBe(false);
  });
});

describe('items that do not need a cell', () => {
  it('can still be bought twice in a row', () => {
    // These never set pendingArsenalId, so the new guard must not touch them.
    const first = usePlacement.getState().buyArsenal('bomber');
    const second = usePlacement.getState().buyArsenal('bomber');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(usePlacement.getState().pendingArsenalId).toBeNull();
    expect(first.itemId).not.toBe(second.itemId);
  });

  it('charges fuel for each one', () => {
    const before = usePlacement.getState().fuelSpent;
    usePlacement.getState().buyArsenal('bomber');
    const afterOne = usePlacement.getState().fuelSpent;
    usePlacement.getState().buyArsenal('bomber');

    expect(afterOne).toBeGreaterThan(before);
    expect(usePlacement.getState().fuelSpent).toBeGreaterThan(afterOne);
  });
});

describe('classic mode is unaffected', () => {
  it('still refuses any arsenal purchase for its own reason', () => {
    reset('classic');

    const result = usePlacement.getState().buyArsenal('mine');

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/classic mode has no arsenal/i);
  });
});

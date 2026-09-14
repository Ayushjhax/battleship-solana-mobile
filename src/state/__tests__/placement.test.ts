import { emptyBoard } from '../../engine/board';
import { specFor } from '../../engine/arsenal';
import { FLEET_SHIP_COUNT } from '../../engine/fleet';
import { validateArsenalPlacement, validateLayout } from '../../engine/placement';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePlacement } from '../placement';

describe('placement store', () => {
  beforeEach(() => usePlacement.getState().initialize('ai', 1, 'advanced'));

  it('keeps all 50 shuffled fleets complete and valid', () => {
    for (let seed = 1; seed <= 50; seed++) {
      usePlacement.getState().autoPlace(seed);
      const ships = usePlacement.getState().ships;
      expect(ships).toHaveLength(FLEET_SHIP_COUNT);
      expect(validateLayout(ships)).toEqual({ ok: true });
    }
  });

  it('keeps fuel equal to the exact purchase total and never overspends', () => {
    const kinds = ['atomicBomber', 'bomber', 'doubleTorpedoBomber', 'torpedoBomber'] as const;
    for (let pass = 0; pass < 5; pass++) {
      for (const kind of kinds) usePlacement.getState().buyArsenal(kind);
    }
    const state = usePlacement.getState();
    const expected = state.arsenal.reduce((sum, item) => sum + specFor(item.kind).cost, 0);
    expect(state.fuelSpent).toBe(expected);
    expect(state.fuelSpent).toBeLessThanOrEqual(state.fuelBudget);
    expect(state.fuelBudget - state.fuelSpent).toBeGreaterThanOrEqual(0);
  });

  it('places and sells an AA gun with an exact full refund', () => {
    const bought = usePlacement.getState().buyArsenal('aaGun');
    expect(bought.ok).toBe(true);
    const afterBuy = usePlacement.getState();
    expect(afterBuy.fuelSpent).toBe(10);

    const pending = afterBuy.arsenal.find((item) => item.id === afterBuy.pendingArsenalId);
    expect(pending).toBeDefined();
    const board = { ...emptyBoard(), ships: afterBuy.ships, arsenal: afterBuy.arsenal };
    const index = Array.from({ length: 100 }, (_, i) => i).find(
      (i) =>
        validateArsenalPlacement(board, {
          ...pending!,
          at: { r: Math.floor(i / 10), c: i % 10 },
        }).ok,
    );
    expect(index).toBeDefined();
    expect(
      usePlacement.getState().placePendingArsenal({ r: Math.floor(index! / 10), c: index! % 10 })
        .ok,
    ).toBe(true);

    const placed = usePlacement.getState().arsenal.find((item) => item.id === pending!.id);
    expect(placed?.at).toBeDefined();
    expect(usePlacement.getState().sellArsenal(pending!.id).ok).toBe(true);
    expect(usePlacement.getState().fuelSpent).toBe(0);
    expect(usePlacement.getState().arsenal).toHaveLength(0);
  });

  it('classic mode clears the arsenal and refunds every item', () => {
    usePlacement.getState().buyArsenal('submarine');
    usePlacement.getState().buyArsenal('bomber');
    expect(usePlacement.getState().fuelSpent).toBeGreaterThan(0);
    usePlacement.getState().setRuleset('classic');
    expect(usePlacement.getState().ruleset).toBe('classic');
    expect(usePlacement.getState().fuelSpent).toBe(0);
    expect(usePlacement.getState().arsenal).toEqual([]);
  });
});

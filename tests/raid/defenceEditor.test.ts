/**
 * part-07 §8.1 — "Defence editor: budget maths, caps, invalid save maps to
 * copy, read-only while under attack, unsaved-changes guard."
 *
 * The editor IS the placement screen (§2, "the placement screen with three
 * differences, and no forked code"), so half of these tests are about the
 * placement store behaving differently when its mode is `'harbour'` — and,
 * just as importantly, behaving IDENTICALLY when it is not.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { specFor } from '@engine/arsenal';
import { cellsOf, halo } from '@engine/board';
import { HARBOUR_KINDS, RAID_KIT_KINDS, harbourFuelFor, raidFuelFor } from '@engine/raid';
import type { ArsenalItem, ArsenalKind } from '@engine/types';

import { RAID_ERROR_LINES, harbourErrorLine, raidErrorLine } from '@/raid/ui/captainCopy';
import {
  canBuyForHarbour,
  canBuyForKit,
  harbourBudget,
  harbourCapFor,
  harbourCapTable,
  harbourShopKinds,
  kitBudget,
  kitShopKinds,
} from '@/raid/ui/defenceBudget';
import { RAID_ERROR_CODES } from '@/raid/types';
import { usePlacement } from '@/state/placement';

const item = (kind: ArsenalKind, n: number): ArsenalItem => ({
  id: `${kind}-${n}`,
  kind,
  at: { r: 9, c: n },
});

const ALL_UNLOCKS = ['sonar_net', 'decoy', 'minesweeper'];

/** Cells no ship or halo occupies, so an item can legally land there. */
function freeCells(ships: readonly import('@engine/types').Ship[]): { r: number; c: number }[] {
  const blocked = new Set<string>();
  for (const ship of ships) {
    for (const cell of cellsOf(ship)) blocked.add(`${cell.r},${cell.c}`);
    for (const cell of halo(ship)) blocked.add(`${cell.r},${cell.c}`);
  }
  const out: { r: number; c: number }[] = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      if (!blocked.has(`${r},${c}`)) out.push({ r, c });
    }
  }
  return out;
}

// ===========================================================================
// Budget maths (§8.1)
// ===========================================================================

describe('the harbour fuel budget', () => {
  it('reads "Harbour fuel spent / budget", not the match fuel', () => {
    const budget = harbourBudget([item('mine', 0), item('aaGun', 2)], 4);
    const expected = specFor('mine').cost + specFor('aaGun').cost;
    expect(budget.spent).toBe(expected);
    expect(budget.budget).toBe(harbourFuelFor(4));
    expect(budget.label).toBe(`Harbour fuel ${expected} / ${harbourFuelFor(4)}`);
    // The match budget is 260; the harbour's is nothing like it.
    expect(budget.budget).not.toBe(260);
  });

  it('an empty harbour has spent nothing', () => {
    expect(harbourBudget([], 5)).toMatchObject({ spent: 0, remaining: harbourFuelFor(5) });
  });

  it('remaining can go negative, so an over-budget board says so', () => {
    const many = Array.from({ length: 30 }, (_, n) => item('mine', n));
    expect(harbourBudget(many, 1).remaining).toBeLessThan(0);
  });

  it('rises with the Coastal Command level', () => {
    for (let level = 1; level <= 6; level++) {
      expect(harbourBudget([], level).budget).toBeGreaterThanOrEqual(
        harbourBudget([], level - 1).budget,
      );
    }
  });
});

describe('the raid kit budget', () => {
  it('is the Armory raid fuel', () => {
    const budget = kitBudget({ bomber: 1 }, 3);
    expect(budget.budget).toBe(raidFuelFor(3));
    expect(budget.spent).toBe(specFor('bomber').cost);
    expect(budget.label).toBe(`Raid fuel ${specFor('bomber').cost} / ${raidFuelFor(3)}`);
  });

  it('counts multiples', () => {
    expect(kitBudget({ bomber: 2 }, 5).spent).toBe(specFor('bomber').cost * 2);
  });

  it('ignores zero and negative counts', () => {
    expect(kitBudget({ bomber: 0, submarine: -2 }, 5).spent).toBe(0);
  });
});

// ===========================================================================
// Caps (§8.1)
// ===========================================================================

describe('Coastal Command caps, which are not the match caps', () => {
  it('a harbour at level 6 holds more mines than a match allows', () => {
    expect(harbourCapFor('mine', 6)).toBe(8);
    expect(specFor('mine').max).toBe(5);
    expect(harbourCapFor('mine', 6)).toBeGreaterThan(specFor('mine').max);
  });

  it('caps rise with the level and never fall', () => {
    for (const kind of HARBOUR_KINDS) {
      for (let level = 1; level <= 6; level++) {
        expect(harbourCapFor(kind, level)).toBeGreaterThanOrEqual(harbourCapFor(kind, level - 1));
      }
    }
  });

  it('the cap table covers exactly the harbour kinds', () => {
    expect(Object.keys(harbourCapTable(5)).sort()).toEqual([...HARBOUR_KINDS].sort());
  });

  it('refuses one past the cap, and says how many are allowed', () => {
    const cap = harbourCapFor('mine', 1);
    const full = Array.from({ length: cap }, (_, n) => item('mine', n));
    const check = canBuyForHarbour(full, 'mine', {
      coastalCommandLevel: 1,
      unlocks: ALL_UNLOCKS,
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toContain(String(cap));
  });

  it('allows the last one under the cap', () => {
    const cap = harbourCapFor('mine', 3);
    const almost = Array.from({ length: cap - 1 }, (_, n) => item('mine', n));
    expect(
      canBuyForHarbour(almost, 'mine', { coastalCommandLevel: 3, unlocks: ALL_UNLOCKS }).ok,
    ).toBe(true);
  });
});

describe('what each shop stocks', () => {
  it('the harbour stocks own-board defences and NOT radar', () => {
    expect(harbourShopKinds()).toEqual(HARBOUR_KINDS);
    expect(harbourShopKinds()).not.toContain('radar');
    expect(harbourShopKinds()).not.toContain('bomber');
  });

  it('the kit stocks the seven §4 weapons, including radar', () => {
    expect(kitShopKinds()).toEqual(RAID_KIT_KINDS);
    expect(kitShopKinds()).toContain('radar');
  });

  it('refuses a weapon in a harbour and a defence in a kit', () => {
    const harbour = canBuyForHarbour([], 'bomber', {
      coastalCommandLevel: 5,
      unlocks: ALL_UNLOCKS,
    });
    expect(harbour.ok).toBe(false);
    expect(harbour.reason).toContain('not a harbour defence');

    const kit = canBuyForKit({}, 'mine', { armoryLevel: 5, unlocks: ALL_UNLOCKS });
    expect(kit.ok).toBe(false);
    expect(kit.reason).toContain('does not raid');
  });

  it('gates nets and decoys on the Academy', () => {
    const none = { coastalCommandLevel: 5, unlocks: [] as string[] };
    expect(canBuyForHarbour([], 'sonar_net', none).reason).toContain('Academy');
    expect(canBuyForHarbour([], 'decoy', none).reason).toContain('Academy');
    // Mines and guns never needed research.
    expect(canBuyForHarbour([], 'mine', none).ok).toBe(true);
  });

  it('refuses when the fuel will not cover it', () => {
    // Level 1 pays 50. Fill it with mines, then try an AA gun at 10.
    const spent = Array.from({ length: harbourCapFor('mine', 1) }, (_, n) => item('mine', n));
    const budget = harbourBudget(spent, 1);
    if (budget.remaining < specFor('aaGun').cost) {
      expect(
        canBuyForHarbour(spent, 'aaGun', { coastalCommandLevel: 1, unlocks: ALL_UNLOCKS }).reason,
      ).toContain('harbour fuel');
    }
    // Armory 1 pays 40; an atomic bomber is 60.
    expect(canBuyForKit({}, 'atomicBomber', { armoryLevel: 1, unlocks: ALL_UNLOCKS }).reason).toBe(
      'Not enough raid fuel.',
    );
  });
});

// ===========================================================================
// The placement store in harbour mode (§2 — "no forked code")
// ===========================================================================

describe('the placement store serves both, from one code path', () => {
  beforeEach(() => {
    usePlacement.getState().initialize('ai', 1, 'advanced');
  });

  it('a match is untouched: full budget, every kind, match caps', () => {
    const state = usePlacement.getState();
    expect(state.mode).toBe('ai');
    expect(state.allowedKinds).toBeNull();
    expect(state.kindCaps).toBeNull();
    expect(state.fuelLabel).toBe('Fuel');
    expect(state.fuelBudget).toBe(260);
  });

  it('harbour mode swaps the budget, the shop and the chip', () => {
    usePlacement.getState().initialize('harbour', 1, 'advanced', {
      fuelBudget: harbourFuelFor(4),
      allowedKinds: harbourShopKinds(),
      kindCaps: harbourCapTable(4),
      fuelLabel: 'Harbour fuel',
    });
    const state = usePlacement.getState();
    expect(state.mode).toBe('harbour');
    expect(state.fuelBudget).toBe(harbourFuelFor(4));
    expect(state.allowedKinds).toEqual(HARBOUR_KINDS);
    expect(state.fuelLabel).toBe('Harbour fuel');
  });

  it('refuses a kind the harbour does not stock', () => {
    usePlacement.getState().initialize('harbour', 1, 'advanced', {
      fuelBudget: 200,
      allowedKinds: harbourShopKinds(),
      kindCaps: harbourCapTable(6),
    });
    const result = usePlacement.getState().buyArsenal('bomber');
    expect(result.ok).toBe(false);
    expect(usePlacement.getState().arsenal).toHaveLength(0);
  });

  it('enforces the Coastal Command cap, not the match cap', () => {
    usePlacement.getState().initialize('harbour', 1, 'advanced', {
      fuelBudget: 500,
      allowedKinds: harbourShopKinds(),
      kindCaps: { mine: 2 },
    });
    // Two buy AND land; the third is refused even though a match allows five.
    // They must be PLACED, not cancelled: cancelling sells the item back, so
    // a test that cancels is testing an empty arsenal.
    const free = freeCells(usePlacement.getState().ships);

    expect(usePlacement.getState().buyArsenal('mine').ok).toBe(true);
    expect(usePlacement.getState().placePendingArsenal(free[0]!).ok).toBe(true);
    expect(usePlacement.getState().buyArsenal('mine').ok).toBe(true);
    expect(usePlacement.getState().placePendingArsenal(free[1]!).ok).toBe(true);
    expect(usePlacement.getState().arsenal).toHaveLength(2);

    const third = usePlacement.getState().buyArsenal('mine');
    expect(third.ok).toBe(false);
    expect(third.reason).toContain('2');
    expect(usePlacement.getState().arsenal).toHaveLength(2);
  });

  it('loadLayout opens on the saved harbour and recomputes the fuel', () => {
    usePlacement.getState().initialize('harbour', 1, 'advanced', { fuelBudget: 130 });
    const ships = usePlacement.getState().ships;
    usePlacement.getState().loadLayout(ships, [item('mine', 0), item('aaGun', 3)]);

    const state = usePlacement.getState();
    expect(state.arsenal).toHaveLength(2);
    expect(state.fuelSpent).toBe(specFor('mine').cost + specFor('aaGun').cost);
    expect(state.pendingArsenalId).toBeNull();
  });
});

// ===========================================================================
// Invalid save maps to copy (§8.1)
// ===========================================================================

describe('every error reaches the player as a Captain line', () => {
  it('covers the whole API error union — no code can reach a screen', () => {
    for (const code of RAID_ERROR_CODES) {
      const line = raidErrorLine(code);
      expect(line, code).toBeTruthy();
      // The code itself must never be the copy.
      expect(line, code).not.toBe(code);
      expect(line.length, code).toBeGreaterThan(10);
    }
    expect(Object.keys(RAID_ERROR_LINES).sort()).toEqual([...RAID_ERROR_CODES].sort());
  });

  it('maps every harbour validation error to its own line', () => {
    for (const code of [
      'bad-fleet',
      'bad-placement',
      'over-fuel',
      'over-cap',
      'not-researched',
      'not-a-defence',
      'needs-admiralty',
    ]) {
      const line = harbourErrorLine(code);
      expect(line, code).toBeTruthy();
      expect(line, code).not.toBe(code);
    }
  });

  it('an unknown code still gets a sentence, never a blank', () => {
    expect(harbourErrorLine('something-new')).toContain('will not stand');
    expect(raidErrorLine('nonsense' as never)).toBeTruthy();
  });

  it('no line leaks a code, a stack or a status number', () => {
    for (const line of Object.values(RAID_ERROR_LINES)) {
      expect(line).not.toMatch(/\b[45]\d\d\b/);
      expect(line).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
      expect(line).not.toContain('Error');
      expect(line).not.toContain('undefined');
    }
  });
});

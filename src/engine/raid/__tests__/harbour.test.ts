/**
 * The harbour and the kit — part-06 §3, §4, §10.
 *
 * §10: "A defender's harbour is validated on save: legal fleet, within budget
 * and caps, items researched. An invalid harbour is refused, and the last valid
 * one keeps defending." These tests are what "refused" means.
 */
import { describe, expect, it } from 'vitest';

import { specFor } from '../../arsenal';
import { coordKey } from '../../board';
import { FLEET_SHIP_COUNT, validateFleetComposition } from '../../fleet';
import { autoPlaceFleet, validateArsenalPlacement, validateLayout } from '../../placement';
import { createRng } from '../../rng';
import { LIGHTHOUSE_SEAS, terrainForSea } from '../../terrain';
import type { ArsenalItem, Board, Coord, Ship } from '../../types';
import {
  HARBOUR_CAPS,
  HARBOUR_FUEL,
  HARBOUR_KINDS,
  RAID_FUEL,
  RAID_KIT_KINDS,
  RAID_MIN_ADMIRALTY,
  generateDefaultHarbour,
  harbourCapsFor,
  harbourFuelFor,
  raidFuelFor,
  validateHarbour,
  validateKit,
  type HarbourContext,
  type HarbourLayout,
} from '../index';

const at = (r: number, c: number): Coord => ({ r, c });

const ALL_UNLOCKS = ['sonar_net', 'decoy', 'minesweeper'];

const context = (over: Partial<HarbourContext> = {}): HarbourContext => ({
  admiraltyLevel: 6,
  coastalCommandLevel: 6,
  unlocks: ALL_UNLOCKS,
  // Part 10B — every sea unlocked, so the older harbour tests are unaffected.
  lighthouseLevel: 4,
  ...over,
});

/** A legal, sparse fleet with room for defences. */
function fleet(): Ship[] {
  const mk = (id: string, cls: Ship['class'], len: number, r: number, c: number): Ship => ({
    id,
    class: cls,
    len,
    origin: at(r, c),
    orientation: 'h',
    hits: [],
  });
  return [
    mk('battleship-1', 'battleship', 4, 0, 0),
    mk('destroyer-3', 'destroyer', 2, 0, 6),
    mk('cruiser-1', 'cruiser', 3, 2, 0),
    mk('boat-1', 'boat', 1, 2, 6),
    mk('cruiser-2', 'cruiser', 3, 4, 0),
    mk('boat-2', 'boat', 1, 4, 6),
    mk('destroyer-1', 'destroyer', 2, 6, 0),
    mk('destroyer-2', 'destroyer', 2, 8, 7),
  ];
}

const harbour = (arsenal: ArsenalItem[] = []): HarbourLayout => ({ ships: fleet(), arsenal });
const item = (kind: ArsenalItem['kind'], r: number, c: number, n = 1): ArsenalItem => ({
  id: `${kind}-${n}`,
  kind,
  at: at(r, c),
});

// ===========================================================================
// §3 — who may have a harbour at all
// ===========================================================================

describe('the Admiralty 3 gate', () => {
  it('is 3, and a perfectly legal harbour below it is still refused', () => {
    expect(RAID_MIN_ADMIRALTY).toBe(3);
    const check = validateHarbour(harbour(), context({ admiraltyLevel: 2 }));
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.error).toBe('needs-admiralty');
  });

  it('passes at exactly 3', () => {
    expect(validateHarbour(harbour(), context({ admiraltyLevel: 3 })).ok).toBe(true);
  });
});

// ===========================================================================
// §3 — the fleet and the placement
// ===========================================================================

describe('a harbour is a legal board first', () => {
  it('needs the whole fleet', () => {
    const short = { ships: fleet().slice(0, 5), arsenal: [] };
    const check = validateHarbour(short, context());
    expect(check.ok === false && check.error).toBe('bad-fleet');
    expect(validateFleetComposition(short.ships).ok).toBe(false);
  });

  it('refuses overlapping ships', () => {
    const ships = fleet();
    ships[2] = { ...ships[2]!, origin: at(0, 1) }; // on top of the battleship
    const check = validateHarbour({ ships, arsenal: [] }, context());
    expect(check.ok === false && check.error).toBe('bad-placement');
    expect(validateLayout(ships).ok).toBe(false);
  });

  it('refuses a defence on an illegal cell, and says which item', () => {
    const check = validateHarbour(harbour([item('mine', 0, 0)]), context());
    expect(check.ok === false && check.error).toBe('bad-placement');
    expect(check.ok === false && check.detail).toContain('mine-1');
  });
});

// ===========================================================================
// §3 — what may defend, and how much of it
// ===========================================================================

describe('harbour defences', () => {
  it('radar is not a harbour defence — there is nobody there to read it', () => {
    expect(HARBOUR_KINDS).not.toContain('radar');
    const check = validateHarbour(harbour([item('radar', 9, 9)]), context());
    expect(check.ok === false && check.error).toBe('not-a-defence');
  });

  it('an offensive weapon cannot sit on a harbour either', () => {
    const check = validateHarbour(harbour([item('bomber', 9, 9)]), context());
    expect(check.ok === false && check.error).toBe('not-a-defence');
  });

  it('nets and decoys need the Academy research', () => {
    const noResearch = context({ unlocks: [] });
    expect(validateHarbour(harbour([item('sonar_net', 9, 9)]), noResearch)).toMatchObject({
      ok: false,
      error: 'not-researched',
    });
    expect(validateHarbour(harbour([item('decoy', 9, 9)]), noResearch)).toMatchObject({
      ok: false,
      error: 'not-researched',
    });
    // Mines and guns never did.
    expect(validateHarbour(harbour([item('mine', 9, 9)]), noResearch).ok).toBe(true);
  });

  it('enforces the per-kind cap for the Coastal Command level', () => {
    const level = 1;
    const cap = harbourCapsFor(level).mine;
    const withinCap = harbour(
      Array.from({ length: cap }, (_, n) => item('mine', 9, n * 2, n + 1)),
    );
    expect(validateHarbour(withinCap, context({ coastalCommandLevel: level })).ok).toBe(true);

    const overCap = harbour(
      Array.from({ length: cap + 1 }, (_, n) => item('mine', 9, n * 2, n + 1)),
    );
    const check = validateHarbour(overCap, context({ coastalCommandLevel: level }));
    expect(check.ok === false && check.error).toBe('over-cap');
  });

  it('enforces the fuel budget', () => {
    // Level 1 pays 50 fuel. Three mines (5 each) plus a gun (10) is 25 — fine.
    const cheap = harbour([
      item('mine', 9, 0, 1),
      item('mine', 9, 2, 2),
      item('mine', 9, 4, 3),
      item('aaGun', 9, 6, 1),
    ]);
    expect(validateHarbour(cheap, context({ coastalCommandLevel: 1 })).ok).toBe(true);

    // Level 0 pays nothing, so even one mine is over budget.
    const check = validateHarbour(harbour([item('mine', 9, 0)]), {
      admiraltyLevel: 3,
      coastalCommandLevel: 0,
      unlocks: ALL_UNLOCKS,
      lighthouseLevel: 0,
    });
    expect(check.ok === false && check.error).toBe('over-cap'); // cap 0 is hit first
  });

  it('reports the fuel it counted, so the UI never has to re-add it', () => {
    const check = validateHarbour(harbour([item('mine', 9, 0, 1), item('aaGun', 9, 3, 1)]), context());
    expect(check.ok && check.fuelUsed).toBe(specFor('mine').cost + specFor('aaGun').cost);
  });

  it('caps and fuel both rise with the level and never fall', () => {
    for (let level = 1; level < HARBOUR_CAPS.length; level++) {
      expect(harbourFuelFor(level)).toBeGreaterThanOrEqual(harbourFuelFor(level - 1));
      for (const kind of HARBOUR_KINDS) {
        const key = kind as keyof (typeof HARBOUR_CAPS)[number];
        expect(harbourCapsFor(level)[key]).toBeGreaterThanOrEqual(harbourCapsFor(level - 1)[key]);
      }
    }
  });

  it('clamps a level past the end of the table rather than returning undefined', () => {
    expect(harbourFuelFor(99)).toBe(HARBOUR_FUEL[HARBOUR_FUEL.length - 1]);
    expect(harbourCapsFor(99)).toEqual(HARBOUR_CAPS[HARBOUR_CAPS.length - 1]);
    expect(raidFuelFor(99)).toBe(RAID_FUEL[RAID_FUEL.length - 1]);
  });
});

// ===========================================================================
// §3 — the generated default harbour
// ===========================================================================

describe('the generated default harbour', () => {
  it('is always legal, for a hundred different users', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const generated = generateDefaultHarbour(seed, context());
      const check = validateHarbour(generated, context());
      expect(check.ok, `seed ${seed}: ${check.ok === false ? check.detail : ''}`).toBe(true);
      expect(generated.ships).toHaveLength(FLEET_SHIP_COUNT);
    }
  });

  it('is never empty — nobody is raidable with a bare board', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(generateDefaultHarbour(seed, context()).arsenal.length).toBeGreaterThan(0);
    }
  });

  it('is reproducible: the same seed gives the same harbour', () => {
    const a = generateDefaultHarbour(77, context());
    const b = generateDefaultHarbour(77, context());
    expect(b).toEqual(a);
  });

  it('is different for different users', () => {
    const a = JSON.stringify(generateDefaultHarbour(1, context()));
    const b = JSON.stringify(generateDefaultHarbour(2, context()));
    expect(a).not.toBe(b);
  });

  it('places nothing on a ship or in a halo', () => {
    const generated = generateDefaultHarbour(5, context());
    const placed: ArsenalItem[] = [];
    for (const one of generated.arsenal) {
      const board: Board = { ships: generated.ships, arsenal: placed, marks: {} };
      expect(validateArsenalPlacement(board, one).ok).toBe(true);
      placed.push(one);
    }
    const cells = new Set(generated.arsenal.map((i) => coordKey(i.at!)));
    expect(cells.size).toBe(generated.arsenal.length); // no two in one cell
  });

  it('respects a low Coastal Command level', () => {
    const low = context({ coastalCommandLevel: 1 });
    const generated = generateDefaultHarbour(9, low);
    expect(validateHarbour(generated, low).ok).toBe(true);
    expect(generated.arsenal.filter((i) => i.kind === 'mine').length).toBeLessThanOrEqual(
      harbourCapsFor(1).mine,
    );
  });
});

// ===========================================================================
// §4 — the raid kit
// ===========================================================================

describe('the raid kit', () => {
  const kitContext = { armoryLevel: 5, unlocks: ALL_UNLOCKS };

  it('is exactly the seven §4 names', () => {
    expect([...RAID_KIT_KINDS].sort()).toEqual(
      ['atomicBomber', 'bomber', 'doubleTorpedoBomber', 'minesweeper', 'radar', 'submarine', 'torpedoBomber'].sort(),
    );
  });

  it('accepts an empty kit', () => {
    expect(validateKit({}, kitContext)).toEqual({ ok: true, fuelUsed: 0 });
  });

  it('refuses a defence', () => {
    for (const kind of HARBOUR_KINDS) {
      const check = validateKit({ [kind]: 1 }, kitContext);
      expect(check.ok === false && check.error, kind).toBe('not-offensive');
    }
  });

  it('uses match caps', () => {
    const max = specFor('bomber').max;
    expect(validateKit({ bomber: max }, kitContext).ok).toBe(true);
    const check = validateKit({ bomber: max + 1 }, kitContext);
    expect(check.ok === false && check.error).toBe('over-cap');
  });

  it('uses match prices, inside the Armory raid fuel', () => {
    const check = validateKit({ bomber: 1, submarine: 1 }, kitContext);
    expect(check.ok && check.fuelUsed).toBe(specFor('bomber').cost + specFor('submarine').cost);
  });

  it('refuses a kit over the raid fuel budget', () => {
    // Armory 1 pays 40. An atomic bomber alone is 60.
    const check = validateKit({ atomicBomber: 1 }, { armoryLevel: 1, unlocks: ALL_UNLOCKS });
    expect(check.ok === false && check.error).toBe('over-fuel');
    expect(raidFuelFor(1)).toBe(40);
  });

  it('needs the Academy research for the minesweeper', () => {
    const check = validateKit({ minesweeper: 1 }, { armoryLevel: 5, unlocks: [] });
    expect(check.ok === false && check.error).toBe('not-researched');
    expect(validateKit({ minesweeper: 1 }, kitContext).ok).toBe(true);
  });

  it('ignores zero and negative counts rather than charging for them', () => {
    expect(validateKit({ bomber: 0, submarine: -3 }, kitContext)).toEqual({ ok: true, fuelUsed: 0 });
  });
});

// ---------------------------------------------------------------------------
// Part 10B — the harbour's sea
// ---------------------------------------------------------------------------

describe('the harbour sea', () => {
  it('refuses a sea the Lighthouse has not unlocked, before the layout', () => {
    const locked: HarbourLayout = { ships: fleet(), arsenal: [], sea: 'strait' };
    const check = validateHarbour(locked, context({ lighthouseLevel: 0 }));
    expect(check.ok === false && check.error).toBe('sea-locked');
    expect(check.ok === false && check.detail).toContain('Lighthouse');
  });

  it('accepts each sea with a fleet generated on it, and locks it one level lower', () => {
    for (let level = 1; level <= LIGHTHOUSE_SEAS.length; level++) {
      const sea = LIGHTHOUSE_SEAS[level - 1] as 'archipelago' | 'coral' | 'fogbank' | 'strait';
      const ships = autoPlaceFleet(createRng(level * 13), terrainForSea(sea));
      const check = validateHarbour({ ships, arsenal: [], sea }, context({ lighthouseLevel: level }));
      expect(check.ok, `${sea} at Lighthouse ${level}: ${check.ok ? '' : check.detail}`).toBe(true);
      const locked = validateHarbour(
        { ships, arsenal: [], sea },
        context({ lighthouseLevel: level - 1 }),
      );
      expect(locked.ok === false && locked.error).toBe('sea-locked');
    }
  });

  it('an Open Sea harbour stays legal with no Lighthouse at all', () => {
    const check = validateHarbour({ ships: fleet(), arsenal: [], sea: 'open' }, context({ lighthouseLevel: 0 }));
    expect(check.ok).toBe(true);
  });

  it('a fleet that is illegal on the chosen sea is a bad placement', () => {
    // The fleet helper holds a cruiser on row E; Coral's reef band is rows D–F.
    const check = validateHarbour({ ships: fleet(), arsenal: [], sea: 'coral' }, context());
    expect(check.ok === false && check.error).toBe('bad-placement');
    expect(check.ok === false && check.detail).toContain('reef');
  });
});

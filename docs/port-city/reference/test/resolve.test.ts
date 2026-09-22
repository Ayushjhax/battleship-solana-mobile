import { describe, expect, it } from 'vitest';
import { resolveCell, useWeapon, rowsCrossed } from '../src/resolve.js';
import { board, cell, item, ship } from './helpers.js';

describe('a cell resolves in the documented order (§5.2)', () => {
  it('a miss marks water and ends the turn', () => {
    const b = board([ship('destroyer', 0, 0)]);
    const r = resolveCell(b, cell(5, 5));
    expect(r.outcome).toBe('miss');
    expect(b.marks[5][5]).toBe('miss');
  });

  it('a hit on a ship that survives stays a hit', () => {
    const b = board([ship('cruiser', 2, 2)]);
    expect(resolveCell(b, cell(2, 2)).outcome).toBe('hit');
    expect(b.marks[2][2]).toBe('hit');
  });

  it('the last cell sinks the ship and hatches the whole halo', () => {
    const b = board([ship('destroyer', 2, 2)]); // C3-C4
    resolveCell(b, cell(2, 2));
    const r = resolveCell(b, cell(2, 3));
    expect(r.outcome).toBe('sunk');
    // The 3x4 box around a 1x2 ship is 12 cells, 2 of which are the ship, so the
    // halo is 10. Doc §5.2 says "twelve" - it is counting the box. See CORRECTIONS.
    expect(r.revealed).toHaveLength(10);
    expect(b.marks[1][1]).toBe('revealed');
    expect(b.marks[3][4]).toBe('revealed');
    expect(b.marks[2][2]).toBe('sunk');
  });

  it('a one-cell boat sinks instantly and reveals its eight neighbours', () => {
    const b = board([ship('boat', 4, 4)]);
    const r = resolveCell(b, cell(4, 4));
    expect(r.outcome).toBe('sunk');
    expect(r.revealed).toHaveLength(8);
  });

  it('a mine is consumed and reported, and the cell can never be fired on again', () => {
    const b = board([ship('boat', 0, 0)], [item('mine', 5, 5)]);
    expect(resolveCell(b, cell(5, 5)).outcome).toBe('mine');
    expect(b.marks[5][5]).toBe('mine');
    expect(resolveCell(b, cell(5, 5)).outcome).toBe('illegal');
  });

  it('an AA gun or radar is destroyed and the attacker keeps the turn', () => {
    const b = board([ship('boat', 0, 0)], [item('aa_gun', 6, 1), item('radar', 6, 3)]);
    expect(resolveCell(b, cell(6, 1)).outcome).toBe('item_destroyed');
    expect(resolveCell(b, cell(6, 3)).outcome).toBe('item_destroyed');
    expect(b.marks[6][1]).toBe('item_wreck');
  });

  it('a used radar is just water', () => {
    const b = board([ship('boat', 0, 0)], [item('radar', 6, 3)]);
    useWeapon(b, 'radar', cell(0, 0));
    expect(resolveCell(b, cell(6, 3)).outcome).toBe('miss');
  });

  it('a mine inside a sunk ship halo is neutralised, never triggered', () => {
    const b = board([ship('boat', 4, 4)], [item('mine', 4, 5)]);
    resolveCell(b, cell(4, 4));
    expect(b.marks[4][5]).toBe('revealed');
    expect(b.layout.items[0].state).toBe('neutralised');
  });

  it('an AA gun inside a sunk ship halo keeps guarding and can no longer be shot (Appendix C)', () => {
    const b = board([ship('boat', 4, 4), ship('cruiser', 8, 0)], [item('aa_gun', 4, 5)]);
    resolveCell(b, cell(4, 4));
    expect(b.marks[4][5]).toBe('revealed');
    expect(b.layout.items[0].state).toBe('live');
    expect(useWeapon(b, 'torpedo', cell(4, 0)).intercepted).toBe('aa_gun');
  });
});

describe('torpedo bomber (§7.5)', () => {
  it('passes a cell that was already hit and strikes the next intact ship cell', () => {
    const b = board([ship('destroyer', 4, 2), ship('cruiser', 4, 5)]); // E3-E4, E6-E8
    resolveCell(b, cell(4, 2)); // E3 already hit
    const a = useWeapon(b, 'torpedo', cell(4, 0));
    expect(a.resolutions).toHaveLength(1);
    expect(a.resolutions[0].cell).toEqual({ r: 4, c: 3 });
    expect(a.keepsTurn).toBe(true);
  });

  it('runs off the far edge when the row holds nothing intact, and ends the turn', () => {
    const b = board([ship('destroyer', 9, 0)]);
    const a = useWeapon(b, 'torpedo', cell(4, 0));
    expect(a.resolutions).toHaveLength(0);
    expect(a.keepsTurn).toBe(false);
  });

  it('passes over mines and items without setting them off', () => {
    const b = board([ship('boat', 3, 8)], [item('mine', 3, 2), item('aa_gun', 9, 9)]);
    const a = useWeapon(b, 'torpedo', cell(3, 0));
    expect(a.mineTriggered).toBe(false);
    expect(b.layout.items[0].state).toBe('live');
    expect(a.resolutions[0].outcome).toBe('sunk');
  });
});

describe('double torpedo bomber (§7.6)', () => {
  it('runs the target row and the one below it', () => {
    const b = board([ship('boat', 2, 3), ship('boat', 3, 7)]);
    const a = useWeapon(b, 'double_torpedo', cell(2, 0));
    expect(a.resolutions.map((r) => r.cell)).toEqual([
      { r: 2, c: 3 },
      { r: 3, c: 7 },
    ]);
  });

  it('picking the last row pairs I and J', () => {
    expect(rowsCrossed('double_torpedo', cell(9, 0))).toEqual([8, 9]);
  });
});

describe('bomber and atomic bomber (§7.7, §7.8)', () => {
  it('the bomber drops on the target, its right and below', () => {
    const b = board([ship('boat', 2, 3)]);
    const a = useWeapon(b, 'bomber', cell(2, 3));
    expect(a.resolutions.map((r) => r.cell)).toEqual([
      { r: 2, c: 3 },
      { r: 2, c: 4 },
      { r: 3, c: 3 },
    ]);
  });

  it('a bomber aimed at the far corner drops one bomb', () => {
    const b = board([ship('boat', 0, 0)]);
    expect(useWeapon(b, 'bomber', cell(9, 9)).resolutions).toHaveLength(1);
  });

  it('the atomic bomber resolves nine cells centre first', () => {
    const b = board([ship('boat', 0, 0)]);
    const a = useWeapon(b, 'atomic', cell(4, 4));
    expect(a.resolutions).toHaveLength(9);
    expect(a.resolutions[0].cell).toEqual({ r: 4, c: 4 });
  });

  it('a mine in the blast ends the turn even though ships were hit', () => {
    const b = board([ship('destroyer', 4, 3)], [item('mine', 4, 5)]);
    const a = useWeapon(b, 'atomic', cell(4, 4));
    expect(a.hitSomething).toBe(true);
    expect(a.mineTriggered).toBe(true);
    expect(a.keepsTurn).toBe(false);
  });
});

describe('submarine (§7.9)', () => {
  it('fires up and down the column and never resolves its own cell', () => {
    const b = board([ship('boat', 2, 6), ship('cruiser', 6, 6, false)]);
    const a = useWeapon(b, 'submarine', cell(4, 6));
    expect(b.marks[4][6]).toBe('unknown');
    expect(a.resolutions.map((r) => r.cell)).toEqual([
      { r: 2, c: 6 },
      { r: 6, c: 6 },
    ]);
  });

  it('cannot be intercepted by an AA gun', () => {
    const b = board([ship('boat', 2, 6)], [item('aa_gun', 4, 0)]);
    expect(useWeapon(b, 'submarine', cell(4, 6)).intercepted).toBeUndefined();
  });
});

describe('radar (§7.10)', () => {
  it('counts ship cells in the 3x3, hit or not, and ends the turn', () => {
    const b = board([ship('cruiser', 7, 2)]); // H3-H5
    resolveCell(b, cell(7, 2));
    const a = useWeapon(b, 'radar', cell(7, 3));
    expect(a.radarCount).toBe(3);
    expect(a.keepsTurn).toBe(false);
  });

  it('ignores mines and guns', () => {
    const b = board([ship('boat', 0, 0)], [item('mine', 5, 5), item('aa_gun', 5, 6)]);
    expect(useWeapon(b, 'radar', cell(5, 5)).radarCount).toBe(0);
  });
});

describe('the aircraft rule (§8)', () => {
  it('a gun anywhere in a crossed row downs the plane before anything resolves', () => {
    const b = board([ship('destroyer', 5, 4)], [item('aa_gun', 6, 8)]);
    const a = useWeapon(b, 'bomber', cell(5, 4)); // crosses rows 5 and 6
    expect(a.intercepted).toBe('aa_gun');
    expect(a.resolutions).toHaveLength(0);
    expect(b.marks[5][4]).toBe('unknown');
    expect(a.keepsTurn).toBe(false);
  });

  it('the gun that fires is revealed to the attacker but stays live', () => {
    const gun = item('aa_gun', 6, 8);
    const b = board([ship('boat', 0, 0)], [gun]);
    useWeapon(b, 'torpedo', cell(6, 0));
    expect(b.known.has(gun.id)).toBe(true);
    expect(useWeapon(b, 'torpedo', cell(6, 0)).intercepted).toBe('aa_gun');
  });

  it('a destroyed gun stops guarding', () => {
    const b = board([ship('destroyer', 5, 4)], [item('aa_gun', 6, 8)]);
    resolveCell(b, cell(6, 8));
    expect(useWeapon(b, 'bomber', cell(5, 4)).intercepted).toBeUndefined();
  });

  it('crossed rows match the table in §8.1', () => {
    expect(rowsCrossed('torpedo', cell(3, 0))).toEqual([3]);
    expect(rowsCrossed('bomber', cell(3, 0))).toEqual([3, 4]);
    expect(rowsCrossed('atomic', cell(3, 0))).toEqual([2, 3, 4]);
    expect(rowsCrossed('atomic', cell(0, 0))).toEqual([0, 1]);
  });
});

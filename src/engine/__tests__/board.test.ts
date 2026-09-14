/**
 * P00 smoke tests: proves the engine runs under plain Node with zero React
 * Native shims. P03 replaces this file with the real suite.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { cellsOf, halo, inBounds } from '../board';
import { FLEET_CELL_COUNT, FLEET_SPEC } from '../fleet';
import { validatePlacement } from '../placement';
import { emptyBoard } from '../board';
import type { Ship } from '../types';

const ship = (over: Partial<Ship> = {}): Ship => ({
  id: 's1',
  class: 'destroyer',
  len: 2,
  origin: { r: 4, c: 4 },
  orientation: 'h',
  hits: [],
  ...over,
});

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('stays inside its range', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const n = rng.int(10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
    }
  });
});

describe('board', () => {
  it('bounds-checks the 10x10 grid', () => {
    expect(inBounds({ r: 0, c: 0 })).toBe(true);
    expect(inBounds({ r: 9, c: 9 })).toBe(true);
    expect(inBounds({ r: 10, c: 0 })).toBe(false);
    expect(inBounds({ r: -1, c: 3 })).toBe(false);
  });

  it('lays a ship out along its orientation', () => {
    expect(cellsOf(ship({ len: 3, orientation: 'v', origin: { r: 0, c: 2 } }))).toEqual([
      { r: 0, c: 2 },
      { r: 1, c: 2 },
      { r: 2, c: 2 },
    ]);
  });

  it('surrounds a mid-board ship with its halo, excluding its own cells', () => {
    // A 2-long horizontal ship has 8 surrounding cells plus 2 caps = 10.
    expect(halo(ship()).length).toBe(10);
  });
});

describe('fleet spec', () => {
  it('matches the brief: 8 ships, 18 cells', () => {
    const ships = FLEET_SPEC.reduce((n, e) => n + e.count, 0);
    const cells = FLEET_SPEC.reduce((n, e) => n + e.count * e.len, 0);
    expect(ships).toBe(8);
    expect(cells).toBe(18);
    expect(cells).toBe(FLEET_CELL_COUNT);
  });
});

describe('placement', () => {
  it('rejects a ship hanging off the grid', () => {
    const result = validatePlacement(emptyBoard(), ship({ len: 4, origin: { r: 0, c: 8 } }));
    expect(result.ok).toBe(false);
  });

  it('rejects a diagonal touch', () => {
    const board = { ...emptyBoard(), ships: [ship({ id: 'a' })] };
    // 'a' occupies (4,4)-(4,5); (3,6) touches (4,5) diagonally.
    const result = validatePlacement(board, ship({ id: 'b', len: 1, origin: { r: 3, c: 6 } }));
    expect(result).toEqual({ ok: false, reason: 'ships may not touch' });
  });

  it('accepts a ship one clear cell away', () => {
    const board = { ...emptyBoard(), ships: [ship({ id: 'a' })] };
    const result = validatePlacement(board, ship({ id: 'b', len: 1, origin: { r: 2, c: 6 } }));
    expect(result.ok).toBe(true);
  });
});

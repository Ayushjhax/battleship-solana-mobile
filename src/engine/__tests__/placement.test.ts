import { describe, expect, it } from 'vitest';
import { cellsOf, coordKey, emptyBoard, halo } from '../board';
import { FLEET_SPEC, validateFleetComposition } from '../fleet';
import {
  autoPlaceFleet,
  moveShip,
  placeShip,
  removeShip,
  rotateShip,
  validateArsenalPlacement,
  validateLayout,
  validatePlacement,
} from '../placement';
import { createRng } from '../rng';
import type { ArsenalItem, Board, Ship } from '../types';

const ship = (over: Partial<Ship> = {}): Ship => ({
  id: 's1',
  class: 'destroyer',
  len: 2,
  origin: { r: 4, c: 4 },
  orientation: 'h',
  hits: [],
  ...over,
});

const withShips = (...ships: Ship[]): Board => ({ ...emptyBoard(), ships });

describe('validatePlacement', () => {
  it('rejects ships hanging off any edge', () => {
    expect(validatePlacement(emptyBoard(), ship({ len: 4, origin: { r: 0, c: 7 } })).ok).toBe(
      false,
    );
    expect(
      validatePlacement(emptyBoard(), ship({ len: 3, origin: { r: 8, c: 0 }, orientation: 'v' }))
        .ok,
    ).toBe(false);
    expect(validatePlacement(emptyBoard(), ship({ origin: { r: -1, c: 0 } })).ok).toBe(false);
  });

  it('rejects overlap', () => {
    const board = withShips(ship({ id: 'a' }));
    expect(validatePlacement(board, ship({ id: 'b', len: 1, origin: { r: 4, c: 5 } }))).toEqual({
      ok: false,
      reason: 'overlaps another ship',
    });
  });

  it('rejects every diagonal touch — the halo rule', () => {
    // 'a' occupies (4,4)-(4,5). All four diagonal corners must be refused.
    const board = withShips(ship({ id: 'a' }));
    for (const origin of [
      { r: 3, c: 3 },
      { r: 3, c: 6 },
      { r: 5, c: 3 },
      { r: 5, c: 6 },
    ]) {
      expect(validatePlacement(board, ship({ id: 'b', len: 1, origin }))).toEqual({
        ok: false,
        reason: 'ships may not touch',
      });
    }
  });

  it('rejects orthogonal touches and accepts one clear cell of water', () => {
    const board = withShips(ship({ id: 'a' }));
    expect(validatePlacement(board, ship({ id: 'b', len: 1, origin: { r: 4, c: 6 } })).ok).toBe(
      false,
    );
    expect(validatePlacement(board, ship({ id: 'b', len: 1, origin: { r: 3, c: 4 } })).ok).toBe(
      false,
    );
    expect(validatePlacement(board, ship({ id: 'b', len: 1, origin: { r: 4, c: 7 } })).ok).toBe(
      true,
    );
    expect(validatePlacement(board, ship({ id: 'b', len: 1, origin: { r: 2, c: 4 } })).ok).toBe(
      true,
    );
  });

  it('ignores the ship being re-placed when checking against itself', () => {
    const board = withShips(ship({ id: 'a' }));
    expect(validatePlacement(board, ship({ id: 'a', origin: { r: 4, c: 5 } })).ok).toBe(true);
  });

  it('rejects moving a ship over a placed arsenal item', () => {
    const board: Board = {
      ...emptyBoard(),
      arsenal: [{ id: 'gun-1', kind: 'aaGun', at: { r: 4, c: 5 } }],
    };
    expect(validatePlacement(board, ship({ origin: { r: 4, c: 4 } }))).toEqual({
      ok: false,
      reason: 'cell is occupied by an arsenal item',
    });
  });

  it('halo is exactly the 8-neighbourhood of the footprint, clipped', () => {
    const corner = halo(ship({ len: 1, origin: { r: 0, c: 0 } }));
    expect(corner.map(coordKey).sort()).toEqual(['0,1', '1,0', '1,1']);
    const mid = halo(ship({ len: 2, origin: { r: 4, c: 4 } }));
    expect(mid).toHaveLength(10);
    expect(mid.some((c) => c.r === 4 && (c.c === 4 || c.c === 5))).toBe(false);
  });
});

describe('placeShip / removeShip / moveShip / rotateShip', () => {
  it('placeShip adds, and replaces a ship with the same id', () => {
    const first = placeShip(emptyBoard(), ship({ id: 'a' }));
    expect(first.ok).toBe(true);
    const moved = placeShip(first.board, ship({ id: 'a', origin: { r: 0, c: 0 } }));
    expect(moved.ok).toBe(true);
    expect(moved.board.ships).toHaveLength(1);
    expect(moved.board.ships[0]?.origin).toEqual({ r: 0, c: 0 });
  });

  it('placeShip fails cleanly and leaves the board untouched', () => {
    const board = withShips(ship({ id: 'a' }));
    const result = placeShip(board, ship({ id: 'b', origin: { r: 4, c: 6 } }));
    expect(result.ok).toBe(false);
    expect(result.board).toBe(board);
  });

  it('removeShip and moveShip', () => {
    const board = withShips(ship({ id: 'a' }), ship({ id: 'b', origin: { r: 8, c: 8 } }));
    expect(removeShip(board, 'a').board.ships.map((s) => s.id)).toEqual(['b']);
    expect(removeShip(board, 'zzz').ok).toBe(false);
    const moved = moveShip(board, 'b', { r: 8, c: 0 });
    expect(moved.ok).toBe(true);
    expect(moved.board.ships.find((s) => s.id === 'b')?.origin).toEqual({ r: 8, c: 0 });
    expect(moveShip(board, 'b', { r: 8, c: 9 }).ok).toBe(false); // off the edge
  });

  it('rotateShip pivots on the first cell', () => {
    const board = withShips(ship({ id: 'a', len: 3, origin: { r: 2, c: 2 } }));
    const rotated = rotateShip(board, 'a');
    expect(rotated.ok).toBe(true);
    expect(cellsOf(rotated.board.ships[0] as Ship)).toEqual([
      { r: 2, c: 2 },
      { r: 3, c: 2 },
      { r: 4, c: 2 },
    ]);
  });

  it('rotateShip fails cleanly when the rotated ship would not fit', () => {
    const board = withShips(ship({ id: 'a', len: 3, origin: { r: 8, c: 0 } }));
    const result = rotateShip(board, 'a');
    expect(result.ok).toBe(false);
    expect(result.board).toBe(board);
    expect(result.board.ships[0]?.orientation).toBe('h');
  });
});

describe('validateArsenalPlacement — one empty cell, halo rule does NOT apply', () => {
  const board = withShips(ship({ id: 'a' })); // (4,4)-(4,5)
  const item = (at: ArsenalItem['at'], id = 'm1'): ArsenalItem => ({ id, kind: 'mine', at });

  it('accepts a cell right next to a ship, even diagonally', () => {
    expect(validateArsenalPlacement(board, item({ r: 4, c: 6 })).ok).toBe(true);
    expect(validateArsenalPlacement(board, item({ r: 3, c: 3 })).ok).toBe(true);
  });

  it('rejects a ship cell, another item, and out of bounds', () => {
    expect(validateArsenalPlacement(board, item({ r: 4, c: 4 })).ok).toBe(false);
    const withItem: Board = { ...board, arsenal: [item({ r: 0, c: 0 }, 'm0')] };
    expect(validateArsenalPlacement(withItem, item({ r: 0, c: 0 })).ok).toBe(false);
    expect(validateArsenalPlacement(withItem, item({ r: 0, c: 0 }, 'm0')).ok).toBe(true); // itself
    expect(validateArsenalPlacement(board, item({ r: 10, c: 0 })).ok).toBe(false);
    expect(validateArsenalPlacement(board, item(undefined)).ok).toBe(false);
  });
});

describe('autoPlaceFleet', () => {
  it('produces a complete, valid layout for 1000 different seeds', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const ships = autoPlaceFleet(createRng(seed));
      expect(ships).toHaveLength(10);
      expect(validateFleetComposition(ships).ok).toBe(true);
      const layout = validateLayout(ships);
      if (!layout.ok) throw new Error(`seed ${seed}: ${layout.reason}`);
      // Every class present in the right numbers.
      for (const spec of FLEET_SPEC) {
        expect(ships.filter((s) => s.class === spec.class)).toHaveLength(spec.count);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    expect(autoPlaceFleet(createRng(99))).toEqual(autoPlaceFleet(createRng(99)));
    expect(autoPlaceFleet(createRng(99))).not.toEqual(autoPlaceFleet(createRng(100)));
  });
});

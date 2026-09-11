/**
 * Placement rules — docs/brief.md 3.2.
 * Axis-aligned, fully in bounds, and no touching including diagonally.
 * Arsenal items take one empty cell and are exempt from the halo rule.
 */
import { cellsOf, coordKey, halo, inBounds, sameCoord } from './board';
import { specFor } from './arsenal';
import { FLEET_SPEC, makeFleet } from './fleet';
import type { Rng } from './rng';
import {
  GRID_SIZE,
  type ArsenalItem,
  type Board,
  type Coord,
  type Orientation,
  type Ship,
} from './types';

export type PlacementResult = { ok: true } | { ok: false; reason: string };

/** Mutating helpers return the new board on success and the old one on failure. */
export type BoardResult = { ok: true; board: Board } | { ok: false; board: Board; reason: string };

export type ArsenalBoardResult =
  | { ok: true; board: Board; fuelSpent: number; item?: ArsenalItem }
  | { ok: false; board: Board; fuelSpent: number; reason: string };

/** The arsenal's price total. Keeping this in the engine prevents UI drift. */
export function arsenalFuelSpent(items: readonly ArsenalItem[]): number {
  return items.reduce((total, item) => total + specFor(item.kind).cost, 0);
}

/** Buy one inventory item while enforcing both its cap and the shared budget. */
export function purchaseArsenalItem(
  board: Board,
  kind: ArsenalItem['kind'],
  fuelBudget: number,
): ArsenalBoardResult {
  const fuelSpent = arsenalFuelSpent(board.arsenal);
  const spec = specFor(kind);
  const owned = board.arsenal.filter((item) => item.kind === kind).length;
  if (owned >= spec.max) {
    return { ok: false, board, fuelSpent, reason: `${kind} is at its cap` };
  }
  if (fuelSpent + spec.cost > fuelBudget) {
    return { ok: false, board, fuelSpent, reason: `not enough fuel for ${kind}` };
  }

  let serial = 1;
  while (board.arsenal.some((item) => item.id === `${kind}-${serial}`)) serial++;
  const item: ArsenalItem = { id: `${kind}-${serial}`, kind };
  const next = { ...board, arsenal: [...board.arsenal, item] };
  return { ok: true, board: next, fuelSpent: arsenalFuelSpent(next.arsenal), item };
}

/** Place or move a purchased defensive item. */
export function placeArsenalItem(board: Board, itemId: string, at: Coord): ArsenalBoardResult {
  const fuelSpent = arsenalFuelSpent(board.arsenal);
  const item = board.arsenal.find((candidate) => candidate.id === itemId);
  if (!item) return { ok: false, board, fuelSpent, reason: `no item ${itemId}` };
  if (specFor(item.kind).placement !== 'own board') {
    return { ok: false, board, fuelSpent, reason: `${item.kind} is not placed on your board` };
  }
  const candidate = { ...item, at };
  const check = validateArsenalPlacement(board, candidate);
  if (!check.ok) return { ok: false, board, fuelSpent, reason: check.reason };
  const next = {
    ...board,
    arsenal: board.arsenal.map((current) => (current.id === itemId ? candidate : current)),
  };
  return { ok: true, board: next, fuelSpent, item: candidate };
}

/** Sell or cancel one item at full price. */
export function sellArsenalItem(board: Board, itemId: string): ArsenalBoardResult {
  const fuelSpent = arsenalFuelSpent(board.arsenal);
  if (!board.arsenal.some((item) => item.id === itemId)) {
    return { ok: false, board, fuelSpent, reason: `no item ${itemId}` };
  }
  const next = { ...board, arsenal: board.arsenal.filter((item) => item.id !== itemId) };
  return { ok: true, board: next, fuelSpent: arsenalFuelSpent(next.arsenal) };
}

/**
 * Bounds, overlap and the halo rule, checked against every OTHER ship on the
 * board (a ship with the same id is being re-placed, so it is ignored).
 */
export function validatePlacement(board: Board, ship: Ship): PlacementResult {
  if (ship.len < 1) return { ok: false, reason: 'ship has no length' };
  const cells = cellsOf(ship);
  if (!cells.every(inBounds)) return { ok: false, reason: 'out of bounds' };

  const occupied = new Set<string>();
  const forbidden = new Set<string>();
  for (const other of board.ships) {
    if (other.id === ship.id) continue;
    for (const cell of cellsOf(other)) occupied.add(coordKey(cell));
    for (const cell of halo(other)) forbidden.add(coordKey(cell));
  }

  for (const cell of cells) {
    const key = coordKey(cell);
    if (occupied.has(key)) return { ok: false, reason: 'overlaps another ship' };
    if (forbidden.has(key)) return { ok: false, reason: 'ships may not touch' };
    if (board.arsenal.some((item) => item.at && sameCoord(item.at, cell))) {
      return { ok: false, reason: 'cell is occupied by an arsenal item' };
    }
  }
  return { ok: true };
}

/**
 * Own-board arsenal items ignore the halo rule; they only need one empty cell
 * — empty of ships and of other items.
 */
export function validateArsenalPlacement(board: Board, item: ArsenalItem): PlacementResult {
  const at = item.at;
  if (!at) return { ok: false, reason: 'no cell given' };
  if (!inBounds(at)) return { ok: false, reason: 'out of bounds' };

  for (const ship of board.ships) {
    if (cellsOf(ship).some((cell) => sameCoord(cell, at))) {
      return { ok: false, reason: 'cell is occupied by a ship' };
    }
  }
  for (const other of board.arsenal) {
    if (other.id !== item.id && other.at && sameCoord(other.at, at)) {
      return { ok: false, reason: 'cell is occupied by another item' };
    }
  }
  return { ok: true };
}

/** Adds the ship, or replaces the ship with the same id, if the placement is valid. */
export function placeShip(board: Board, ship: Ship): BoardResult {
  const check = validatePlacement(board, ship);
  if (!check.ok) return { ok: false, board, reason: check.reason };
  const clean: Ship = { ...ship, hits: [] };
  const others = board.ships.filter((s) => s.id !== ship.id);
  return { ok: true, board: { ...board, ships: [...others, clean] } };
}

export function removeShip(board: Board, shipId: string): BoardResult {
  if (!board.ships.some((s) => s.id === shipId)) {
    return { ok: false, board, reason: `no ship ${shipId} on the board` };
  }
  return { ok: true, board: { ...board, ships: board.ships.filter((s) => s.id !== shipId) } };
}

export function moveShip(board: Board, shipId: string, origin: Coord): BoardResult {
  const ship = board.ships.find((s) => s.id === shipId);
  if (!ship) return { ok: false, board, reason: `no ship ${shipId} on the board` };
  return placeShip(board, { ...ship, origin });
}

/** Rotation pivots on the ship's first cell and fails cleanly when invalid. */
export function rotateShip(board: Board, shipId: string): BoardResult {
  const ship = board.ships.find((s) => s.id === shipId);
  if (!ship) return { ok: false, board, reason: `no ship ${shipId} on the board` };
  const orientation: Orientation = ship.orientation === 'h' ? 'v' : 'h';
  return placeShip(board, { ...ship, orientation });
}

const ATTEMPTS_PER_SHIP = 200;
const FLEET_RESTARTS = 50;

/**
 * A full valid random layout. Largest ships first; 200 random tries per ship,
 * and if one cannot be placed the whole fleet restarts. It terminates: the
 * board has room for this fleet many times over, and the restart cap makes the
 * worst case finite rather than probabilistic.
 */
export function autoPlaceFleet(rng: Rng): Ship[] {
  for (let restart = 0; restart < FLEET_RESTARTS; restart++) {
    const placed = tryPlaceFleet(rng);
    if (placed) return placed;
  }
  throw new Error('autoPlaceFleet could not place the fleet');
}

function tryPlaceFleet(rng: Rng): Ship[] | null {
  let board: Board = { ships: [], arsenal: [], marks: {} };
  for (const spec of makeFleet()) {
    let done = false;
    for (let attempt = 0; attempt < ATTEMPTS_PER_SHIP && !done; attempt++) {
      const orientation: Orientation = rng.int(2) === 0 ? 'h' : 'v';
      const maxR = orientation === 'v' ? GRID_SIZE - spec.len : GRID_SIZE - 1;
      const maxC = orientation === 'h' ? GRID_SIZE - spec.len : GRID_SIZE - 1;
      const ship: Ship = {
        id: spec.id,
        class: spec.class,
        len: spec.len,
        origin: { r: rng.int(maxR + 1), c: rng.int(maxC + 1) },
        orientation,
        hits: [],
      };
      const result = placeShip(board, ship);
      if (result.ok) {
        board = result.board;
        done = true;
      }
    }
    if (!done) return null;
  }
  return [...board.ships];
}

/** Every ship valid against every other — the whole-layout check. */
export function validateLayout(ships: readonly Ship[]): PlacementResult {
  let board: Board = { ships: [], arsenal: [], marks: {} };
  for (const ship of ships) {
    const result = placeShip(board, ship);
    if (!result.ok) return { ok: false, reason: `${ship.id}: ${result.reason}` };
    board = result.board;
  }
  return { ok: true };
}

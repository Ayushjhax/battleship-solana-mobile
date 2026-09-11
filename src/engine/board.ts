/** Grid helpers. Pure — see CLAUDE.md > Engine purity. */
import { GRID_SIZE, type Board, type Coord, type Ship } from './types';

export function inBounds(coord: Coord): boolean {
  return (
    Number.isInteger(coord.r) &&
    Number.isInteger(coord.c) &&
    coord.r >= 0 &&
    coord.r < GRID_SIZE &&
    coord.c >= 0 &&
    coord.c < GRID_SIZE
  );
}

export function coordKey(coord: Coord): string {
  return `${coord.r},${coord.c}`;
}

export function parseKey(key: string): Coord {
  const [r, c] = key.split(',');
  return { r: Number(r), c: Number(c) };
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.r === b.r && a.c === b.c;
}

export function cellsOf(ship: Pick<Ship, 'len' | 'origin' | 'orientation'>): Coord[] {
  const cells: Coord[] = [];
  for (let i = 0; i < ship.len; i++) {
    cells.push(
      ship.orientation === 'h'
        ? { r: ship.origin.r, c: ship.origin.c + i }
        : { r: ship.origin.r + i, c: ship.origin.c },
    );
  }
  return cells;
}

/** The eight surrounding cells, clipped to the grid. */
export function neighbours8(coord: Coord): Coord[] {
  const out: Coord[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const next = { r: coord.r + dr, c: coord.c + dc };
      if (inBounds(next)) out.push(next);
    }
  }
  return out;
}

/** The four orthogonal neighbours, clipped to the grid. */
export function neighbours4(coord: Coord): Coord[] {
  const out: Coord[] = [];
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const next = { r: coord.r + dr, c: coord.c + dc };
    if (inBounds(next)) out.push(next);
  }
  return out;
}

/**
 * The footprint expanded one cell in all eight directions, excluding the ship's
 * own cells. docs/brief.md 3.2 — ships may not touch, including diagonally.
 */
export function halo(ship: Pick<Ship, 'len' | 'origin' | 'orientation'>): Coord[] {
  const own = new Set(cellsOf(ship).map(coordKey));
  const seen = new Set<string>();
  const out: Coord[] = [];
  for (const cell of cellsOf(ship)) {
    for (const n of neighbours8(cell)) {
      const key = coordKey(n);
      if (own.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}

/** Every cell of the grid in row-major order. */
export function allCells(): Coord[] {
  const out: Coord[] = [];
  for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) out.push({ r, c });
  return out;
}

export function emptyBoard(): Board {
  return { ships: [], arsenal: [], marks: {} };
}

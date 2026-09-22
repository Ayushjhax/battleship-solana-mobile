import { Board, ItemKind, Layout, Ship, ShipClass, makeBoard, shipCells } from '../src/grid.js';

let n = 0;
export const ship = (cls: ShipClass, r: number, c: number, horizontal = true, len?: number): Ship => {
  const length = len ?? { battleship: 4, cruiser: 3, destroyer: 2, boat: 1 }[cls];
  const cells = shipCells({ r, c }, length, horizontal);
  return { id: `${cls}-${++n}`, cls, cells, hit: cells.map(() => false) };
};

export const item = (kind: ItemKind, r: number, c: number) => ({
  id: `${kind}-${++n}`,
  kind,
  cell: { r, c },
  state: 'live' as const,
});

export const board = (ships: Ship[], items: ReturnType<typeof item>[] = []): Board =>
  makeBoard({ ships, items } as Layout);

export const marksAt = (b: Board, r: number, c: number) => b.marks[r][c];
export const cell = (r: number, c: number) => ({ r, c });

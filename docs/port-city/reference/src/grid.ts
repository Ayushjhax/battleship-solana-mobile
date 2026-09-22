// Empire of Bits - Port City reference rules.
// Grid, fleet, placement. Mirrors the shipped engine (doc §3, §4) and adds the
// Port City items (sonar net, decoy buoy). Pure, deterministic, no I/O.

export const SIZE = 10;

export type Cell = { r: number; c: number };
export const key = (c: Cell) => `${c.r},${c.c}`;
export const inGrid = (c: Cell) => c.r >= 0 && c.r < SIZE && c.c >= 0 && c.c < SIZE;

export type ShipClass = 'battleship' | 'cruiser' | 'destroyer' | 'boat';
export const FLEET_SPEC: { cls: ShipClass; len: number; count: number }[] = [
  { cls: 'battleship', len: 4, count: 1 },
  { cls: 'cruiser', len: 3, count: 2 },
  { cls: 'destroyer', len: 2, count: 3 },
  { cls: 'boat', len: 1, count: 4 },
];
export const FLEET_CELLS = 20;

export type Ship = { id: string; cls: ShipClass; cells: Cell[]; hit: boolean[] };
export const isSunk = (s: Ship) => s.hit.every(Boolean);
export const isIntactAt = (s: Ship, c: Cell) => {
  const i = s.cells.findIndex((x) => x.r === c.r && x.c === c.c);
  return i >= 0 && !s.hit[i];
};

// Own-board items. `radar` is bought on your board but fired at the enemy.
export type ItemKind = 'mine' | 'aa_gun' | 'radar' | 'sonar_net' | 'decoy';
export type ItemState = 'live' | 'spent' | 'destroyed' | 'used' | 'neutralised' | 'hit' | 'exposed';
export type OwnItem = { id: string; kind: ItemKind; cell: Cell; state: ItemState };

export type Layout = { ships: Ship[]; items: OwnItem[] };

// Attacker-visible mark on a cell (doc §5.3 + new marks).
export type Mark =
  | 'unknown'
  | 'miss'
  | 'hit'
  | 'sunk'
  | 'revealed'
  | 'mine'
  | 'mine_disarmed'
  | 'item_wreck'
  | 'decoy';

export const isMarked = (m: Mark) => m !== 'unknown';

export type Board = {
  layout: Layout;
  marks: Mark[][]; // what the attacker has proven
  known: Set<string>; // item ids the attacker has been shown (AA that downed a plane, sonar that ate a sub)
};

export const emptyMarks = (): Mark[][] =>
  Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 'unknown' as Mark));

export const makeBoard = (layout: Layout): Board => ({
  layout,
  marks: emptyMarks(),
  known: new Set<string>(),
});

export const haloOf = (cells: Cell[]): Cell[] => {
  const own = new Set(cells.map(key));
  const out = new Map<string, Cell>();
  for (const c of cells)
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const n = { r: c.r + dr, c: c.c + dc };
        if (inGrid(n) && !own.has(key(n))) out.set(key(n), n);
      }
  return [...out.values()];
};

export const shipCells = (start: Cell, len: number, horizontal: boolean): Cell[] =>
  Array.from({ length: len }, (_, i) => ({
    r: start.r + (horizontal ? 0 : i),
    c: start.c + (horizontal ? i : 0),
  }));

/** Ships never touch, not even at a corner (doc §4.1). Items are exempt. */
export function fleetIsLegal(ships: Ship[]): boolean {
  const taken = new Map<string, string>();
  for (const s of ships) {
    for (const c of s.cells) {
      if (!inGrid(c)) return false;
      if (taken.has(key(c))) return false;
      taken.set(key(c), s.id);
    }
  }
  for (const s of ships)
    for (const h of haloOf(s.cells)) {
      const owner = taken.get(key(h));
      if (owner && owner !== s.id) return false;
    }
  return true;
}

export type PlacementError =
  | 'off-grid'
  | 'ships-touch'
  | 'cell-taken'
  | 'item-on-ship'
  | 'decoy-touches-ship'
  | 'fleet-incomplete';

/**
 * Full layout validation.
 * Items take one empty cell each and are exempt from the halo rule - except the
 * Decoy Buoy, which pretends to be a ship and therefore obeys it (Part 5).
 */
export function validateLayout(layout: Layout): PlacementError | null {
  const { ships, items } = layout;
  const want = FLEET_SPEC.reduce((n, f) => n + f.count, 0);
  if (ships.length !== want) return 'fleet-incomplete';
  for (const s of ships) for (const c of s.cells) if (!inGrid(c)) return 'off-grid';
  if (!fleetIsLegal(ships)) return 'ships-touch';

  const shipCellSet = new Set(ships.flatMap((s) => s.cells.map(key)));
  const itemCells = new Set<string>();
  for (const it of items) {
    if (!inGrid(it.cell)) return 'off-grid';
    if (shipCellSet.has(key(it.cell))) return 'item-on-ship';
    if (itemCells.has(key(it.cell))) return 'cell-taken';
    itemCells.add(key(it.cell));
  }
  const decoys = items.filter((i) => i.kind === 'decoy');
  for (const d of decoys) {
    for (const h of haloOf([d.cell])) {
      if (shipCellSet.has(key(h))) return 'decoy-touches-ship';
      if (decoys.some((o) => o !== d && o.cell.r === h.r && o.cell.c === h.c))
        return 'decoy-touches-ship';
    }
  }
  return null;
}

export const liveItemAt = (b: Board, c: Cell): OwnItem | undefined =>
  b.layout.items.find((i) => i.cell.r === c.r && i.cell.c === c.c && i.state === 'live');

export const shipAt = (b: Board, c: Cell): Ship | undefined =>
  b.layout.ships.find((s) => s.cells.some((x) => x.r === c.r && x.c === c.c));

export const hitCellCount = (b: Board) =>
  b.layout.ships.reduce((n, s) => n + s.hit.filter(Boolean).length, 0);

export const sunkShips = (b: Board) => b.layout.ships.filter(isSunk);
export const fleetDestroyed = (b: Board) => b.layout.ships.every(isSunk);

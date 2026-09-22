import {
  Cell,
  FLEET_SPEC,
  ItemKind,
  Layout,
  OwnItem,
  Ship,
  SIZE,
  fleetIsLegal,
  haloOf,
  key,
  shipCells,
  validateLayout,
} from './grid.js';

/** mulberry32 - small, fast, deterministic. The server uses the match seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];

/** Mirrors Shuffle: largest ships first, 200 tries per ship, restart the fleet if stuck. */
export function randomFleet(r: () => number): Ship[] {
  for (let attempt = 0; attempt < 50; attempt++) {
    const ships: Ship[] = [];
    let ok = true;
    for (const spec of FLEET_SPEC) {
      for (let n = 1; n <= spec.count && ok; n++) {
        let placed = false;
        for (let t = 0; t < 200 && !placed; t++) {
          const horizontal = r() < 0.5;
          const start: Cell = {
            r: Math.floor(r() * (horizontal ? SIZE : SIZE - spec.len + 1)),
            c: Math.floor(r() * (horizontal ? SIZE - spec.len + 1 : SIZE)),
          };
          const cells = shipCells(start, spec.len, horizontal);
          const candidate: Ship = {
            id: `${spec.cls}-${n}`,
            cls: spec.cls,
            cells,
            hit: cells.map(() => false),
          };
          if (fleetIsLegal([...ships, candidate])) {
            ships.push(candidate);
            placed = true;
          }
        }
        if (!placed) ok = false;
      }
      if (!ok) break;
    }
    if (ok) return ships;
  }
  throw new Error('could not place fleet');
}

/** Drops items on free cells. Decoys obey the ship halo, everything else does not. */
export function randomItems(
  r: () => number,
  ships: Ship[],
  counts: Partial<Record<ItemKind, number>>,
): OwnItem[] {
  const items: OwnItem[] = [];
  const shipSet = new Set(ships.flatMap((s) => s.cells.map(key)));
  const shipHalo = new Set(ships.flatMap((s) => haloOf(s.cells).map(key)));
  let id = 0;
  for (const [kind, count] of Object.entries(counts) as [ItemKind, number][]) {
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < 400; t++) {
        const cell: Cell = { r: Math.floor(r() * SIZE), c: Math.floor(r() * SIZE) };
        if (shipSet.has(key(cell))) continue;
        if (items.some((x) => x.cell.r === cell.r && x.cell.c === cell.c)) continue;
        if (kind === 'decoy' && shipHalo.has(key(cell))) continue;
        if (
          kind === 'decoy' &&
          items.some(
            (x) =>
              x.kind === 'decoy' &&
              Math.abs(x.cell.r - cell.r) <= 1 &&
              Math.abs(x.cell.c - cell.c) <= 1,
          )
        )
          continue;
        items.push({ id: `${kind}-${++id}`, kind, cell, state: 'live' });
        break;
      }
    }
  }
  return items;
}

export function randomLayout(seed: number, counts: Partial<Record<ItemKind, number>> = {}): Layout {
  const r = rng(seed);
  const ships = randomFleet(r);
  const layout: Layout = { ships, items: randomItems(r, ships, counts) };
  const err = validateLayout(layout);
  if (err) throw new Error(`generated illegal layout: ${err}`);
  return layout;
}

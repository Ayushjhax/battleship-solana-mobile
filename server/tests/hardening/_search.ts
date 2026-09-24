/* Throwaway search for the secrecy sweep's two fleets. Deleted after use. */
import { cellsOf, halo } from '../../../src/engine/board';
import { placeShip } from '../../../src/engine/placement';
import { createRng } from '../../../src/engine/rng';
import { makeFleet } from '../../../src/engine/fleet';
import type { Board, Coord, Ship } from '../../../src/engine/types';

const key = (c: Coord) => `${c.r},${c.c}`;

/** Random fleet in rows lo..hi where every cell at `edgeRow` satisfies `edgeOk`. */
function bandFleet(seed: number, lo: number, hi: number, edgeRows: number[], edgeOk: (c: Coord) => boolean): Ship[] | null {
  const rng = createRng(seed);
  for (let restart = 0; restart < 40; restart++) {
    let board: Board = { ships: [], arsenal: [], marks: {} };
    let ok = true;
    for (const spec of makeFleet()) {
      let placed = false;
      for (let attempt = 0; attempt < 200 && !placed; attempt++) {
        const orientation = rng.int(2) === 0 ? 'h' : 'v';
        if (orientation === 'v' && hi - spec.len + 1 < lo) break;
        const origin = {
          r: lo + rng.int((orientation === 'v' ? hi - spec.len + 1 : hi) - lo + 1),
          c: rng.int(orientation === 'h' ? 11 - spec.len : 10),
        };
        const ship: Ship = { id: spec.id, class: spec.class, len: spec.len, origin, orientation, hits: [] };
        const cells = cellsOf(ship);
        if (cells.some((c) => edgeRows.includes(c.r) && !edgeOk(c))) continue;
        const res = placeShip(board, ship);
        if (res.ok) { board = res.board; placed = true; }
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return [...board.ships];
  }
  return null;
}

function crossCollisions(a: readonly Ship[], b: readonly Ship[]): number {
  const aSet = new Set(a.flatMap((s) => cellsOf(s)).map(key));
  const bSet = new Set(b.flatMap((s) => cellsOf(s)).map(key));
  let n = 0;
  for (const s of a) for (const c of halo(s)) if (bSet.has(key(c))) n++;
  for (const s of b) for (const c of halo(s)) if (aSet.has(key(c))) n++;
  return n;
}

function decoyCells(ships: readonly Ship[]): Coord[] {
  const out: Coord[] = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
    const touching = ships.some((s) => halo(s).some((h) => h.r === r && h.c === c));
    if (!touching) out.push({ r, c });
  }
  return out;
}

for (let seedA = 1; seedA < 500; seedA++) {
  const a = bandFleet(seedA, 0, 4, [4], (c) => c.c <= 3);
  if (!a) continue;
  for (let seedB = 1; seedB < 500; seedB++) {
    const b = bandFleet(seedB, 5, 9, [5], (c) => c.c >= 6);
    if (!b) continue;
    if (crossCollisions(a, b) !== 0) continue;
    const da = decoyCells(a);
    const db = decoyCells(b);
    if (!da.length || !db.length) continue;
    console.log('FOUND', { seedA, seedB });
    console.log('A', JSON.stringify(a));
    console.log('B', JSON.stringify(b));
    console.log('decoy A', JSON.stringify(da));
    console.log('decoy B', JSON.stringify(db));
    process.exit(0);
  }
}
console.log('none');

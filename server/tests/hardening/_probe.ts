/* Throwaway: pick decoy/mine cells for the match secrecy test. Deleted after use. */
import { cellsOf, halo, neighbours8 } from '../../../src/engine/board';
import { validateArsenalPlacement } from '../../../src/engine/placement';
import type { Board, Coord, Ship } from '../../../src/engine/types';

const A: Ship[] = [
  { id: 'battleship-1', class: 'battleship', len: 4, origin: { r: 0, c: 5 }, orientation: 'v', hits: [] },
  { id: 'cruiser-1', class: 'cruiser', len: 3, origin: { r: 2, c: 2 }, orientation: 'v', hits: [] },
  { id: 'cruiser-2', class: 'cruiser', len: 3, origin: { r: 0, c: 7 }, orientation: 'v', hits: [] },
  { id: 'destroyer-1', class: 'destroyer', len: 2, origin: { r: 2, c: 9 }, orientation: 'v', hits: [] },
  { id: 'destroyer-2', class: 'destroyer', len: 2, origin: { r: 2, c: 0 }, orientation: 'v', hits: [] },
  { id: 'destroyer-3', class: 'destroyer', len: 2, origin: { r: 0, c: 2 }, orientation: 'h', hits: [] },
  { id: 'boat-1', class: 'boat', len: 1, origin: { r: 0, c: 9 }, orientation: 'h', hits: [] },
  { id: 'boat-2', class: 'boat', len: 1, origin: { r: 0, c: 0 }, orientation: 'h', hits: [] },
];
const B: Ship[] = [
  { id: 'battleship-1', class: 'battleship', len: 4, origin: { r: 5, c: 7 }, orientation: 'v', hits: [] },
  { id: 'cruiser-1', class: 'cruiser', len: 3, origin: { r: 6, c: 2 }, orientation: 'v', hits: [] },
  { id: 'cruiser-2', class: 'cruiser', len: 3, origin: { r: 7, c: 9 }, orientation: 'v', hits: [] },
  { id: 'destroyer-1', class: 'destroyer', len: 2, origin: { r: 8, c: 4 }, orientation: 'h', hits: [] },
  { id: 'destroyer-2', class: 'destroyer', len: 2, origin: { r: 6, c: 0 }, orientation: 'v', hits: [] },
  { id: 'destroyer-3', class: 'destroyer', len: 2, origin: { r: 6, c: 4 }, orientation: 'h', hits: [] },
  { id: 'boat-1', class: 'boat', len: 1, origin: { r: 5, c: 9 }, orientation: 'v', hits: [] },
  { id: 'boat-2', class: 'boat', len: 1, origin: { r: 9, c: 0 }, orientation: 'h', hits: [] },
];

const key = (c: Coord) => `${c.r},${c.c}`;

function candidates(defender: Ship[], attacker: Ship[], label: string) {
  const atkShips = new Set(attacker.flatMap((s) => cellsOf(s)).map(key));
  const board: Board = { ships: defender, arsenal: [], marks: {} };
  console.log(`\n=== ${label}: defender=${label[0]} ===`);
  const all: { cell: Coord; nbrs: Coord[]; bad: number }[] = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
    const at = { r, c };
    if (atkShips.has(key(at))) continue;
    if (!validateArsenalPlacement(board, { id: 'd', kind: 'decoy', at }).ok) continue;
    const nbrs = neighbours8(at);
    const bad = nbrs.filter((n) => atkShips.has(key(n))).length;
    all.push({ cell: at, nbrs, bad });
  }
  all.sort((x, y) => x.bad - y.bad || x.nbrs.length - y.nbrs.length);
  for (const b of all.slice(0, 8)) {
    console.log(`cell ${key(b.cell)} nbrs=${b.nbrs.length} bad=${b.bad}`, b.nbrs.map(key).join(' '));
  }
}

candidates(A, B, 'A'); // defender A, attacker B
candidates(B, A, 'B'); // defender B, attacker A

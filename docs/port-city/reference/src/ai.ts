// The raider brain used for calibration. It sees only the masked view - marks
// plus items the defender has been forced to reveal - exactly like the AI in
// doc §10. Normal = parity hunt + target. Hard adds the no-touch deductions.

import { Board, Cell, ItemKind, Mark, SIZE, inGrid, isMarked } from './grid.js';
import { Weapon } from './resolve.js';

export type View = {
  marks: Mark[][];
  knownItems: { kind: ItemKind; cell: Cell }[];
};

export const maskedView = (b: Board): View => ({
  marks: b.marks.map((row) => [...row]),
  knownItems: b.layout.items
    .filter((i) => b.known.has(i.id) && i.state === 'live')
    .map((i) => ({ kind: i.kind, cell: i.cell })),
});

export type Move =
  | { type: 'shot'; cell: Cell }
  | { type: 'weapon'; weapon: Weapon; target: Cell }
  | { type: 'none' };

const neighbours4 = (c: Cell): Cell[] =>
  [
    { r: c.r - 1, c: c.c },
    { r: c.r + 1, c: c.c },
    { r: c.r, c: c.c - 1 },
    { r: c.r, c: c.c + 1 },
  ].filter(inGrid);

const diagonals = (c: Cell): Cell[] =>
  [
    { r: c.r - 1, c: c.c - 1 },
    { r: c.r - 1, c: c.c + 1 },
    { r: c.r + 1, c: c.c - 1 },
    { r: c.r + 1, c: c.c + 1 },
  ].filter(inGrid);

const openAt = (v: View, c: Cell) => inGrid(c) && !isMarked(v.marks[c.r][c.c]);

function liveHits(v: View): Cell[] {
  const out: Cell[] = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) if (v.marks[r][c] === 'hit') out.push({ r, c });
  return out;
}

function targetCandidates(v: View, hard: boolean): Cell[] {
  const hits = liveHits(v);
  if (!hits.length) return [];
  const hitSet = new Set(hits.map((h) => `${h.r},${h.c}`));
  const out: Cell[] = [];
  for (const h of hits) {
    // Two hits in a line: extend only along that line (doc §10.1).
    const horiz = hitSet.has(`${h.r},${h.c - 1}`) || hitSet.has(`${h.r},${h.c + 1}`);
    const vert = hitSet.has(`${h.r - 1},${h.c}`) || hitSet.has(`${h.r + 1},${h.c}`);
    let cands: Cell[];
    if (horiz && !vert) {
      cands = [];
      for (const dir of [-1, 1]) {
        let c = h.c + dir;
        while (inGrid({ r: h.r, c }) && v.marks[h.r][c] === 'hit') c += dir;
        if (openAt(v, { r: h.r, c })) cands.push({ r: h.r, c });
      }
    } else if (vert && !horiz) {
      cands = [];
      for (const dir of [-1, 1]) {
        let r = h.r + dir;
        while (inGrid({ r, c: h.c }) && v.marks[r][h.c] === 'hit') r += dir;
        if (openAt(v, { r, c: h.c })) cands.push({ r, c: h.c });
      }
    } else {
      cands = neighbours4(h).filter((c) => openAt(v, c));
    }
    out.push(...cands);
  }
  if (!hard) return out;
  // A ship is straight, so a cell diagonal to a hit cannot hold one.
  const banned = new Set(hits.flatMap((h) => diagonals(h).map((d) => `${d.r},${d.c}`)));
  const filtered = out.filter((c) => !banned.has(`${c.r},${c.c}`));
  return filtered.length ? filtered : out;
}

function huntCandidates(v: View, hard: boolean): Cell[] {
  const open: Cell[] = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) if (!isMarked(v.marks[r][c])) open.push({ r, c });
  if (!open.length) return [];
  const parity = open.filter((c) => (c.r + c.c) % 2 === 0);
  let pool = parity.length ? parity : open;
  if (hard) {
    const banned = new Set<string>();
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (v.marks[r][c] === 'hit')
          for (const d of diagonals({ r, c })) banned.add(`${d.r},${d.c}`);
    const kept = pool.filter((c) => !banned.has(`${c.r},${c.c}`));
    if (kept.length) pool = kept;
  }
  // Prefer cells with room around them - a ship is more likely to fit there.
  const score = (c: Cell) =>
    neighbours4(c).filter((n) => openAt(v, n)).length * 2 +
    diagonals(c).filter((n) => openAt(v, n)).length;
  const best = Math.max(...pool.map(score));
  return pool.filter((c) => score(c) === best);
}

const unknownIn = (v: View, cells: Cell[]) => cells.filter((c) => openAt(v, c)).length;

const guardedRows = (v: View) =>
  new Set(v.knownItems.filter((i) => i.kind === 'aa_gun').map((i) => i.cell.r));
const guardedCols = (v: View) =>
  new Set(v.knownItems.filter((i) => i.kind === 'sonar_net').map((i) => i.cell.c));

/** Weapon choice, only when there is no wounded ship to finish (doc §10.3). */
function weaponMove(v: View, kit: Partial<Record<Weapon, number>>, rand: () => number): Move | null {
  const rows = guardedRows(v);
  const cols = guardedCols(v);
  const has = (w: Weapon) => (kit[w] ?? 0) > 0;

  if (has('minesweeper')) {
    let best: { row: number; n: number } | null = null;
    for (let r = 0; r < SIZE - 1; r++) {
      const n =
        unknownIn(
          v,
          Array.from({ length: SIZE }, (_, c) => ({ r, c })),
        ) +
        unknownIn(
          v,
          Array.from({ length: SIZE }, (_, c) => ({ r: r + 1, c })),
        );
      if (!best || n > best.n) best = { row: r, n };
    }
    if (best && best.n >= 14) return { type: 'weapon', weapon: 'minesweeper', target: { r: best.row, c: 0 } };
  }
  if (has('atomic')) {
    let best: { cell: Cell; n: number } | null = null;
    for (let r = 1; r < SIZE - 1; r++)
      for (let c = 1; c < SIZE - 1; c++) {
        if ([r - 1, r, r + 1].some((x) => rows.has(x))) continue;
        const block: Cell[] = [];
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) block.push({ r: r + dr, c: c + dc });
        const n = unknownIn(v, block);
        if (!best || n > best.n) best = { cell: { r, c }, n };
      }
    if (best && best.n >= 8) return { type: 'weapon', weapon: 'atomic', target: best.cell };
  }
  if (has('double_torpedo')) {
    let best: { row: number; n: number } | null = null;
    for (let r = 0; r < SIZE - 1; r++) {
      if (rows.has(r) || rows.has(r + 1)) continue;
      const n =
        unknownIn(v, Array.from({ length: SIZE }, (_, c) => ({ r, c }))) +
        unknownIn(v, Array.from({ length: SIZE }, (_, c) => ({ r: r + 1, c })));
      if (!best || n > best.n) best = { row: r, n };
    }
    if (best && best.n >= 15) return { type: 'weapon', weapon: 'double_torpedo', target: { r: best.row, c: 0 } };
  }
  if (has('bomber')) {
    let best: { cell: Cell; n: number } | null = null;
    for (let r = 0; r < SIZE - 1; r++)
      for (let c = 0; c < SIZE - 1; c++) {
        if (rows.has(r) || rows.has(r + 1)) continue;
        const n = unknownIn(v, [
          { r, c },
          { r, c: c + 1 },
          { r: r + 1, c },
        ]);
        if (!best || n > best.n) best = { cell: { r, c }, n };
      }
    if (best && best.n === 3) return { type: 'weapon', weapon: 'bomber', target: best.cell };
  }
  if (has('torpedo')) {
    let best: { row: number; n: number } | null = null;
    for (let r = 0; r < SIZE; r++) {
      if (rows.has(r)) continue;
      const n = unknownIn(v, Array.from({ length: SIZE }, (_, c) => ({ r, c })));
      if (!best || n > best.n) best = { row: r, n };
    }
    if (best && best.n >= 8) return { type: 'weapon', weapon: 'torpedo', target: { r: best.row, c: 0 } };
  }
  if (has('submarine')) {
    let best: { cell: Cell; n: number } | null = null;
    for (let c = 0; c < SIZE; c++) {
      if (cols.has(c)) continue;
      const col = Array.from({ length: SIZE }, (_, r) => ({ r, c }));
      const n = unknownIn(v, col);
      const spot = col.filter((x) => openAt(v, x))[Math.floor(col.length / 2)] ?? col.find((x) => openAt(v, x));
      if (spot && (!best || n > best.n)) best = { cell: spot, n };
    }
    if (best && best.n >= 6) return { type: 'weapon', weapon: 'submarine', target: best.cell };
  }
  return null;
}

export function chooseMove(
  v: View,
  opts: {
    difficulty?: 'easy' | 'normal' | 'hard';
    kit?: Partial<Record<Weapon, number>>;
    rand?: () => number;
  } = {},
): Move {
  const difficulty = opts.difficulty ?? 'normal';
  const rand = opts.rand ?? Math.random;
  const hard = difficulty === 'hard';
  const kit = opts.kit ?? {};

  const chase = targetCandidates(v, hard);
  if (chase.length) return { type: 'shot', cell: chase[Math.floor(rand() * chase.length)] };

  const weapon = weaponMove(v, kit, rand);
  if (weapon) return weapon;

  if (difficulty === 'easy' && rand() < 0.35) {
    const open: Cell[] = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) if (!isMarked(v.marks[r][c])) open.push({ r, c });
    if (open.length) return { type: 'shot', cell: open[Math.floor(rand() * open.length)] };
  }

  const hunt = huntCandidates(v, hard);
  if (hunt.length) return { type: 'shot', cell: hunt[Math.floor(rand() * hunt.length)] };
  return { type: 'none' };
}

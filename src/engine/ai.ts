/**
 * Offline opponent — hunt / target. It consumes only a PlayerView, exactly
 * like a human player: the AI cannot see anything a player could not.
 *
 * HUNT    fire on the parity lattice ((r + c) % 2 === 0) among unknown cells,
 *         weighted by how much open space surrounds each candidate — a cell
 *         with unknown neighbours all round is likelier to hide a ship.
 * TARGET  on an unresolved hit, queue its orthogonal neighbours; once two hits
 *         are collinear, extend along that axis only.
 *
 * 'easy'  adds a 35% chance of a plain random move.
 * 'hard'  also excludes cells that the no-touching rule proves empty: the
 *         8-neighbours of sunk ships (the rules reveal those anyway) and the
 *         diagonal neighbours of any hit — a ship is straight, so whatever
 *         sits diagonally would be a second ship touching it.
 *
 * In advanced mode it spends arsenal when a good target exists: the atomic
 * bomber on the densest unknown 3x3, torpedo bombers on rows that are still
 * mostly unknown — never on a row an AA gun is known to cover.
 */
import { allCells, coordKey, neighbours4, neighbours8 } from './board';
import type { Rng } from './rng';
import { GRID_SIZE, type Coord, type MatchAction, type PlayerView } from './types';

export type Difficulty = 'easy' | 'normal' | 'hard';

const EASY_RANDOM_CHANCE = 0.35;
const ATOMIC_MIN_UNKNOWN = 8;
const TORPEDO_MIN_UNKNOWN = 8;

interface Knowledge {
  readonly unknown: (cell: Coord) => boolean;
  readonly hits: readonly Coord[];
  readonly excluded: ReadonlySet<string>;
  readonly protectedRows: ReadonlySet<number>;
}

function readView(view: PlayerView, difficulty: Difficulty): Knowledge {
  const marks = view.enemy.marks;
  const unknown = (cell: Coord): boolean => marks[coordKey(cell)] === undefined;

  const hits: Coord[] = [];
  const sunk: Coord[] = [];
  for (const cell of allCells()) {
    const mark = marks[coordKey(cell)];
    if (mark === 'hit') hits.push(cell);
    else if (mark === 'sunk') sunk.push(cell);
  }

  const excluded = new Set<string>();
  if (difficulty === 'hard') {
    for (const cell of sunk) for (const n of neighbours8(cell)) excluded.add(coordKey(n));
    for (const hit of hits) {
      for (const n of neighbours8(hit)) {
        if (n.r !== hit.r && n.c !== hit.c) excluded.add(coordKey(n));
      }
    }
  }

  const protectedRows = new Set<number>();
  for (const item of view.enemy.revealedItems) {
    if (item.kind === 'aaGun' && !item.destroyed) protectedRows.add(item.at.r);
  }

  return { unknown, hits, excluded, protectedRows };
}

function pickWeighted(rng: Rng, items: readonly { cell: Coord; weight: number }[]): Coord {
  const total = items.reduce((n, i) => n + i.weight, 0);
  let x = rng.next() * total;
  for (const item of items) {
    x -= item.weight;
    if (x < 0) return item.cell;
  }
  return (items[items.length - 1] as { cell: Coord }).cell;
}

/** Unknown cells beyond both ends of a straight run of hits through `hit`. */
function runEnds(hit: Coord, hits: readonly Coord[], axis: 'r' | 'c', k: Knowledge): Coord[] {
  const isHit = (cell: Coord) => hits.some((h) => h.r === cell.r && h.c === cell.c);
  const step = (cell: Coord, d: number): Coord =>
    axis === 'r' ? { r: cell.r, c: cell.c + d } : { r: cell.r + d, c: cell.c };

  let lo = hit;
  while (isHit(step(lo, -1))) lo = step(lo, -1);
  let hi = hit;
  while (isHit(step(hi, 1))) hi = step(hi, 1);
  if (lo.r === hi.r && lo.c === hi.c) return [];

  const ends = [step(lo, -1), step(hi, 1)];
  return ends.filter(
    (cell) =>
      cell.r >= 0 && cell.r < GRID_SIZE && cell.c >= 0 && cell.c < GRID_SIZE && k.unknown(cell),
  );
}

function targetCandidates(k: Knowledge): Coord[] {
  // Collinear hits first: extend the run along its own axis only.
  for (const hit of k.hits) {
    for (const axis of ['r', 'c'] as const) {
      const ends = runEnds(hit, k.hits, axis, k);
      if (ends.length > 0) return ends;
    }
  }
  // Otherwise every unknown orthogonal neighbour of every unresolved hit.
  const seen = new Set<string>();
  const out: Coord[] = [];
  for (const hit of k.hits) {
    for (const n of neighbours4(hit)) {
      const key = coordKey(n);
      if (!k.unknown(n) || seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}

function huntCandidates(k: Knowledge): { cell: Coord; weight: number }[] {
  const unknownCells = allCells().filter(k.unknown);
  const allowed = unknownCells.filter((cell) => !k.excluded.has(coordKey(cell)));
  const pool = allowed.length > 0 ? allowed : unknownCells;
  const lattice = pool.filter((cell) => (cell.r + cell.c) % 2 === 0);
  const chosen = lattice.length > 0 ? lattice : pool;
  return chosen.map((cell) => ({
    cell,
    weight: 1 + neighbours8(cell).filter(k.unknown).length,
  }));
}

/** An arsenal shot worth more than a cannon shot, if the AI owns one. */
function arsenalMove(view: PlayerView, k: Knowledge): MatchAction | null {
  if (view.mode !== 'advanced' || k.hits.length > 0) return null;
  const me = view.you.id;
  const spare = view.you.board.arsenal.filter((i) => !i.used && !i.destroyed);

  const atomic = spare.find((i) => i.kind === 'atomicBomber');
  if (atomic) {
    let best: { at: Coord; unknown: number } | null = null;
    for (let r = 1; r < GRID_SIZE - 1; r++) {
      if (k.protectedRows.has(r - 1) || k.protectedRows.has(r) || k.protectedRows.has(r + 1))
        continue;
      for (let c = 1; c < GRID_SIZE - 1; c++) {
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) if (k.unknown({ r: r + dr, c: c + dc })) count++;
        }
        if (!best || count > best.unknown) best = { at: { r, c }, unknown: count };
      }
    }
    if (best && best.unknown >= ATOMIC_MIN_UNKNOWN) {
      return { type: 'USE_ARSENAL', playerId: me, itemId: atomic.id, at: best.at };
    }
  }

  const torpedo = spare.find((i) => i.kind === 'torpedoBomber' || i.kind === 'doubleTorpedoBomber');
  if (torpedo) {
    let best: { row: number; unknown: number } | null = null;
    for (let r = 0; r < GRID_SIZE; r++) {
      const rows =
        torpedo.kind === 'doubleTorpedoBomber' ? [r, Math.min(r + 1, GRID_SIZE - 1)] : [r];
      if (rows.some((row) => k.protectedRows.has(row))) continue;
      let count = 0;
      for (const row of new Set(rows)) {
        for (let c = 0; c < GRID_SIZE; c++) if (k.unknown({ r: row, c })) count++;
      }
      if (!best || count > best.unknown) best = { row: r, unknown: count };
    }
    const needed =
      torpedo.kind === 'doubleTorpedoBomber' ? TORPEDO_MIN_UNKNOWN * 2 - 1 : TORPEDO_MIN_UNKNOWN;
    if (best && best.unknown >= needed) {
      return { type: 'USE_ARSENAL', playerId: me, itemId: torpedo.id, row: best.row };
    }
  }
  return null;
}

export function chooseMove(view: PlayerView, difficulty: Difficulty, rng: Rng): MatchAction {
  const me = view.you.id;
  const k = readView(view, difficulty);
  const fire = (at: Coord): MatchAction => ({ type: 'FIRE', playerId: me, at });

  const unknownCells = allCells().filter(k.unknown);
  if (unknownCells.length === 0) {
    throw new Error('chooseMove: no unknown cells left');
  }

  if (difficulty === 'easy' && rng.next() < EASY_RANDOM_CHANCE) {
    return fire(rng.pick(unknownCells));
  }

  const special = arsenalMove(view, k);
  if (special) return special;

  if (k.hits.length > 0) {
    const targets = targetCandidates(k);
    const preferred = targets.filter((cell) => !k.excluded.has(coordKey(cell)));
    const pool = preferred.length > 0 ? preferred : targets;
    if (pool.length > 0) return fire(rng.pick(pool));
  }

  return fire(pickWeighted(rng, huntCandidates(k)));
}

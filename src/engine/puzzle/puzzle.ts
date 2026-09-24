/**
 * The daily puzzle — part-09 §2.
 *
 * "One board per UTC day, identical for **every** player, seeded by the date.
 *  Standard fleet, standard rules (no-touch, auto-reveal), no turn limit and
 *  no arsenal. Goal: sink all ten ships in as few shots as possible."
 *
 * ⚠ PAR. §2 says par is 52 and cites `reference/out/puzzle.md`, whose closing
 * line is *"The fleet holds **20 cells**"* — the reference's ten-ship fleet.
 * This game has **8 ships / 18 cells**, so two of the reference's 52 were hits
 * on ships that do not exist here. Par ships as 52 because the instruction
 * says so, but it is a named constant, it is server-configurable, and
 * `scripts/puzzle-calibration.ts` measures what the quartiles actually are on
 * this fleet. See part-09-report.md §1.
 *
 * SECRECY. The layout is server-only. Nothing in this module returns it, and
 * `PuzzleView` has no field that could hold one — the same structural
 * treatment Part 6 gave `RaidView`.
 */
import { cellsOf, coordKey, inBounds } from '../board';
import { FLEET_CELL_COUNT, FLEET_SHIP_COUNT, isSunk } from '../fleet';
import { autoPlaceFleet } from '../placement';
import { createRng } from '../rng';
import { openBoard, resolveCell, sealBoard } from '../shots';
import type { Board, Coord, MatchEvent, Marks, Ship } from '../types';

// ---------------------------------------------------------------------------
// The numbers (§2)
// ---------------------------------------------------------------------------

/**
 * §2 — "**Par is 52.**"
 *
 * From `reference/out/puzzle.md`'s best-quartile column, measured on a 20-cell
 * fleet. Never inline it: if this game's fleet changes again, the constant is
 * the one place to look.
 */
export const PUZZLE_PAR = 52;

/** §2 — "Under 46 is an 'Admiral's round' (the best 10%)." */
export const ADMIRALS_ROUND = 46;

/** §2 — "completing pays 200 coins, 200 steel and 50 ink". */
export const PUZZLE_REWARD = { coins: 200, steel: 200, ink: 50 } as const;

/** §2 — "beating par adds 10 gems". */
export const PAR_GEMS = 10;

/** §2 — "streaks of 3 / 7 / 30 days pay bonuses". */
export const STREAK_BONUSES: readonly { days: number; coins: number; steel: number; gems: number }[] = [
  { days: 3, coins: 200, steel: 300, gems: 0 },
  { days: 7, coins: 600, steel: 800, gems: 5 },
  { days: 30, coins: 3_000, steel: 4_000, gems: 50 },
];

export const BOARD_CELLS = 100;

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * A stable seed for a UTC date. `YYYY-MM-DD` → a 32-bit integer.
 *
 * Deterministic and collision-resistant enough that consecutive days look
 * nothing alike — which §5.1 asserts directly rather than trusting.
 */
export function seedForDate(date: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

/** §2 — "Standard fleet, standard rules". The engine's own placer, so
 *  no-touch holds by construction. SERVER ONLY. */
export function puzzleLayout(date: string): readonly Ship[] {
  return autoPlaceFleet(createRng(seedForDate(date)));
}

/** The UTC day key, the same one the bounties and the offline cap use. */
export function puzzleDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** §2's edition number, for the share text ("puzzle #142"). */
export const EPOCH = '2026-01-01';

export function puzzleNumber(date: string): number {
  const days = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${EPOCH}T00:00:00Z`)) / 86_400_000);
  return days + 1;
}

// ---------------------------------------------------------------------------
// A run
// ---------------------------------------------------------------------------

export interface PuzzleRun {
  readonly date: string;
  /** SERVER ONLY. Never serialised — see `puzzleView`. */
  readonly ships: readonly Ship[];
  readonly marks: Marks;
  readonly shots: number;
  readonly finished: boolean;
  readonly startedAt: number;
  readonly finishedAt: number | null;
}

export function startRun(date: string, startedAt: number): PuzzleRun {
  return {
    date,
    ships: puzzleLayout(date).map((s) => ({ ...s, hits: [] })),
    marks: {},
    shots: 0,
    finished: false,
    startedAt,
    finishedAt: null,
  };
}

export type PuzzleError = 'already-finished' | 'illegal-cell';

export interface PuzzleStep {
  readonly run: PuzzleRun;
  readonly error?: PuzzleError;
  readonly events: readonly MatchEvent[];
}

const PLAYER = 'solver';

/**
 * One shot. §2 — "Each shot is an API call that returns one resolution."
 *
 * Resolution goes through the match engine's own `resolveCell`, so no-touch
 * auto-reveal behaves here exactly as it does in a match — and an auto-revealed
 * halo cell does NOT count as a shot, which is what makes a good solve
 * cheaper than a bad one.
 */
export function fire(run: PuzzleRun, at: Coord): PuzzleStep {
  if (run.finished) return { run, error: 'already-finished', events: [] };
  if (!inBounds(at)) return { run, error: 'illegal-cell', events: [] };
  if (run.marks[coordKey(at)] !== undefined) return { run, error: 'illegal-cell', events: [] };

  const board: Board = { ships: run.ships, arsenal: [], marks: run.marks };
  const wb = openBoard(board);
  const outcome = resolveCell(wb, PLAYER, at);
  const sealed = sealBoard(wb);

  const ships = sealed.ships;
  const finished = ships.length > 0 && ships.every(isSunk);

  return {
    run: {
      ...run,
      ships,
      marks: sealed.marks,
      shots: run.shots + 1,
      finished,
      finishedAt: finished ? run.finishedAt ?? null : null,
    },
    events: outcome.events,
  };
}

/**
 * Rebuilds a run from what the database stores — the marks, and nothing else.
 *
 * §2 — "one resumable attempt a day". The `puzzle_run` row deliberately holds
 * no ship state: storing it would mean the layout existed in two places, and
 * the second one always drifts. Each ship's hits are derived from the marks
 * instead, which is exact, because a cell is marked `hit` or `sunk` if and
 * only if a ship occupies it and the solver found it.
 */
export function resumeRun(
  date: string,
  marks: Marks,
  shots: number,
  startedAt: number,
  finishedAt: number | null,
): PuzzleRun {
  const ships = puzzleLayout(date).map((ship) => ({
    ...ship,
    hits: cellsOf(ship).filter((cell) => {
      const mark = marks[coordKey(cell)];
      return mark === 'hit' || mark === 'sunk';
    }),
  }));

  return {
    date,
    ships,
    marks: { ...marks },
    shots,
    finished: ships.length > 0 && ships.every(isSunk),
    startedAt,
    finishedAt,
  };
}

/** How many of the shots so far were hits — D32's signal, and nothing else. */
export function hitCount(marks: Marks): number {
  return Object.values(marks).filter((mark) => mark === 'hit' || mark === 'sunk').length;
}

/** Closes a finished run with the server's clock. */
export function finish(run: PuzzleRun, at: number): PuzzleRun {
  return run.finished && run.finishedAt === null ? { ...run, finishedAt: at } : run;
}

// ---------------------------------------------------------------------------
// The view — the ONLY thing that may leave the server
// ---------------------------------------------------------------------------

/**
 * Everything the solver may know. There is no `ships` and no `layout` here,
 * by design: a leak needs someone to add a field, and the fuzz test in
 * `tests/puzzle/` then catches it.
 */
export interface PuzzleView {
  readonly date: string;
  readonly number: number;
  readonly marks: Marks;
  readonly shots: number;
  readonly shipsRemaining: number;
  readonly finished: boolean;
  readonly par: number;
}

export function puzzleView(run: PuzzleRun, par = PUZZLE_PAR): PuzzleView {
  return {
    date: run.date,
    number: puzzleNumber(run.date),
    marks: { ...run.marks },
    shots: run.shots,
    shipsRemaining: run.ships.filter((s) => !isSunk(s)).length,
    finished: run.finished,
    par,
  };
}

// ---------------------------------------------------------------------------
// Scoring (§2, §5.3)
// ---------------------------------------------------------------------------

export type PuzzleGrade = 'admirals-round' | 'under-par' | 'par' | 'over-par';

export function grade(shots: number, par = PUZZLE_PAR, admirals = ADMIRALS_ROUND): PuzzleGrade {
  if (shots < admirals) return 'admirals-round';
  if (shots < par) return 'under-par';
  if (shots === par) return 'par';
  return 'over-par';
}

export function beatPar(shots: number, par = PUZZLE_PAR): boolean {
  return shots < par;
}

export interface PuzzleReward {
  readonly coins: number;
  readonly steel: number;
  readonly ink: number;
  readonly gems: number;
  readonly streak: number;
  /** Which streak milestone this solve hit, if any. */
  readonly milestone: number | null;
}

/**
 * §2's rewards. `streak` is the run count INCLUDING today, which the caller
 * computed from yesterday's row — the streak rule lives in `nextStreak`.
 */
export function rewardFor(shots: number, streak: number, par = PUZZLE_PAR): PuzzleReward {
  const milestone = STREAK_BONUSES.find((bonus) => bonus.days === streak) ?? null;
  return {
    coins: PUZZLE_REWARD.coins + (milestone?.coins ?? 0),
    steel: PUZZLE_REWARD.steel + (milestone?.steel ?? 0),
    ink: PUZZLE_REWARD.ink,
    gems: (beatPar(shots, par) ? PAR_GEMS : 0) + (milestone?.gems ?? 0),
    streak,
    milestone: milestone?.days ?? null,
  };
}

/**
 * §5.3 — "a missed day resetting the streak."
 *
 * A streak continues only if the last solve was YESTERDAY. A gap of two days
 * or more starts again at **1**, not 0 — today's solve counts toward the new
 * streak, which is what a player expects when they come back.
 */
export function advanceStreak(
  lastSolvedDate: string | null,
  storedStreak: number,
  today: string,
): number {
  if (!lastSolvedDate) return 1;
  const gapDays = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastSolvedDate}T00:00:00Z`)) / 86_400_000,
  );
  if (gapDays === 1) return Math.max(1, storedStreak) + 1;
  if (gapDays === 0) return Math.max(1, storedStreak); // same day: unchanged
  return 1; // a gap: start again, today counts
}

export { FLEET_CELL_COUNT, FLEET_SHIP_COUNT };

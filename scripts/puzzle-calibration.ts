/**
 * Puzzle calibration against THIS implementation — part-09 §2, plan §0.1.
 *
 * The mirror of `docs/port-city/reference/sim/`, rebuilt on
 * `src/engine/puzzle` and driven by THIS repo's AI (`src/engine/ai.ts`), so
 * the quantiles in `docs/port-city/reference/out/puzzle.md` can be compared
 * like for like.
 *
 *   npx tsx scripts/puzzle-calibration.ts        (N=2000 by default)
 *   npx tsx scripts/puzzle-calibration.ts 5000
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE DIFFERENCE THAT MATTERS, and the reason this script exists.
 *
 * `reference/out/puzzle.md` closes with: *"The fleet holds **20 cells**, so 20
 * of every solve are hits; everything above that is search."* That is the
 * reference's TEN-ship fleet. This game ships **8 ships / 18 cells**
 * (`src/engine/fleet.ts`), so the reference's 52 decomposes as 20 hits + 32
 * search, and on this fleet the hit component drops by 2 outright.
 *
 * §2 says "Par is 52", so 52 is what ships. This measures what 52 actually
 * MEANS here — best quartile, median, or something else — so the report can
 * say so plainly instead of assuming.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Nothing here is imported by the app or the server.
 */
import { chooseMove, type Difficulty } from '../src/engine/ai';
import { FLEET_CELL_COUNT, FLEET_SHIP_COUNT } from '../src/engine/fleet';
import { createMatch, projectView, reduce } from '../src/engine/match';
import { ADMIRALS_ROUND, PUZZLE_PAR, puzzleLayout } from '../src/engine/puzzle';
import { createRng } from '../src/engine/rng';
import type { MatchState } from '../src/engine/types';

const SOLVER = 'solver';
const BOARD = 'board';

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** A date string for seed `n`, so the boards are the real daily boards. */
function dateFor(n: number): string {
  const day = Date.parse('2026-01-01T00:00:00Z') + n * 86_400_000;
  return new Date(day).toISOString().slice(0, 10);
}

/**
 * Solves one board with the repo's AI and returns the shot count.
 *
 * It plays a REAL match against a board holding the puzzle's layout, so the
 * no-touch auto-reveal that makes a good solve cheap is the engine's own, not
 * a re-implementation. The opponent never fires: this is a solo solve, which
 * is exactly what the puzzle is.
 */
function solve(date: string, difficulty: Difficulty, seed: number): number | null {
  const layout = puzzleLayout(date);

  let state: MatchState = createMatch({
    id: `cal-${date}-${difficulty}`,
    mode: 'classic',
    seed,
    playerIds: [SOLVER, BOARD],
  });

  // Both sides submit; only the board's layout matters, and the solver's is
  // never shot at because the board never takes a turn.
  state = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: BOARD,
    ships: layout,
    arsenal: [],
  }).state;
  state = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: SOLVER,
    ships: puzzleLayout(dateFor(seed + 100_000)),
    arsenal: [],
  }).state;

  const rng = createRng(seed ^ 0x9e37_79b9);
  let shots = 0;

  // 100 cells is the hard ceiling; a solver that has not finished by then is
  // broken, and counting past it would hide that.
  for (let guard = 0; guard < 400 && state.phase !== 'over'; guard++) {
    if (state.turn !== SOLVER) {
      // The board does not play. Hand the turn straight back.
      state = { ...state, turn: SOLVER };
      continue;
    }

    const view = projectView(state, SOLVER);
    const action = chooseMove(view, difficulty, rng);
    if (action.type !== 'FIRE') break;

    const before = shots;
    state = reduce(state, action).state;
    shots = before + 1;
  }

  return state.phase === 'over' ? shots : null;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[index]!;
}

function main(): void {
  const n = Number(process.argv[2] ?? 2_000);

  console.log(`Puzzle calibration — ${n} boards per difficulty`);
  console.log(`This fleet: ${FLEET_SHIP_COUNT} ships / ${FLEET_CELL_COUNT} cells`);
  console.log(`Reference:  10 ships / 20 cells   (reference/out/puzzle.md)`);
  console.log(`Shipping par ${PUZZLE_PAR}, Admiral's round under ${ADMIRALS_ROUND}\n`);

  console.log('| difficulty | best 10% | best 25% | median | worst 25% | worst 10% | mean | failed |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');

  const rows: Record<string, number[]> = {};

  for (const difficulty of DIFFICULTIES) {
    const shots: number[] = [];
    let failed = 0;

    for (let i = 0; i < n; i++) {
      const result = solve(dateFor(i), difficulty, i + 1);
      if (result === null) failed++;
      else shots.push(result);
    }

    shots.sort((a, b) => a - b);
    rows[difficulty] = shots;

    const mean = shots.reduce((a, b) => a + b, 0) / Math.max(1, shots.length);
    console.log(
      `| ${difficulty} | ${quantile(shots, 0.1)} | ${quantile(shots, 0.25)} | ` +
        `${quantile(shots, 0.5)} | ${quantile(shots, 0.75)} | ${quantile(shots, 0.9)} | ` +
        `${mean.toFixed(1)} | ${failed} |`,
    );
  }

  // What par 52 actually means on this fleet, which is the whole question.
  console.log('\n| difficulty | beat par 52 | Admiral’s round (<46) |');
  console.log('| --- | --- | --- |');
  for (const difficulty of DIFFICULTIES) {
    const shots = rows[difficulty] ?? [];
    const underPar = shots.filter((s) => s < PUZZLE_PAR).length;
    const admiral = shots.filter((s) => s < ADMIRALS_ROUND).length;
    const pct = (k: number) => `${((k / Math.max(1, shots.length)) * 100).toFixed(1)}%`;
    console.log(`| ${difficulty} | ${pct(underPar)} | ${pct(admiral)} |`);
  }

  console.log(
    '\n§2 intends par to be the BEST QUARTILE (25%) and an Admiral’s round the best 10%.',
  );

  // A sanity check the reference's closing line implies: hits are fixed, so
  // everything above the fleet's cell count is search.
  const normal = rows.normal ?? [];
  if (normal.length > 0) {
    const median = quantile(normal, 0.5);
    console.log(
      `Median normal solve: ${median} shots = ${FLEET_CELL_COUNT} hits + ${median - FLEET_CELL_COUNT} search.`,
    );
  }
}

main();

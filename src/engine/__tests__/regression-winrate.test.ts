/**
 * THE REGRESSION GUARD for Part 5 — part-05 §10's "compare AI-vs-AI win rates
 * before and after: they must move by less than 2 points".
 *
 * 500 seeded Normal-vs-Normal games through the real reducer. Normal's kit is
 * fixed and never contains a sonar net, a decoy or a minesweeper, so the only
 * thing that can move this number is an EXISTING rule changing. That is
 * exactly the signal Part 5 needs, because Part 5 edits shots.ts, arsenal.ts,
 * match.ts and placement.ts — the four files the whole game stands on.
 *
 * BASELINE_* below were recorded on the tree BEFORE a single engine line was
 * touched, as the first commit of Part 5, so the baseline cannot have been
 * contaminated by the work it is guarding.
 *
 * If this fails: do not adjust the numbers. Find out which rule moved.
 */
import { describe, expect, it } from 'vitest';

import { chooseMove } from '../ai';
import { createMatch, projectView, reduce } from '../match';
import { autoPlaceFleet } from '../placement';
import { createRng } from '../rng';
import type { MatchMode } from '../types';

const GAMES = 500;
/** part-05 §10's bar, in percentage points. */
export const WIN_RATE_TOLERANCE = 2;

/**
 * Recorded on the pre-Part-5 tree. Both sides play Normal with no arsenal, so
 * seat A's edge is purely the coin flip plus first-mover advantage.
 */
const BASELINE_CLASSIC_A_WIN_PCT = 50.2;
const BASELINE_ADVANCED_A_WIN_PCT = 50.2;
/** Median moves per game — a second, finer tripwire than the win rate. */
const BASELINE_CLASSIC_MEDIAN_MOVES = 100;
const BASELINE_ADVANCED_MEDIAN_MOVES = 100;

interface Outcome {
  readonly winner: string | null;
  readonly moves: number;
  readonly rejected: number;
}

/**
 * One game, both seats on Normal, NO arsenal on either side.
 *
 * The arsenal is deliberately empty: this measures the core loop — shot
 * resolution, the halo reveal, the turn rule, the win condition — without the
 * noise of random weapon draws. A change to any of those moves this number;
 * a change confined to the new items cannot.
 */
function playGame(seed: number, mode: MatchMode): Outcome {
  const rng = createRng(seed);
  const shipsA = autoPlaceFleet(rng);
  const shipsB = autoPlaceFleet(rng);

  let state = createMatch({ id: `reg-${seed}`, mode, seed, playerIds: ['a', 'b'] });
  state = reduce(state, { type: 'SUBMIT_LAYOUT', playerId: 'a', ships: shipsA, arsenal: [] }).state;
  state = reduce(state, { type: 'SUBMIT_LAYOUT', playerId: 'b', ships: shipsB, arsenal: [] }).state;

  let rejected = 0;
  let guard = 0;
  while (state.phase !== 'over' && guard++ < 400) {
    const actor = state.turn;
    const action = chooseMove(projectView(state, actor), 'normal', rng);
    const result = reduce(state, action);
    if (result.events.some((e) => e.type === 'REJECTED')) rejected++;
    state = result.state;
  }
  return { winner: state.winner, moves: state.moves, rejected };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? 0);
}

export function measure(mode: MatchMode, games = GAMES): {
  aWinPct: number;
  medianMoves: number;
  rejected: number;
} {
  let aWins = 0;
  let rejected = 0;
  const moves: number[] = [];
  for (let seed = 1; seed <= games; seed++) {
    const game = playGame(seed * 7919, mode);
    if (game.winner === 'a') aWins++;
    rejected += game.rejected;
    moves.push(game.moves);
  }
  return {
    aWinPct: Math.round((aWins / games) * 1000) / 10,
    medianMoves: median(moves),
    rejected,
  };
}

describe('engine regression: AI vs AI win rate (part-05 §10)', () => {
  it('classic stays within 2 points of the pre-Part-5 baseline', () => {
    const { aWinPct, medianMoves, rejected } = measure('classic');
    // Printed so a failure report carries the number, not just a verdict.
    console.log(`[regression] classic  A=${aWinPct}%  median moves=${medianMoves}`);

    expect(rejected).toBe(0);
    expect(Math.abs(aWinPct - BASELINE_CLASSIC_A_WIN_PCT)).toBeLessThan(WIN_RATE_TOLERANCE);
    expect(Math.abs(medianMoves - BASELINE_CLASSIC_MEDIAN_MOVES)).toBeLessThanOrEqual(2);
  }, 120_000);

  it('advanced stays within 2 points of the pre-Part-5 baseline', () => {
    const { aWinPct, medianMoves, rejected } = measure('advanced');
    console.log(`[regression] advanced A=${aWinPct}%  median moves=${medianMoves}`);

    expect(rejected).toBe(0);
    expect(Math.abs(aWinPct - BASELINE_ADVANCED_A_WIN_PCT)).toBeLessThan(WIN_RATE_TOLERANCE);
    expect(Math.abs(medianMoves - BASELINE_ADVANCED_MEDIAN_MOVES)).toBeLessThanOrEqual(2);
  }, 120_000);

  it('is deterministic: the same seeds give the same answer twice', () => {
    expect(measure('classic', 40)).toEqual(measure('classic', 40));
  }, 120_000);
});

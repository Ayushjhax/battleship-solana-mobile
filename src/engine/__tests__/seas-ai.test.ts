/**
 * Part 10B — the AI on every sea.
 *
 * The AI consumes only a PlayerView, and terrain is on it, so the rule "never
 * fires at an island" is a property of `chooseMove`, not of the reducer. This
 * drives real games on every sea and asserts:
 *
 *   - no FIRE ever targets an island (the reducer would refuse it anyway, but
 *     a wasted shot would still be a bug in the hunt);
 *   - every game converges to a winner;
 *   - the median shots per sea, printed for the part-10 report, sit inside a
 *     sane band (a hunt that cannot converge would run past the guard).
 *
 * Classic, no arsenal, both sides Normal: the cleanest way to see what the
 * terrain alone does to the length of a game.
 */
import { describe, expect, it } from 'vitest';
import { chooseMove } from '../ai';
import { isIsland } from '../terrain';
import { createMatch, projectView, reduce } from '../match';
import { autoPlaceFleet } from '../placement';
import { createRng } from '../rng';
import { SEAS, type SeaSpec } from '../terrain';
import type { MatchState } from '../types';

const GAMES_PER_SEA = 200;

interface SeaRun {
  readonly shots: readonly number[];
  readonly islandShots: number;
  readonly unfinished: number;
  readonly rejected: number;
}

function playSea(sea: SeaSpec, games: number): SeaRun {
  const shots: number[] = [];
  let islandShots = 0;
  let unfinished = 0;
  let rejected = 0;

  for (let seed = 1; seed <= games; seed++) {
    const rng = createRng(seed * 7919);
    let state: MatchState = createMatch({
      id: `sea-${sea.id}-${seed}`,
      // Advanced with an empty arsenal: terrain is not a Classic feature, and
      // Classic deliberately ignores it (it is Open Sea only, forever).
      mode: 'advanced',
      seed,
      playerIds: ['a', 'b'],
      terrain: sea.terrain,
    });
    state = reduce(state, {
      type: 'SUBMIT_LAYOUT',
      playerId: 'a',
      ships: autoPlaceFleet(rng, sea.terrain),
      arsenal: [],
    }).state;
    state = reduce(state, {
      type: 'SUBMIT_LAYOUT',
      playerId: 'b',
      ships: autoPlaceFleet(rng, sea.terrain),
      arsenal: [],
    }).state;

    let guard = 0;
    while (state.phase !== 'over' && guard++ < 400) {
      const actor = state.turn;
      const action = chooseMove(projectView(state, actor), 'normal', rng);
      if (action.type === 'FIRE' && isIsland(sea.terrain, action.at)) islandShots++;
      const result = reduce(state, action);
      if (result.events.some((event) => event.type === 'REJECTED')) rejected++;
      state = result.state;
    }
    if (state.phase !== 'over') unfinished++;
    shots.push(state.moves);
  }

  return { shots, islandShots, unfinished, rejected };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

describe('the AI on every sea', () => {
  it(`${GAMES_PER_SEA} games per sea: no island shots, every game converges, medians recorded`, {
    timeout: 300_000,
  }, () => {
    const medians: Record<string, number> = {};
    for (const sea of SEAS) {
      const run = playSea(sea, GAMES_PER_SEA);
      const medianShots = median(run.shots);
      medians[sea.id] = medianShots;
      // The report reads these lines.
      console.log(
        `[seas] ${sea.id.padEnd(11)} median=${medianShots} ` +
          `best=${Math.min(...run.shots)} worst=${Math.max(...run.shots)}`,
      );
      expect(run.islandShots, `${sea.id}: fired at an island`).toBe(0);
      expect(run.unfinished, `${sea.id}: a game did not finish`).toBe(0);
      expect(run.rejected, `${sea.id}: a move was rejected`).toBe(0);
      // A hunt that could not converge would run into the guard above; this
      // band catches a pathological-but-terminating one.
      expect(medianShots, `${sea.id} median`).toBeGreaterThan(30);
      expect(medianShots, `${sea.id} median`).toBeLessThan(150);
    }
    expect(Object.keys(medians)).toEqual(SEAS.map((sea) => sea.id));
  });
});

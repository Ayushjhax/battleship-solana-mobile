/**
 * Whole games through the real reducer with both sides played by the AI —
 * turn alternation, timeouts never needed, arsenal in advanced mode. If any
 * action the AI chooses is rejected, something between ai.ts and match.ts
 * disagrees about the rules.
 */
import { describe, expect, it } from 'vitest';
import { chooseMove } from '../ai';
import { ARSENAL_SPEC } from '../arsenal';
import { validateArsenalPlacement } from '../placement';
import { autoPlaceFleet } from '../placement';
import { createMatch, projectView, reduce } from '../match';
import { createRng, type Rng } from '../rng';
import type { ArsenalItem, Board, MatchMode, Ship } from '../types';
import { FUEL_BUDGET } from '../types';

/** A random shopping list within budget, with own-board items on free cells. */
function randomArsenal(rng: Rng, ships: Ship[]): ArsenalItem[] {
  const items: ArsenalItem[] = [];
  let fuel = 0;
  const board: Board = { ships, arsenal: [], marks: {} };
  for (const spec of rng.shuffle(ARSENAL_SPEC)) {
    const want = rng.int(spec.max + 1);
    for (let n = 0; n < want; n++) {
      if (fuel + spec.cost > FUEL_BUDGET) break;
      const id = `${spec.kind}-${n + 1}`;
      if (spec.placement === 'own board') {
        let placed = false;
        for (let attempt = 0; attempt < 50 && !placed; attempt++) {
          const item: ArsenalItem = { id, kind: spec.kind, at: { r: rng.int(10), c: rng.int(10) } };
          if (validateArsenalPlacement({ ...board, arsenal: items }, item).ok) {
            items.push(item);
            placed = true;
          }
        }
        if (!placed) continue;
      } else {
        items.push({ id, kind: spec.kind });
      }
      fuel += spec.cost;
    }
  }
  return items;
}

function playGame(
  seed: number,
  mode: MatchMode,
): { moves: number; winner: string | null; rejected: number } {
  const rng = createRng(seed);
  const shipsA = autoPlaceFleet(rng);
  const shipsB = autoPlaceFleet(rng);
  let state = createMatch({ id: `sim-${seed}`, mode, seed, playerIds: ['a', 'b'] });
  state = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: 'a',
    ships: shipsA,
    arsenal: mode === 'advanced' ? randomArsenal(rng, shipsA) : [],
  }).state;
  const started = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: 'b',
    ships: shipsB,
    arsenal: mode === 'advanced' ? randomArsenal(rng, shipsB) : [],
  });
  state = started.state;
  expect(state.phase).toBe('playing');

  let rejected = 0;
  let guard = 0;
  while (state.phase !== 'over' && guard++ < 400) {
    const actor = state.turn;
    const difficulty = actor === 'a' ? 'hard' : 'normal';
    const action = chooseMove(projectView(state, actor), difficulty, rng);
    const r = reduce(state, action);
    if (r.events.some((e) => e.type === 'REJECTED')) rejected++;
    state = r.state;
  }
  return { moves: state.moves, winner: state.winner, rejected };
}

describe('AI vs AI through the reducer', () => {
  it('classic: 40 seeds finish cleanly with no rejected actions', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const game = playGame(seed, 'classic');
      expect(game.rejected).toBe(0);
      expect(['a', 'b']).toContain(game.winner);
      expect(game.moves).toBeLessThan(200);
    }
  });

  it('advanced: 40 seeds with random arsenal finish cleanly with no rejected actions', () => {
    for (let seed = 101; seed <= 140; seed++) {
      const game = playGame(seed, 'advanced');
      expect(game.rejected).toBe(0);
      expect(['a', 'b']).toContain(game.winner);
      expect(game.moves).toBeLessThan(200);
    }
  });
});

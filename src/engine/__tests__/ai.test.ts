import { describe, expect, it } from 'vitest';
import { chooseMove, type Difficulty } from '../ai';
import { coordKey } from '../board';
import { createMatch, projectView, reduce } from '../match';
import { autoPlaceFleet } from '../placement';
import { createRng } from '../rng';
import type { ArsenalItem, MatchState } from '../types';
import { LAYOUT_A, LAYOUT_B, P0, P1 } from './fixtures';

const AI = P1;
const TARGET = P0;

/** A match where the AI (bob) attacks a fixed layout; the defender never fires back. */
function arena(
  defenderShips = LAYOUT_A,
  mode: 'classic' | 'advanced' = 'classic',
  aiArsenal: ArsenalItem[] = [],
): MatchState {
  let state = createMatch({ id: 'arena', mode, seed: 1, playerIds: [TARGET, AI] });
  state = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: TARGET,
    ships: defenderShips,
    arsenal: [],
  }).state;
  state = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: AI,
    ships: LAYOUT_B,
    arsenal: aiArsenal,
  }).state;
  return { ...state, turn: AI };
}

/** Plays the AI to the end, handing the turn straight back after every miss. */
function playOut(
  state: MatchState,
  difficulty: Difficulty,
  seed: number,
): { moves: number; state: MatchState } {
  const rng = createRng(seed);
  let moves = 0;
  while (state.phase !== 'over') {
    const action = chooseMove(projectView(state, AI), difficulty, rng);
    const r = reduce(state, action);
    if (r.events.some((e) => e.type === 'REJECTED')) {
      throw new Error(
        `AI made an illegal move: ${JSON.stringify(action)} -> ${JSON.stringify(r.events)}`,
      );
    }
    state = r.state.turn === AI ? r.state : { ...r.state, turn: AI };
    moves++;
    if (moves > 200) throw new Error('runaway game');
  }
  return { moves, state };
}

describe('chooseMove', () => {
  it('finishes a fixed layout in under 100 moves for 200 seeds, never firing at a known cell', () => {
    const fixed = autoPlaceFleet(createRng(42));
    let total = 0;
    let worst = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { moves, state } = playOut(arena(fixed), 'normal', seed);
      expect(moves).toBeLessThan(100);
      expect(state.winner).toBe(AI);
      total += moves;
      worst = Math.max(worst, moves);
    }
    const average = total / 200;
    // Random play needs ~95 shots here; hunt/target with auto-reveal should be far below.
    expect(average).toBeLessThan(75);
    expect(worst).toBeLessThan(100);
  });

  it('every difficulty finishes, and hard is no worse than normal', () => {
    const fixed = autoPlaceFleet(createRng(7));
    const avg = (difficulty: Difficulty) => {
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const { moves } = playOut(arena(fixed), difficulty, seed);
        expect(moves).toBeLessThan(100);
        total += moves;
      }
      return total / 60;
    };
    const normal = avg('normal');
    expect(avg('hard')).toBeLessThanOrEqual(normal + 2);
    expect(avg('easy')).toBeLessThan(100);
  });

  it("easy's 35% random move fires off the parity lattice; normal never does", () => {
    const view = projectView(arena(), AI);
    const offLattice = (difficulty: Difficulty) => {
      let n = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const move = chooseMove(view, difficulty, createRng(seed));
        if (move.type === 'FIRE' && (move.at.r + move.at.c) % 2 === 1) n++;
      }
      return n;
    };
    expect(offLattice('normal')).toBe(0);
    const easy = offLattice('easy');
    // 35% random, and half of random cells are off-lattice: expect ~35 of 200.
    expect(easy).toBeGreaterThan(15);
    expect(easy).toBeLessThan(60);
  });

  it('hunts on the parity lattice', () => {
    const rng = createRng(3);
    const view = projectView(arena(), AI);
    for (let i = 0; i < 30; i++) {
      const move = chooseMove(view, 'normal', rng);
      if (move.type !== 'FIRE') throw new Error('expected FIRE');
      expect((move.at.r + move.at.c) % 2).toBe(0);
    }
  });

  it('targets the orthogonal neighbours of a lone hit, then extends along the line', () => {
    let state = arena();
    state = reduce(state, { type: 'FIRE', playerId: AI, at: { r: 0, c: 1 } }).state; // battleship, mid-ship
    const rng = createRng(11);
    const first = chooseMove(projectView(state, AI), 'normal', rng);
    if (first.type !== 'FIRE') throw new Error('expected FIRE');
    expect(['0,0', '0,2', '1,1']).toContain(coordKey(first.at));

    state = reduce(state, { type: 'FIRE', playerId: AI, at: { r: 0, c: 2 } }).state; // second hit, collinear
    for (let i = 0; i < 20; i++) {
      const move = chooseMove(projectView(state, AI), 'normal', createRng(i));
      if (move.type !== 'FIRE') throw new Error('expected FIRE');
      expect(['0,0', '0,3']).toContain(coordKey(move.at)); // only the ends of the run
    }
  });

  it('hard never fires diagonally next to a hit', () => {
    let state = arena();
    state = reduce(state, { type: 'FIRE', playerId: AI, at: { r: 2, c: 5 } }).state; // cruiser-2 middle
    for (let i = 0; i < 50; i++) {
      const move = chooseMove(projectView(state, AI), 'hard', createRng(i));
      if (move.type !== 'FIRE') throw new Error('expected FIRE');
      const diagonal = Math.abs(move.at.r - 2) === 1 && Math.abs(move.at.c - 5) === 1;
      expect(diagonal).toBe(false);
    }
  });

  it('in advanced mode drops the atomic bomber on the densest unknown 3x3 first', () => {
    const state = arena(LAYOUT_A, 'advanced', [{ id: 'nuke', kind: 'atomicBomber' }]);
    const move = chooseMove(projectView(state, AI), 'normal', createRng(1));
    expect(move).toMatchObject({ type: 'USE_ARSENAL', itemId: 'nuke' });
    if (move.type !== 'USE_ARSENAL' || !move.at) throw new Error('expected a cell target');
    expect(move.at.r).toBeGreaterThanOrEqual(1);
    expect(move.at.r).toBeLessThanOrEqual(8);
  });

  it('will not fly an aircraft over a row an AA gun is known to cover', () => {
    let state = createMatch({ id: 'aa', mode: 'advanced', seed: 1, playerIds: [TARGET, AI] });
    state = reduce(state, {
      type: 'SUBMIT_LAYOUT',
      playerId: TARGET,
      ships: LAYOUT_A,
      arsenal: [{ id: 'g', kind: 'aaGun', at: { r: 5, c: 9 } }],
    }).state;
    state = reduce(state, {
      type: 'SUBMIT_LAYOUT',
      playerId: AI,
      ships: LAYOUT_B,
      arsenal: [
        { id: 't1', kind: 'torpedoBomber' },
        { id: 't2', kind: 'torpedoBomber' },
      ],
    }).state;
    state = { ...state, turn: AI };
    // Learn about the gun the hard way.
    state = reduce(state, { type: 'USE_ARSENAL', playerId: AI, itemId: 't1', row: 5 }).state;
    state = { ...state, turn: AI };
    expect(projectView(state, AI).enemy.revealedItems).toHaveLength(1);
    for (let i = 0; i < 20; i++) {
      const move = chooseMove(projectView(state, AI), 'normal', createRng(i));
      if (move.type === 'USE_ARSENAL') expect(move.row).not.toBe(5);
    }
  });
});

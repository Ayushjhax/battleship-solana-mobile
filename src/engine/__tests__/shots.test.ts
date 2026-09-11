import { describe, expect, it } from 'vitest';
import { coordKey, halo } from '../board';
import { reduce } from '../match';
import { resolveShot } from '../shots';
import type { ArsenalItem, MatchEvent, MatchState } from '../types';
import { LAYOUT_A, P0, P1, startMatch, types } from './fixtures';

// P1 (bob) attacks P0 (alice) on layout A.
const setup = (arsenalA: ArsenalItem[] = []): MatchState =>
  startMatch({ mode: arsenalA.length ? 'advanced' : 'classic', arsenalA, first: P1 });

const fire = (state: MatchState, r: number, c: number) =>
  reduce(state, { type: 'FIRE', playerId: P1, at: { r, c } });

const marksOf = (state: MatchState) => state.players[0].board.marks;

describe('resolveShot — docs/brief.md 3.3, in order', () => {
  it('a hit keeps the turn', () => {
    const state = setup();
    const { state: next, events } = fire(state, 0, 0); // battleship
    expect(types(events)).toEqual(['HIT']);
    expect(next.turn).toBe(P1);
    expect(marksOf(next)[coordKey({ r: 0, c: 0 })]).toBe('hit');
    expect(next.players[0].board.ships.find((s) => s.id === 'battleship-1')?.hits).toEqual([
      { r: 0, c: 0 },
    ]);
  });

  it('a miss ends the turn', () => {
    const state = setup();
    const { state: next, events } = fire(state, 9, 9);
    expect(types(events)).toEqual(['MISS', 'TURN_CHANGED']);
    expect(next.turn).toBe(P0);
    expect(marksOf(next)[coordKey({ r: 9, c: 9 })]).toBe('miss');
  });

  it('sinking auto-reveals exactly the 8-halo of the whole ship', () => {
    let state = setup();
    state = fire(state, 4, 3).state; // destroyer-2 (4,3)-(4,4)
    const { state: next, events } = fire(state, 4, 4);
    expect(types(events)).toEqual(['HIT', 'SUNK', 'AUTO_REVEAL']);

    const sunk = events[1] as Extract<MatchEvent, { type: 'SUNK' }>;
    expect(sunk.shipId).toBe('destroyer-2');
    expect(sunk.cells).toEqual([
      { r: 4, c: 3 },
      { r: 4, c: 4 },
    ]);

    const reveal = events[2] as Extract<MatchEvent, { type: 'AUTO_REVEAL' }>;
    const expected = halo(LAYOUT_A.find((s) => s.id === 'destroyer-2')!)
      .map(coordKey)
      .sort();
    expect(reveal.cells.map(coordKey).sort()).toEqual(expected);
    expect(reveal.cells).toHaveLength(10);

    for (const cell of reveal.cells) expect(marksOf(next)[coordKey(cell)]).toBe('revealed');
    for (const cell of sunk.cells) expect(marksOf(next)[coordKey(cell)]).toBe('sunk');
    expect(next.turn).toBe(P1); // still their turn
  });

  it('a halo cell that was already a miss keeps its mark and is not re-revealed', () => {
    let state = setup();
    state = fire(state, 3, 2).state; // miss inside destroyer-2's halo; turn passes
    state = { ...state, turn: P1 };
    state = fire(state, 4, 3).state;
    const { state: next, events } = fire(state, 4, 4);
    const reveal = events[2] as Extract<MatchEvent, { type: 'AUTO_REVEAL' }>;
    expect(reveal.cells).toHaveLength(9);
    expect(reveal.cells.some((c) => c.r === 3 && c.c === 2)).toBe(false);
    expect(marksOf(next)[coordKey({ r: 3, c: 2 })]).toBe('miss');
  });

  it('a boat at the edge reveals its clipped halo', () => {
    const state = setup();
    const { events } = fire(state, 6, 0); // boat-1 at (6,0)
    expect(types(events)).toEqual(['HIT', 'SUNK', 'AUTO_REVEAL']);
    const reveal = events[2] as Extract<MatchEvent, { type: 'AUTO_REVEAL' }>;
    expect(reveal.cells.map(coordKey).sort()).toEqual(['5,0', '5,1', '6,1', '7,0', '7,1']);
  });

  it('an already-shot cell is rejected without consuming the turn or changing state', () => {
    let state = setup();
    state = fire(state, 0, 0).state; // hit, turn kept
    const { state: next, events } = fire(state, 0, 0);
    expect(types(events)).toEqual(['REJECTED']);
    expect(next).toBe(state);
    expect(next.turn).toBe(P1);
    expect(next.moves).toBe(state.moves);

    // Revealed cells count as shot too.
    let s2 = fire(state, 6, 0).state; // sinks boat-1, reveals (5,0) etc.
    const again = fire(s2, 5, 0);
    expect(types(again.events)).toEqual(['REJECTED']);
    expect(again.state).toBe(s2);
    s2 = again.state;
  });

  it('a mine ends the turn immediately and is consumed', () => {
    const mine: ArsenalItem = { id: 'mine-1', kind: 'mine', at: { r: 9, c: 9 } };
    const state = setup([mine]);
    const { state: next, events } = fire(state, 9, 9);
    expect(types(events)).toEqual(['MINE_TRIGGERED', 'TURN_CHANGED']);
    expect(next.turn).toBe(P0);
    expect(marksOf(next)[coordKey({ r: 9, c: 9 })]).toBe('mine');
    expect(next.players[0].board.arsenal[0]?.used).toBe(true);
    // Firing there again is "already shot".
    expect(types(fire({ ...next, turn: P1 }, 9, 9).events)).toEqual(['REJECTED']);
  });

  it('an AA gun under fire is destroyed and counts as hitting something', () => {
    const gun: ArsenalItem = { id: 'gun-1', kind: 'aaGun', at: { r: 8, c: 8 } };
    const state = setup([gun]);
    const { state: next, events } = fire(state, 8, 8);
    expect(types(events)).toEqual(['ITEM_HIT']);
    expect(next.turn).toBe(P1);
    expect(next.players[0].board.arsenal[0]).toMatchObject({ destroyed: true, revealed: true });
    expect(marksOf(next)[coordKey({ r: 8, c: 8 })]).toBe('revealed');
  });

  it('resolveShot is pure: the input state is untouched', () => {
    const state = setup();
    const snapshot = JSON.stringify(state);
    resolveShot(state, P1, { r: 0, c: 0 });
    resolveShot(state, P1, { r: 9, c: 9 });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('out-of-bounds shots are rejected', () => {
    const state = setup();
    expect(resolveShot(state, P1, { r: 10, c: 0 }).rejected).toBe('out of bounds');
    expect(resolveShot(state, P1, { r: 0, c: -1 }).rejected).toBe('out of bounds');
  });
});

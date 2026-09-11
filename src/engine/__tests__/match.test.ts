import { describe, expect, it } from 'vitest';
import { createMatch, firstTurn, reduce, validateSubmission } from '../match';
import type { ArsenalItem, MatchState, Ship } from '../types';
import { LAYOUT_A, LAYOUT_B, P0, P1, cellsOfLayout, startMatch, types } from './fixtures';

describe('lifecycle', () => {
  it('starts in placing, accepts both layouts, then flips a coin from the seed', () => {
    let state = createMatch({ id: 'm', mode: 'classic', seed: 123, playerIds: [P0, P1] });
    expect(state.phase).toBe('placing');

    const a = reduce(state, { type: 'SUBMIT_LAYOUT', playerId: P0, ships: LAYOUT_A, arsenal: [] });
    expect(types(a.events)).toEqual(['LAYOUT_ACCEPTED']);
    expect(a.state.players[0].ready).toBe(true);
    expect(a.state.phase).toBe('placing');
    state = a.state;

    const b = reduce(state, { type: 'SUBMIT_LAYOUT', playerId: P1, ships: LAYOUT_B, arsenal: [] });
    expect(types(b.events)).toEqual(['LAYOUT_ACCEPTED', 'MATCH_STARTED']);
    expect(b.state.phase).toBe('playing');
    expect(b.state.turn).toBe(firstTurn(b.state));
    expect([P0, P1]).toContain(b.state.turn);

    // Same seed, same coin.
    const again = createMatch({ id: 'm', mode: 'classic', seed: 123, playerIds: [P0, P1] });
    expect(firstTurn(again)).toBe(b.state.turn);
    // Different seeds can flip the other way.
    const flips = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => firstTurn({ ...again, seed })));
    expect(flips.size).toBe(2);
  });

  it('a full scripted game: alice sinks the whole fleet in one turn and wins', () => {
    let state = startMatch({ first: P0 });
    const cells = cellsOfLayout(LAYOUT_B);
    const seen: string[] = [];
    for (const at of cells) {
      const r = reduce(state, { type: 'FIRE', playerId: P0, at });
      seen.push(...types(r.events));
      state = r.state;
      if (state.phase === 'over') break;
    }
    expect(state.phase).toBe('over');
    expect(state.winner).toBe(P0);
    expect(state.moves).toBe(20);
    expect(seen.filter((t) => t === 'SUNK')).toHaveLength(10);
    expect(seen.filter((t) => t === 'TURN_CHANGED')).toHaveLength(0);
    expect(seen[seen.length - 1]).toBe('GAME_OVER');
    expect(state.players[1].board.ships.every((s) => s.hits.length === s.len)).toBe(true);
  });

  it('turns alternate on misses and the game runs to a finish', () => {
    let state = startMatch({ first: P0 });
    // alice misses, bob misses, alice hits (keeps), alice misses.
    let r = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 9, c: 0 } });
    expect(r.state.turn).toBe(P1);
    r = reduce(r.state, { type: 'FIRE', playerId: P1, at: { r: 9, c: 9 } });
    expect(r.state.turn).toBe(P0);
    r = reduce(r.state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 9 } });
    expect(r.state.turn).toBe(P0);
    r = reduce(r.state, { type: 'FIRE', playerId: P0, at: { r: 9, c: 1 } });
    expect(r.state.turn).toBe(P1);
    state = r.state;
    expect(state.moves).toBe(4);
  });
});

describe('validation', () => {
  it('rejects an out-of-turn action and leaves the state untouched', () => {
    const state = startMatch({ first: P0 });
    const r = reduce(state, { type: 'FIRE', playerId: P1, at: { r: 0, c: 0 } });
    expect(r.events).toEqual([{ type: 'REJECTED', playerId: P1, reason: 'not your turn' }]);
    expect(r.state).toBe(state);
  });

  it('rejects actions from strangers and actions after the match is over', () => {
    const state = startMatch({ first: P0 });
    expect(
      types(reduce(state, { type: 'FIRE', playerId: 'mallory', at: { r: 0, c: 0 } }).events),
    ).toEqual(['REJECTED']);
    const over = reduce(state, { type: 'RESIGN', playerId: P0 }).state;
    expect(over.phase).toBe('over');
    expect(types(reduce(over, { type: 'FIRE', playerId: P1, at: { r: 0, c: 0 } }).events)).toEqual([
      'REJECTED',
    ]);
    expect(types(reduce(over, { type: 'RESIGN', playerId: P1 }).events)).toEqual(['REJECTED']);
  });

  it('rejects firing before both layouts are in', () => {
    let state = createMatch({ id: 'm', mode: 'classic', seed: 1, playerIds: [P0, P1] });
    state = reduce(state, {
      type: 'SUBMIT_LAYOUT',
      playerId: P0,
      ships: LAYOUT_A,
      arsenal: [],
    }).state;
    expect(types(reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } }).events)).toEqual(
      ['REJECTED'],
    );
  });

  it('rejects bad layouts: touching ships, wrong fleet, arsenal in classic, over budget', () => {
    const touching: Ship[] = LAYOUT_A.map((s) =>
      s.id === 'boat-1' ? { ...s, origin: { r: 5, c: 2 } } : s,
    ); // diagonal to (4,1)/(4,3)
    expect(validateSubmission('classic', touching, []).ok).toBe(false);
    expect(validateSubmission('classic', LAYOUT_A.slice(1), []).ok).toBe(false);
    expect(
      validateSubmission('classic', LAYOUT_A, [{ id: 'm', kind: 'mine', at: { r: 9, c: 9 } }]).ok,
    ).toBe(false);

    const expensive: ArsenalItem[] = [
      { id: 'a', kind: 'atomicBomber' },
      { id: 'b1', kind: 'bomber' },
      { id: 'b2', kind: 'bomber' },
      { id: 'd1', kind: 'doubleTorpedoBomber' },
      { id: 'd2', kind: 'doubleTorpedoBomber' },
      { id: 't1', kind: 'torpedoBomber' },
      { id: 't2', kind: 'torpedoBomber' },
      { id: 's', kind: 'submarine' },
    ]; // 60+60+70+40+10 = 240 — then add a radar and mines to tip it over
    const ok = validateSubmission('advanced', LAYOUT_A, expensive);
    expect(ok).toEqual({ ok: true, fuel: 240 });
    const over = validateSubmission('advanced', LAYOUT_A, [
      ...expensive,
      { id: 'r', kind: 'radar', at: { r: 9, c: 9 } },
      { id: 'm1', kind: 'mine', at: { r: 9, c: 8 } },
      { id: 'm2', kind: 'mine', at: { r: 9, c: 7 } },
    ]);
    expect(over.ok).toBe(false);
  });

  it('rejects too many of a kind, offensive items with a cell, own-board items on ships', () => {
    const tooMany: ArsenalItem[] = [
      { id: 'a1', kind: 'atomicBomber' },
      { id: 'a2', kind: 'atomicBomber' },
    ];
    expect(validateSubmission('advanced', LAYOUT_A, tooMany).ok).toBe(false);
    expect(
      validateSubmission('advanced', LAYOUT_A, [{ id: 'b', kind: 'bomber', at: { r: 9, c: 9 } }])
        .ok,
    ).toBe(false);
    expect(
      validateSubmission('advanced', LAYOUT_A, [{ id: 'm', kind: 'mine', at: { r: 0, c: 0 } }]).ok,
    ).toBe(false);
    expect(validateSubmission('advanced', LAYOUT_A, [{ id: 'm', kind: 'mine' }]).ok).toBe(false);
    expect(
      validateSubmission('advanced', LAYOUT_A, [{ id: 'm', kind: 'mine', at: { r: 0, c: 4 } }]).ok,
    ).toBe(true); // next to the battleship
  });

  it('a layout may be re-submitted while still placing, with hits wiped', () => {
    let state = createMatch({ id: 'm', mode: 'classic', seed: 1, playerIds: [P0, P1] });
    state = reduce(state, {
      type: 'SUBMIT_LAYOUT',
      playerId: P0,
      ships: LAYOUT_A,
      arsenal: [],
    }).state;
    const dirty = LAYOUT_B.map((s) => ({ ...s, hits: [{ r: 0, c: 0 }] }));
    const r = reduce(state, { type: 'SUBMIT_LAYOUT', playerId: P0, ships: dirty, arsenal: [] });
    expect(types(r.events)).toEqual(['LAYOUT_ACCEPTED']);
    expect(r.state.players[0].board.ships.every((s) => s.hits.length === 0)).toBe(true);
    expect(r.state.players[0].board.ships[0]?.orientation).toBe('v');
  });
});

describe('timeouts and resignation', () => {
  it('a timeout passes the turn; two in a row forfeit', () => {
    const state = startMatch({ first: P0 });
    let r = reduce(state, { type: 'TIMEOUT', playerId: P0 });
    expect(types(r.events)).toEqual(['TIMEOUT', 'TURN_CHANGED']);
    expect(r.state.turn).toBe(P1);
    expect(r.state.players[0].consecutiveTimeouts).toBe(1);

    r = reduce(r.state, { type: 'FIRE', playerId: P1, at: { r: 9, c: 9 } }); // bob misses
    r = reduce(r.state, { type: 'TIMEOUT', playerId: P0 });
    expect(types(r.events)).toEqual(['TIMEOUT', 'GAME_OVER']);
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(P1);
  });

  it('a real action resets the streak', () => {
    const state = startMatch({ first: P0 });
    let r = reduce(state, { type: 'TIMEOUT', playerId: P0 });
    r = reduce(r.state, { type: 'FIRE', playerId: P1, at: { r: 9, c: 9 } });
    r = reduce(r.state, { type: 'FIRE', playerId: P0, at: { r: 9, c: 9 } }); // alice acts
    expect(r.state.players[0].consecutiveTimeouts).toBe(0);
    r = reduce(r.state, { type: 'FIRE', playerId: P1, at: { r: 9, c: 8 } });
    r = reduce(r.state, { type: 'TIMEOUT', playerId: P0 });
    expect(r.state.phase).toBe('playing'); // only 1 in a row
  });

  it('a timeout for the wrong player is rejected', () => {
    const state = startMatch({ first: P0 });
    expect(types(reduce(state, { type: 'TIMEOUT', playerId: P1 }).events)).toEqual(['REJECTED']);
  });

  it('resigning hands the win to the opponent, from either player', () => {
    const state = startMatch({ first: P0 });
    const r = reduce(state, { type: 'RESIGN', playerId: P1 });
    expect(types(r.events)).toEqual(['RESIGNED', 'GAME_OVER']);
    expect(r.state.winner).toBe(P0);
  });
});

describe('purity', () => {
  it('reduce never mutates its input', () => {
    const state: MatchState = startMatch({ first: P0 });
    const frozen = JSON.stringify(state);
    reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 9 } });
    reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 3 } });
    reduce(state, { type: 'TIMEOUT', playerId: P0 });
    reduce(state, { type: 'RESIGN', playerId: P0 });
    expect(JSON.stringify(state)).toBe(frozen);
  });
});

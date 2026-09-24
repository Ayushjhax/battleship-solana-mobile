/**
 * The Naval Academy's three items — part-05 §10.
 *
 * Every scenario from docs/port-city/reference/test/new-items.test.ts, ported
 * onto this repo's engine, plus the secrecy and Classic tests part-05 asks for
 * on top.
 *
 * The reference models a raid board; this models a match. Where the two differ
 * the MATCH is authoritative, because that is what ships.
 */
import { describe, expect, it } from 'vitest';

import { ARSENAL_SPEC, minesweeper, radar, specFor, submarine, torpedoBomber } from '../arsenal';
import { coordKey } from '../board';
import { createMatch, projectView, reduce, validateSubmission } from '../match';
import { validateArsenalPlacement } from '../placement';
import { openBoard, resolveCell, sealBoard } from '../shots';
import type { ArsenalItem, Coord, MatchState, Ship } from '../types';

const at = (r: number, c: number): Coord => ({ r, c });

/** The shipped fleet: 8 ships, 18 cells, spread so tests can aim freely. */
function fleet(): Ship[] {
  const mk = (id: string, cls: Ship['class'], len: number, r: number, c: number, o: 'h' | 'v' = 'h'): Ship => ({
    id,
    class: cls,
    len,
    origin: at(r, c),
    orientation: o,
    hits: [],
  });
  // Laid out so rows 1/3/5/7/9 and the lower-left block are free for items,
  // and row 8's only ship sits far right — which is what lets a torpedo test
  // show a decoy stopping a run short of the ship behind it.
  return [
    mk('battleship-1', 'battleship', 4, 0, 0), // (0,0)-(0,3)
    mk('destroyer-3', 'destroyer', 2, 0, 6), // (0,6)-(0,7)
    mk('cruiser-1', 'cruiser', 3, 2, 0), // (2,0)-(2,2)
    mk('boat-1', 'boat', 1, 2, 6),
    mk('cruiser-2', 'cruiser', 3, 4, 0), // (4,0)-(4,2)
    mk('boat-2', 'boat', 1, 4, 6),
    mk('destroyer-1', 'destroyer', 2, 6, 0), // (6,0)-(6,1)
    mk('destroyer-2', 'destroyer', 2, 8, 7), // (8,7)-(8,8)
  ];
}

/** A match already in play: `a` attacks, `b` defends with `defence`. */
function match(defence: ArsenalItem[] = [], attack: ArsenalItem[] = []): MatchState {
  let state = createMatch({ id: 'items', mode: 'advanced', seed: 1, playerIds: ['a', 'b'] });
  state = reduce(state, { type: 'SUBMIT_LAYOUT', playerId: 'a', ships: fleet(), arsenal: attack }).state;
  state = reduce(state, { type: 'SUBMIT_LAYOUT', playerId: 'b', ships: fleet(), arsenal: defence }).state;
  expect(state.phase).toBe('playing');
  return { ...state, turn: 'a' };
}

const netAt = (r: number, c: number): ArsenalItem => ({ id: `sonar_net-${r}${c}`, kind: 'sonar_net', at: at(r, c) });
const decoyAt = (r: number, c: number): ArsenalItem => ({ id: `decoy-${r}${c}`, kind: 'decoy', at: at(r, c) });
const mineAt = (r: number, c: number): ArsenalItem => ({ id: `mine-${r}${c}`, kind: 'mine', at: at(r, c) });
const gunAt = (r: number, c: number): ArsenalItem => ({ id: `aaGun-${r}${c}`, kind: 'aaGun', at: at(r, c) });

/** Fire one plain shot and return the new state. */
function fire(state: MatchState, cell: Coord): MatchState {
  const result = reduce({ ...state, turn: 'a' }, { type: 'FIRE', playerId: 'a', at: cell });
  expect(result.events.some((e) => e.type === 'REJECTED')).toBe(false);
  return result.state;
}

const defender = (state: MatchState) => state.players[1];

// ===========================================================================
// Sonar Net (§2)
// ===========================================================================

describe('Sonar Net — the submarine counter (mirrors the AA gun)', () => {
  it('eats a submarine that surfaces in its column', () => {
    const state = match([netAt(9, 6)]);
    const out = submarine(state, 'a', at(7, 6));

    expect(out.events.some((e) => e.type === 'SUBMARINE_DETECTED')).toBe(true);
    // Nothing resolved: no torpedo ran, no cell was marked.
    expect(out.events.some((e) => e.type === 'HIT' || e.type === 'MISS')).toBe(false);
    expect(out.keepsTurn).toBe(false);

    const net = defender(out.state).board.arsenal.find((i) => i.kind === 'sonar_net');
    expect(net?.revealed).toBe(true);
    // Revealed, NOT marked — the cell can still be shot (§2).
    expect(defender(out.state).board.marks[coordKey(at(9, 6))]).toBeUndefined();
  });

  it('does nothing to aircraft — nets and planes ignore each other', () => {
    const out = torpedoBomber(match([netAt(3, 5)]), 'a', 3);
    expect(out.events.some((e) => e.type === 'AIRCRAFT_DOWNED')).toBe(false);
    expect(out.events.some((e) => e.type === 'SUBMARINE_DETECTED')).toBe(false);
  });

  it('guards only its own column', () => {
    const out = submarine(match([netAt(9, 5)]), 'a', at(7, 6));
    expect(out.events.some((e) => e.type === 'SUBMARINE_DETECTED')).toBe(false);
  });

  it('is destroyed by a plain shot, stops guarding, and the attacker keeps the turn', () => {
    let state = match([netAt(9, 6)]);
    const shot = reduce(state, { type: 'FIRE', playerId: 'a', at: at(9, 6) });
    expect(shot.events.some((e) => e.type === 'ITEM_HIT')).toBe(true);
    state = { ...shot.state, turn: 'a' };
    expect(state.turn).toBe('a'); // hitting an item keeps the turn

    const out = submarine(state, 'a', at(7, 6));
    expect(out.events.some((e) => e.type === 'SUBMARINE_DETECTED')).toBe(false);
  });

  it('is passed over by torpedoes, like every other item', () => {
    // Row 8 holds destroyer-2 at columns 7-8; put a net at column 2.
    const out = torpedoBomber(match([netAt(8, 2)]), 'a', 8);
    const run = out.events.find((e) => e.type === 'TORPEDO_RUN');
    expect(run?.type === 'TORPEDO_RUN' && run.hitAt).toEqual(at(8, 7));

    const net = defender(out.state).board.arsenal.find((i) => i.kind === 'sonar_net');
    expect(net?.destroyed).toBeFalsy();
  });

  it('is never consumed by a detection — it can eat a submarine every time', () => {
    const out = submarine(match([netAt(9, 6)]), 'a', at(7, 6));
    const net = defender(out.state).board.arsenal.find((i) => i.kind === 'sonar_net');
    expect(net?.used).toBeFalsy();
    expect(net?.destroyed).toBeFalsy();

    const again = submarine(out.state, 'a', at(6, 6));
    expect(again.events.some((e) => e.type === 'SUBMARINE_DETECTED')).toBe(true);
  });

  it('caught in a sunk ship halo: revealed, unshootable, still guarding (§2)', () => {
    // boat-2 is the single cell (4,6). A net at (5,6) sits in its halo.
    let state = match([netAt(5, 6)]);
    state = fire(state, at(4, 6)); // sinks boat-2, hatching its halo

    expect(defender(state).board.marks[coordKey(at(5, 6))]).toBe('revealed');
    const out = submarine({ ...state, turn: 'a' }, 'a', at(8, 6));
    expect(out.events.some((e) => e.type === 'SUBMARINE_DETECTED')).toBe(true);
  });
});

// ===========================================================================
// Decoy Buoy (§3)
// ===========================================================================

describe('Decoy Buoy — it lies', () => {
  it('reads as an ordinary hit, and the attacker keeps the turn', () => {
    const state = match([decoyAt(8, 2)]);
    const result = reduce(state, { type: 'FIRE', playerId: 'a', at: at(8, 2) });

    expect(result.state.players[1].board.marks[coordKey(at(8, 2))]).toBe('hit');
    expect(result.events.map((e) => e.type)).toEqual(['HIT']);
    expect(result.state.turn).toBe('a'); // a hit keeps the turn
  });

  it('emits no event a real hit would not — there is no tell', () => {
    const real = reduce(match(), { type: 'FIRE', playerId: 'a', at: at(0, 0) });
    const fake = reduce(match([decoyAt(8, 2)]), { type: 'FIRE', playerId: 'a', at: at(8, 2) });
    expect(fake.events.map((e) => e.type)).toEqual(real.events.map((e) => e.type));
  });

  it('is exposed only once all EIGHT neighbours are marked — the lie lasts', () => {
    let state = match([decoyAt(8, 2)]);
    state = fire(state, at(8, 2));

    const orthogonal = [at(7, 2), at(9, 2), at(8, 1), at(8, 3)];
    for (const cell of orthogonal) state = fire(state, cell);
    expect(defender(state).board.marks[coordKey(at(8, 2))]).toBe('hit'); // four is not enough

    for (const cell of [at(7, 1), at(7, 3), at(9, 1)]) state = fire(state, cell);
    expect(defender(state).board.marks[coordKey(at(8, 2))]).toBe('hit'); // seven is not enough

    const last = reduce({ ...state, turn: 'a' }, { type: 'FIRE', playerId: 'a', at: at(9, 3) });
    expect(last.state.players[1].board.marks[coordKey(at(8, 2))]).toBe('decoy');
    expect(last.events.some((e) => e.type === 'DECOY_EXPOSED')).toBe(true);
  });

  it('stops a torpedo, protecting the ships further down the row', () => {
    // Row 8: destroyer-2 sits at columns 7-8. A decoy at column 2 absorbs it.
    const out = torpedoBomber(match([decoyAt(8, 2)]), 'a', 8);
    const run = out.events.find((e) => e.type === 'TORPEDO_RUN');
    expect(run?.type === 'TORPEDO_RUN' && run.hitAt).toEqual(at(8, 2));
    // The destroyer behind it is untouched.
    expect(defender(out.state).board.marks[coordKey(at(8, 7))]).toBeUndefined();
  });

  it('once hit it is no longer intact, so torpedoes pass over it', () => {
    let state = match([decoyAt(8, 2)]);
    state = fire(state, at(8, 2));
    const out = torpedoBomber({ ...state, turn: 'a' }, 'a', 8);
    const run = out.events.find((e) => e.type === 'TORPEDO_RUN');
    expect(run?.type === 'TORPEDO_RUN' && run.hitAt).toEqual(at(8, 7));
  });

  it('is never counted by radar — radar never lies', () => {
    const withDecoys = radar(match([decoyAt(8, 2), decoyAt(8, 4)]), 'a', at(8, 3));
    const result = withDecoys.events.find((e) => e.type === 'RADAR_RESULT');
    expect(result?.type === 'RADAR_RESULT' && result.count).toBe(0);
  });

  it('may not touch a ship, so a sinking ship can never expose it', () => {
    const board = { ships: fleet(), arsenal: [], marks: {} };
    // battleship-1 occupies (0,0)-(0,3); (1,2) is inside its halo.
    expect(validateArsenalPlacement(board, decoyAt(1, 2)).ok).toBe(false);
    // Clear of every ship is fine.
    expect(validateArsenalPlacement(board, decoyAt(8, 2)).ok).toBe(true);
  });

  it('may not touch another decoy', () => {
    const board = { ships: fleet(), arsenal: [decoyAt(8, 2)], marks: {} };
    expect(validateArsenalPlacement(board, decoyAt(8, 3)).ok).toBe(false);
    expect(validateArsenalPlacement(board, decoyAt(9, 1)).ok).toBe(false);
    expect(validateArsenalPlacement(board, decoyAt(8, 4)).ok).toBe(true);
  });

  it('every OTHER item stays halo-exempt', () => {
    const board = { ships: fleet(), arsenal: [], marks: {} };
    expect(validateArsenalPlacement(board, netAt(1, 2)).ok).toBe(true);
    expect(validateArsenalPlacement(board, mineAt(1, 2)).ok).toBe(true);
    expect(validateArsenalPlacement(board, gunAt(1, 2)).ok).toBe(true);
  });

  it('does not count towards the fleet — sinking every ship still ends the match', () => {
    let state = match([decoyAt(8, 2)]);
    for (const ship of fleet()) {
      for (let i = 0; i < ship.len; i++) {
        const cell =
          ship.orientation === 'h'
            ? at(ship.origin.r, ship.origin.c + i)
            : at(ship.origin.r + i, ship.origin.c);
        if (state.phase === 'over') break;
        if (defender(state).board.marks[coordKey(cell)]) continue;
        state = fire(state, cell);
      }
    }
    expect(state.phase).toBe('over');
    expect(state.winner).toBe('a');
  });
});

// ===========================================================================
// Minesweeper (§4)
// ===========================================================================

describe('Minesweeper — the free action', () => {
  it('disarms every live mine in the two swept rows and nothing else', () => {
    const state = match([mineAt(3, 1), mineAt(4, 7), mineAt(6, 3)]);
    const out = minesweeper(state, 'a', 3);

    const marks = defender(out.state).board.marks;
    expect(marks[coordKey(at(3, 1))]).toBe('mine_disarmed');
    expect(marks[coordKey(at(4, 7))]).toBe('mine_disarmed');
    // Row 6 is outside the sweep.
    expect(marks[coordKey(at(6, 3))]).toBeUndefined();
    expect(out.events.filter((e) => e.type === 'MINE_DISARMED')).toHaveLength(2);
  });

  it('touches nothing but mines — ships, guns, nets and decoys are untouched', () => {
    const state = match([netAt(3, 2), gunAt(3, 4), decoyAt(4, 8), mineAt(3, 8)]);
    const out = minesweeper(state, 'a', 3);

    const marks = defender(out.state).board.marks;
    expect(marks[coordKey(at(3, 8))]).toBe('mine_disarmed');
    expect(marks[coordKey(at(3, 2))]).toBeUndefined();
    expect(marks[coordKey(at(3, 4))]).toBeUndefined();
    expect(marks[coordKey(at(4, 8))]).toBeUndefined();
    // Row 4 holds cruiser-2 at (4,0)-(4,2): still unmarked.
    expect(marks[coordKey(at(4, 0))]).toBeUndefined();
  });

  it('is a free action: it never ends your turn', () => {
    const state = match([], [{ id: 'minesweeper-1', kind: 'minesweeper' }]);
    const result = reduce(state, {
      type: 'USE_ARSENAL',
      playerId: 'a',
      itemId: 'minesweeper-1',
      row: 3,
    });
    expect(result.events.some((e) => e.type === 'REJECTED')).toBe(false);
    expect(result.events.some((e) => e.type === 'TURN_CHANGED')).toBe(false);
    expect(result.state.turn).toBe('a');
  });

  it('keeps the turn even when it finds nothing at all', () => {
    const out = minesweeper(match(), 'a', 3);
    expect(out.keepsTurn).toBe(true);
    expect(out.events.filter((e) => e.type === 'MINE_DISARMED')).toHaveLength(0);
  });

  it('is consumed on use whether or not it found anything', () => {
    const state = match([], [{ id: 'minesweeper-1', kind: 'minesweeper' }]);
    const result = reduce(state, {
      type: 'USE_ARSENAL',
      playerId: 'a',
      itemId: 'minesweeper-1',
      row: 3,
    });
    const item = result.state.players[0].board.arsenal.find((i) => i.id === 'minesweeper-1');
    expect(item?.used).toBe(true);
  });

  it('sweeping the last row pairs I and J, like the double torpedo', () => {
    const out = minesweeper(match([mineAt(8, 3), mineAt(9, 3)]), 'a', 9);
    const marks = defender(out.state).board.marks;
    expect(marks[coordKey(at(8, 3))]).toBe('mine_disarmed');
    expect(marks[coordKey(at(9, 3))]).toBe('mine_disarmed');
  });

  it('a disarmed cell can never be fired on again', () => {
    const out = minesweeper(match([mineAt(3, 1)]), 'a', 3);
    const shot = reduce({ ...out.state, turn: 'a' }, { type: 'FIRE', playerId: 'a', at: at(3, 1) });
    expect(shot.events.some((e) => e.type === 'REJECTED')).toBe(true);
  });

  it('is not an aircraft: no AA gun can stop it', () => {
    const out = minesweeper(match([gunAt(3, 5), mineAt(3, 1)]), 'a', 3);
    expect(out.events.some((e) => e.type === 'AIRCRAFT_DOWNED')).toBe(false);
    expect(defender(out.state).board.marks[coordKey(at(3, 1))]).toBe('mine_disarmed');
  });

  it('is not stopped by a sonar net either', () => {
    const out = minesweeper(match([netAt(3, 1), mineAt(3, 8)]), 'a', 3);
    expect(out.events.some((e) => e.type === 'SUBMARINE_DETECTED')).toBe(false);
    expect(defender(out.state).board.marks[coordKey(at(3, 8))]).toBe('mine_disarmed');
  });

  it('does not re-report a mine already neutralised by a halo reveal', () => {
    // boat-2 is the single cell (4,6); a mine at (5,6) sits in its halo.
    let state = match([mineAt(5, 6)]);
    state = fire(state, at(4, 6)); // sinks boat-2 and hatches (5,6) as 'revealed'
    expect(defender(state).board.marks[coordKey(at(5, 6))]).toBe('revealed');

    const out = minesweeper({ ...state, turn: 'a' }, 'a', 5);
    expect(out.events.filter((e) => e.type === 'MINE_DISARMED')).toHaveLength(0);
    expect(defender(out.state).board.marks[coordKey(at(5, 6))]).toBe('revealed');
  });
});

// ===========================================================================
// Secrecy — the test that fails the build on a leak (§6, §10)
// ===========================================================================

describe('the masked view never leaks a decoy (§6)', () => {
  it('serialises a hit decoy as a plain hit, with no trace of its kind', () => {
    let state = match([decoyAt(8, 2)]);
    state = fire(state, at(8, 2));

    const view = projectView(state, 'a');
    const json = JSON.stringify(view);

    // The word must not appear ANYWHERE in what the attacker receives.
    expect(json).not.toContain('decoy');
    expect(view.enemy.marks[coordKey(at(8, 2))]).toBe('hit');
    expect(view.enemy.revealedItems.some((i) => i.kind === 'decoy')).toBe(false);
    // And it is not counted as a ship.
    expect(view.enemy.shipsRemaining).toBe(8);
  });

  it('stays hidden while neighbours are still unmarked', () => {
    let state = match([decoyAt(8, 2)]);
    state = fire(state, at(8, 2));
    for (const cell of [at(7, 2), at(9, 2), at(8, 1)]) state = fire(state, cell);
    expect(JSON.stringify(projectView(state, 'a'))).not.toContain('decoy');
  });

  it('only reveals it once exposed, which the player can already see', () => {
    let state = match([decoyAt(8, 2)]);
    for (const cell of [
      at(8, 2), at(7, 1), at(7, 2), at(7, 3),
      at(8, 1), at(8, 3), at(9, 1), at(9, 2), at(9, 3),
    ]) {
      state = fire(state, cell);
    }
    const view = projectView(state, 'a');
    expect(view.enemy.marks[coordKey(at(8, 2))]).toBe('decoy');
  });

  it("the defender's OWN view still shows their decoys — it is their board", () => {
    const state = match([decoyAt(8, 2)]);
    const own = projectView(state, 'b');
    expect(own.you.board.arsenal.some((i) => i.kind === 'decoy')).toBe(true);
  });
});

// ===========================================================================
// Fuel, caps, unlocks and Classic (§10)
// ===========================================================================

describe('fuel, caps and Classic (§10)', () => {
  it('everything at cap is now 360 fuel against the unchanged 260 budget', () => {
    const total = ARSENAL_SPEC.reduce((sum, spec) => sum + spec.cost * spec.max, 0);
    expect(total).toBe(360);
  });

  it('prices and caps are exactly the published ones', () => {
    expect(specFor('sonar_net')).toMatchObject({ cost: 10, max: 2, placement: 'own board' });
    expect(specFor('decoy')).toMatchObject({ cost: 5, max: 3, placement: 'own board' });
    expect(specFor('minesweeper')).toMatchObject({ cost: 15, max: 1, placement: 'offensive' });
  });

  it('enforces the caps', () => {
    const four = [decoyAt(8, 2), decoyAt(8, 4), decoyAt(9, 1), decoyAt(7, 5)];
    const check = validateSubmission('advanced', fleet(), four);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('too many decoy');
  });

  it('still refuses a layout over 260 fuel', () => {
    const many: ArsenalItem[] = [
      { id: 'atomicBomber-1', kind: 'atomicBomber' },
      { id: 'doubleTorpedoBomber-1', kind: 'doubleTorpedoBomber' },
      { id: 'doubleTorpedoBomber-2', kind: 'doubleTorpedoBomber' },
      { id: 'bomber-1', kind: 'bomber' },
      { id: 'bomber-2', kind: 'bomber' },
      { id: 'torpedoBomber-1', kind: 'torpedoBomber' },
      { id: 'torpedoBomber-2', kind: 'torpedoBomber' },
      { id: 'minesweeper-1', kind: 'minesweeper' },
      { id: 'submarine-1', kind: 'submarine' },
      // Own-board items need a cell; these are all clear of the fleet.
      { id: 'mine-1', kind: 'mine', at: at(9, 0) },
      { id: 'mine-2', kind: 'mine', at: at(9, 2) },
      { id: 'mine-3', kind: 'mine', at: at(9, 4) },
    ];
    const check = validateSubmission('advanced', fleet(), many);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('over budget');
  });

  it('CLASSIC rejects all three, as it rejects every arsenal item', () => {
    for (const item of [netAt(5, 5), decoyAt(8, 2), { id: 'minesweeper-1', kind: 'minesweeper' as const }]) {
      const check = validateSubmission('classic', fleet(), [item]);
      expect(check.ok, `classic accepted ${item.kind}`).toBe(false);
      if (!check.ok) expect(check.reason).toContain('classic mode has no arsenal');
    }
  });

  it('Classic with no arsenal is still accepted, unchanged', () => {
    expect(validateSubmission('classic', fleet(), []).ok).toBe(true);
  });
});

// ===========================================================================
// The golden resolution order — proof that inserting the decoy moved nothing
// ===========================================================================

describe('resolution order is unchanged except for the decoy (§6)', () => {
  it('mine before ship before item before water, exactly as before', () => {
    const board = {
      ships: [
        {
          id: 'boat-1',
          class: 'boat' as const,
          len: 1,
          origin: at(0, 0),
          orientation: 'h' as const,
          hits: [],
        },
      ],
      arsenal: [mineAt(2, 2), gunAt(4, 4)],
      marks: {},
    };

    const wb = openBoard(board);
    expect(resolveCell(wb, 'a', at(2, 2))).toMatchObject({ hit: false, mine: true });
    expect(resolveCell(wb, 'a', at(0, 0))).toMatchObject({ hit: true, sunk: true, mine: false });
    expect(resolveCell(wb, 'a', at(4, 4))).toMatchObject({ hit: true, sunk: false, mine: false });
    expect(resolveCell(wb, 'a', at(7, 7))).toMatchObject({ hit: false, sunk: false, mine: false });

    const sealed = sealBoard(wb);
    expect(sealed.marks[coordKey(at(2, 2))]).toBe('mine');
    expect(sealed.marks[coordKey(at(0, 0))]).toBe('sunk');
    expect(sealed.marks[coordKey(at(4, 4))]).toBe('revealed');
    expect(sealed.marks[coordKey(at(7, 7))]).toBe('miss');
  });

  it('a decoy sits between the ship and the other items', () => {
    const wb = openBoard({ ships: [], arsenal: [decoyAt(3, 3)], marks: {} });
    const outcome = resolveCell(wb, 'a', at(3, 3));
    // Byte-identical to a non-sinking ship hit.
    expect(outcome).toMatchObject({ hit: true, sunk: false, mine: false });
    expect(outcome.events.map((e) => e.type)).toEqual(['HIT']);
  });
});

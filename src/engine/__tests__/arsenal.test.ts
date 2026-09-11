import { describe, expect, it } from 'vitest';
import { ARSENAL_SPEC, atomicFootprint, bomberFootprint, doubleTorpedoRows } from '../arsenal';
import { coordKey } from '../board';
import { projectView, reduce } from '../match';
import type { ArsenalItem, MatchEvent, MatchState } from '../types';
import { FUEL_BUDGET } from '../types';
import { LAYOUT_A, P0, P1, cellsOfLayout, startMatch, types } from './fixtures';

const item = (id: string, kind: ArsenalItem['kind'], at?: ArsenalItem['at']): ArsenalItem => ({
  id,
  kind,
  ...(at ? { at } : {}),
});

/** P1 (bob) attacks P0 (alice) on layout A, with the given stocks. */
const setup = (arsenalB: ArsenalItem[], arsenalA: ArsenalItem[] = []): MatchState =>
  startMatch({ mode: 'advanced', arsenalA, arsenalB, first: P1 });

const use = (
  state: MatchState,
  itemId: string,
  target: { at?: { r: number; c: number }; row?: number },
) => reduce(state, { type: 'USE_ARSENAL', playerId: P1, itemId, ...target });

const hitsIn = (events: readonly MatchEvent[]) =>
  events
    .filter((e): e is Extract<MatchEvent, { type: 'HIT' }> => e.type === 'HIT')
    .map((e) => coordKey(e.at))
    .sort();

describe('spec table', () => {
  it('matches docs/brief.md 3.4 prices and caps, and the budget', () => {
    const row = (kind: ArsenalItem['kind']) => ARSENAL_SPEC.find((e) => e.kind === kind)!;
    expect([row('torpedoBomber').cost, row('torpedoBomber').max]).toEqual([20, 2]);
    expect([row('doubleTorpedoBomber').cost, row('doubleTorpedoBomber').max]).toEqual([35, 2]);
    expect([row('bomber').cost, row('bomber').max]).toEqual([30, 2]);
    expect([row('atomicBomber').cost, row('atomicBomber').max]).toEqual([60, 1]);
    expect([row('aaGun').cost, row('aaGun').max]).toEqual([10, 3]);
    expect([row('radar').cost, row('radar').max]).toEqual([15, 1]);
    expect([row('mine').cost, row('mine').max]).toEqual([5, 5]);
    expect([row('submarine').cost, row('submarine').max]).toEqual([10, 1]);
    expect(FUEL_BUDGET).toBe(260);
  });
});

describe('footprints', () => {
  it('bomber is a fixed T: target, target+right, target+down, clipped', () => {
    expect(bomberFootprint({ r: 2, c: 4 })).toEqual([
      { r: 2, c: 4 },
      { r: 2, c: 5 },
      { r: 3, c: 4 },
    ]);
    expect(bomberFootprint({ r: 9, c: 9 })).toEqual([{ r: 9, c: 9 }]);
  });

  it('atomic is the full 3x3, clipped', () => {
    expect(atomicFootprint({ r: 1, c: 1 })).toHaveLength(9);
    expect(atomicFootprint({ r: 0, c: 0 })).toHaveLength(4);
    expect(atomicFootprint({ r: 0, c: 5 })).toHaveLength(6);
  });

  it('double torpedo covers the row and the next; row J uses I and J', () => {
    expect(doubleTorpedoRows(4)).toEqual([4, 5]);
    expect(doubleTorpedoRows(9)).toEqual([8, 9]);
  });
});

describe('bomber', () => {
  it('bombs its T; hits keep the turn', () => {
    const state = setup([item('b1', 'bomber')]);
    const { state: next, events } = use(state, 'b1', { at: { r: 2, c: 4 } }); // cruiser-2 at (2,4),(2,5)
    expect(events[0]).toMatchObject({ type: 'ARSENAL_USED', kind: 'bomber' });
    expect(
      events.filter((event) => event.type === 'BOMB_DROPPED').map((event) => event.at),
    ).toEqual(bomberFootprint({ r: 2, c: 4 }));
    expect(hitsIn(events)).toEqual(['2,4', '2,5']);
    expect(types(events)).toContain('MISS'); // (3,4)
    expect(next.turn).toBe(P1);
    expect(next.players[1].board.arsenal[0]?.used).toBe(true);
  });

  it('a drop that hits nothing ends the turn, and the item is still spent', () => {
    const state = setup([item('b1', 'bomber')]);
    const { state: next, events } = use(state, 'b1', { at: { r: 8, c: 8 } });
    expect(types(events)).toEqual([
      'ARSENAL_USED',
      'AIRCRAFT_LAUNCHED',
      'BOMB_DROPPED',
      'BOMB_DROPPED',
      'BOMB_DROPPED',
      'MISS',
      'MISS',
      'MISS',
      'TURN_CHANGED',
    ]);
    expect(next.turn).toBe(P0);
    expect(next.players[1].board.arsenal[0]?.used).toBe(true);
  });
});

describe('atomic bomber', () => {
  it('destroys the 3x3 and sinks what it covers', () => {
    const state = setup([item('a1', 'atomicBomber')]);
    const { state: next, events } = use(state, 'a1', { at: { r: 1, c: 1 } });
    const flash = events.find((event) => event.type === 'NUKE_FLASH');
    expect(flash?.cells.map(coordKey).sort()).toEqual(
      atomicFootprint({ r: 1, c: 1 }).map(coordKey).sort(),
    );
    expect(hitsIn(events)).toEqual(['0,0', '0,1', '0,2', '2,0', '2,1', '2,2']);
    expect(types(events).filter((t) => t === 'SUNK')).toEqual(['SUNK']); // cruiser-1 fully covered
    expect(types(events).filter((t) => t === 'MISS')).toHaveLength(3);
    expect(next.turn).toBe(P1);
  });
});

describe('torpedo bombers', () => {
  it('runs from column 1 and hits the first intact ship cell in the row', () => {
    const state = setup([item('t1', 'torpedoBomber')]);
    const { state: next, events } = use(state, 't1', { row: 4 });
    const run = events.find((e) => e.type === 'TORPEDO_RUN') as Extract<
      MatchEvent,
      { type: 'TORPEDO_RUN' }
    >;
    expect(run.path).toEqual([{ r: 4, c: 0 }]);
    expect(events.find((event) => event.type === 'TORPEDO_TRAVEL')).toMatchObject({
      path: run.path,
      hitAt: run.hitAt,
    });
    expect(run.hitAt).toEqual({ r: 4, c: 0 });
    expect(hitsIn(events)).toEqual(['4,0']);
    expect(next.turn).toBe(P1);
  });

  it('passes over cells already hit and strikes the next intact one', () => {
    let state = setup([item('t1', 'torpedoBomber')]);
    state = reduce(state, { type: 'FIRE', playerId: P1, at: { r: 4, c: 0 } }).state;
    state = reduce(state, { type: 'FIRE', playerId: P1, at: { r: 4, c: 1 } }).state; // destroyer-1 sunk
    const { events } = use(state, 't1', { row: 4 });
    const run = events.find((e) => e.type === 'TORPEDO_RUN') as Extract<
      MatchEvent,
      { type: 'TORPEDO_RUN' }
    >;
    expect(run.hitAt).toEqual({ r: 4, c: 3 }); // destroyer-2
    expect(run.path).toHaveLength(4);
  });

  it('an empty row runs the full width and ends the turn', () => {
    const state = setup([item('t1', 'torpedoBomber')]);
    const { state: next, events } = use(state, 't1', { row: 1 });
    const run = events.find((e) => e.type === 'TORPEDO_RUN') as Extract<
      MatchEvent,
      { type: 'TORPEDO_RUN' }
    >;
    expect(run.path).toHaveLength(10);
    expect(run.hitAt).toBeNull();
    expect(next.turn).toBe(P0);
  });

  it('double torpedo runs two rows; row 9 clamps', () => {
    const state = setup([item('d1', 'doubleTorpedoBomber')]);
    const { state: next, events } = use(state, 'd1', { row: 4 });
    expect(events.filter((e) => e.type === 'TORPEDO_RUN')).toHaveLength(2);
    expect(hitsIn(events)).toEqual(['4,0']); // row 5 is empty
    expect(next.turn).toBe(P1);

    const clamped = use(setup([item('d1', 'doubleTorpedoBomber')]), 'd1', { row: 9 });
    const runs = clamped.events.filter((e) => e.type === 'TORPEDO_RUN') as Extract<
      MatchEvent,
      { type: 'TORPEDO_RUN' }
    >[];
    expect(runs.map((r) => r.path[0]?.r)).toEqual([8, 9]);
  });

  it('rejects a row out of range', () => {
    const state = setup([item('t1', 'torpedoBomber')]);
    expect(types(use(state, 't1', { row: 10 }).events)).toEqual(['REJECTED']);
    expect(types(use(state, 't1', {}).events)).toEqual(['REJECTED']);
  });
});

describe('the aircraft rule', () => {
  const gunAt = { r: 4, c: 9 };

  it('an AA gun downs a torpedo bomber crossing its row: no hits, weapon spent, turn ends, gun revealed', () => {
    const state = setup([item('t1', 'torpedoBomber')], [item('g1', 'aaGun', gunAt)]);
    const { state: next, events } = use(state, 't1', { row: 4 });
    expect(types(events)).toEqual([
      'ARSENAL_USED',
      'AIRCRAFT_LAUNCHED',
      'AIRCRAFT_DOWNED',
      'TURN_CHANGED',
    ]);
    expect(events[2]).toMatchObject({ type: 'AIRCRAFT_DOWNED', kind: 'torpedoBomber', gunAt });
    expect(next.turn).toBe(P0);
    expect(next.players[1].board.arsenal[0]?.used).toBe(true);
    expect(next.players[0].board.ships.every((s) => s.hits.length === 0)).toBe(true);
    expect(projectView(next, P1).enemy.revealedItems).toEqual([
      { kind: 'aaGun', at: gunAt, destroyed: false },
    ]);
    // The gun's cell is still a legal target — the attacker can go and destroy it.
    expect(projectView(next, P1).enemy.marks[coordKey(gunAt)]).toBeUndefined();
  });

  it('an atomic blast whose footprint touches the gun row is downed too', () => {
    const state = setup([item('a1', 'atomicBomber')], [item('g1', 'aaGun', gunAt)]);
    const { events } = use(state, 'a1', { at: { r: 3, c: 5 } }); // rows 2..4
    expect(types(events)).toEqual([
      'ARSENAL_USED',
      'AIRCRAFT_LAUNCHED',
      'AIRCRAFT_DOWNED',
      'TURN_CHANGED',
    ]);
  });

  it('a bomber on another row is untouched', () => {
    const state = setup([item('b1', 'bomber')], [item('g1', 'aaGun', gunAt)]);
    const { events } = use(state, 'b1', { at: { r: 0, c: 0 } });
    expect(types(events)).not.toContain('AIRCRAFT_DOWNED');
    expect(hitsIn(events)).toEqual(['0,0', '0,1']);
  });

  it('a destroyed gun no longer covers its row', () => {
    let state = setup([item('t1', 'torpedoBomber')], [item('g1', 'aaGun', gunAt)]);
    state = reduce(state, { type: 'FIRE', playerId: P1, at: gunAt }).state; // ITEM_HIT, turn kept
    const { events } = use(state, 't1', { row: 4 });
    expect(types(events)).not.toContain('AIRCRAFT_DOWNED');
    expect(hitsIn(events)).toEqual(['4,0']);
  });

  it('the submarine is not an aircraft', () => {
    const state = setup([item('s1', 'submarine')], [item('g1', 'aaGun', gunAt)]);
    const { events } = use(state, 's1', { at: { r: 3, c: 0 } }); // row 4 below has destroyer-1
    expect(types(events)).not.toContain('AIRCRAFT_DOWNED');
    expect(hitsIn(events)).toEqual(['2,0', '4,0']); // up: cruiser-1, down: destroyer-1
  });
});

describe('submarine', () => {
  it('fires up and down from a free cell until each torpedo hits a ship or leaves the grid', () => {
    const state = setup([item('s1', 'submarine')]);
    const { state: next, events } = use(state, 's1', { at: { r: 1, c: 4 } });
    expect(events).toContainEqual({ type: 'SUBMARINE_SURFACED', playerId: P1, at: { r: 1, c: 4 } });
    const runs = events.filter((e) => e.type === 'TORPEDO_RUN') as Extract<
      MatchEvent,
      { type: 'TORPEDO_RUN' }
    >[];
    expect(runs).toHaveLength(2);
    expect(events.filter((event) => event.type === 'TORPEDO_TRAVEL')).toHaveLength(2);
    expect(runs[0]?.hitAt).toBeNull(); // up through (0,4): empty
    expect(runs[1]?.hitAt).toEqual({ r: 2, c: 4 }); // down: cruiser-2
    expect(next.turn).toBe(P1);
  });

  it('needs a free cell — one the attacker has not marked', () => {
    let state = setup([item('s1', 'submarine')]);
    state = reduce(state, { type: 'FIRE', playerId: P1, at: { r: 1, c: 4 } }).state; // miss
    state = { ...state, turn: P1 };
    const { state: next, events } = use(state, 's1', { at: { r: 1, c: 4 } });
    expect(types(events)).toEqual(['REJECTED']);
    expect(next).toBe(state);
  });
});

describe('radar', () => {
  it('returns a count of ship cells in the 3x3 and nothing else, and ends the turn', () => {
    const state = setup([item('r1', 'radar', { r: 9, c: 0 })]);
    const { state: next, events } = use(state, 'r1', { at: { r: 1, c: 1 } });
    expect(types(events)).toEqual(['ARSENAL_USED', 'RADAR_RESULT', 'TURN_CHANGED']);
    expect(events[1]).toEqual({ type: 'RADAR_RESULT', playerId: P1, at: { r: 1, c: 1 }, count: 6 });
    expect(next.turn).toBe(P0);
    expect(next.players[1].board.arsenal[0]?.used).toBe(true);

    // No ship position leaks through the events: only the centre cell appears.
    const json = JSON.stringify(events);
    for (const cell of cellsOfLayout(LAYOUT_A)) {
      expect(json).not.toContain(JSON.stringify(cell));
    }
    // And the defender's marks are untouched — radar is not a shot.
    expect(Object.keys(next.players[0].board.marks)).toHaveLength(0);
  });

  it('clips at the edge and counts hit cells too', () => {
    let state = setup([item('r1', 'radar', { r: 9, c: 0 })]);
    state = reduce(state, { type: 'FIRE', playerId: P1, at: { r: 0, c: 0 } }).state; // hit battleship
    const { events } = use(state, 'r1', { at: { r: 0, c: 0 } }); // 2x2: (0,0),(0,1) ships
    expect(events[1]).toMatchObject({ type: 'RADAR_RESULT', count: 2 });
  });
});

describe('use validation', () => {
  it('cannot use an own-board item, an unknown item, a spent item, or anything in classic mode', () => {
    const state = setup([item('b1', 'bomber')], [item('g1', 'aaGun', { r: 9, c: 9 })]);
    expect(types(use(state, 'nope', { at: { r: 0, c: 0 } }).events)).toEqual(['REJECTED']);
    const alice = reduce(
      { ...state, turn: P0 },
      { type: 'USE_ARSENAL', playerId: P0, itemId: 'g1' },
    );
    expect(types(alice.events)).toEqual(['REJECTED']);
    const spent = use(state, 'b1', { at: { r: 8, c: 8 } }).state;
    expect(types(use({ ...spent, turn: P1 }, 'b1', { at: { r: 0, c: 0 } }).events)).toEqual([
      'REJECTED',
    ]);

    const classic = startMatch({ first: P1 });
    expect(types(use(classic, 'b1', { at: { r: 0, c: 0 } }).events)).toEqual(['REJECTED']);
  });
});

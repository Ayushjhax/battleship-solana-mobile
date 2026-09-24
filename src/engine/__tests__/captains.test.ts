/**
 * Part 10A — the six captains, one test block each.
 *
 * The shape every ability shares: fire the trigger and assert exactly one
 * CAPTAIN_ABILITY event; fire it again and assert there is still exactly one.
 * Then the part-specific rules: fuel out of the same 260, Classic refusal, the
 * opponent seeing the captain at reveal, and a replay reproducing the ability.
 *
 * Rosa's block is the differential test the design asks for: the same seeded
 * match, played twice by the same AI, with and without her — every event, every
 * mark and every ship must be identical.
 */
import { describe, expect, it } from 'vitest';
import { chooseMove } from '../ai';
import { CAPTAINS, captainFuel, itemCounts } from '../captains';
import { createMatch, projectView, reduce, validateSubmission } from '../match';
import { createRng } from '../rng';
import type { ArsenalItem, CaptainId, Coord, MatchAction, MatchState } from '../types';
import { LAYOUT_A, LAYOUT_B, P0, P1, startMatch, types } from './fixtures';

const captainEvents = (events: readonly { type: string }[]) =>
  events.filter((event) => event.type === 'CAPTAIN_ABILITY');

const gun = (id: string, r: number, c: number): ArsenalItem => ({
  id,
  kind: 'aaGun',
  at: { r, c },
});

describe('the roster', () => {
  it('is six captains with the roster’s fuel, and the union covers them exactly', () => {
    expect(CAPTAINS.map((c) => c.id).sort()).toEqual(
      ['berhan', 'ivo', 'mara', 'oldCaptain', 'rosa', 'tomas'].sort(),
    );
    expect(Object.fromEntries(CAPTAINS.map((c) => [c.id, c.fuel]))).toEqual({
      berhan: 45,
      mara: 25,
      ivo: 15,
      tomas: 30,
      rosa: 0,
      oldCaptain: 20,
    });
    expect(captainFuel(null)).toBe(0);
    expect(captainFuel('rosa')).toBe(0);
  });
});

describe('validateSubmission — the captain is fuel out of the same 260', () => {
  it('prices each captain and reports the total', () => {
    for (const captain of CAPTAINS) {
      const check = validateSubmission('advanced', LAYOUT_A, [], undefined, captain.id);
      expect(check).toEqual({ ok: true, fuel: captain.fuel });
    }
  });

  it('rejects a layout whose arsenal plus captain exceeds 260', () => {
    // 230 fuel of offensive items — legal alone, illegal with Berhan's 45.
    const heavy: ArsenalItem[] = [
      { id: 'atomic-1', kind: 'atomicBomber' },
      { id: 'tb-1', kind: 'torpedoBomber' },
      { id: 'tb-2', kind: 'torpedoBomber' },
      { id: 'dtb-1', kind: 'doubleTorpedoBomber' },
      { id: 'dtb-2', kind: 'doubleTorpedoBomber' },
      { id: 'b-1', kind: 'bomber' },
      { id: 'b-2', kind: 'bomber' },
    ];
    expect(validateSubmission('advanced', LAYOUT_A, heavy, undefined, 'rosa')).toEqual({
      ok: true,
      fuel: 230,
    });
    const rejected = validateSubmission('advanced', LAYOUT_A, heavy, undefined, 'berhan');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe('over budget: 275 > 260');
  });

  it('refuses an unknown captain id rather than dropping it', () => {
    const check = validateSubmission('advanced', LAYOUT_A, [], undefined, 'blackbeard' as CaptainId);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('unknown captain');
  });

  it('Classic refuses every captain, even with no arsenal', () => {
    for (const captain of CAPTAINS) {
      const check = validateSubmission('classic', LAYOUT_A, [], undefined, captain.id);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason).toBe('classic mode has no captains');
    }
  });
});

describe('Berhan, the Gunner', () => {
  it('turns the first plain miss into a kept turn, once', () => {
    const state = startMatch({ mode: 'advanced', captainA: 'berhan', first: P0 });
    const first = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } });
    expect(types(first.events)).toEqual(['MISS', 'CAPTAIN_ABILITY']);
    expect(first.state.turn).toBe(P0);
    expect(first.state.players[0].captainUsed).toBe(true);

    const second = reduce(first.state, { type: 'FIRE', playerId: P0, at: { r: 1, c: 0 } });
    expect(types(second.events)).toEqual(['MISS', 'TURN_CHANGED']);
    expect(second.state.turn).toBe(P1);
    expect(captainEvents(second.events)).toHaveLength(0);
  });

  it('is not spent by a hit, and not spent by a mine', () => {
    const hitState = startMatch({ mode: 'advanced', captainA: 'berhan', first: P0 });
    const hit = reduce(hitState, { type: 'FIRE', playerId: P0, at: { r: 0, c: 5 } });
    expect(types(hit.events)).toEqual(['HIT']);
    expect(hit.state.players[0].captainUsed).toBe(false);

    const miss = reduce(hit.state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } });
    expect(types(miss.events)).toEqual(['MISS', 'CAPTAIN_ABILITY']);
    expect(miss.state.turn).toBe(P0);

    const mineState = startMatch({
      mode: 'advanced',
      arsenalB: [{ id: 'mine-1', kind: 'mine', at: { r: 0, c: 0 } }],
      captainA: 'berhan',
      first: P0,
    });
    const mine = reduce(mineState, { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } });
    expect(types(mine.events)).toEqual(['MINE_TRIGGERED', 'TURN_CHANGED']);
    expect(mine.state.players[0].captainUsed).toBe(false);
  });

  it('is not spent by arsenal fire', () => {
    const state = startMatch({
      mode: 'advanced',
      arsenalA: [{ id: 'tb-1', kind: 'torpedoBomber' }],
      captainA: 'berhan',
      first: P0,
    });
    const fired = reduce(state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'tb-1', row: 8 });
    expect(fired.state.players[0].captainUsed).toBe(false);
    expect(captainEvents(fired.events)).toHaveLength(0);
  });

  it('replays exactly from the same seed and actions', () => {
    const script: MatchAction[] = [
      { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } },
      { type: 'FIRE', playerId: P0, at: { r: 1, c: 0 } },
      { type: 'FIRE', playerId: P1, at: { r: 4, c: 0 } },
    ];
    const run = () => {
      let state = startMatch({ mode: 'advanced', captainA: 'berhan', captainB: 'tomas', seed: 3 });
      const events: { type: string }[] = [];
      for (const action of script) {
        const result = reduce(state, action);
        events.push(...result.events);
        state = result.state;
      }
      return events;
    };
    expect(run()).toEqual(run());
  });
});

describe('Mara, the Engineer', () => {
  it('leaves each AA gun damaged on its first hit, and destroyable on the second', () => {
    const state = startMatch({
      mode: 'advanced',
      arsenalB: [gun('gun-1', 0, 0)],
      captainB: 'mara',
      first: P0,
    });
    const first = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } });
    expect(types(first.events)).toEqual(['ITEM_HIT', 'CAPTAIN_ABILITY']);
    expect(first.state.players[1].board.marks['0,0']).toBeUndefined();
    const damaged = first.state.players[1].board.arsenal[0];
    expect(damaged?.damaged).toBe(true);
    expect(damaged?.destroyed).toBeUndefined();
    expect(damaged?.revealed).toBe(true);
    expect(first.state.players[1].captainUsed).toBe(false);

    // The attacker is told it is damaged — and only that.
    expect(projectView(first.state, P0).enemy.revealedItems).toEqual([
      { kind: 'aaGun', at: { r: 0, c: 0 }, destroyed: false, damaged: true },
    ]);

    const second = reduce(first.state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } });
    expect(types(second.events)).toEqual(['ITEM_HIT']);
    expect(second.state.players[1].board.marks['0,0']).toBe('revealed');
    expect(second.state.players[1].board.arsenal[0]?.destroyed).toBe(true);
    expect(captainEvents(second.events)).toHaveLength(0);
  });

  it('gives every AA gun its own survival, once each', () => {
    const state = startMatch({
      mode: 'advanced',
      arsenalB: [gun('gun-1', 0, 0), gun('gun-2', 0, 2)],
      captainB: 'mara',
      first: P0,
    });
    const first = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } });
    const second = reduce(first.state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 2 } });
    expect(captainEvents(second.events)).toHaveLength(1);
    expect(second.state.players[1].board.arsenal.map((i) => i.damaged)).toEqual([true, true]);

    // Gun 1's second hit destroys it; gun 2 is untouched by that.
    const third = reduce(second.state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } });
    expect(captainEvents(third.events)).toHaveLength(0);
    expect(third.state.players[1].board.arsenal.map((i) => i.destroyed)).toEqual([true, undefined]);
  });

  it('a damaged gun still guards its row', () => {
    const state = startMatch({
      mode: 'advanced',
      arsenalA: [{ id: 'tb-1', kind: 'torpedoBomber' }],
      arsenalB: [gun('gun-1', 0, 0)],
      captainB: 'mara',
      first: P0,
    });
    const damaged = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } });
    const plane = reduce(damaged.state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'tb-1', row: 0 });
    expect(types(plane.events)).toContain('AIRCRAFT_DOWNED');
  });

  it('without Mara, the first hit destroys the gun as before', () => {
    const state = startMatch({
      mode: 'advanced',
      arsenalB: [gun('gun-1', 0, 0)],
      first: P0,
    });
    const hit = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } });
    expect(types(hit.events)).toEqual(['ITEM_HIT']);
    expect(hit.state.players[1].board.marks['0,0']).toBe('revealed');
    expect(hit.state.players[1].board.arsenal[0]?.destroyed).toBe(true);
  });
});

describe('Ivo, the Spy', () => {
  const spyBoard: ArsenalItem[] = [
    { id: 'mine-1', kind: 'mine', at: { r: 9, c: 4 } },
    { id: 'mine-2', kind: 'mine', at: { r: 9, c: 6 } },
    gun('gun-1', 9, 2),
    { id: 'net-1', kind: 'sonar_net', at: { r: 9, c: 8 } },
    { id: 'decoy-1', kind: 'decoy', at: { r: 8, c: 0 } },
  ];

  function ivoStart() {
    let state = createMatch({ id: 'ivo', mode: 'advanced', seed: 1, playerIds: [P0, P1] });
    state = reduce(state, {
      type: 'SUBMIT_LAYOUT',
      playerId: P0,
      ships: LAYOUT_A,
      arsenal: [],
      captainId: 'ivo',
    }).state;
    return reduce(state, {
      type: 'SUBMIT_LAYOUT',
      playerId: P1,
      ships: LAYOUT_B,
      arsenal: spyBoard,
    });
  }

  it('reports the enemy’s counts at match start — counts only, never cells', () => {
    const started = ivoStart();
    expect(types(started.events)).toEqual(['LAYOUT_ACCEPTED', 'MATCH_STARTED', 'CAPTAIN_ABILITY']);
    const event = started.events.find((e) => e.type === 'CAPTAIN_ABILITY');
    expect(event).toMatchObject({
      type: 'CAPTAIN_ABILITY',
      playerId: P0,
      captainId: 'ivo',
      counts: { mine: 2, aaGun: 1, sonar_net: 1, decoy: 1 },
    });
    expect(started.state.players[0].captainUsed).toBe(true);
    // No cell coordinates anywhere in the intelligence.
    const json = JSON.stringify(event);
    for (const cell of spyBoard.map((i) => i.at as Coord)) {
      expect(json).not.toContain(`"r":${cell.r},"c":${cell.c}`);
    }
  });

  it('fires once, at the start, and never again', () => {
    const started = ivoStart();
    const shot = reduce(started.state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } });
    expect(captainEvents(shot.events)).toHaveLength(0);
  });

  it('counts a board with none of the four as zeros', () => {
    const counts = itemCounts({ ships: [], arsenal: [{ id: 'tb', kind: 'torpedoBomber' }], marks: {} });
    expect(counts).toEqual({ mine: 0, aaGun: 0, sonar_net: 0, decoy: 0 });
  });
});

describe('Tomas, the Navigator', () => {
  it('lets the first torpedo pass under a ship and carry on down the row', () => {
    const state = startMatch({
      mode: 'advanced',
      arsenalA: [
        { id: 'tb-1', kind: 'torpedoBomber' },
        { id: 'tb-2', kind: 'torpedoBomber' },
      ],
      captainB: 'tomas',
      first: P0,
    });
    const first = reduce(state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'tb-1', row: 0 });
    expect(types(first.events)).toEqual([
      'ARSENAL_USED',
      'AIRCRAFT_LAUNCHED',
      'CAPTAIN_ABILITY',
      'TORPEDO_TRAVEL',
      'TORPEDO_RUN',
      'HIT',
    ]);
    // The boat at (0,3) was passed over and stays unmarked; the destroyer at
    // (0,5) behind it was hit.
    expect(first.state.players[1].board.marks['0,3']).toBeUndefined();
    expect(first.state.players[1].board.marks['0,5']).toBe('hit');
    expect(first.state.players[1].captainUsed).toBe(true);

    // The next torpedo is a normal one: it strikes the boat.
    const second = reduce(first.state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'tb-2', row: 0 });
    expect(captainEvents(second.events)).toHaveLength(0);
    expect(second.state.players[1].board.marks['0,3']).toBe('sunk');
  });

  it('fires once across a double torpedo’s two rows', () => {
    const state = startMatch({
      mode: 'advanced',
      arsenalA: [{ id: 'dtb-1', kind: 'doubleTorpedoBomber' }],
      captainB: 'tomas',
      first: P0,
    });
    const run = reduce(state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'dtb-1', row: 2 });
    expect(captainEvents(run.events)).toHaveLength(1);
  });

  it('does not fire for a decoy: a decoy still stops the run', () => {
    const state = startMatch({
      mode: 'advanced',
      arsenalA: [{ id: 'tb-1', kind: 'torpedoBomber' }],
      arsenalB: [{ id: 'decoy-1', kind: 'decoy', at: { r: 2, c: 0 } }],
      captainB: 'tomas',
      first: P0,
    });
    const run = reduce(state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'tb-1', row: 2 });
    expect(captainEvents(run.events)).toHaveLength(0);
    expect(run.state.players[1].board.marks['2,0']).toBe('hit');
  });

  it('without Tomas, the torpedo strikes the first ship it meets', () => {
    const state = startMatch({
      mode: 'advanced',
      arsenalA: [{ id: 'tb-1', kind: 'torpedoBomber' }],
      first: P0,
    });
    const run = reduce(state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'tb-1', row: 0 });
    expect(types(run.events)).toEqual([
      'ARSENAL_USED',
      'AIRCRAFT_LAUNCHED',
      'TORPEDO_TRAVEL',
      'TORPEDO_RUN',
      'HIT',
      'SUNK',
      'AUTO_REVEAL',
    ]);
    expect(run.state.players[1].board.marks['0,3']).toBe('sunk');
  });
});

describe('The Old Captain', () => {
  it('hands over one free radar when the first ship sinks, once', () => {
    const state = startMatch({ mode: 'advanced', captainB: 'oldCaptain', first: P0 });
    const first = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 3 } });
    expect(types(first.events)).toEqual(['HIT', 'SUNK', 'AUTO_REVEAL', 'CAPTAIN_ABILITY']);
    const defender = first.state.players[1];
    expect(defender.captainUsed).toBe(true);
    expect(defender.board.arsenal).toContainEqual({ id: 'radar-free-1', kind: 'radar' });

    // A second sink hands over nothing more.
    const second = reduce(first.state, { type: 'FIRE', playerId: P0, at: { r: 2, c: 3 } });
    expect(captainEvents(second.events)).toHaveLength(0);
    expect(second.state.players[1].board.arsenal).toHaveLength(1);
  });

  it('the free radar is a real radar, usable from the arsenal', () => {
    const state = startMatch({ mode: 'advanced', captainB: 'oldCaptain', first: P0 });
    const sunk = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 3 } });
    const theirs = { ...sunk.state, turn: P1 };
    const used = reduce(theirs, {
      type: 'USE_ARSENAL',
      playerId: P1,
      itemId: 'radar-free-1',
      at: { r: 5, c: 5 },
    });
    expect(types(used.events)).toEqual(['ARSENAL_USED', 'RADAR_RESULT', 'TURN_CHANGED']);
    expect(used.state.players[1].board.arsenal[0]?.used).toBe(true);
  });

  it('without the Old Captain, no radar is handed over', () => {
    const state = startMatch({ mode: 'advanced', first: P0 });
    const sunk = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 3 } });
    expect(types(sunk.events)).toEqual(['HIT', 'SUNK', 'AUTO_REVEAL']);
    expect(sunk.state.players[1].board.arsenal).toEqual([]);
  });
});

describe('Rosa, the Quartermaster — the differential test', () => {
  interface Run {
    readonly events: readonly { type: string }[];
    readonly fingerprint: string;
  }

  /** The same seeded AI-vs-AI game, with Rosa optionally on seat A. */
  function play(seed: number, rosa: boolean): Run {
    const rng = createRng(seed);
    let state = createMatch({ id: `rosa-${seed}`, mode: 'advanced', seed, playerIds: [P0, P1] });
    state = reduce(state, {
      type: 'SUBMIT_LAYOUT',
      playerId: P0,
      ships: LAYOUT_A,
      arsenal: [],
      ...(rosa ? { captainId: 'rosa' as const } : {}),
    }).state;
    state = reduce(state, {
      type: 'SUBMIT_LAYOUT',
      playerId: P1,
      ships: LAYOUT_B,
      arsenal: [],
    }).state;

    const events: { type: string }[] = [];
    let guard = 0;
    while (state.phase !== 'over' && guard++ < 400) {
      const actor = state.turn;
      const action = chooseMove(projectView(state, actor), 'normal', rng);
      const result = reduce(state, action);
      events.push(...result.events);
      state = result.state;
    }
    // Everything a captain could possibly touch, minus the captain fields.
    const fingerprint = JSON.stringify(
      state.players.map((player) => ({
        id: player.id,
        fuelSpent: player.fuelSpent,
        board: player.board,
      })),
    );
    return { events, fingerprint };
  }

  it('changes nothing inside the match: every event and every board identical', () => {
    for (const seed of [11, 29, 47]) {
      const without = play(seed, false);
      const withRosa = play(seed, true);
      expect(withRosa.events).toEqual(without.events);
      expect(withRosa.fingerprint).toEqual(without.fingerprint);
      expect(withRosa.events.some((e) => e.type === 'CAPTAIN_ABILITY')).toBe(false);
    }
  });

  it('is still a captain in the config and the view', () => {
    const state = startMatch({ mode: 'advanced', captainA: 'rosa', first: P0 });
    expect(state.players[0].captainId).toBe('rosa');
    expect(projectView(state, P1).enemy.captainId).toBe('rosa');
  });
});

describe('the reveal and the replay', () => {
  it('both players see each other’s captain, and only their own ability state', () => {
    const state = startMatch({ mode: 'advanced', captainA: 'ivo', captainB: 'tomas', first: P0 });
    const asA = projectView(state, P0);
    const asB = projectView(state, P1);
    expect(asA.you.captainId).toBe('ivo');
    expect(asA.enemy.captainId).toBe('tomas');
    expect(asB.you.captainId).toBe('tomas');
    expect(asB.enemy.captainId).toBe('ivo');
    // No captain in Classic — ever.
    const classic = startMatch({ first: P0 });
    expect(projectView(classic, P0).you.captainId).toBeNull();
    expect(projectView(classic, P0).enemy.captainId).toBeNull();
  });

  it('an ability event names its OWNER, even when the attacker rolled the dice', () => {
    const state = startMatch({ mode: 'advanced', captainB: 'oldCaptain', first: P0 });
    const sunk = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 0, c: 3 } });
    const ability = sunk.events.find((e) => e.type === 'CAPTAIN_ABILITY');
    expect(ability).toMatchObject({ playerId: P1, captainId: 'oldCaptain' });
  });

  it('a full scripted captain match replays to the same event list', () => {
    const script: MatchAction[] = [
      { type: 'FIRE', playerId: P0, at: { r: 0, c: 0 } }, // Berhan's miss, kept turn
      { type: 'FIRE', playerId: P0, at: { r: 0, c: 3 } }, // sinks the boat -> Old Captain
      { type: 'FIRE', playerId: P0, at: { r: 1, c: 0 } }, // plain miss -> turn passes
      { type: 'USE_ARSENAL', playerId: P1, itemId: 'radar-free-1', at: { r: 5, c: 5 } },
      { type: 'FIRE', playerId: P0, at: { r: 2, c: 3 } },
    ];
    const run = () => {
      let state = startMatch({
        mode: 'advanced',
        captainA: 'berhan',
        captainB: 'oldCaptain',
        seed: 9,
        first: P0,
      });
      const events: { type: string }[] = [];
      for (const action of script) {
        const result = reduce(state, action);
        if (result.events.some((e) => e.type === 'REJECTED')) {
          throw new Error(`rejected: ${JSON.stringify(result.events)}`);
        }
        events.push(...result.events);
        state = result.state;
      }
      return events;
    };
    const first = run();
    expect(first).toEqual(run());
    expect(first.filter((e) => e.type === 'CAPTAIN_ABILITY')).toHaveLength(2);
  });
});

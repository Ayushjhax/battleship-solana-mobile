/**
 * Harbour raids — part-06 §11, with every scenario from
 * docs/port-city/reference/test/raid.test.ts ported onto this engine.
 *
 * The reference models a 10-ship / 20-cell fleet. This game ships 8 ships and
 * 18 cells, so destruction denominators differ — see raid.ts's header and
 * the report. Behaviour is otherwise identical.
 */
import { describe, expect, it } from 'vitest';

import { coordKey } from '../../board';
import { FLEET_CELL_COUNT } from '../../fleet';
import { autoPlaceFleet } from '../../placement';
import { createRng } from '../../rng';
import type { ArsenalItem, Coord, Ship } from '../../types';
import {
  RAID_DEFAULTS,
  RAID_DESTRUCTION_DENOMINATOR,
  RAID_KIT_KINDS,
  abandonRaid,
  fireShell,
  kitLeft,
  raidScore,
  replayRaid,
  retreat,
  settleRaid,
  startRaid,
  useKit,
  validateKit,
  type HarbourLayout,
  type RaidState,
} from '../index';

const at = (r: number, c: number): Coord => ({ r, c });

/** A sparse legal fleet, so items can be placed anywhere in rows 5-9. */
function fleet(): Ship[] {
  const mk = (id: string, cls: Ship['class'], len: number, r: number, c: number): Ship => ({
    id,
    class: cls,
    len,
    origin: at(r, c),
    orientation: 'h',
    hits: [],
  });
  return [
    mk('battleship-1', 'battleship', 4, 0, 0),
    mk('destroyer-3', 'destroyer', 2, 0, 6),
    mk('cruiser-1', 'cruiser', 3, 2, 0),
    mk('boat-1', 'boat', 1, 2, 6),
    mk('cruiser-2', 'cruiser', 3, 4, 0),
    mk('boat-2', 'boat', 1, 4, 6),
    mk('destroyer-1', 'destroyer', 2, 6, 0),
    mk('destroyer-2', 'destroyer', 2, 8, 7),
  ];
}

const mine = (r: number, c: number): ArsenalItem => ({ id: `mine-${r}${c}`, kind: 'mine', at: at(r, c) });
const gun = (r: number, c: number): ArsenalItem => ({ id: `aaGun-${r}${c}`, kind: 'aaGun', at: at(r, c) });
const net = (r: number, c: number): ArsenalItem => ({ id: `sonar_net-${r}${c}`, kind: 'sonar_net', at: at(r, c) });
const decoy = (r: number, c: number): ArsenalItem => ({ id: `decoy-${r}${c}`, kind: 'decoy', at: at(r, c) });

function harbour(arsenal: ArsenalItem[] = []): HarbourLayout {
  return { ships: fleet(), arsenal };
}

/** Every cell of every ship, for "clear the harbour" tests. */
function allShipCells(): Coord[] {
  const cells: Coord[] = [];
  for (const ship of fleet()) {
    for (let i = 0; i < ship.len; i++) cells.push(at(ship.origin.r, ship.origin.c + i));
  }
  return cells;
}

// ===========================================================================
// The denominator (the finding in §0 of the plan)
// ===========================================================================

describe('the destruction denominator', () => {
  it('is the ENGINE fleet size, not the reference doc 20', () => {
    expect(RAID_DESTRUCTION_DENOMINATOR).toBe(FLEET_CELL_COUNT);
    expect(RAID_DESTRUCTION_DENOMINATOR).toBe(18);
  });

  it('lets a cleared harbour actually reach 100% and three stars', () => {
    // With a hardcoded 20 this would top out at 18/20 = 90% and the third
    // star would be unreachable forever.
    let state = startRaid(harbour(), {}, 0, { ...RAID_DEFAULTS, shells: 200 });
    for (const cell of allShipCells()) state = fireShell(state, cell).state;

    const score = raidScore(state);
    expect(score.destruction).toBe(1);
    expect(score.stars).toBe(3);
  });
});

// ===========================================================================
// Shells (§11)
// ===========================================================================

describe('shells', () => {
  it('a miss costs one shell', () => {
    const state = fireShell(startRaid(harbour()), at(9, 0)).state;
    expect(state.shells).toBe(RAID_DEFAULTS.shells - 1);
  });

  it('a hit hands the shell straight back', () => {
    const state = fireShell(startRaid(harbour()), at(0, 0)).state;
    expect(state.shells).toBe(RAID_DEFAULTS.shells);
  });

  it('sinking a ship also hands the shell back', () => {
    const out = fireShell(startRaid(harbour()), at(2, 6)); // boat-1, one cell
    expect(out.state.shells).toBe(RAID_DEFAULTS.shells);
    expect(out.events.some((e) => e.type === 'SUNK')).toBe(true);
  });

  it('destroying a defence also hands the shell back', () => {
    const out = fireShell(startRaid(harbour([gun(9, 0)])), at(9, 0));
    expect(out.state.shells).toBe(RAID_DEFAULTS.shells);
    expect(out.events.some((e) => e.type === 'ITEM_HIT')).toBe(true);
  });

  it('a mine costs the shell plus the penalty', () => {
    const state = fireShell(startRaid(harbour([mine(9, 0)])), at(9, 0)).state;
    expect(state.shells).toBe(RAID_DEFAULTS.shells - 1 - RAID_DEFAULTS.minePenalty);
  });

  it('a decoy refunds the shell — it is indistinguishable from a hit', () => {
    const out = fireShell(startRaid(harbour([decoy(8, 2)])), at(8, 2));
    expect(out.state.shells).toBe(RAID_DEFAULTS.shells);
    expect(out.shellDelta).toBe(0);
    expect(out.events.map((e) => e.type)).toEqual(['HIT']);
  });

  it('and then eats the shells spent around it', () => {
    let state = startRaid(harbour([decoy(8, 2)]));
    state = fireShell(state, at(8, 2)).state; // free
    for (const cell of [at(7, 1), at(7, 2), at(7, 3), at(8, 1)]) {
      state = fireShell(state, cell).state; // four misses
    }
    expect(state.shells).toBe(RAID_DEFAULTS.shells - 4);
  });

  it('refuses a cell that was already resolved, and charges nothing', () => {
    const state = fireShell(startRaid(harbour()), at(9, 0)).state;
    const before = state.shells;
    const again = fireShell(state, at(9, 0));
    expect(again.error).toBe('illegal-cell');
    expect(again.state.shells).toBe(before);
  });

  it('refuses a cell off the grid', () => {
    expect(fireShell(startRaid(harbour()), at(-1, 0)).error).toBe('illegal-cell');
    expect(fireShell(startRaid(harbour()), at(0, 10)).error).toBe('illegal-cell');
  });

  it('kit items cost no shells but a mine in the footprint still bites', () => {
    const state = startRaid(harbour([mine(5, 5)]), { atomicBomber: 1 });
    const out = useKit(state, 'atomicBomber', { at: at(5, 5) });
    expect(out.state.shells).toBe(RAID_DEFAULTS.shells - RAID_DEFAULTS.minePenalty);
    expect(out.state.kit.atomicBomber).toBe(0);
  });

  it('a kit item that finds no mine costs nothing at all', () => {
    const out = useKit(startRaid(harbour(), { bomber: 1 }), 'bomber', { at: at(5, 5) });
    expect(out.state.shells).toBe(RAID_DEFAULTS.shells);
  });

  it('an intercepted plane is still spent', () => {
    const state = startRaid(harbour([gun(3, 5)]), { torpedoBomber: 1 });
    const out = useKit(state, 'torpedoBomber', { row: 3 });
    expect(out.events.some((e) => e.type === 'AIRCRAFT_DOWNED')).toBe(true);
    expect(out.state.kit.torpedoBomber).toBe(0);
  });

  it('a sonar net eats a submarine and reveals itself', () => {
    const state = startRaid(harbour([net(9, 6)]), { submarine: 1 });
    const out = useKit(state, 'submarine', { at: at(7, 6) });
    expect(out.events.some((e) => e.type === 'SUBMARINE_DETECTED')).toBe(true);
    const revealed = out.state.arsenal.find((i) => i.kind === 'sonar_net');
    expect(revealed?.revealed).toBe(true);
  });

  it('refuses a weapon that is not in the kit', () => {
    expect(useKit(startRaid(harbour()), 'bomber', { at: at(5, 5) }).error).toBe('no-item');
  });

  it('refuses a defence as a kit weapon', () => {
    const out = useKit(startRaid(harbour(), { mine: 1 }), 'mine', { at: at(5, 5) });
    expect(out.error).toBe('not-in-kit');
  });

  it('allows radar, which §4 names even though its spec says "own board"', () => {
    // Regression: deriving the kit from spec.placement drops radar silently.
    expect(RAID_KIT_KINDS).toContain('radar');
    const out = useKit(startRaid(harbour(), { radar: 1 }), 'radar', { at: at(1, 1) });
    expect(out.error).toBeUndefined();
    expect(out.events.some((e) => e.type === 'RADAR_RESULT')).toBe(true);
    expect(out.state.shells).toBe(RAID_DEFAULTS.shells); // reads cost no shells
  });

  it('radar counts ship cells and never a decoy', () => {
    const withDecoy = startRaid(harbour([decoy(8, 2)]), { radar: 2 });
    const overDecoy = useKit(withDecoy, 'radar', { at: at(8, 2) });
    const hit = overDecoy.events.find((e) => e.type === 'RADAR_RESULT');
    expect(hit && 'count' in hit ? hit.count : -1).toBe(0);
  });

  it('a kit is legal only if every kind in it is a raid kit kind', () => {
    const context = { armoryLevel: 5, unlocks: ['sonar_net', 'decoy', 'minesweeper'] };
    expect(validateKit({ radar: 1 }, context).ok).toBe(true);
    expect(validateKit({ bomber: 1 }, context).ok).toBe(true);
    const bad = validateKit({ mine: 1 }, context);
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.error).toBe('not-offensive');
  });
});

// ===========================================================================
// Stars (§11)
// ===========================================================================

describe('stars', () => {
  it('no stars for an empty raid', () => {
    expect(raidScore(startRaid(harbour())).stars).toBe(0);
  });

  it('sinking the battleship alone is one star', () => {
    let state = startRaid(harbour());
    for (let c = 0; c < 4; c++) state = fireShell(state, at(0, c)).state;
    const score = raidScore(state);
    expect(score.battleshipSunk).toBe(true);
    expect(score.stars).toBe(1);
    // 4 of 18 cells.
    expect(score.destruction).toBeCloseTo(4 / 18, 6);
  });

  it('half the tonnage without the battleship is also one star', () => {
    let state = startRaid(harbour());
    // 9 cells of 18, avoiding the battleship entirely.
    const cells = [
      at(2, 0), at(2, 1), at(2, 2), // cruiser-1
      at(4, 0), at(4, 1), at(4, 2), // cruiser-2
      at(6, 0), at(6, 1), // destroyer-1
      at(2, 6), // boat-1
    ];
    for (const cell of cells) state = fireShell(state, cell).state;
    const score = raidScore(state);
    expect(score.battleshipSunk).toBe(false);
    expect(score.destruction).toBeGreaterThanOrEqual(0.5);
    expect(score.stars).toBe(1);
  });

  it('the battleship plus half is two stars', () => {
    let state = startRaid(harbour(), {}, 0, { ...RAID_DEFAULTS, shells: 200 });
    for (const cell of [at(0, 0), at(0, 1), at(0, 2), at(0, 3), at(2, 0), at(2, 1), at(2, 2), at(4, 0), at(4, 1), at(4, 2)]) {
      state = fireShell(state, cell).state;
    }
    const score = raidScore(state);
    expect(score.battleshipSunk).toBe(true);
    expect(score.destruction).toBeGreaterThanOrEqual(0.5);
    expect(score.stars).toBe(2);
  });

  it('clearing the harbour is three stars and ends the raid as cleared', () => {
    let state = startRaid(harbour(), {}, 0, { ...RAID_DEFAULTS, shells: 200 });
    for (const cell of allShipCells()) state = fireShell(state, cell).state;
    expect(raidScore(state).stars).toBe(3);
    expect(state.over).toBe(true);
    expect(state.endReason).toBe('cleared');
  });
});

// ===========================================================================
// Ends (§11)
// ===========================================================================

describe('ends', () => {
  it('runs out when the shells are gone and no kit is left', () => {
    let state = startRaid(harbour(), {}, 0, { ...RAID_DEFAULTS, shells: 3 });
    for (const cell of [at(9, 0), at(9, 2), at(9, 4)]) state = fireShell(state, cell).state;
    expect(state.shells).toBe(0);
    expect(state.over).toBe(true);
    expect(state.endReason).toBe('out_of_shells');
  });

  it('keeps going on zero shells while a kit item is left', () => {
    let state = startRaid(harbour(), { bomber: 1 }, 0, { ...RAID_DEFAULTS, shells: 2 });
    state = fireShell(state, at(9, 0)).state;
    state = fireShell(state, at(9, 2)).state;
    expect(state.shells).toBe(0);
    expect(state.over).toBe(false); // the bomber keeps it alive

    state = useKit(state, 'bomber', { at: at(5, 5) }).state;
    expect(kitLeft(state)).toBe(0);
    expect(state.over).toBe(true);
    expect(state.endReason).toBe('out_of_shells');
  });

  it('stops at the time limit', () => {
    const state = fireShell(startRaid(harbour(), {}, 0), at(9, 0), RAID_DEFAULTS.timeLimitMs).state;
    expect(state.over).toBe(true);
    expect(state.endReason).toBe('time');
  });

  it('retreat is final', () => {
    const state = retreat(startRaid(harbour()), 10);
    expect(state.over).toBe(true);
    expect(state.endReason).toBe('retreat');
    expect(fireShell(state, at(9, 0)).error).toBe('raid-over');
  });

  it('a disconnect SETTLES with what it had, never voids', () => {
    let state = startRaid(harbour());
    for (let c = 0; c < 4; c++) state = fireShell(state, at(0, c)).state;

    const settled = settleRaid(abandonRaid(state));
    expect(settled.endReason).toBe('disconnect');
    expect(settled.stars).toBe(1); // the battleship it did sink still counts
    expect(settled.battleshipSunk).toBe(true);
  });

  it('settling an already-ended raid keeps its reason', () => {
    const state = retreat(startRaid(harbour()), 5);
    expect(settleRaid(state, 9).endReason).toBe('retreat');
  });
});

// ===========================================================================
// Replay (§8, §11)
// ===========================================================================

describe('replay', () => {
  it('logs every action', () => {
    let state = startRaid(harbour(), { radar: 1 });
    state = fireShell(state, at(9, 0), 1).state;
    state = useKit(state, 'radar', { at: at(5, 5) }, 2).state;
    state = retreat(state, 3);
    expect(state.log).toHaveLength(3);
    expect(state.log.map((e) => e.action.kind)).toEqual(['fire', 'use', 'retreat']);
  });

  it('re-running the stored actions reproduces stars, destruction and marks exactly', () => {
    const layout = harbour([mine(9, 0), gun(3, 5), decoy(8, 2)]);
    const kit = { bomber: 1, torpedoBomber: 1 };

    let live = startRaid(layout, kit);
    const script = [
      { kind: 'fire' as const, at: at(0, 0) },
      { kind: 'fire' as const, at: at(9, 0) },
      { kind: 'use' as const, weapon: 'bomber' as const, at: at(2, 0) },
      { kind: 'fire' as const, at: at(8, 2) },
      { kind: 'use' as const, weapon: 'torpedoBomber' as const, row: 3 },
      { kind: 'fire' as const, at: at(4, 0) },
    ];
    for (const action of script) {
      if (action.kind === 'fire') live = fireShell(live, action.at).state;
      else live = useKit(live, action.weapon, { ...(action.at ? { at: action.at } : {}), ...(action.row !== undefined ? { row: action.row } : {}) }).state;
    }

    const replayed = replayRaid(layout, kit, script);

    expect(raidScore(replayed)).toEqual(raidScore(live));
    expect(replayed.marks).toEqual(live.marks);
    expect(replayed.shells).toBe(live.shells);
    expect(replayed.over).toBe(live.over);
  });

  it('a replay of an empty script is just the start state', () => {
    const layout = harbour();
    const replayed = replayRaid(layout, {}, []);
    expect(replayed.shells).toBe(RAID_DEFAULTS.shells);
    expect(raidScore(replayed).stars).toBe(0);
  });
});

// ===========================================================================
// Config
// ===========================================================================

describe('configuration', () => {
  it('the shell budget is server-configurable (raid.shells) and defaults to 30', () => {
    expect(RAID_DEFAULTS.shells).toBe(30);
    expect(startRaid(harbour(), {}, 0, { ...RAID_DEFAULTS, shells: 45 }).shells).toBe(45);
  });

  it('the mine penalty and clock come from config too', () => {
    expect(RAID_DEFAULTS.minePenalty).toBe(2);
    expect(RAID_DEFAULTS.timeLimitMs).toBe(240_000);

    const state = fireShell(
      startRaid(harbour([mine(9, 0)]), {}, 0, { ...RAID_DEFAULTS, minePenalty: 5 }),
      at(9, 0),
    ).state;
    expect(state.shells).toBe(RAID_DEFAULTS.shells - 6);
  });
});

// ===========================================================================
// Determinism — a raid never mutates its input
// ===========================================================================

describe('purity', () => {
  it('does not mutate the state it is given', () => {
    const state: RaidState = startRaid(harbour([mine(9, 0)]), { bomber: 1 });
    const snapshot = JSON.stringify(state);
    fireShell(state, at(0, 0));
    useKit(state, 'bomber', { at: at(5, 5) });
    retreat(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('a generated fleet clears to exactly 100%', () => {
    // Guards the denominator against any future fleet change.
    const ships = autoPlaceFleet(createRng(7));
    let state = startRaid({ ships, arsenal: [] }, {}, 0, { ...RAID_DEFAULTS, shells: 400 });
    for (const ship of ships) {
      for (let i = 0; i < ship.len; i++) {
        const cell =
          ship.orientation === 'h'
            ? at(ship.origin.r, ship.origin.c + i)
            : at(ship.origin.r + i, ship.origin.c);
        if (state.marks[coordKey(cell)] === undefined) state = fireShell(state, cell).state;
      }
    }
    expect(raidScore(state).destruction).toBe(1);
  });
});

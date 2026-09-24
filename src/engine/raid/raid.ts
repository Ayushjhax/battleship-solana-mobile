/**
 * The raid rules — part-06 §1, §2, §6.
 *
 * Every resolution goes through the match engine's own `resolveCell` and the
 * arsenal resolvers, so interception, the decoy's silence and the halo reveal
 * all behave in a raid exactly as they do in a match. What a raid changes is
 * only the CURRENCY: shells instead of turns.
 *
 * THE DESTRUCTION DENOMINATOR. part-06 §2 says "enemy ship cells hit / 20",
 * and reference/src/grid.ts agrees (FLEET_CELLS = 20, four single-cell boats).
 * This game ships an 8-ship, 18-cell fleet (src/engine/fleet.ts: "the classic
 * ten-ship fleet minus two of the four one-cell boats"). Hard-coding 20 here
 * would cap destruction at 18/20 = 90% and make the third star UNREACHABLE.
 * So the denominator is imported, never inlined, and a test pins it.
 */
import { atomicBomber, bomber, doubleTorpedoBomber, minesweeper, radar, specFor, submarine, torpedoBomber } from '../arsenal';
import { coordKey, inBounds } from '../board';
import { FLEET_CELL_COUNT, isSunk } from '../fleet';
import { createMatch, reduce } from '../match';
import { openBoard, resolveCell, sealBoard } from '../shots';
import { WATER, isIsland } from '../terrain';
import type { ArsenalKind, Coord, MatchEvent, MatchState, Ship } from '../types';
import {
  RAID_DEFAULTS,
  isRaidKitKind,
  type HarbourLayout,
  type KitCounts,
  type RaidAction,
  type RaidConfig,
  type RaidEnd,
  type RaidError,
  type RaidLogEntry,
  type RaidScore,
  type RaidState,
  type RaidStepResult,
} from './types';

/** The fleet's total cells — 18 in this game, not the reference's 20. */
export const RAID_DESTRUCTION_DENOMINATOR = FLEET_CELL_COUNT;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function startRaid(
  layout: HarbourLayout,
  kit: KitCounts = {},
  startedAt = 0,
  config: RaidConfig = RAID_DEFAULTS,
): RaidState {
  return {
    layout,
    ships: layout.ships.map((s) => ({ ...s, hits: [] })),
    arsenal: layout.arsenal.map((i) => ({ id: i.id, kind: i.kind, ...(i.at ? { at: i.at } : {}) })),
    marks: {},
    terrain: config.terrain ?? WATER,
    shells: config.shells,
    kit: { ...kit },
    config,
    startedAt,
    over: false,
    log: [],
    spent: [],
  };
}

export function kitLeft(state: RaidState): number {
  return Object.values(state.kit).reduce((n: number, v) => n + (v ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function raidScore(state: RaidState): RaidScore {
  let cellsHit = 0;
  for (const ship of state.ships) cellsHit += ship.hits.length;

  const destruction = cellsHit / RAID_DESTRUCTION_DENOMINATOR;
  const battleship = state.ships.find((s) => s.class === 'battleship');
  const battleshipSunk = battleship !== undefined && isSunk(battleship);

  const stars = ((battleshipSunk ? 1 : 0) +
    (destruction >= 0.5 ? 1 : 0) +
    (destruction >= 1 ? 1 : 0)) as 0 | 1 | 2 | 3;

  return {
    cellsHit,
    destruction,
    battleshipSunk,
    stars,
    shipsSunk: state.ships.filter(isSunk).length,
  };
}

// ---------------------------------------------------------------------------
// Ending
// ---------------------------------------------------------------------------

function ended(state: RaidState, reason: RaidEnd): RaidState {
  if (state.over) return state;
  return { ...state, over: true, endReason: reason };
}

/** §6's end conditions, checked after every action. */
function maybeEnd(state: RaidState, now: number): RaidState {
  if (state.over) return state;
  if (state.ships.length > 0 && state.ships.every(isSunk)) return ended(state, 'cleared');
  if (now - state.startedAt >= state.config.timeLimitMs) return ended(state, 'time');
  // Shells AND kit must both be gone: a bomber keeps a 0-shell raid alive.
  if (state.shells <= 0 && kitLeft(state) === 0) return ended(state, 'out_of_shells');
  return state;
}

export function retreat(state: RaidState, now = 0): RaidState {
  const next = ended(state, 'retreat');
  return { ...next, log: [...next.log, logEntry(now, { kind: 'retreat' }, next.shells, 0)] };
}

/** Disconnect settles with whatever was earned — never "no result" (§6). */
export function abandonRaid(state: RaidState): RaidState {
  return ended(state, 'disconnect');
}

function logEntry(t: number, action: RaidAction, shells: number, shellDelta: number): RaidLogEntry {
  return { t, action, shells, shellDelta };
}

// ---------------------------------------------------------------------------
// The board <-> MatchState bridge
//
// The arsenal resolvers take a MatchState because that is what a match has.
// A raid has one board, so it borrows a two-seat MatchState whose defender is
// the harbour. This is a shim, not a model: nothing outside this file sees it.
// ---------------------------------------------------------------------------

const RAIDER = 'raider';
const HARBOUR = 'harbour';

function asMatchState(state: RaidState): MatchState {
  const base = createMatch({
    id: 'raid',
    mode: 'advanced',
    seed: 1,
    playerIds: [RAIDER, HARBOUR],
    terrain: state.terrain,
  });
  return {
    ...base,
    phase: 'playing',
    turn: RAIDER,
    players: [
      base.players[0],
      {
        ...base.players[1],
        board: { ships: state.ships, arsenal: state.arsenal, marks: state.marks },
        ready: true,
      },
    ],
  };
}

function fromMatchState(state: RaidState, match: MatchState): RaidState {
  const board = match.players[1].board;
  return { ...state, ships: board.ships, arsenal: board.arsenal, marks: board.marks };
}

// ---------------------------------------------------------------------------
// fire
// ---------------------------------------------------------------------------

function fail(state: RaidState, error: RaidError): RaidStepResult {
  return { state, error, shellDelta: 0, events: [] };
}

/**
 * One shell at one cell. §11's table:
 *   miss -1 | hit 0 | sunk 0 | decoy hit 0 | item destroyed 0 | mine -1-penalty
 * An illegal cell is refused and costs NOTHING.
 */
export function fireShell(state: RaidState, at: Coord, now = 0): RaidStepResult {
  if (state.over) return fail(state, 'raid-over');
  if (state.shells <= 0) return fail(state, 'no-shells');
  if (!inBounds(at)) return fail(state, 'illegal-cell');
  // Part 10B — an island is never a legal target, and a refused shot costs
  // nothing (same as an already-shot cell).
  if (isIsland(state.terrain, at)) return fail(state, 'illegal-cell');
  if (state.marks[coordKey(at)] !== undefined) return fail(state, 'illegal-cell');

  const wb = openBoard(
    { ships: state.ships, arsenal: state.arsenal, marks: state.marks },
    { terrain: state.terrain },
  );
  const outcome = resolveCell(wb, RAIDER, at);
  const sealed = sealBoard(wb);

  // A decoy returns { hit: true } and is indistinguishable from a real hit —
  // which is exactly right: the shell comes back either way (Part 5).
  const shellDelta = outcome.mine ? -1 - state.config.minePenalty : outcome.hit ? 0 : -1;

  let next: RaidState = {
    ...state,
    ships: sealed.ships,
    arsenal: sealed.arsenal,
    marks: sealed.marks,
    shells: Math.max(0, state.shells + shellDelta),
  };
  next = { ...next, log: [...next.log, logEntry(now, { kind: 'fire', at }, next.shells, shellDelta)] };
  next = maybeEnd(next, now);

  return { state: next, shellDelta, events: outcome.events };
}

// ---------------------------------------------------------------------------
// use (kit)
// ---------------------------------------------------------------------------

/**
 * A kit item costs NO shell — it was paid for in raid fuel before the raid —
 * but a mine caught in its footprint still charges the penalty (§1, §11).
 *
 * Interception is the match's: an AA gun downs an aircraft and a sonar net
 * eats a submarine, and either reveals the defence for the rest of the raid
 * (§4). The weapon is spent whatever happened.
 */
export function useKit(
  state: RaidState,
  weapon: ArsenalKind,
  target: { at?: Coord; row?: number },
  now = 0,
): RaidStepResult {
  if (state.over) return fail(state, 'raid-over');
  if ((state.kit[weapon] ?? 0) <= 0) return fail(state, 'no-item');

  const spec = specFor(weapon);
  if (!isRaidKitKind(weapon)) return fail(state, 'not-in-kit');
  if (spec.target === 'cell' && (!target.at || !inBounds(target.at))) return fail(state, 'bad-target');
  if (spec.target === 'row' && (target.row === undefined || target.row < 0 || target.row > 9)) {
    return fail(state, 'bad-target');
  }

  const match = asMatchState(state);
  const outcome = (() => {
    switch (weapon) {
      case 'torpedoBomber':
        return torpedoBomber(match, RAIDER, target.row);
      case 'doubleTorpedoBomber':
        return doubleTorpedoBomber(match, RAIDER, target.row);
      case 'bomber':
        return bomber(match, RAIDER, target.at);
      case 'atomicBomber':
        return atomicBomber(match, RAIDER, target.at);
      case 'submarine':
        return submarine(match, RAIDER, target.at);
      case 'radar':
        return radar(match, RAIDER, target.at);
      case 'minesweeper':
        return minesweeper(match, RAIDER, target.row);
      default:
        return null;
    }
  })();

  if (!outcome) return fail(state, 'not-in-kit');
  if (outcome.rejected) return fail(state, 'bad-target');

  const mineTriggered = outcome.events.some((e) => e.type === 'MINE_TRIGGERED');
  const shellDelta = mineTriggered ? -state.config.minePenalty : 0;

  let next = fromMatchState(state, outcome.state);
  next = {
    ...next,
    kit: { ...next.kit, [weapon]: (next.kit[weapon] ?? 0) - 1 },
    shells: Math.max(0, next.shells + shellDelta),
    spent: [...next.spent, `${weapon}-${next.spent.length + 1}`],
  };
  next = {
    ...next,
    log: [
      ...next.log,
      logEntry(
        now,
        { kind: 'use', weapon, ...(target.at ? { at: target.at } : {}), ...(target.row !== undefined ? { row: target.row } : {}) },
        next.shells,
        shellDelta,
      ),
    ],
  };
  next = maybeEnd(next, now);

  return { state: next, shellDelta, events: outcome.events };
}

// ---------------------------------------------------------------------------
// settle + replay
// ---------------------------------------------------------------------------

export interface RaidSettlement extends RaidScore {
  readonly endReason: RaidEnd;
  readonly shellsLeft: number;
}

/** Closes a raid that is still running (the clock, or a disconnect). */
export function settleRaid(state: RaidState, now = 0, reason?: RaidEnd): RaidSettlement {
  const closed = state.over ? state : ended(maybeEnd(state, now), reason ?? 'time');
  return {
    ...raidScore(closed),
    endReason: closed.endReason ?? 'time',
    shellsLeft: closed.shells,
  };
}

/**
 * §8 — the replay is produced by RE-RUNNING the engine over the stored
 * actions, not by storing rendered frames. Same snapshot, same actions, same
 * config in, identical stars/destruction/marks out.
 */
export function replayRaid(
  layout: HarbourLayout,
  kit: KitCounts,
  actions: readonly RaidAction[],
  config: RaidConfig = RAID_DEFAULTS,
  startedAt = 0,
): RaidState {
  let state = startRaid(layout, kit, startedAt, config);
  for (const action of actions) {
    if (state.over) break;
    if (action.kind === 'fire') state = fireShell(state, action.at, startedAt).state;
    else if (action.kind === 'use') {
      state = useKit(
        state,
        action.weapon,
        { ...(action.at ? { at: action.at } : {}), ...(action.row !== undefined ? { row: action.row } : {}) },
        startedAt,
      ).state;
    } else state = retreat(state, startedAt);
  }
  return state;
}

export { reduce as __reduceUnused };
export type { Ship, MatchEvent };

/**
 * The reducer and the masking function — docs/brief.md 3.3 and 4.1.
 *
 * reduce() is pure and never mutates. It checks that the actor is the current
 * player and that the phase allows the action; anything else comes back as a
 * REJECTED event with the state untouched.
 *
 * projectView() is the entire anti-cheat story: a player gets their own board
 * in full and, of the enemy, ONLY what the rules have made public.
 *
 * Where the brief is silent:
 *   - A layout may be re-submitted while the match is still 'placing'; the
 *     match starts the moment both players are ready.
 *   - A real action (FIRE / USE_ARSENAL) resets the actor's timeout streak.
 *   - RESIGN is accepted from either player at any time before 'over'.
 *   - TIMEOUT is only meaningful for the current player.
 *   - Own-board items (AA gun, mine) cannot be "used"; radar can, on the
 *     enemy board.
 */
import { cellsOf, coordKey } from './board';
import {
  ARSENAL_SPEC,
  atomicBomber,
  bomber,
  doubleTorpedoBomber,
  isOwnBoardKind,
  minesweeper,
  radar,
  specFor,
  submarine,
  torpedoBomber,
  type ArsenalOutcome,
} from './arsenal';
import { abilityFor, captainFuel, isCaptainId } from './captains';
import { allSunk, isSunk, validateFleetComposition } from './fleet';
import { validateArsenalPlacement, validateLayout } from './placement';
import { createRng } from './rng';
import { resolveShot } from './shots';
import { WATER } from './terrain';
import {
  FUEL_BUDGET,
  MAX_CONSECUTIVE_TIMEOUTS,
  isAcademyKind,
  type ArsenalItem,
  type Board,
  type CaptainId,
  type Coord,
  type GameOverReason,
  type MatchAction,
  type MatchEvent,
  type MatchMode,
  type MatchState,
  type PlayerState,
  type PlayerView,
  type RevealedItemView,
  type Ship,
  type SunkShipView,
} from './types';
import type { Terrain } from './terrain';

export interface ReduceResult {
  readonly state: MatchState;
  readonly events: readonly MatchEvent[];
}

export interface CreateMatchOptions {
  readonly id: string;
  readonly mode: MatchMode;
  readonly seed: number;
  readonly playerIds: readonly [string, string];
  /** Part 10B — the sea. Ignored in Classic, which is always Open Sea. */
  readonly terrain?: Terrain;
}

function emptyPlayer(id: string): PlayerState {
  return {
    id,
    board: { ships: [], arsenal: [], marks: {} },
    fuelSpent: 0,
    consecutiveTimeouts: 0,
    ready: false,
    captainId: null,
    captainUsed: false,
  };
}

export function createMatch(options: CreateMatchOptions): MatchState {
  const [a, b] = options.playerIds;
  if (a === b) throw new Error('players must have distinct ids');
  return {
    id: options.id,
    mode: options.mode,
    seed: options.seed,
    phase: 'placing',
    players: [emptyPlayer(a), emptyPlayer(b)],
    // Placeholder until both layouts are in; the coin flip happens then.
    turn: a,
    winner: null,
    moves: 0,
    // Classic is Open Sea only, forever: a terrain handed to a Classic match
    // is ignored rather than rejected, so no caller can leak a sea into it.
    terrain: options.mode === 'classic' ? WATER : (options.terrain ?? WATER),
  };
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

export function playerIndex(state: MatchState, playerId: string): 0 | 1 | -1 {
  if (state.players[0].id === playerId) return 0;
  if (state.players[1].id === playerId) return 1;
  return -1;
}

export function opponentOf(state: MatchState, playerId: string): string {
  return state.players[0].id === playerId ? state.players[1].id : state.players[0].id;
}

function withPlayer(state: MatchState, index: 0 | 1, patch: Partial<PlayerState>): MatchState {
  const updated = { ...state.players[index], ...patch };
  const players: [PlayerState, PlayerState] =
    index === 0 ? [updated, state.players[1]] : [state.players[0], updated];
  return { ...state, players };
}

function reject(state: MatchState, playerId: string, reason: string): ReduceResult {
  return { state, events: [{ type: 'REJECTED', playerId, reason }] };
}

function gameOver(state: MatchState, winner: string, reason: GameOverReason): ReduceResult {
  return {
    state: { ...state, phase: 'over', winner },
    events: [{ type: 'GAME_OVER', winner, reason }],
  };
}

/** docs/brief.md 3.3 — first turn is a coin flip from the match seed. */
export function firstTurn(state: MatchState): string {
  return createRng(state.seed).int(2) === 0 ? state.players[0].id : state.players[1].id;
}

// ---------------------------------------------------------------------------
// SUBMIT_LAYOUT
// ---------------------------------------------------------------------------

export type LayoutCheck = { ok: true; fuel: number } | { ok: false; reason: string };

/**
 * The whole submission: fleet composition, placements, arsenal, captain and
 * budget.
 *
 * `unlocks` is Part 5's Naval Academy gate. Undefined means "no gate" — every
 * caller that does not know about research (offline play before the Academy
 * exists, and every existing test) behaves exactly as before. When it IS
 * given, an Academy item the player has not researched is a REJECTED layout,
 * never a silent drop (part-05 §5).
 *
 * `captainId` is Part 10A. The captain is priced in fuel out of the SAME 260,
 * so the ceiling check below is unchanged; Classic refuses any captain, and
 * an id that is not on the roster is a rejection rather than a dropped field.
 */
export function validateSubmission(
  mode: MatchMode,
  ships: readonly Ship[],
  arsenal: readonly ArsenalItem[],
  unlocks?: readonly string[],
  captainId?: CaptainId | null,
  terrain: Terrain = WATER,
): LayoutCheck {
  const composition = validateFleetComposition(ships);
  if (!composition.ok) return composition;
  const layout = validateLayout(ships, terrain);
  if (!layout.ok) return layout;

  const captain = captainId ?? null;

  if (mode === 'classic') {
    if (arsenal.length > 0) return { ok: false, reason: 'classic mode has no arsenal' };
    if (captain !== null) return { ok: false, reason: 'classic mode has no captains' };
    return { ok: true, fuel: 0 };
  }

  if (captain !== null && !isCaptainId(captain)) {
    return { ok: false, reason: `unknown captain ${String(captain)}` };
  }

  const ids = new Set<string>();
  let fuel = 0;
  const board: Board = { ships, arsenal: [], marks: {} };
  const placed: ArsenalItem[] = [];
  for (const item of arsenal) {
    if (ids.has(item.id)) return { ok: false, reason: `duplicate item id ${item.id}` };
    ids.add(item.id);
    if (!ARSENAL_SPEC.some((e) => e.kind === item.kind)) {
      return { ok: false, reason: `unknown arsenal kind ${String(item.kind)}` };
    }
    if (unlocks !== undefined && isAcademyKind(item.kind) && !unlocks.includes(item.kind)) {
      return { ok: false, reason: `${item.kind} has not been researched` };
    }
    const spec = specFor(item.kind);
    const count = arsenal.filter((i) => i.kind === item.kind).length;
    if (count > spec.max) return { ok: false, reason: `too many ${item.kind}: max ${spec.max}` };
    fuel += spec.cost;

    if (isOwnBoardKind(item.kind)) {
      const check = validateArsenalPlacement({ ...board, arsenal: placed }, item, terrain);
      if (!check.ok) return { ok: false, reason: `${item.id}: ${check.reason}` };
      placed.push(item);
    } else if (item.at !== undefined) {
      return { ok: false, reason: `${item.id}: offensive items are not placed on the board` };
    }
  }
  fuel += captainFuel(captain);
  if (fuel > FUEL_BUDGET) return { ok: false, reason: `over budget: ${fuel} > ${FUEL_BUDGET}` };
  return { ok: true, fuel };
}

function submitLayout(
  state: MatchState,
  playerId: string,
  ships: readonly Ship[],
  arsenal: readonly ArsenalItem[],
  captainId?: CaptainId | null,
): ReduceResult {
  if (state.phase !== 'placing') return reject(state, playerId, 'layouts are closed');
  const index = playerIndex(state, playerId);
  if (index === -1) return reject(state, playerId, 'unknown player');

  const check = validateSubmission(
    state.mode,
    ships,
    arsenal,
    undefined,
    captainId,
    state.terrain,
  );
  if (!check.ok) return reject(state, playerId, check.reason);

  const board: Board = {
    ships: ships.map((s) => ({ ...s, hits: [] })),
    arsenal: arsenal.map((i) => ({ id: i.id, kind: i.kind, ...(i.at ? { at: i.at } : {}) })),
    marks: {},
  };
  let next = withPlayer(state, index, {
    board,
    fuelSpent: check.fuel,
    ready: true,
    captainId: captainId ?? null,
  });
  const events: MatchEvent[] = [{ type: 'LAYOUT_ACCEPTED', playerId }];

  if (next.players[0].ready && next.players[1].ready) {
    const turn = firstTurn(next);
    next = { ...next, phase: 'playing', turn };
    events.push({ type: 'MATCH_STARTED', turn });

    // Part 10A — Ivo's onMatchStart, now that BOTH boards are final. Counts
    // only, never cells, and one event per owner at most.
    for (const i of [0, 1] as const) {
      const player = next.players[i];
      const ability = abilityFor(player.captainId);
      if (!ability?.onMatchStart || player.captainUsed) continue;
      const enemy = next.players[i === 0 ? 1 : 0];
      const fired = ability.onMatchStart({ owner: player.id, enemy: enemy.board });
      if (!fired) continue;
      next = withPlayer(next, i, { captainUsed: true });
      events.push(...fired.events);
    }
  }
  return { state: next, events };
}

// ---------------------------------------------------------------------------
// Turn bookkeeping shared by FIRE and USE_ARSENAL
// ---------------------------------------------------------------------------

function afterAttack(
  state: MatchState,
  attackerId: string,
  events: readonly MatchEvent[],
  keepsTurn: boolean,
): ReduceResult {
  const index = playerIndex(state, attackerId) as 0 | 1;
  let next = withPlayer(state, index, { consecutiveTimeouts: 0 });
  next = { ...next, moves: next.moves + 1 };
  const out: MatchEvent[] = [...events];

  const defender = next.players[index === 0 ? 1 : 0];
  if (allSunk(defender)) {
    const over = gameOver(next, attackerId, 'fleet');
    return { state: over.state, events: [...out, ...over.events] };
  }
  if (!keepsTurn) {
    const turn = opponentOf(next, attackerId);
    next = { ...next, turn };
    out.push({ type: 'TURN_CHANGED', turn });
  }
  return { state: next, events: out };
}

function requireTurn(state: MatchState, playerId: string): string | null {
  if (state.phase !== 'playing') return 'match is not in play';
  if (playerIndex(state, playerId) === -1) return 'unknown player';
  if (state.turn !== playerId) return 'not your turn';
  return null;
}

// ---------------------------------------------------------------------------
// USE_ARSENAL
// ---------------------------------------------------------------------------

function useArsenal(
  state: MatchState,
  playerId: string,
  itemId: string,
  at: Coord | undefined,
  row: number | undefined,
): ReduceResult {
  if (state.mode !== 'advanced') return reject(state, playerId, 'no arsenal in classic mode');
  const index = playerIndex(state, playerId) as 0 | 1;
  const me = state.players[index];
  const item = me.board.arsenal.find((i) => i.id === itemId);
  if (!item) return reject(state, playerId, `no item ${itemId}`);
  if (item.used || item.destroyed) return reject(state, playerId, `${item.kind} already spent`);
  // Passive own-board items work by themselves and can never be "used".
  // Part 5 adds two: the sonar net and the decoy.
  if (
    item.kind === 'aaGun' ||
    item.kind === 'mine' ||
    item.kind === 'sonar_net' ||
    item.kind === 'decoy'
  ) {
    return reject(state, playerId, `${item.kind} works on its own; it cannot be used`);
  }

  let outcome: ArsenalOutcome;
  switch (item.kind) {
    case 'torpedoBomber':
      outcome = torpedoBomber(state, playerId, row);
      break;
    case 'doubleTorpedoBomber':
      outcome = doubleTorpedoBomber(state, playerId, row);
      break;
    case 'bomber':
      outcome = bomber(state, playerId, at);
      break;
    case 'atomicBomber':
      outcome = atomicBomber(state, playerId, at);
      break;
    case 'submarine':
      outcome = submarine(state, playerId, at);
      break;
    case 'radar':
      outcome = radar(state, playerId, at);
      break;
    case 'minesweeper':
      outcome = minesweeper(state, playerId, row);
      break;
  }
  if (outcome.rejected) return reject(state, playerId, outcome.rejected);

  // The weapon is consumed whatever happened — including being shot down.
  const arsenal = me.board.arsenal.map((i) => (i.id === itemId ? { ...i, used: true } : i));
  const spent = withPlayer(outcome.state, index, {
    board: { ...outcome.state.players[index].board, arsenal },
  });
  const used: MatchEvent = {
    type: 'ARSENAL_USED',
    playerId,
    itemId,
    kind: item.kind,
    ...(at ? { at } : {}),
    ...(row !== undefined ? { row } : {}),
  };
  return afterAttack(spent, playerId, [used, ...outcome.events], outcome.keepsTurn);
}

// ---------------------------------------------------------------------------
// reduce
// ---------------------------------------------------------------------------

export function reduce(state: MatchState, action: MatchAction): ReduceResult {
  if (state.phase === 'over') return reject(state, action.playerId, 'match is over');

  switch (action.type) {
    case 'SUBMIT_LAYOUT':
      return submitLayout(state, action.playerId, action.ships, action.arsenal, action.captainId);

    case 'FIRE': {
      const problem = requireTurn(state, action.playerId);
      if (problem) return reject(state, action.playerId, problem);
      const shot = resolveShot(state, action.playerId, action.at);
      if (shot.rejected) return reject(state, action.playerId, shot.rejected);

      // Part 10A — Berhan's steady hand. The FIRST plain shot that MISSES does
      // not end the turn. A mine is not a miss, and arsenal fire never comes
      // through here. One event, one use, then the rule is normal again.
      let nextState = shot.state;
      let events: MatchEvent[] = [...shot.events];
      let keepsTurn = shot.keepsTurn;
      const index = playerIndex(state, action.playerId) as 0 | 1;
      const attacker = nextState.players[index];
      const missed = shot.events.some((event) => event.type === 'MISS');
      const ability = abilityFor(attacker.captainId);
      if (missed && ability?.onShotResolved && !attacker.captainUsed) {
        const fired = ability.onShotResolved({ owner: action.playerId, at: action.at, miss: true });
        if (fired) {
          nextState = withPlayer(nextState, index, { captainUsed: true });
          events = [...events, ...fired.events];
          keepsTurn = true;
        }
      }
      return afterAttack(nextState, action.playerId, events, keepsTurn);
    }

    case 'USE_ARSENAL': {
      const problem = requireTurn(state, action.playerId);
      if (problem) return reject(state, action.playerId, problem);
      return useArsenal(state, action.playerId, action.itemId, action.at, action.row);
    }

    case 'TIMEOUT': {
      const problem = requireTurn(state, action.playerId);
      if (problem) return reject(state, action.playerId, problem);
      const index = playerIndex(state, action.playerId) as 0 | 1;
      const consecutive = state.players[index].consecutiveTimeouts + 1;
      const next = withPlayer(state, index, { consecutiveTimeouts: consecutive });
      const events: MatchEvent[] = [{ type: 'TIMEOUT', playerId: action.playerId, consecutive }];
      if (consecutive >= MAX_CONSECUTIVE_TIMEOUTS) {
        const over = gameOver(next, opponentOf(next, action.playerId), 'forfeit');
        return { state: over.state, events: [...events, ...over.events] };
      }
      const turn = opponentOf(next, action.playerId);
      events.push({ type: 'TURN_CHANGED', turn });
      return { state: { ...next, turn }, events };
    }

    case 'RESIGN': {
      if (playerIndex(state, action.playerId) === -1)
        return reject(state, action.playerId, 'unknown player');
      const over = gameOver(state, opponentOf(state, action.playerId), 'resign');
      return {
        state: over.state,
        events: [{ type: 'RESIGNED', playerId: action.playerId }, ...over.events],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// projectView — THE MASKING FUNCTION
// ---------------------------------------------------------------------------

/**
 * Builds what `playerId` may know. The enemy's `ships` and `arsenal` arrays
 * never cross this boundary; only derived, already-public facts do:
 *   - marks: every mark on the enemy board was made by this player's shots
 *   - sunkShips: every cell of a sunk ship is already marked 'sunk'
 *   - revealedItems: guns that downed a plane, and items destroyed by fire
 *   - shipsRemaining: a count, shown on the HUD in the reference game
 */
export function projectView(state: MatchState, playerId: string): PlayerView {
  const index = playerIndex(state, playerId);
  if (index === -1) throw new Error(`player ${playerId} is not in match ${state.id}`);
  const you = state.players[index];
  const enemy = state.players[index === 0 ? 1 : 0];

  const sunkShips: SunkShipView[] = enemy.board.ships
    .filter(isSunk)
    .map((s) => ({ id: s.id, class: s.class, cells: cellsOf(s) }));

  const revealedItems: RevealedItemView[] = enemy.board.arsenal
    .filter((i) => i.at !== undefined && (i.revealed || i.destroyed))
    .map((i) => ({
      kind: i.kind,
      at: i.at as NonNullable<typeof i.at>,
      destroyed: i.destroyed === true,
      ...(i.damaged ? { damaged: true } : {}),
    }));

  return {
    matchId: state.id,
    mode: state.mode,
    phase: state.phase,
    turn: state.turn,
    winner: state.winner,
    moves: state.moves,
    terrain: state.terrain,
    you,
    enemy: {
      id: enemy.id,
      ready: enemy.ready,
      marks: { ...enemy.board.marks },
      sunkShips,
      shipsRemaining: enemy.board.ships.length - sunkShips.length,
      revealedItems,
      captainId: enemy.captainId,
      captainUsed: enemy.captainUsed,
    },
  };
}

/** Convenience for tests and the AI: is this cell still unknown to the attacker? */
export function isUnknown(view: PlayerView, r: number, c: number): boolean {
  return view.enemy.marks[coordKey({ r, c })] === undefined;
}

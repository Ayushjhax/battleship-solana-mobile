/**
 * The arsenal table and its resolvers — docs/brief.md 3.4.
 * Fuel budget is 260. Prices and caps below are the spec; do not tune them here.
 *
 * AIRCRAFT RULE: before resolving any bomber variant, scan the target row(s)
 * on the defender's board for an AA gun. If one is there: AIRCRAFT_DOWNED,
 * reveal the gun's cell, consume the weapon (the reducer does that), end the
 * turn and resolve nothing else.
 *
 * TURN EFFECT: any arsenal attack landing >= 1 hit keeps the turn; one that
 * hits nothing ends it.
 *
 * Where the brief is silent:
 *   - "Rows an aircraft crosses" are the rows of its footprint: the torpedo
 *     row, both rows of a double torpedo, the two rows of a bomber's T, the
 *     three rows of an atomic blast. A gun in any of them shoots it down.
 *   - The torpedo bomber's "near edge" is column 1 (c = 0); the torpedo runs
 *     toward column 10. It passes over cells already hit and strikes the
 *     first INTACT ship cell, so it is never wasted on a wreck.
 *   - A double torpedo on row J (r = 9) runs rows I and J.
 *   - Torpedoes react to ships only; they pass over mines, guns and radars.
 *   - Bombs (bomber, atomic) resolve every footprint cell like a normal shot,
 *     skipping cells already marked. A mine in the footprint detonates, and
 *     the mine's "turn ends immediately" wins over any hits in the same drop.
 *   - The submarine surfaces on a cell the attacker has not marked ("free" is
 *     the attacker's knowledge — anything else would leak the board) and its
 *     torpedoes start from the cells above and below it.
 *   - Radar counts SHIP cells (hit or not) in the 3x3, never arsenal items,
 *     and using it ends the turn since it lands no hit.
 */
import { coordKey, inBounds } from './board';
import {
  defenderIndex,
  hasIntactShipAt,
  openBoard,
  resolveCell,
  withDefenderBoard,
  type WorkingBoard,
} from './shots';
import type { ArsenalKind, ArsenalPlacement, Coord, MatchEvent, MatchState } from './types';
import { GRID_SIZE } from './types';

export interface ArsenalSpecEntry {
  readonly kind: ArsenalKind;
  readonly cost: number;
  readonly max: number;
  readonly placement: ArsenalPlacement;
  /** Bombers are aircraft, so AA guns can stop them. */
  readonly isAircraft: boolean;
  /** What the USE_ARSENAL action must carry. */
  readonly target: 'row' | 'cell' | 'none';
}

export const ARSENAL_SPEC: readonly ArsenalSpecEntry[] = [
  {
    kind: 'torpedoBomber',
    cost: 20,
    max: 2,
    placement: 'offensive',
    isAircraft: true,
    target: 'row',
  },
  {
    kind: 'doubleTorpedoBomber',
    cost: 35,
    max: 2,
    placement: 'offensive',
    isAircraft: true,
    target: 'row',
  },
  { kind: 'bomber', cost: 30, max: 2, placement: 'offensive', isAircraft: true, target: 'cell' },
  {
    kind: 'atomicBomber',
    cost: 60,
    max: 1,
    placement: 'offensive',
    isAircraft: true,
    target: 'cell',
  },
  { kind: 'aaGun', cost: 10, max: 3, placement: 'own board', isAircraft: false, target: 'none' },
  { kind: 'radar', cost: 15, max: 1, placement: 'own board', isAircraft: false, target: 'cell' },
  { kind: 'mine', cost: 5, max: 5, placement: 'own board', isAircraft: false, target: 'none' },
  {
    kind: 'submarine',
    cost: 10,
    max: 1,
    placement: 'offensive',
    isAircraft: false,
    target: 'cell',
  },
] as const;

export function specFor(kind: ArsenalKind): ArsenalSpecEntry {
  const entry = ARSENAL_SPEC.find((e) => e.kind === kind);
  if (!entry) throw new Error(`unknown arsenal kind: ${String(kind)}`);
  return entry;
}

export function isOwnBoardKind(kind: ArsenalKind): boolean {
  return specFor(kind).placement === 'own board';
}

export interface ArsenalOutcome {
  readonly state: MatchState;
  readonly events: readonly MatchEvent[];
  readonly keepsTurn: boolean;
  readonly rejected?: string;
}

function rejected(state: MatchState, reason: string): ArsenalOutcome {
  return { state, events: [], keepsTurn: true, rejected: reason };
}

function validRow(row: number | undefined): row is number {
  return row !== undefined && Number.isInteger(row) && row >= 0 && row < GRID_SIZE;
}

// ---------------------------------------------------------------------------
// Footprints — exported so the UI can preview them and tests can pin them
// ---------------------------------------------------------------------------

/** Target, target+right, target+down — clipped to the grid. */
export function bomberFootprint(at: Coord): Coord[] {
  return [at, { r: at.r, c: at.c + 1 }, { r: at.r + 1, c: at.c }].filter(inBounds);
}

/** The full 3x3 around the target — clipped to the grid. */
export function atomicFootprint(at: Coord): Coord[] {
  const out: Coord[] = [];
  for (let r = at.r - 1; r <= at.r + 1; r++) {
    for (let c = at.c - 1; c <= at.c + 1; c++) {
      const cell = { r, c };
      if (inBounds(cell)) out.push(cell);
    }
  }
  return out;
}

export function doubleTorpedoRows(row: number): [number, number] {
  return row >= GRID_SIZE - 1 ? [GRID_SIZE - 2, GRID_SIZE - 1] : [row, row + 1];
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

interface Tally {
  events: MatchEvent[];
  hits: number;
  mine: boolean;
}

/** The aircraft rule. Returns the finished outcome if a gun covers any row. */
function intercept(
  state: MatchState,
  attackerId: string,
  wb: WorkingBoard,
  kind: ArsenalKind,
  rows: readonly number[],
): ArsenalOutcome | null {
  const gun = wb.arsenal.find(
    (i) => i.kind === 'aaGun' && !i.destroyed && i.at !== undefined && rows.includes(i.at.r),
  );
  if (!gun || !gun.at) return null;
  gun.revealed = true;
  return {
    state: withDefenderBoard(state, attackerId, wb),
    events: [{ type: 'AIRCRAFT_DOWNED', playerId: attackerId, kind, gunAt: gun.at }],
    keepsTurn: false,
  };
}

/** Resolves every unmarked footprint cell like a shot. */
function drop(wb: WorkingBoard, attackerId: string, cells: readonly Coord[], tally: Tally): void {
  for (const cell of cells) {
    if (wb.marks[coordKey(cell)]) continue;
    const outcome = resolveCell(wb, attackerId, cell);
    tally.events.push(...outcome.events);
    if (outcome.hit) tally.hits++;
    if (outcome.mine) tally.mine = true;
  }
}

/** A torpedo along `path`: stops at the first intact ship cell, else runs off the grid. */
function torpedo(wb: WorkingBoard, attackerId: string, path: readonly Coord[], tally: Tally): void {
  const travelled: Coord[] = [];
  for (const cell of path) {
    travelled.push(cell);
    if (hasIntactShipAt(wb, cell)) {
      tally.events.push({
        type: 'TORPEDO_TRAVEL',
        playerId: attackerId,
        path: travelled,
        hitAt: cell,
      });
      tally.events.push({
        type: 'TORPEDO_RUN',
        playerId: attackerId,
        path: travelled,
        hitAt: cell,
      });
      const outcome = resolveCell(wb, attackerId, cell);
      tally.events.push(...outcome.events);
      if (outcome.hit) tally.hits++;
      return;
    }
  }
  tally.events.push({
    type: 'TORPEDO_TRAVEL',
    playerId: attackerId,
    path: travelled,
    hitAt: null,
  });
  tally.events.push({ type: 'TORPEDO_RUN', playerId: attackerId, path: travelled, hitAt: null });
}

function aircraftLaunch(
  playerId: string,
  kind: 'torpedoBomber' | 'doubleTorpedoBomber' | 'bomber' | 'atomicBomber',
  rows: readonly number[],
  at?: Coord,
): MatchEvent {
  return { type: 'AIRCRAFT_LAUNCHED', playerId, kind, rows, ...(at ? { at } : {}) };
}

function finish(
  state: MatchState,
  attackerId: string,
  wb: WorkingBoard,
  tally: Tally,
): ArsenalOutcome {
  return {
    state: withDefenderBoard(state, attackerId, wb),
    events: tally.events,
    keepsTurn: tally.hits > 0 && !tally.mine,
  };
}

function rowPath(row: number): Coord[] {
  const path: Coord[] = [];
  for (let c = 0; c < GRID_SIZE; c++) path.push({ r: row, c });
  return path;
}

// ---------------------------------------------------------------------------
// Resolvers — one per kind
// ---------------------------------------------------------------------------

/** Pick an enemy row; the torpedo runs from column 1 and hits the first intact ship cell. */
export function torpedoBomber(
  state: MatchState,
  attackerId: string,
  row: number | undefined,
): ArsenalOutcome {
  if (!validRow(row)) return rejected(state, 'row out of bounds');
  const wb = openBoard(state.players[defenderIndex(state, attackerId)].board);
  const launched = aircraftLaunch(attackerId, 'torpedoBomber', [row]);
  const downed = intercept(state, attackerId, wb, 'torpedoBomber', [row]);
  if (downed) return { ...downed, events: [launched, ...downed.events] };
  const tally: Tally = { events: [launched], hits: 0, mine: false };
  torpedo(wb, attackerId, rowPath(row), tally);
  return finish(state, attackerId, wb, tally);
}

/** Two torpedoes down two adjacent rows. */
export function doubleTorpedoBomber(
  state: MatchState,
  attackerId: string,
  row: number | undefined,
): ArsenalOutcome {
  if (!validRow(row)) return rejected(state, 'row out of bounds');
  const rows = doubleTorpedoRows(row);
  const wb = openBoard(state.players[defenderIndex(state, attackerId)].board);
  const launched = aircraftLaunch(attackerId, 'doubleTorpedoBomber', rows);
  const downed = intercept(state, attackerId, wb, 'doubleTorpedoBomber', rows);
  if (downed) return { ...downed, events: [launched, ...downed.events] };
  const tally: Tally = { events: [launched], hits: 0, mine: false };
  for (const r of rows) torpedo(wb, attackerId, rowPath(r), tally);
  return finish(state, attackerId, wb, tally);
}

/** Bombs the target plus target+right and target+down. */
export function bomber(
  state: MatchState,
  attackerId: string,
  at: Coord | undefined,
): ArsenalOutcome {
  if (!at || !inBounds(at)) return rejected(state, 'cell out of bounds');
  const cells = bomberFootprint(at);
  const wb = openBoard(state.players[defenderIndex(state, attackerId)].board);
  const rows = [...new Set(cells.map((c) => c.r))];
  const launched = aircraftLaunch(attackerId, 'bomber', rows, at);
  const downed = intercept(state, attackerId, wb, 'bomber', rows);
  if (downed) return { ...downed, events: [launched, ...downed.events] };
  const drops: MatchEvent[] = cells.map((cell, index) => ({
    type: 'BOMB_DROPPED',
    playerId: attackerId,
    kind: 'bomber',
    at: cell,
    index,
    total: cells.length,
  }));
  const tally: Tally = { events: [launched, ...drops], hits: 0, mine: false };
  drop(wb, attackerId, cells, tally);
  return finish(state, attackerId, wb, tally);
}

/** Destroys the full 3x3 around the target. */
export function atomicBomber(
  state: MatchState,
  attackerId: string,
  at: Coord | undefined,
): ArsenalOutcome {
  if (!at || !inBounds(at)) return rejected(state, 'cell out of bounds');
  const cells = atomicFootprint(at).sort(
    (a, b) => Math.hypot(a.r - at.r, a.c - at.c) - Math.hypot(b.r - at.r, b.c - at.c),
  );
  const wb = openBoard(state.players[defenderIndex(state, attackerId)].board);
  const rows = [...new Set(cells.map((c) => c.r))];
  const launched = aircraftLaunch(attackerId, 'atomicBomber', rows, at);
  const downed = intercept(state, attackerId, wb, 'atomicBomber', rows);
  if (downed) return { ...downed, events: [launched, ...downed.events] };
  const tally: Tally = {
    events: [
      launched,
      {
        type: 'BOMB_DROPPED',
        playerId: attackerId,
        kind: 'atomicBomber',
        at,
        index: 0,
        total: 1,
      },
      { type: 'NUKE_FLASH', playerId: attackerId, at, cells },
    ],
    hits: 0,
    mine: false,
  };
  drop(wb, attackerId, cells, tally);
  return finish(state, attackerId, wb, tally);
}

/** Surfaces on a free (unmarked) cell and fires torpedoes up and down. Not an aircraft. */
export function submarine(
  state: MatchState,
  attackerId: string,
  at: Coord | undefined,
): ArsenalOutcome {
  if (!at || !inBounds(at)) return rejected(state, 'cell out of bounds');
  const defender = state.players[defenderIndex(state, attackerId)];
  if (defender.board.marks[coordKey(at)]) return rejected(state, 'submarine needs a free cell');

  const wb = openBoard(defender.board);
  const tally: Tally = {
    events: [{ type: 'SUBMARINE_SURFACED', playerId: attackerId, at }],
    hits: 0,
    mine: false,
  };
  const up: Coord[] = [];
  for (let r = at.r - 1; r >= 0; r--) up.push({ r, c: at.c });
  const down: Coord[] = [];
  for (let r = at.r + 1; r < GRID_SIZE; r++) down.push({ r, c: at.c });
  torpedo(wb, attackerId, up, tally);
  torpedo(wb, attackerId, down, tally);
  return finish(state, attackerId, wb, tally);
}

/** Returns only the COUNT of ship cells in the 3x3 — never which ones. Ends the turn. */
export function radar(
  state: MatchState,
  attackerId: string,
  at: Coord | undefined,
): ArsenalOutcome {
  if (!at || !inBounds(at)) return rejected(state, 'cell out of bounds');
  const defender = state.players[defenderIndex(state, attackerId)];
  const occupied = new Set<string>();
  for (const ship of defender.board.ships) {
    for (let i = 0; i < ship.len; i++) {
      const cell =
        ship.orientation === 'h'
          ? { r: ship.origin.r, c: ship.origin.c + i }
          : { r: ship.origin.r + i, c: ship.origin.c };
      occupied.add(coordKey(cell));
    }
  }
  const count = atomicFootprint(at).filter((cell) => occupied.has(coordKey(cell))).length;
  return {
    state,
    events: [{ type: 'RADAR_RESULT', playerId: attackerId, at, count }],
    keepsTurn: false,
  };
}

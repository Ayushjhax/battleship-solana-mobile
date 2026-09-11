/**
 * Shot resolution — docs/brief.md 3.3, implemented in that order:
 *
 *   already shot     -> reject, turn is NOT consumed
 *   contains a MINE  -> MINE_TRIGGERED, mine consumed, attacker's turn ENDS
 *   contains a ship  -> HIT; if the ship has no intact cells left, SUNK plus
 *                       AUTO_REVEAL of every 8-neighbour of the whole ship.
 *                       Attacker KEEPS the turn.
 *   otherwise        -> MISS, turn ENDS.
 *
 * Where the brief is silent:
 *   - An own-board item (AA gun, radar) hit by fire is destroyed. The attacker
 *     "hit something", so the turn is kept (ITEM_HIT). Its cell is marked
 *     'revealed' — known to hold no ship — and the item shows in the
 *     attacker's revealedItems as destroyed.
 *   - AUTO_REVEAL only lists cells that were still unknown; cells already
 *     marked keep their mark. A revealed cell can never be fired on again, so
 *     a mine or gun sitting in a sunk ship's halo is simply neutralised.
 *
 * resolveCell works on a WorkingBoard — a mutable copy that openBoard() makes
 * and sealBoard() freezes back — so callers never mutate MatchState.
 */
import { cellsOf, coordKey, halo, inBounds, sameCoord } from './board';
import type {
  ArsenalItem,
  ArsenalKind,
  Board,
  CellState,
  Coord,
  MatchEvent,
  MatchState,
  Orientation,
  ShipClass,
} from './types';

export interface WorkingShip {
  readonly id: string;
  readonly class: ShipClass;
  readonly len: number;
  readonly origin: Coord;
  readonly orientation: Orientation;
  hits: Coord[];
}

export interface WorkingItem {
  readonly id: string;
  readonly kind: ArsenalKind;
  readonly at?: Coord;
  used: boolean;
  destroyed: boolean;
  revealed: boolean;
}

export interface WorkingBoard {
  ships: WorkingShip[];
  arsenal: WorkingItem[];
  marks: Record<string, CellState>;
}

export function openBoard(board: Board): WorkingBoard {
  return {
    ships: board.ships.map((s) => ({ ...s, hits: [...s.hits] })),
    arsenal: board.arsenal.map((i) => ({
      id: i.id,
      kind: i.kind,
      ...(i.at ? { at: i.at } : {}),
      used: i.used ?? false,
      destroyed: i.destroyed ?? false,
      revealed: i.revealed ?? false,
    })),
    marks: { ...board.marks },
  };
}

export function sealBoard(wb: WorkingBoard): Board {
  return {
    ships: wb.ships.map((s) => ({ ...s, hits: [...s.hits] })),
    arsenal: wb.arsenal.map((i): ArsenalItem => {
      const item: ArsenalItem = { id: i.id, kind: i.kind, ...(i.at ? { at: i.at } : {}) };
      return {
        ...item,
        ...(i.used ? { used: true } : {}),
        ...(i.destroyed ? { destroyed: true } : {}),
        ...(i.revealed ? { revealed: true } : {}),
      };
    }),
    marks: { ...wb.marks },
  };
}

export interface CellOutcome {
  readonly events: MatchEvent[];
  /** A ship part or an own-board item was hit. */
  readonly hit: boolean;
  readonly sunk: boolean;
  readonly mine: boolean;
}

function shipAt(wb: WorkingBoard, at: Coord): WorkingShip | undefined {
  return wb.ships.find((s) => cellsOf(s).some((cell) => sameCoord(cell, at)));
}

function liveItemAt(wb: WorkingBoard, at: Coord): WorkingItem | undefined {
  return wb.arsenal.find(
    (i) => i.at !== undefined && !i.used && !i.destroyed && sameCoord(i.at, at),
  );
}

/** A ship cell that has not been hit yet. */
export function hasIntactShipAt(wb: WorkingBoard, at: Coord): boolean {
  const ship = shipAt(wb, at);
  return ship !== undefined && !ship.hits.some((h) => sameCoord(h, at));
}

/**
 * Resolves ONE cell the attacker is targeting. The caller guarantees the cell
 * is in bounds and not yet marked. Shared by FIRE and every arsenal weapon.
 */
export function resolveCell(wb: WorkingBoard, attackerId: string, at: Coord): CellOutcome {
  const key = coordKey(at);
  const events: MatchEvent[] = [];

  const item = liveItemAt(wb, at);
  if (item?.kind === 'mine') {
    item.used = true;
    item.revealed = true;
    wb.marks[key] = 'mine';
    events.push({ type: 'MINE_TRIGGERED', playerId: attackerId, at });
    return { events, hit: false, sunk: false, mine: true };
  }

  const ship = shipAt(wb, at);
  if (ship) {
    ship.hits.push(at);
    wb.marks[key] = 'hit';
    events.push({ type: 'HIT', playerId: attackerId, at });

    if (ship.hits.length >= ship.len) {
      const cells = cellsOf(ship);
      for (const cell of cells) wb.marks[coordKey(cell)] = 'sunk';
      events.push({
        type: 'SUNK',
        playerId: attackerId,
        shipId: ship.id,
        shipClass: ship.class,
        cells,
      });

      const revealed: Coord[] = [];
      for (const cell of halo(ship)) {
        const k = coordKey(cell);
        if (wb.marks[k]) continue;
        wb.marks[k] = 'revealed';
        revealed.push(cell);
      }
      events.push({ type: 'AUTO_REVEAL', playerId: attackerId, cells: revealed });
      return { events, hit: true, sunk: true, mine: false };
    }
    return { events, hit: true, sunk: false, mine: false };
  }

  if (item) {
    // An AA gun or radar under normal fire: destroyed, and the attacker keeps the turn.
    item.destroyed = true;
    item.revealed = true;
    wb.marks[key] = 'revealed';
    events.push({ type: 'ITEM_HIT', playerId: attackerId, kind: item.kind, at });
    return { events, hit: true, sunk: false, mine: false };
  }

  wb.marks[key] = 'miss';
  events.push({ type: 'MISS', playerId: attackerId, at });
  return { events, hit: false, sunk: false, mine: false };
}

export interface ShotOutcome {
  readonly state: MatchState;
  readonly events: readonly MatchEvent[];
  readonly keepsTurn: boolean;
  /** Set when the shot was illegal; the turn is not consumed and state is unchanged. */
  readonly rejected?: string;
}

export function defenderIndex(state: MatchState, attackerId: string): 0 | 1 {
  return state.players[0].id === attackerId ? 1 : 0;
}

/** Replaces the defender's board with a sealed working copy. */
export function withDefenderBoard(
  state: MatchState,
  attackerId: string,
  wb: WorkingBoard,
): MatchState {
  const index = defenderIndex(state, attackerId);
  const defender = state.players[index];
  const updated = { ...defender, board: sealBoard(wb) };
  const players: [typeof updated, typeof updated] =
    index === 0 ? [updated, state.players[1]] : [state.players[0], updated];
  return { ...state, players };
}

/** A single FIRE at a cell, in the brief's order. Pure: returns a new state. */
export function resolveShot(state: MatchState, attackerId: string, at: Coord): ShotOutcome {
  if (!inBounds(at)) {
    return { state, events: [], keepsTurn: true, rejected: 'out of bounds' };
  }
  const defender = state.players[defenderIndex(state, attackerId)];
  if (defender.board.marks[coordKey(at)]) {
    return { state, events: [], keepsTurn: true, rejected: 'already shot' };
  }

  const wb = openBoard(defender.board);
  const outcome = resolveCell(wb, attackerId, at);
  return {
    state: withDefenderBoard(state, attackerId, wb),
    events: outcome.events,
    keepsTurn: outcome.hit && !outcome.mine,
  };
}

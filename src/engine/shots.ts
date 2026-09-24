/**
 * Shot resolution — docs/brief.md 3.3, implemented in that order:
 *
 *   already shot     -> reject, turn is NOT consumed
 *   contains a MINE  -> MINE_TRIGGERED, mine consumed, attacker's turn ENDS
 *   contains a ship  -> HIT; if the ship has no intact cells left, SUNK plus
 *                       AUTO_REVEAL of every 8-neighbour of the whole ship.
 *                       Attacker KEEPS the turn.
 *   contains a DECOY -> HIT, indistinguishable from the line above (Part 5)
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
 * PART 5 — THE DECOY. It sits AFTER the ship check and BEFORE the other
 * items, and it returns byte-identical output to a real ship-cell hit: the
 * cell is marked 'hit', `hit` is true, `sunk` and `mine` are false, and the
 * only event is HIT. That identity IS the item — any extra event, mark or
 * flag would be a tell, and the masked view would leak it. There is a test
 * that fails the build if it ever does.
 *
 * A decoy is EXPOSED once all eight of its in-grid neighbours are marked; the
 * sweep that does that runs at the tail of every resolveCell, so nothing can
 * forget to call it.
 *
 * resolveCell works on a WorkingBoard — a mutable copy that openBoard() makes
 * and sealBoard() freezes back — so callers never mutate MatchState.
 */
import { cellsOf, coordKey, halo, inBounds, neighbours8, sameCoord } from './board';
import { abilityFor, freeRadar } from './captains';
import { isSunk } from './fleet';
import { WATER, isFog, isIsland } from './terrain';
import type {
  ArsenalItem,
  ArsenalKind,
  Board,
  CaptainId,
  CellState,
  Coord,
  MatchEvent,
  MatchState,
  Orientation,
  ShipClass,
} from './types';
import type { Terrain } from './terrain';

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
  /** Part 10A — Mara's gun that survived its first hit. */
  damaged: boolean;
}

/**
 * Part 10A — the defender's captain, carried on the working board so a deep
 * resolver can spend it. `owner` is the player id the ability belongs to;
 * `used` is copied back onto PlayerState by withDefenderBoard.
 */
export interface WorkingCaptain {
  readonly id: CaptainId | null;
  readonly owner: string;
  used: boolean;
}

const NO_CAPTAIN: WorkingCaptain = { id: null, owner: '', used: false };

export interface WorkingBoard {
  ships: WorkingShip[];
  arsenal: WorkingItem[];
  marks: Record<string, CellState>;
  captain: WorkingCaptain;
  /** Part 10B — the public sea, carried so resolution can respect it. */
  terrain: Terrain;
}

export interface WorkingBoardOptions {
  readonly captain?: WorkingCaptain;
  readonly terrain?: Terrain;
}

export function openBoard(board: Board, options: WorkingBoardOptions = {}): WorkingBoard {
  return {
    ships: board.ships.map((s) => ({ ...s, hits: [...s.hits] })),
    arsenal: board.arsenal.map((i) => ({
      id: i.id,
      kind: i.kind,
      ...(i.at ? { at: i.at } : {}),
      used: i.used ?? false,
      destroyed: i.destroyed ?? false,
      revealed: i.revealed ?? false,
      damaged: i.damaged ?? false,
    })),
    marks: { ...board.marks },
    captain: options.captain ? { ...options.captain } : { ...NO_CAPTAIN },
    terrain: options.terrain ?? WATER,
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
        ...(i.damaged ? { damaged: true } : {}),
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

/** A decoy that has not been resolved yet — torpedoes stop on it (Part 5 §3). */
export function hasIntactDecoyAt(wb: WorkingBoard, at: Coord): boolean {
  const item = wb.arsenal.find(
    (i) => i.kind === 'decoy' && i.at !== undefined && !i.used && sameCoord(i.at, at),
  );
  return item !== undefined;
}

/**
 * Part 5 §3 — a hit decoy is exposed the moment all EIGHT of its in-grid
 * neighbours are marked. Until then the lie holds and the cell reads 'hit'.
 *
 * (The reference implementation's comment says "orthogonal"; its own test and
 * the design doc both say eight. Eight is implemented.)
 *
 * Runs at the tail of every resolveCell, so a decoy can be exposed by a shot
 * anywhere near it — including a halo reveal — not just by one aimed at it.
 */
function exposeDecoys(wb: WorkingBoard, attackerId: string, events: MatchEvent[]): void {
  for (const item of wb.arsenal) {
    if (item.kind !== 'decoy' || !item.at || !item.used || item.revealed) continue;
    // Part 10B — an island neighbour is public knowledge (nothing can be
    // there), so it counts as resolved; otherwise a decoy placed legally
    // beside an island could never be exposed, which is a bug, not a rule.
    const allMarked = neighbours8(item.at).every(
      (cell) => wb.marks[coordKey(cell)] !== undefined || isIsland(wb.terrain, cell),
    );
    if (!allMarked) continue;
    item.revealed = true;
    wb.marks[coordKey(item.at)] = 'decoy';
    events.push({ type: 'DECOY_EXPOSED', playerId: attackerId, at: item.at });
  }
}

/**
 * Resolves ONE cell the attacker is targeting. The caller guarantees the cell
 * is in bounds and not yet marked. Shared by FIRE and every arsenal weapon.
 */
export function resolveCell(wb: WorkingBoard, attackerId: string, at: Coord): CellOutcome {
  const key = coordKey(at);
  const events: MatchEvent[] = [];

  // Part 10B — belt-and-braces. Every caller already filters islands (FIRE is
  // rejected, bombs skip them, torpedoes stop dead), but a cell that is land
  // must never resolve to anything even if one of them forgets.
  if (isIsland(wb.terrain, at)) {
    return { events, hit: false, sunk: false, mine: false };
  }

  const item = liveItemAt(wb, at);
  if (item?.kind === 'mine') {
    item.used = true;
    item.revealed = true;
    wb.marks[key] = 'mine';
    events.push({ type: 'MINE_TRIGGERED', playerId: attackerId, at });
    exposeDecoys(wb, attackerId, events);
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
        // Part 10B — fog keeps its secrets: a halo cell inside fog does not
        // hatch. Cells outside the fog still do.
        if (isFog(wb.terrain, cell)) continue;
        wb.marks[k] = 'revealed';
        revealed.push(cell);
      }
      events.push({ type: 'AUTO_REVEAL', playerId: attackerId, cells: revealed });

      // Part 10A — the Old Captain: the defender's FIRST ship sunk hands them
      // one free radar. The item is added to the defender's own board here;
      // `captainUsed` rides back to PlayerState through withDefenderBoard.
      const ability = abilityFor(wb.captain.id);
      if (ability?.onShipSunk && !wb.captain.used) {
        const decision = ability.onShipSunk({
          owner: wb.captain.owner,
          at,
          firstShip: wb.ships.filter(isSunk).length === 1,
        });
        if (decision?.grantRadar) {
          wb.captain.used = true;
          const radar = freeRadar();
          wb.arsenal.push({
            id: radar.id,
            kind: radar.kind,
            used: false,
            destroyed: false,
            revealed: false,
            damaged: false,
          });
          events.push(...decision.events);
        }
      }

      exposeDecoys(wb, attackerId, events);
      return { events, hit: true, sunk: true, mine: false };
    }
    exposeDecoys(wb, attackerId, events);
    return { events, hit: true, sunk: false, mine: false };
  }

  // Part 5 §3 — the decoy, after the ship and before every other item. The
  // return below must stay byte-identical to the ship-hit return above.
  if (item?.kind === 'decoy') {
    item.used = true;
    wb.marks[key] = 'hit';
    events.push({ type: 'HIT', playerId: attackerId, at });
    exposeDecoys(wb, attackerId, events);
    return { events, hit: true, sunk: false, mine: false };
  }

  if (item) {
    // Part 10A — Mara's reinforced mount. The FIRST hit leaves the gun
    // damaged and the cell UNMARKED, so the attacker can come back and finish
    // it; the second hit falls through to the normal destroy below. The mark
    // is deliberately skipped: a mark means "resolved, never shootable again",
    // and that is exactly what this ability buys.
    const ability = abilityFor(wb.captain.id);
    if (ability?.onItemHit) {
      const decision = ability.onItemHit({ owner: wb.captain.owner, item, at });
      if (decision?.survive) {
        item.damaged = true;
        item.revealed = true;
        events.push({ type: 'ITEM_HIT', playerId: attackerId, kind: item.kind, at, damaged: true });
        events.push(...decision.events);
        exposeDecoys(wb, attackerId, events);
        return { events, hit: true, sunk: false, mine: false };
      }
    }

    // An AA gun or radar under normal fire: destroyed, and the attacker keeps the turn.
    item.destroyed = true;
    item.revealed = true;
    wb.marks[key] = 'revealed';
    events.push({ type: 'ITEM_HIT', playerId: attackerId, kind: item.kind, at });
    exposeDecoys(wb, attackerId, events);
    return { events, hit: true, sunk: false, mine: false };
  }

  wb.marks[key] = 'miss';
  events.push({ type: 'MISS', playerId: attackerId, at });
  exposeDecoys(wb, attackerId, events);
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
  // Part 10A — a deep resolver can only spend the defender's captain; this is
  // the single place that transfer happens, so no weapon can forget it.
  const updated = {
    ...defender,
    board: sealBoard(wb),
    captainUsed: defender.captainUsed || wb.captain.used,
  };
  const players: [typeof updated, typeof updated] =
    index === 0 ? [updated, state.players[1]] : [state.players[0], updated];
  return { ...state, players };
}

/**
 * Opens the defender's board with their captain attached, so the ability hooks
 * can fire during resolution. Every weapon that resolves on the enemy board
 * goes through this; only a raid's shim board has no captain.
 */
export function openDefenderBoard(state: MatchState, attackerId: string): WorkingBoard {
  const defender = state.players[defenderIndex(state, attackerId)];
  return openBoard(defender.board, {
    captain: {
      id: defender.captainId,
      owner: defender.id,
      used: defender.captainUsed,
    },
    terrain: state.terrain,
  });
}

/** A single FIRE at a cell, in the brief's order. Pure: returns a new state. */
export function resolveShot(state: MatchState, attackerId: string, at: Coord): ShotOutcome {
  if (!inBounds(at)) {
    return { state, events: [], keepsTurn: true, rejected: 'out of bounds' };
  }
  // Part 10B — an island is public, can never be fired on, and costs nothing
  // to refuse (the turn is not consumed, exactly like an already-shot cell).
  if (isIsland(state.terrain, at)) {
    return { state, events: [], keepsTurn: true, rejected: 'island' };
  }
  const defender = state.players[defenderIndex(state, attackerId)];
  if (defender.board.marks[coordKey(at)]) {
    return { state, events: [], keepsTurn: true, rejected: 'already shot' };
  }

  const wb = openDefenderBoard(state, attackerId);
  const outcome = resolveCell(wb, attackerId, at);
  return {
    state: withDefenderBoard(state, attackerId, wb),
    events: outcome.events,
    keepsTurn: outcome.hit && !outcome.mine,
  };
}

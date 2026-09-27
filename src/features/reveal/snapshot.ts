/**
 * The winner's final board, as the loser's reveal draws it: validated and
 * copied, never trusted. Pure TypeScript (no React), so tests/reveal/ checks
 * every rule here.
 *
 * Two sources, one gate:
 *   online   the server's `over.reveal` (server/src/room.ts): the winner's
 *            board from the terminal state, sent only to the losing seat and
 *            only after the match is settled. The wire keeps it `unknown`
 *            (src/net/protocol.ts) so a bad reveal can never cost the player
 *            the `over` frame and the rewards it carries.
 *   offline  the local match's own final board for the AI's seat.
 *
 * Ships are the point of the screen, so one malformed ship rejects the whole
 * board and the loser goes straight to their result — never a fleet that is
 * not the one they fought. Defences and marks are kept when this app can draw
 * them and dropped otherwise (a newer server's kinds). Nothing is invented.
 */
import { cellsOf, coordKey } from '@engine/board';
import { isSunk, lengthOf } from '@engine/fleet';
import {
  GRID_SIZE,
  type ArsenalItem,
  type ArsenalKind,
  type Board,
  type CellState,
  type Coord,
  type Ship,
  type ShipClass,
} from '@engine/types';

const SHIP_CLASSES: readonly ShipClass[] = ['battleship', 'cruiser', 'destroyer', 'boat'];
/** Planted on a board, with a cell — what ArsenalSprite draws. Carried weapons have no cell. */
const BOARD_KINDS: readonly ArsenalKind[] = ['aaGun', 'mine', 'radar'];
/** 'unknown' is the absence of a mark, so it is never drawn. */
const MARK_STATES: readonly CellState[] = ['miss', 'hit', 'sunk', 'revealed', 'mine'];
const MAX_SHIPS = 10;
const MAX_ITEMS = 32;
const MAX_ID = 64;

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID ? value : null;
}

function readCoord(value: unknown): Coord | null {
  if (!isObject(value)) return null;
  const { r, c } = value;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  const row = r as number;
  const col = c as number;
  return row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE ? { r: row, c: col } : null;
}

function readShip(value: unknown): Ship | null {
  if (!isObject(value)) return null;
  const id = readId(value.id);
  const shipClass = SHIP_CLASSES.find((k) => k === value.class);
  const origin = readCoord(value.origin);
  const orientation = value.orientation === 'h' || value.orientation === 'v' ? value.orientation : null;
  if (!id || !shipClass || !origin || !orientation) return null;
  const len = lengthOf(shipClass);
  if (value.len !== len) return null;
  const cells = cellsOf({ len, origin, orientation });
  const last = cells[cells.length - 1] as Coord;
  if (last.r >= GRID_SIZE || last.c >= GRID_SIZE) return null;
  if (!Array.isArray(value.hits) || value.hits.length > len) return null;
  const onShip = new Set(cells.map(coordKey));
  const hits: Coord[] = [];
  const seen = new Set<string>();
  for (const raw of value.hits) {
    const hit = readCoord(raw);
    if (!hit || !onShip.has(coordKey(hit))) return null;
    if (seen.has(coordKey(hit))) continue;
    seen.add(coordKey(hit));
    hits.push(hit);
  }
  return { id, class: shipClass, len, origin, orientation, hits };
}

function readItem(value: unknown): ArsenalItem | null {
  if (!isObject(value)) return null;
  const id = readId(value.id);
  const kind = BOARD_KINDS.find((k) => k === value.kind);
  const at = readCoord(value.at);
  if (!id || !kind || !at) return null;
  return {
    id,
    kind,
    at,
    ...(value.used === true ? { used: true } : {}),
    ...(value.destroyed === true ? { destroyed: true } : {}),
    ...(value.revealed === true ? { revealed: true } : {}),
  };
}

/**
 * A validated, detached copy of `raw` as a Board, or null when it cannot be
 * drawn truthfully (missing, not a fleet, a ship off the grid or overlapping
 * another, a hit that is not on its ship).
 */
export function parseRevealBoard(raw: unknown): Board | null {
  if (!isObject(raw) || !Array.isArray(raw.ships)) return null;
  if (raw.ships.length === 0 || raw.ships.length > MAX_SHIPS) return null;

  const ships: Ship[] = [];
  const ids = new Set<string>();
  const taken = new Set<string>();
  for (const value of raw.ships) {
    const ship = readShip(value);
    if (!ship || ids.has(ship.id)) return null;
    for (const cell of cellsOf(ship)) {
      const key = coordKey(cell);
      if (taken.has(key)) return null;
      taken.add(key);
    }
    ids.add(ship.id);
    ships.push(ship);
  }

  const arsenal: ArsenalItem[] = [];
  if (Array.isArray(raw.arsenal)) {
    for (const value of raw.arsenal.slice(0, MAX_ITEMS)) {
      const item = readItem(value);
      if (item && !ids.has(item.id)) {
        ids.add(item.id);
        arsenal.push(item);
      }
    }
  }

  const marks: Record<string, CellState> = {};
  if (isObject(raw.marks)) {
    for (const [key, state] of Object.entries(raw.marks)) {
      const match = /^(\d),(\d)$/.exec(key);
      const mark = MARK_STATES.find((s) => s === state);
      if (match && mark) marks[key] = mark;
    }
  }

  return { ships, arsenal, marks };
}

/** The board's sunk ships — the ones the reveal marks with a small red cross. */
export function sunkShipsOf(board: Board): Ship[] {
  return board.ships.filter(isSunk);
}

/** Any AA gun or mine planted on the board — the legend lists defences only when there are some. */
export function hasDefences(board: Board): boolean {
  return board.arsenal.some((item) => item.at !== undefined && (item.kind === 'aaGun' || item.kind === 'mine'));
}

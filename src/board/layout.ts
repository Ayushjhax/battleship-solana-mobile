/**
 * Board geometry on the 800 x 360 canvas — docs/brief.md 5.4, pure maths.
 * Cell 28, board 280 square, two boards plus a 40 gutter = 600, leaving 100
 * each side for labels and HUD. Own board at x = 100, enemy at x = 420.
 */
import type { Coord, Ship } from '@engine/types';
import { CANVAS_W } from '@/ui/tokens';

export const CELL = 28;
export const GRID = 10;
export const BOARD_SIZE = CELL * GRID; // 280
export const GUTTER = 40;
export const BOARDS_W = BOARD_SIZE * 2 + GUTTER; // 600
export const SIDE_MARGIN = (CANVAS_W - BOARDS_W) / 2; // 100

/** Top edge of both boards; puts the board's centre at y = 180. */
export const BOARD_TOP = 40;

/**
 * In battle the HUD strip takes the top of the sheet (IMG_9770), the column
 * numbers are dropped and the boards run to the bottom edge.
 */
export const BATTLE_BOARD_TOP = 78;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface BoardOrigin {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const OWN_BOARD_ORIGIN: BoardOrigin = { x: SIDE_MARGIN, y: BOARD_TOP };
export const ENEMY_BOARD_ORIGIN: BoardOrigin = { x: SIDE_MARGIN + BOARD_SIZE + GUTTER, y: BOARD_TOP };

/** Centre of the gutter between the boards — where the turn triangle lives. */
export const GUTTER_CENTRE: Point = { x: SIDE_MARGIN + BOARD_SIZE + GUTTER / 2, y: BOARD_TOP + BOARD_SIZE / 2 };

/** The two origins and the gutter centre for a board top other than the default. */
export function boardOrigins(top: number): { own: BoardOrigin; enemy: BoardOrigin; gutterCentre: Point } {
  return {
    own: { x: SIDE_MARGIN, y: top },
    enemy: { x: SIDE_MARGIN + BOARD_SIZE + GUTTER, y: top },
    gutterCentre: { x: SIDE_MARGIN + BOARD_SIZE + GUTTER / 2, y: top + BOARD_SIZE / 2 },
  };
}

export const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;
export const COL_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;

/** Canvas point of a cell's top-left corner. */
export function cellToPoint(coord: Coord, origin: BoardOrigin): Point {
  return { x: origin.x + coord.c * CELL, y: origin.y + coord.r * CELL };
}

/** Canvas point of a cell's centre. */
export function cellCentre(coord: Coord, origin: BoardOrigin): Point {
  return { x: origin.x + coord.c * CELL + CELL / 2, y: origin.y + coord.r * CELL + CELL / 2 };
}

/** Canvas point -> cell, or null anywhere outside the board. */
export function pointToCell(xy: Point, origin: BoardOrigin): Coord | null {
  const dx = xy.x - origin.x;
  const dy = xy.y - origin.y;
  if (dx < 0 || dy < 0 || dx >= BOARD_SIZE || dy >= BOARD_SIZE) return null;
  return { r: Math.floor(dy / CELL), c: Math.floor(dx / CELL) };
}

/** A ship's rectangle in board-local units (the board's top-left is 0,0). */
export function shipRect(ship: Pick<Ship, 'len' | 'origin' | 'orientation'>): Rect {
  const x = ship.origin.c * CELL;
  const y = ship.origin.r * CELL;
  return ship.orientation === 'h'
    ? { x, y, w: ship.len * CELL, h: CELL }
    : { x, y, w: CELL, h: ship.len * CELL };
}

/** A cell's rectangle in board-local units. */
export function cellRect(coord: Coord): Rect {
  return { x: coord.c * CELL, y: coord.r * CELL, w: CELL, h: CELL };
}

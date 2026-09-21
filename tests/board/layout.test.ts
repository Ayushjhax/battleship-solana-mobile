/**
 * Board geometry on the fixed 800x360 virtual canvas. Pure arithmetic, so it is
 * cheap to pin exactly — and worth pinning, because every tap target, ship
 * rectangle and shot marker is derived from these numbers. A silent change here
 * misaligns the whole board rather than failing loudly.
 */
import { describe, expect, it } from 'vitest';

import {
  BATTLE_BOARD_TOP,
  BOARDS_W,
  BOARD_SIZE,
  BOARD_TOP,
  CELL,
  COL_LABELS,
  ENEMY_BOARD_ORIGIN,
  GRID,
  GUTTER,
  GUTTER_CENTRE,
  OWN_BOARD_ORIGIN,
  ROW_LABELS,
  SIDE_MARGIN,
  boardOrigins,
  cellCentre,
  cellRect,
  cellToPoint,
  pointToCell,
  shipRect,
} from '../../src/board/layout';

describe('canvas constants', () => {
  it('keeps the documented 28/280/40/600/100 geometry', () => {
    expect(CELL).toBe(28);
    expect(GRID).toBe(10);
    expect(BOARD_SIZE).toBe(280);
    expect(GUTTER).toBe(40);
    expect(BOARDS_W).toBe(600);
    expect(SIDE_MARGIN).toBe(100);
  });

  it('leaves equal margins either side of the two boards', () => {
    expect(SIDE_MARGIN * 2 + BOARDS_W).toBe(800);
  });

  it('places the enemy board exactly one board plus one gutter to the right', () => {
    expect(ENEMY_BOARD_ORIGIN.x - OWN_BOARD_ORIGIN.x).toBe(BOARD_SIZE + GUTTER);
    expect(ENEMY_BOARD_ORIGIN.y).toBe(OWN_BOARD_ORIGIN.y);
  });

  it('centres the gutter marker between the two boards', () => {
    expect(GUTTER_CENTRE.x).toBe(SIDE_MARGIN + BOARD_SIZE + GUTTER / 2);
    expect(GUTTER_CENTRE.y).toBe(BOARD_TOP + BOARD_SIZE / 2);
  });

  it('drops the battle boards below the placement boards to make room for the HUD', () => {
    expect(BATTLE_BOARD_TOP).toBeGreaterThan(BOARD_TOP);
  });

  it('labels ten rows A-J and ten columns 1-10', () => {
    expect(ROW_LABELS).toHaveLength(GRID);
    expect(COL_LABELS).toHaveLength(GRID);
    expect(ROW_LABELS[0]).toBe('A');
    expect(ROW_LABELS[GRID - 1]).toBe('J');
    expect(COL_LABELS[GRID - 1]).toBe('10');
  });
});

describe('boardOrigins', () => {
  it('re-derives both origins and the gutter centre for any top edge', () => {
    const { own, enemy, gutterCentre } = boardOrigins(BATTLE_BOARD_TOP);

    expect(own).toEqual({ x: SIDE_MARGIN, y: BATTLE_BOARD_TOP });
    expect(enemy).toEqual({ x: SIDE_MARGIN + BOARD_SIZE + GUTTER, y: BATTLE_BOARD_TOP });
    expect(gutterCentre.y).toBe(BATTLE_BOARD_TOP + BOARD_SIZE / 2);
  });

  it('agrees with the exported constants at the placement top', () => {
    const { own, enemy, gutterCentre } = boardOrigins(BOARD_TOP);

    expect(own).toEqual(OWN_BOARD_ORIGIN);
    expect(enemy).toEqual(ENEMY_BOARD_ORIGIN);
    expect(gutterCentre).toEqual(GUTTER_CENTRE);
  });
});

describe('cellToPoint and cellCentre', () => {
  it('puts A1 at the board origin', () => {
    expect(cellToPoint({ r: 0, c: 0 }, OWN_BOARD_ORIGIN)).toEqual({
      x: SIDE_MARGIN,
      y: BOARD_TOP,
    });
  });

  it('advances one cell per coordinate step', () => {
    expect(cellToPoint({ r: 2, c: 3 }, OWN_BOARD_ORIGIN)).toEqual({
      x: SIDE_MARGIN + 3 * CELL,
      y: BOARD_TOP + 2 * CELL,
    });
  });

  it('centres are half a cell in from the corner', () => {
    const corner = cellToPoint({ r: 7, c: 4 }, ENEMY_BOARD_ORIGIN);
    const centre = cellCentre({ r: 7, c: 4 }, ENEMY_BOARD_ORIGIN);

    expect(centre.x - corner.x).toBe(CELL / 2);
    expect(centre.y - corner.y).toBe(CELL / 2);
  });

  it('keeps the last cell inside the board', () => {
    const corner = cellToPoint({ r: GRID - 1, c: GRID - 1 }, OWN_BOARD_ORIGIN);

    expect(corner.x + CELL).toBe(SIDE_MARGIN + BOARD_SIZE);
    expect(corner.y + CELL).toBe(BOARD_TOP + BOARD_SIZE);
  });
});

describe('pointToCell', () => {
  it('round-trips every cell through its own centre', () => {
    for (let r = 0; r < GRID; r += 1) {
      for (let c = 0; c < GRID; c += 1) {
        const centre = cellCentre({ r, c }, OWN_BOARD_ORIGIN);
        expect(pointToCell(centre, OWN_BOARD_ORIGIN)).toEqual({ r, c });
      }
    }
  });

  it('claims the top-left corner of a cell, not the one before it', () => {
    const corner = cellToPoint({ r: 5, c: 5 }, OWN_BOARD_ORIGIN);

    expect(pointToCell(corner, OWN_BOARD_ORIGIN)).toEqual({ r: 5, c: 5 });
  });

  it('rejects a tap above or left of the board', () => {
    expect(pointToCell({ x: SIDE_MARGIN - 1, y: BOARD_TOP }, OWN_BOARD_ORIGIN)).toBeNull();
    expect(pointToCell({ x: SIDE_MARGIN, y: BOARD_TOP - 1 }, OWN_BOARD_ORIGIN)).toBeNull();
  });

  it('rejects a tap past the bottom-right edge', () => {
    expect(
      pointToCell({ x: SIDE_MARGIN + BOARD_SIZE, y: BOARD_TOP }, OWN_BOARD_ORIGIN),
    ).toBeNull();
    expect(
      pointToCell({ x: SIDE_MARGIN, y: BOARD_TOP + BOARD_SIZE }, OWN_BOARD_ORIGIN),
    ).toBeNull();
  });

  it('rejects a tap in the gutter between the boards', () => {
    expect(pointToCell(GUTTER_CENTRE, OWN_BOARD_ORIGIN)).toBeNull();
    expect(pointToCell(GUTTER_CENTRE, ENEMY_BOARD_ORIGIN)).toBeNull();
  });

  it('reads the same screen point as different cells on the two boards', () => {
    const point = cellCentre({ r: 3, c: 2 }, ENEMY_BOARD_ORIGIN);

    expect(pointToCell(point, ENEMY_BOARD_ORIGIN)).toEqual({ r: 3, c: 2 });
    expect(pointToCell(point, OWN_BOARD_ORIGIN)).toBeNull();
  });
});

describe('shipRect', () => {
  it('lays a horizontal ship out along x', () => {
    const rect = shipRect({ len: 4, origin: { r: 2, c: 1 }, orientation: 'h' });

    expect(rect).toEqual({ x: CELL, y: 2 * CELL, w: 4 * CELL, h: CELL });
  });

  it('lays a vertical ship out along y', () => {
    const rect = shipRect({ len: 3, origin: { r: 0, c: 5 }, orientation: 'v' });

    expect(rect).toEqual({ x: 5 * CELL, y: 0, w: CELL, h: 3 * CELL });
  });

  it('gives a length-1 ship a single square cell either way', () => {
    const horizontal = shipRect({ len: 1, origin: { r: 9, c: 9 }, orientation: 'h' });
    const vertical = shipRect({ len: 1, origin: { r: 9, c: 9 }, orientation: 'v' });

    expect(horizontal).toEqual(vertical);
    expect(horizontal.w).toBe(CELL);
  });

  it('keeps a full-width ship inside the board', () => {
    const rect = shipRect({ len: GRID, origin: { r: 0, c: 0 }, orientation: 'h' });

    expect(rect.w).toBe(BOARD_SIZE);
  });
});

describe('cellRect', () => {
  it('returns one board-relative cell square', () => {
    expect(cellRect({ r: 0, c: 0 })).toEqual({ x: 0, y: 0, w: CELL, h: CELL });
    expect(cellRect({ r: 3, c: 2 })).toEqual({ x: 2 * CELL, y: 3 * CELL, w: CELL, h: CELL });
  });

  it('agrees with a length-1 ship rect at the same coordinate', () => {
    expect(cellRect({ r: 1, c: 6 })).toEqual(
      shipRect({ len: 1, origin: { r: 1, c: 6 }, orientation: 'h' }),
    );
  });
});

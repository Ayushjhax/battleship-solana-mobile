/**
 * The reveal's page fits (src/features/reveal/revealLayout.ts). <Scale> maps
 * the 800 x 360 canvas onto any landscape screen with ONE uniform scale, after
 * the safe-area insets, so "fits the canvas" is "fits a small phone": these
 * check the canvas, and the scale arithmetic for a few real screens.
 */
import { describe, expect, it } from 'vitest';

import { CELL } from '../../src/board/layout';
import {
  BANNER,
  BOARD_CX,
  BOARD_DRAWN,
  BOARD_K,
  BOX,
  COUNTDOWN_H,
  BAR_W,
  FRAME,
  HOLE,
  LEFT_COL,
  LEFT_STACK,
  RIGHT_COL,
  RIGHT_STACK,
  SUNK_MARK,
  boxToCanvas,
} from '../../src/features/reveal/revealLayout';

const CANVAS = { w: 800, h: 360 };

const leftHeight =
  LEFT_STACK.frame +
  LEFT_STACK.name.gap +
  LEFT_STACK.name.h +
  LEFT_STACK.rank.gap +
  LEFT_STACK.rank.h +
  LEFT_STACK.divider.gap +
  LEFT_STACK.divider.h +
  LEFT_STACK.quote.gap +
  LEFT_STACK.quote.h;
const legend = RIGHT_STACK.legend;
const rightHeight =
  RIGHT_STACK.stamp.h +
  legend.gap +
  legend.rows * legend.row +
  (legend.rows - 1) * legend.rowGap +
  RIGHT_STACK.countdown.gap +
  COUNTDOWN_H;

describe('the reveal page fits the canvas', () => {
  it('the board is drawn whole inside the canvas, under the banner', () => {
    expect(BOARD_DRAWN.left).toBeGreaterThanOrEqual(0);
    expect(BOARD_DRAWN.right).toBeLessThanOrEqual(CANVAS.w);
    expect(BOARD_DRAWN.top).toBeGreaterThanOrEqual(BANNER.top + BANNER.h);
    expect(BOARD_DRAWN.bottom).toBeLessThanOrEqual(CANVAS.h);
    expect(BANNER.top).toBeGreaterThanOrEqual(0);
  });

  it('the banner is centred over the board and no wider than it', () => {
    expect(BOARD_CX - BANNER.w / 2).toBeGreaterThanOrEqual(BOARD_DRAWN.left);
    expect(BOARD_CX + BANNER.w / 2).toBeLessThanOrEqual(BOARD_DRAWN.right);
    expect((BOARD_DRAWN.left + BOARD_DRAWN.right) / 2).toBeCloseTo(CANVAS.w / 2, 5);
  });

  it('the side columns sit beside the board with a gutter, inside the canvas', () => {
    expect(LEFT_COL.left).toBeGreaterThanOrEqual(0);
    expect(LEFT_COL.left + LEFT_COL.width).toBeLessThan(BOARD_DRAWN.left);
    expect(RIGHT_COL.left).toBeGreaterThan(BOARD_DRAWN.right);
    expect(RIGHT_COL.left + RIGHT_COL.width).toBeLessThanOrEqual(CANVAS.w);
  });

  it('the columns are balanced — neither is a giant empty strip', () => {
    expect(Math.abs(LEFT_COL.width - RIGHT_COL.width)).toBeLessThan(2);
    expect(LEFT_COL.width).toBeLessThan(CANVAS.w * 0.3);
  });

  it('every piece in each column is narrower than its column', () => {
    for (const w of [FRAME.w, LEFT_STACK.divider.w, LEFT_STACK.quote.w]) {
      expect(w).toBeLessThanOrEqual(LEFT_COL.width);
    }
    const legendW = legend.iconW + 8 + legend.labelMaxW;
    for (const w of [RIGHT_STACK.stamp.w, BAR_W, legendW]) {
      expect(w).toBeLessThanOrEqual(RIGHT_COL.width);
    }
  });

  it('each column’s stack fits the canvas height with room to spare', () => {
    expect(leftHeight).toBeLessThanOrEqual(CANVAS.h - 20);
    expect(rightHeight).toBeLessThanOrEqual(CANVAS.h - 20);
  });

  it('the portrait’s round clip sits inside the rope frame', () => {
    expect(HOLE.cx - HOLE.d / 2).toBeGreaterThan(0);
    expect(HOLE.cx + HOLE.d / 2).toBeLessThan(FRAME.w);
    expect(HOLE.cy - HOLE.d / 2).toBeGreaterThan(0);
    expect(HOLE.cy + HOLE.d / 2).toBeLessThan(FRAME.h);
  });
});

describe('cells stay square and readable', () => {
  it('the board scales uniformly: a cell is as wide as it is tall', () => {
    const a = boxToCanvas(24, 24);
    const b = boxToCanvas(24 + CELL, 24 + CELL);
    expect(b.x - a.x).toBeCloseTo(b.y - a.y, 10);
    expect(b.x - a.x).toBeCloseTo(CELL * BOARD_K, 10);
    expect(BOX).toBe(328);
  });

  it.each([
    ['a small landscape phone (640 x 360 dp)', 640, 360, 0, 0],
    ['a phone with a side notch (780 x 360 dp, 32 dp inset)', 780, 360, 32, 0],
    ['a large phone (915 x 412 dp)', 915, 412, 0, 24],
  ])('%s: whole on screen, cells at least 20 dp', (_name, w, h, insetX, insetY) => {
    const availW = w - insetX;
    const availH = h - insetY;
    const scale = Math.min(availW / CANVAS.w, availH / CANVAS.h);
    expect(CANVAS.w * scale).toBeLessThanOrEqual(availW + 1e-9);
    expect(CANVAS.h * scale).toBeLessThanOrEqual(availH + 1e-9);
    expect(CELL * BOARD_K * scale).toBeGreaterThanOrEqual(20);
  });

  it('the sunk cross stays small inside its cell', () => {
    expect(SUNK_MARK).toBeLessThan(CELL * 0.6);
  });
});

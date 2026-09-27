/**
 * Where everything on the reveal sits, in 800 x 360 canvas units. Pure, so
 * tests/reveal/layout.test.ts can prove the page fits: nothing overlaps,
 * nothing runs off the canvas. <Scale> fits the canvas to any landscape
 * screen, safe areas taken off first, with one uniform scale — so what fits
 * here fits a small phone as well as a large one, and cells stay square.
 *
 *   ┌ left column ┐┌──── title banner ────┐┌ right column ┐
 *   │  portrait   ││                      ││ MATCH        │
 *   │  name, rank ││    winner's board    ││ legend       │
 *   │  quote      ││                      ││ countdown    │
 *   └─────────────┘└──────────────────────┘└──────────────┘
 */
import { BOARD_SIZE, LABEL_MARGIN } from '@/board/layout';
import { CANVAS_W } from '@/ui/tokens';

/** The title banner (771 x 127), centred over the board. */
export const BANNER = { w: 296, h: 296 * (127 / 771), top: 3 } as const;

/**
 * The board: GridBoard's own box (the 280 board and its label margins) scaled
 * as a whole, so cells stay square and the letters, numbers and frame keep
 * their places. What it draws runs a little past the board: the row letters
 * from x -3, the column numbers from y -1, the art frame to 312.5 x 315.
 */
export const BOX = BOARD_SIZE + LABEL_MARGIN * 2;
export const DRAWN = { x0: -3, y0: -1, x1: 312.5, y1: 315 } as const;
export const BOARD_K = 0.95;
export const BOARD_TOP = BANNER.top + BANNER.h + 2;
export const BOARD_CX = CANVAS_W / 2;
// RN scales about the box's centre: place the unscaled box so the scaled
// drawing lands centred at BOARD_CX with its top at BOARD_TOP.
export const BOX_LEFT = BOARD_CX - BOX / 2 - ((DRAWN.x0 + DRAWN.x1) / 2 - BOX / 2) * BOARD_K;
export const BOX_TOP = BOARD_TOP - BOX / 2 - (DRAWN.y0 - BOX / 2) * BOARD_K;

/** Canvas point of a point in GridBoard's box, after the scale. */
export function boxToCanvas(x: number, y: number): { x: number; y: number } {
  return {
    x: BOX_LEFT + BOX / 2 + (x - BOX / 2) * BOARD_K,
    y: BOX_TOP + BOX / 2 + (y - BOX / 2) * BOARD_K,
  };
}

const drawnTopLeft = boxToCanvas(DRAWN.x0, DRAWN.y0);
const drawnBottomRight = boxToCanvas(DRAWN.x1, DRAWN.y1);
/** What the board draws, on the canvas. */
export const BOARD_DRAWN = {
  left: drawnTopLeft.x,
  top: drawnTopLeft.y,
  right: drawnBottomRight.x,
  bottom: drawnBottomRight.y,
} as const;

/** The two side columns fill what the board leaves, less a gutter. */
export const SIDE_MARGIN = 14;
export const GUTTER = 16;
export const LEFT_COL = { left: SIDE_MARGIN, width: BOARD_DRAWN.left - GUTTER - SIDE_MARGIN } as const;
export const RIGHT_COL = {
  left: BOARD_DRAWN.right + GUTTER,
  width: CANVAS_W - SIDE_MARGIN - (BOARD_DRAWN.right + GUTTER),
} as const;

/**
 * The rope frame (303 x 310) and its round hole: centre (152, 160), the rope's
 * inside at r 128 — the portrait is clipped a little inside that.
 */
export const FRAME = { w: 124, h: 124 * (310 / 303) } as const;
const FRAME_K = FRAME.w / 303;
export const HOLE = { cx: 152 * FRAME_K, cy: 160 * FRAME_K, d: 2 * 125 * FRAME_K } as const;
export const FLAG_W = 36;

/** The left column, top to bottom: each piece's height and the gap above it. */
export const LEFT_STACK = {
  frame: FRAME.h,
  name: { gap: 4, h: 25 },
  rank: { gap: 0, h: 18 },
  divider: { gap: 6, w: 160, h: 160 * (33 / 287) },
  quote: { gap: 8, w: 176, h: 176 * (121 / 317) },
} as const;

/** The right column, top to bottom. The legend has at most two rows. */
export const RIGHT_STACK = {
  stamp: { w: 156, h: 156 * (118 / 291) },
  legend: { gap: 12, row: 22, rowGap: 4, rows: 2, iconW: 18, labelMaxW: 80 },
  countdown: { gap: 14 },
} as const;

/** The countdown block: the badge, "Results in Ns" and the bar. */
export const BADGE = 60;
export const COUNT_LABEL = { gap: 6, h: 20 } as const;
/** bar-track.png / bar-frame.png are 320 x 42. */
export const BAR_W = 180;
export const BAR_H = 42 * (BAR_W / 320);
export const BAR_GAP = 6;
export const COUNTDOWN_H = BADGE + COUNT_LABEL.gap + COUNT_LABEL.h + BAR_GAP + BAR_H;

/** The small red cross on each sunk ship, in board units. */
export const SUNK_MARK = 15;

/**
 * The placement shop's grid arithmetic, kept out of the component.
 *
 * It lives here because `tests/regression/home-and-hud-fixes.test.ts` has to
 * assert it — that file exists because "arsenal scrolls" shipped as a bug —
 * and this repo has no React renderer in its test setup, so anything imported
 * from a .tsx drags react-native into vitest and fails to parse.
 *
 * Part 5 changed it from 3 x 3 to 3 x 4 and grew the panel from 226 to 270
 * tall. The Naval Academy adds three kinds (11 in total) and 3 x 3 = 9 would
 * overflow — which is precisely the bug the regression guards.
 *
 * Four COLUMNS was the obvious fix and is wrong: it drops each card to 92 dp
 * wide, under the 110 dp legibility floor the same regression pins. A fourth
 * ROW keeps cards 124 dp wide, and the panel has the height to spare
 * (SHOP_Y 62 + 270 = 332, inside the 360 canvas).
 */

export const PANEL_W = 400;
export const PANEL_H = 270;
export const GRID_GAP = 5;
export const GRID_PAD = 8;
export const GRID_COLUMNS = 3;
export const GRID_ROWS = 4;
/** The title strip above the cards. */
export const TITLE_H = 30;
/** Slack under the last row. */
export const GRID_TAIL = 7;

export const CARD_W = Math.floor(
  (PANEL_W - GRID_PAD * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS,
);
export const CARD_H = Math.floor(
  (PANEL_H - TITLE_H - GRID_GAP * (GRID_ROWS - 1) - GRID_TAIL) / GRID_ROWS,
);

/** How many cards the grid can show without a scroll view. */
export const SHOP_SLOTS = GRID_COLUMNS * GRID_ROWS;

/** Width the grid actually consumes — must be <= PANEL_W. */
export function gridWidthUsed(): number {
  return GRID_COLUMNS * CARD_W + (GRID_COLUMNS - 1) * GRID_GAP + GRID_PAD * 2;
}

/** Height the grid actually consumes — must be <= PANEL_H - TITLE_H. */
export function gridHeightUsed(): number {
  return GRID_ROWS * CARD_H + (GRID_ROWS - 1) * GRID_GAP + GRID_TAIL;
}

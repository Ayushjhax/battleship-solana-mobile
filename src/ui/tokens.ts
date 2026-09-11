/**
 * Design tokens — docs/brief.md section 5. These names are the contract every
 * screen is written against; add to them, don't rename them.
 */

/** 5.1 — the ballpoint-on-graph-paper palette. */
export const color = {
  paper: '#FBFCFE', // the sheet
  gridMinor: '#CFE9F6', // 1-cell rule
  gridMajor: '#A6D8EE', // every 5th rule
  ruleRed: '#E2453A', // the red margin line near the top
  ink: '#3E2FB8', // primary ballpoint violet
  inkSoft: '#6C5FD6', // secondary strokes, sprite fills
  inkFaint: '#B4ABEC', // hatching, revealed cells
  inkRed: '#C7261C', // X marks, "Arsenal", danger
  inkGreen: '#3E9B4F', // your-turn triangle, confirm buttons
  desk: '#6B4527', // wood letterbox outside the sheet
  deskDark: '#4E3119',
} as const;

/** 5.2 — one family, Bitter. 700 display, 600 buttons and labels, 500 body. */
export const font = {
  body: 'Bitter_500Medium',
  label: 'Bitter_600SemiBold',
  display: 'Bitter_700Bold',
} as const;

/**
 * 5.2 — modular scale, base 16, ratio 1.25, plus the family names.
 * No second display face. No all-caps labels.
 */
export const type = {
  xxs: 11,
  xs: 13,
  sm: 16,
  md: 20,
  lg: 25,
  xl: 31,
  xxl: 39,
  xxxl: 49,
  family: font,
} as const;

export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/**
 * 5.4 — the virtual canvas. Every screen is composed against 800 x 360 dp and
 * uniformly scaled to fit, letterboxed onto the desk. See src/ui/Scale.tsx.
 */
export const CANVAS_W = 800;
export const CANVAS_H = 360;

/**
 * The graph rules on the sheet. One cell is 28 units. `anchorX/anchorY` is a
 * point that must land on a MAJOR intersection — it is the left board's origin
 * (see src/board/layout.ts) so the board sits on the paper's own grid.
 */
export const PAPER_GRID = {
  unit: 28,
  major: 5,
  anchorX: 100,
  anchorY: 40,
  /** y of the red margin rule across the top of the sheet. */
  ruleY: 34,
} as const;

/** docs/assets.md 4.4 — line art is pure black and tinted at runtime. */
export const AVATAR_TINTS = [
  '#3E2FB8', // violet
  '#8A5A2B', // brown
  '#3A3A3A', // charcoal
  '#2E7D6B', // teal
  '#B4532A', // rust
  '#A62B36', // crimson
  '#2A5FA6', // blue
  '#93357A', // magenta
  '#3E7D3E', // green
  '#4A5568', // slate
] as const;

export type ColorToken = keyof typeof color;
export type AvatarTint = (typeof AVATAR_TINTS)[number];

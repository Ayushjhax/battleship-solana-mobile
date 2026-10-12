/**
 * Trailer45 — palette, type and easing. The game's palette (src/ui/tokens.ts)
 * plus ONE accent: `accent`, the lit-ink violet of "the bit".
 */
import { Easing } from 'remotion';

export const C = {
  // the game's tokens
  paper: '#FBFCFE',
  gridMinor: '#CFE9F6',
  gridMajor: '#A6D8EE',
  ruleRed: '#E2453A',
  ink: '#3E2FB8',
  inkSoft: '#6C5FD6',
  inkFaint: '#B4ABEC',
  inkRed: '#C7261C',
  inkGreen: '#3E9B4F',
  // the film
  black: '#000000',
  night: '#05040B', // deep, not crushed
  offWhite: '#F5F5F7',
  accent: '#7C6CFF', // the one accent: lit ballpoint ink — the bit
} as const;

/** Entrances ease out hard; moves ease in and out. Nothing linear. */
export const EASE_IN = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_MOVE = Easing.bezier(0.65, 0, 0.35, 1);

export const FONT = {
  card: 'Anton', //            trailer cards, ALL CAPS
  apple: 'Inter Tight', //     only for "Your move."
  game: 'Bitter', //           the game's own face: in-game names only
} as const;

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

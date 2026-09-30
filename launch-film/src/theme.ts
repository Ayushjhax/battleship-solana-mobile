/**
 * One system: colour, type, easing, geometry. Every scene draws from here.
 * Sizes are 4K canvas pixels (3840 × 2160).
 */
import {Easing} from 'remotion';

export const C = {
  black: '#000000',
  /** headline white: the game's paper, a touch cooler */
  white: '#F5F6FA',
  /** secondary text */
  mute: 'rgba(245,246,250,0.58)',
  /** THE accent: the game's inkSoft (#6C5FD6), lifted for light on black */
  accent: '#8E86E8',
  accentDeep: '#6C5FD6',
  /** the game's ink violet (ship line art) */
  ink: '#3E2FB8',
  /** graph-paper rule (gridMinor), used at low opacity */
  grid: '#CFE9F6',
} as const;

export const FONT = {
  head: 'Inter Tight',
  label: 'Inter',
  /** the game's display face: title and in-game names only */
  game: 'Bitter',
} as const;

/** 4K sizes (BRIEF §4.3) */
export const TYPE = {
  hero: 320,
  headline: 188,
  sub: 88,
  label: 52,
} as const;

/** tracking by size: tighter as it grows */
export const TRACK = {
  hero: '-0.04em',
  headline: '-0.035em',
  sub: '-0.02em',
  label: '-0.005em',
} as const;

/** 5 % title-safe */
export const SAFE = {x: 192, y: 108} as const;

/** one corner radius family */
export const RADIUS = {screen: 64, tile: 48, phone: 150} as const;

export const EASE = {
  /** entrances: cubic-bezier(0.16, 1, 0.3, 1) */
  enter: Easing.bezier(0.16, 1, 0.3, 1),
  /** camera: cubic-bezier(0.65, 0, 0.35, 1) */
  cam: Easing.bezier(0.65, 0, 0.35, 1),
  /** exits: accelerate away */
  exit: Easing.bezier(0.55, 0, 0.75, 0.2),
} as const;

/** frames (30 fps): entrances 0.73 s, exits ~30 % faster */
export const DUR = {enter: 22, exit: 15, word: 3} as const;

/** the soft shadow stack (one for the whole film); on black it reads as depth, not darkness */
export const SHADOW =
  '0 4px 10px rgba(0,0,0,0.5), 0 30px 80px rgba(0,0,0,0.55), 0 90px 200px rgba(0,0,0,0.6)';
/** 1px inner highlight at 1080p = 2px at 4K */
export const INNER_HIGHLIGHT = 'inset 0 0 0 2px rgba(255,255,255,0.14), inset 0 2px 0 0 rgba(255,255,255,0.22)';

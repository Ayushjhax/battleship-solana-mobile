import {interpolate} from 'remotion';
import {DUR, EASE} from '../theme';

export const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** 0 → 1 over an entrance (cubic-bezier(0.16, 1, 0.3, 1)). */
export const enter = (frame: number, start: number, dur: number = DUR.enter) =>
  interpolate(frame, [start, start + dur], [0, 1], {...CLAMP, easing: EASE.enter});

/** 0 → 1 over an exit (accelerating). */
export const exit = (frame: number, start: number, dur: number = DUR.exit) =>
  interpolate(frame, [start, start + dur], [0, 1], {...CLAMP, easing: EASE.exit});

/** 0 → 1 camera move (cubic-bezier(0.65, 0, 0.35, 1)). */
export const cam = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {...CLAMP, easing: EASE.cam});

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** in-then-out visibility: 0 → 1 at `inAt`, 1 → 0 at `outAt` (exit is faster). */
export const inOut = (frame: number, inAt: number, outAt: number | undefined, dIn: number = DUR.enter, dOut: number = DUR.exit) =>
  enter(frame, inAt, dIn) * (outAt === undefined ? 1 : 1 - exit(frame, outAt, dOut));

/** Deterministic pseudo-random in [-1, 1]. */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

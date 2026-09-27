/**
 * The reveal's countdown as arithmetic on a deadline — never a counter that
 * ticks, so a late timer, a dropped frame or a trip to the background cannot
 * make it run long, run short or start again. Pure TypeScript.
 */
import { REVEAL_MS } from './plan';

/** The whole second on the badge: 5 at the start, 1 in the last second. */
export function secondsShown(deadline: number, now: number): number {
  const left = deadline - now;
  if (left <= 0) return 0;
  return Math.min(Math.ceil(REVEAL_MS / 1000), Math.ceil(left / 1000));
}

/** How full the bar is: 1 at the start, 0 at the deadline. */
export function fractionLeft(deadline: number, now: number): number {
  return Math.max(0, Math.min(1, (deadline - now) / REVEAL_MS));
}

/** Until the badge next changes (or the deadline, whichever is first). */
export function msToNextChange(deadline: number, now: number): number {
  const left = deadline - now;
  if (left <= 0) return 0;
  const intoSecond = left % 1000;
  return intoSecond === 0 ? 1000 : intoSecond;
}

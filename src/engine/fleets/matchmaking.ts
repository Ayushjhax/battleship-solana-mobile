/**
 * War matchmaking — part-08 §4, tested by §7.3.
 *
 * §4: "Matchmaking pairs fleets by **average renown of the opted-in members**,
 * widening every 30 s, and gives up after 30 minutes with a friendly message."
 *
 * Three things that are easy to get subtly wrong and so are pinned here:
 *   - the average is over the OPTED-IN members, not the roster. A fleet of 30
 *     sending its five strongest is a 5v5 of strong captains, and pairing it
 *     against the roster average would be pairing it against a fiction.
 *   - a fleet with fewer opted-in members than the size cannot search at all.
 *   - the window widens on a schedule, so two fleets that start 20 s apart
 *     still meet: the window is a function of elapsed time, not of tries.
 */
import { WAR_SIZES, type WarSize } from './types';
import { SEARCH_GIVE_UP_MS } from './war';

/** §4 — "widening every 30 s". */
export const WIDEN_EVERY_MS = 30 * 1_000;

/** The window opens here and grows by this much each step. */
export const WINDOW_START = 150;
export const WINDOW_STEP = 120;

/**
 * How wide the renown window is after `elapsed` ms of searching. Uncapped
 * once the give-up point is reached, which never happens in practice — the
 * search is cancelled at the same moment — but makes the function total.
 */
export function renownWindow(elapsedMs: number): number {
  const steps = Math.max(0, Math.floor(elapsedMs / WIDEN_EVERY_MS));
  return WINDOW_START + steps * WINDOW_STEP;
}

export function shouldGiveUp(elapsedMs: number): boolean {
  return elapsedMs >= SEARCH_GIVE_UP_MS;
}

/** §4 — "gives up after 30 minutes with a friendly message." */
export const GIVE_UP_LINE =
  'Nobody your size is at sea just now. Try again this evening — there are more of us then.';

export interface OptedInMember {
  readonly userId: string;
  readonly renown: number;
  readonly optedIn: boolean;
}

/**
 * The average that matchmaking pairs on: **opted-in only**.
 *
 * Returns null when the fleet cannot field the size, so a caller cannot
 * accidentally treat "not enough people" as "average 0" and get paired
 * against the weakest fleet on the server.
 */
export function searchRating(
  members: readonly OptedInMember[],
  size: WarSize,
): { rating: number; roster: readonly OptedInMember[] } | null {
  const optedIn = members.filter((m) => m.optedIn);
  if (optedIn.length < size) return null;

  // If more opted in than the size, the strongest `size` of them go. That is
  // the fleet a war is actually fought by, so it is the fleet it is rated on.
  const roster = [...optedIn].sort((a, b) => b.renown - a.renown).slice(0, size);
  const rating = Math.round(roster.reduce((n, m) => n + m.renown, 0) / roster.length);
  return { rating, roster };
}

export interface SearchCheck {
  readonly ok: boolean;
  readonly reason: string | null;
}

export function canSearch(members: readonly OptedInMember[], size: WarSize): SearchCheck {
  if (!WAR_SIZES.includes(size)) {
    return { ok: false, reason: 'Wars are fought five, ten or fifteen a side.' };
  }
  const optedIn = members.filter((m) => m.optedIn).length;
  if (optedIn < size) {
    return {
      ok: false,
      reason: `${size} must sign the articles. ${optedIn} ${optedIn === 1 ? 'has' : 'have'} so far.`,
    };
  }
  return { ok: true, reason: null };
}

export interface SearchingFleet {
  readonly fleetId: string;
  readonly size: WarSize;
  readonly rating: number;
  readonly startedAt: number;
}

/**
 * Picks an opponent for `me` from the queue, or null.
 *
 * The window used is the WIDER of the two fleets' windows: a fleet that has
 * been waiting 20 minutes should be findable by one that just arrived, or the
 * long waiter never matches anybody. That is the rule that makes a thin
 * player base work, which is the same reason Part 6 has pirate coves.
 */
export function findOpponent(
  me: SearchingFleet,
  queue: readonly SearchingFleet[],
  now: number,
): SearchingFleet | null {
  const candidates = queue
    .filter((other) => other.fleetId !== me.fleetId && other.size === me.size)
    .filter((other) => {
      const window = Math.max(renownWindow(now - me.startedAt), renownWindow(now - other.startedAt));
      return Math.abs(other.rating - me.rating) <= window;
    });

  if (candidates.length === 0) return null;

  // Closest rating first; the longest waiter breaks a tie, so nobody starves.
  return [...candidates].sort((a, b) => {
    const da = Math.abs(a.rating - me.rating);
    const db = Math.abs(b.rating - me.rating);
    if (da !== db) return da - db;
    return a.startedAt - b.startedAt;
  })[0]!;
}

export { SEARCH_GIVE_UP_MS };

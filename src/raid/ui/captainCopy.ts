/**
 * Every typed error, in the Captain's voice — part-07 §2.3, §8.1.
 *
 * The rule, from Part 2: **no code reaches the player**. A test walks the
 * whole error union and fails if any code has no line, so adding a code to
 * `RaidApiErrorCode` without adding copy breaks the build rather than
 * shipping `bad-harbour` to a phone screen.
 *
 * Register, held from Part 2: plain, specific, and about what to DO. The
 * Captain never says "something went wrong" and never apologises twice.
 */
import type { RaidApiErrorCode } from '../types';

export const RAID_ERROR_LINES: Readonly<Record<RaidApiErrorCode, string>> = {
  offline: 'No signal out here. We will try again when the wind turns.',
  unauthenticated: 'The harbourmaster wants your papers again. Sign in and come back.',
  internal: 'Something fouled below decks. Give it a moment and try again.',
  'feature-off': 'The raiding fleet is still in dock. Not yet, Captain.',
  'no-profile': 'I cannot find your papers at all. Sign in and come back.',
  'needs-admiralty': 'Raids open at Admiralty 3. Build the Admiralty first.',
  'no-harbour': 'That harbour is empty — nothing to raid there.',
  'bad-harbour': 'That layout will not stand. Fix it and I will file it.',
  'bad-kit': 'The Armory cannot load that. Trim it down.',
  'insufficient-coins': 'Not enough coin for the charts. Collect from the city first.',
  'target-locked': 'Somebody beat you to them. Find another.',
  'raid-in-progress': 'You are already at sea. Finish that one first.',
  'no-session': 'That raid is already closed.',
  'not-found': 'I cannot find that one in the log.',
  'rate-limited': 'Steady on. One order at a time.',
};

export function raidErrorLine(code: RaidApiErrorCode): string {
  return RAID_ERROR_LINES[code] ?? RAID_ERROR_LINES.internal;
}

/**
 * The harbour validator's own errors (`@engine/raid`'s `HarbourError`), which
 * are a different union from the API's — §2.3 maps `invalid-layout` errors to
 * Captain lines too.
 */
export const HARBOUR_ERROR_LINES = {
  'bad-fleet': 'That is not a whole fleet. Every ship goes out.',
  'bad-placement': 'Two things are touching. Move one.',
  'over-fuel': 'More than Coastal Command will fuel. Sell something.',
  'over-cap': 'More of those than they will supply.',
  'not-researched': 'The Academy has not finished that one.',
  'not-a-defence': 'That one raids; it does not defend.',
  'needs-admiralty': 'Raids open at Admiralty 3.',
} as const;

export type HarbourErrorCode = keyof typeof HARBOUR_ERROR_LINES;

export function harbourErrorLine(code: string): string {
  return (
    (HARBOUR_ERROR_LINES as Record<string, string>)[code] ??
    'That layout will not stand. Fix it and I will file it.'
  );
}

// ---------------------------------------------------------------------------
// The screens' own copy
// ---------------------------------------------------------------------------

/** §1 — shown when the harbour has never been edited. */
export const UNEDITED_HARBOUR_LINE =
  'The dockyard laid this out for you. Move it before somebody learns it.';

/** §2 — the read-only banner while a raid on you is running. */
export const UNDER_ATTACK_LINE = 'Under attack — you can change this when they are done.';

/** §2 — leaving with unsaved changes. */
export const UNSAVED_TITLE = 'Leave the harbour as it was?';
export const UNSAVED_BODY = 'Your changes are not filed yet.';

/** §3 — the retreat confirm. */
export const RETREAT_TITLE = 'Keep what you have earned?';
export const RETREAT_BODY = 'We sail home with the stars we have.';

/** §3 — the cleared flourish. */
export const CLEARED_LINE = 'Harbour cleared';
export const CLEARED_HOLD_MS = 900;

/** §5 — what the defender is told after someone has seen their board. */
export const REPLAY_DEFENDER_LINE = 'They have seen your harbour now. Move something.';
export const REPLAY_AS_RECORDED_LINE =
  'The log is older than the charts, Captain. This is as it was recorded.';
export const REPLAY_UNAVAILABLE_LINE = 'That log did not survive. The result still stands.';

/** §4 — the menu card after being raided while away. */
export function raidedWhileAwayLine(stars: number, steel: number): string {
  const starWord = stars === 1 ? 'One star' : stars === 2 ? 'Two stars' : 'Three stars';
  return steel > 0
    ? `Your harbour was raided. ${starWord}, ${steel} steel gone.`
    : `Your harbour was raided. ${starWord}, nothing taken.`;
}

/** §3 step 2 — a cove says what it is. Never disguised as a person. */
export const COVE_RIBBON = 'Pirate cove — no renown';

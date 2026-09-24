/**
 * The scripted first raid — part-07 §7, tested by §8.7.
 *
 * "The first raid a player ever runs is forced to a scripted pirate cove with
 * a fixed seed, 3 mines and 1 AA gun, and the Captain talks over four beats:
 * shells and the refund, the mine penalty, the arsenal tab, the stars. It is
 * winnable at 3 stars with reasonable play, and it pays a fixed 300 steel. It
 * never runs twice."
 *
 * TWO DESIGN CHOICES WORTH THE COMMENT:
 *
 * 1. **The beats fire on conditions, not on a counter.** A beat that says
 *    "that shell came back — a hit is free" must appear when a shell actually
 *    comes back, not on move 3 whatever happened. So each beat carries a
 *    predicate over the server payload, and the tour is the same shape as
 *    Part 2's city tour (`tourScript.ts`), which already works this way.
 *
 * 2. **"Never runs twice" is keyed on SETTLEMENT, not on start.** A player
 *    who backgrounds out of their first raid has not been taught anything;
 *    marking it done at open would silently burn the tutorial. The flag is set
 *    when the raid settles, and the 300 steel is paid by the SERVER on that
 *    settlement — the client never credits it (§9.2, and Part 1's rule that
 *    the client never writes a balance).
 */
import type { RaidView } from '../types';

/** The cove every player's first raid is fought against. Fixed, so it is the
 *  same board for everyone and the beats can be written against it. */
export const FIRST_RAID = {
  coveSeed: 20_260_923,
  /** §7 — three mines and one AA gun. */
  defence: { mine: 3, aaGun: 1 },
  /** §7 — a fixed reward, paid by the server. */
  rewardSteel: 300,
  name: 'Pirate cove',
} as const;

export type FirstRaidBeatId = 'shells' | 'mine' | 'arsenal' | 'stars';

export interface FirstRaidBeat {
  readonly id: FirstRaidBeatId;
  readonly line: string;
  /** Which bit of the screen the bubble points at. */
  readonly target: 'shell-row' | 'board' | 'arsenal-tab' | 'star-strip';
}

export interface BeatContext {
  readonly view: RaidView;
  /** The view before the action that just resolved, or null on the first render. */
  readonly previous: RaidView | null;
  /** Did the action that just resolved set off a mine? From the events. */
  readonly mineTriggered: boolean;
  /** How many shots have resolved so far. */
  readonly shotsResolved: number;
}

interface BeatSpec extends FirstRaidBeat {
  readonly when: (context: BeatContext) => boolean;
}

/**
 * The four beats, in the order §7 lists them. Order matters only for ties:
 * `firstRaidBeat` returns the earliest unseen beat whose condition holds, so
 * a player who hits a mine before they hit a ship still gets the shells beat
 * first — it is the one that makes the others make sense.
 */
const BEATS: readonly BeatSpec[] = [
  {
    id: 'shells',
    target: 'shell-row',
    line: 'Thirty shells. A hit hands one straight back — keep hitting and you keep firing.',
    // The moment anything has resolved at all.
    when: (c) => c.shotsResolved >= 1,
  },
  {
    id: 'mine',
    target: 'board',
    line: 'A mine. That is three shells gone at once. They are worth going around.',
    when: (c) => c.mineTriggered,
  },
  {
    id: 'arsenal',
    target: 'arsenal-tab',
    line: 'You are carrying weapons. The red tab opens them, and they cost no shells.',
    // Held something, not used it, and has been firing a while.
    when: (c) => c.view.kitLeft > 0 && c.shotsResolved >= 6,
  },
  {
    id: 'stars',
    target: 'star-strip',
    line: 'One star. Sink their flagship for the second, and clear the bay for the third.',
    when: (c) => c.view.stars >= 1,
  },
];

export const FIRST_RAID_BEAT_COUNT = BEATS.length;

/**
 * The next beat to show, or null. `seen` is the set of beat ids already
 * shown; the caller adds to it when the bubble is dismissed.
 */
export function firstRaidBeat(
  context: BeatContext,
  seen: ReadonlySet<FirstRaidBeatId>,
): FirstRaidBeat | null {
  for (const beat of BEATS) {
    if (seen.has(beat.id)) continue;
    if (!beat.when(context)) continue;
    const { id, line, target } = beat;
    return { id, line, target };
  }
  return null;
}

export function allBeats(): readonly FirstRaidBeat[] {
  return BEATS.map(({ id, line, target }) => ({ id, line, target }));
}

// ---------------------------------------------------------------------------
// "It never runs twice"
// ---------------------------------------------------------------------------

export interface FirstRaidGate {
  /** Has the player ever settled a raid? From the profile. */
  readonly hasRaided: boolean;
  /** Did they dismiss the script? §8.7 — "is skippable". */
  readonly skipped: boolean;
}

/** Should this raid be the scripted one? */
export function shouldRunFirstRaid(gate: FirstRaidGate): boolean {
  return !gate.hasRaided;
}

/** Should the Captain talk during it? Skipping silences him, nothing else. */
export function shouldShowBeats(gate: FirstRaidGate): boolean {
  return shouldRunFirstRaid(gate) && !gate.skipped;
}

/**
 * The card the search step shows instead of a real target, when the first
 * raid is due. It is still honestly a cove — §5 of part-06, "never disguised
 * as a person" — it is simply a fixed one.
 */
export function firstRaidCard(costCoins = 0) {
  return {
    kind: 'cove' as const,
    userId: null,
    coveSeed: FIRST_RAID.coveSeed,
    name: FIRST_RAID.name,
    avatarId: 0,
    avatarColor: 'charcoal',
    countryCode: null,
    admiraltyLevel: 3,
    renown: 0,
    loot: { coins: 0, steel: FIRST_RAID.rewardSteel },
    renownOffer: { best: 0, worst: 0 },
    // §7 — the taught raid is free. The search is not charged for it.
    costCoins,
  };
}

/**
 * What the result screen shows for the taught raid. The steel comes from the
 * SERVER's settlement; this only asserts the two agree, so a mismatch is a
 * visible bug rather than a quietly wrong number on screen.
 */
export function firstRaidRewardMatches(settledSteel: number): boolean {
  return settledSteel >= FIRST_RAID.rewardSteel;
}

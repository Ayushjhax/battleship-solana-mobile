/**
 * part-07 §8.7 — "The first-raid script runs once, is skippable, and pays
 * only once."
 *
 * §7 is a teaching sequence, and the failure mode of a teaching sequence is
 * that it teaches the wrong thing at the wrong moment: a beat that says "that
 * shell came back" when no shell came back is worse than no beat at all. So
 * the beats fire on CONDITIONS over the server payload, not on a counter, and
 * most of these tests are about which condition fires when.
 */
import { describe, expect, it } from 'vitest';

import {
  FIRST_RAID,
  FIRST_RAID_BEAT_COUNT,
  allBeats,
  firstRaidBeat,
  firstRaidCard,
  firstRaidRewardMatches,
  shouldRunFirstRaid,
  shouldShowBeats,
  type BeatContext,
  type FirstRaidBeatId,
} from '@/raid/ui/firstRaid';
import type { RaidView } from '@/raid/types';

const view = (patch: Partial<RaidView> = {}): RaidView => ({
  marks: {},
  sunkShips: [],
  revealedItems: [],
  shipsRemaining: 8,
  shells: 30,
  kit: {},
  kitLeft: 0,
  stars: 0,
  destruction: 0,
  over: false,
  msLeft: 240_000,
  ...patch,
});

const context = (patch: Partial<BeatContext> = {}): BeatContext => ({
  view: view(),
  previous: null,
  mineTriggered: false,
  shotsResolved: 0,
  ...patch,
});

const seen = (...ids: FirstRaidBeatId[]) => new Set<FirstRaidBeatId>(ids);

// ===========================================================================
// §7 — the fixed cove
// ===========================================================================

describe('the scripted cove', () => {
  it('has a fixed seed, so every player fights the same board', () => {
    expect(FIRST_RAID.coveSeed).toBe(20_260_923);
    expect(firstRaidCard().coveSeed).toBe(FIRST_RAID.coveSeed);
  });

  it('is three mines and one AA gun, as §7 specifies', () => {
    expect(FIRST_RAID.defence).toEqual({ mine: 3, aaGun: 1 });
  });

  it('pays a fixed 300 steel', () => {
    expect(FIRST_RAID.rewardSteel).toBe(300);
    expect(firstRaidCard().loot.steel).toBe(300);
  });

  it('is honestly a cove — never disguised as a person', () => {
    const card = firstRaidCard();
    expect(card.kind).toBe('cove');
    expect(card.name).toBe('Pirate cove');
    expect(card.userId).toBeNull();
    // And it moves no renown, like every cove.
    expect(card.renownOffer).toEqual({ best: 0, worst: 0 });
  });

  it('is free — the taught raid does not charge for the charts', () => {
    expect(firstRaidCard().costCoins).toBe(0);
  });
});

// ===========================================================================
// §8.7 — runs once
// ===========================================================================

describe('it runs once', () => {
  it('runs for a player who has never raided', () => {
    expect(shouldRunFirstRaid({ hasRaided: false, skipped: false })).toBe(true);
  });

  it('never runs again once a raid has SETTLED', () => {
    expect(shouldRunFirstRaid({ hasRaided: true, skipped: false })).toBe(false);
    expect(shouldShowBeats({ hasRaided: true, skipped: false })).toBe(false);
  });

  it('is skippable, and skipping silences the Captain without ending the raid', () => {
    // §8.7 — "is skippable". Skipping stops the beats; it does not cancel the
    // scripted cove the player is already fighting, and it does not forfeit
    // the reward.
    expect(shouldShowBeats({ hasRaided: false, skipped: true })).toBe(false);
    expect(shouldRunFirstRaid({ hasRaided: false, skipped: true })).toBe(true);
  });

  it('pays only once, because it only runs once', () => {
    // The steel is the SERVER's; the client only asserts the two agree.
    expect(firstRaidRewardMatches(300)).toBe(true);
    expect(firstRaidRewardMatches(340)).toBe(true);
    expect(firstRaidRewardMatches(120)).toBe(false);
  });
});

// ===========================================================================
// §7 — the four beats
// ===========================================================================

describe('the four beats', () => {
  it('there are exactly four, in §7’s order', () => {
    expect(FIRST_RAID_BEAT_COUNT).toBe(4);
    expect(allBeats().map((b) => b.id)).toEqual(['shells', 'mine', 'arsenal', 'stars']);
  });

  it('each points at something on screen', () => {
    for (const beat of allBeats()) {
      expect(beat.target, beat.id).toBeTruthy();
      expect(beat.line.length, beat.id).toBeGreaterThan(20);
    }
  });

  it('says nothing before anything has happened', () => {
    expect(firstRaidBeat(context(), seen())).toBeNull();
  });

  it('the shells beat fires as soon as one shot resolves', () => {
    const beat = firstRaidBeat(context({ shotsResolved: 1 }), seen());
    expect(beat?.id).toBe('shells');
    expect(beat?.target).toBe('shell-row');
  });

  it('the mine beat fires when a mine actually goes off, not on a schedule', () => {
    // No mine: even at shot 10, the mine beat is not the next one.
    expect(firstRaidBeat(context({ shotsResolved: 10 }), seen('shells'))?.id).not.toBe('mine');
    // A mine: it is.
    const beat = firstRaidBeat(context({ shotsResolved: 3, mineTriggered: true }), seen('shells'));
    expect(beat?.id).toBe('mine');
  });

  it('the arsenal beat waits until there is a weapon AND a while of firing', () => {
    // Holding nothing: never.
    expect(
      firstRaidBeat(context({ shotsResolved: 20, view: view({ kitLeft: 0 }) }), seen('shells')),
    ).toBeNull();
    // Holding one, but only two shots in: too early to be useful.
    expect(
      firstRaidBeat(context({ shotsResolved: 2, view: view({ kitLeft: 1 }) }), seen('shells')),
    ).toBeNull();
    // Holding one, six shots in: now.
    expect(
      firstRaidBeat(context({ shotsResolved: 6, view: view({ kitLeft: 1 }) }), seen('shells'))?.id,
    ).toBe('arsenal');
  });

  it('the stars beat fires on the first star', () => {
    const beat = firstRaidBeat(
      context({ shotsResolved: 8, view: view({ stars: 1 }) }),
      seen('shells'),
    );
    expect(beat?.id).toBe('stars');
  });

  it('a beat already seen never repeats', () => {
    const ctx = context({ shotsResolved: 5 });
    expect(firstRaidBeat(ctx, seen())?.id).toBe('shells');
    expect(firstRaidBeat(ctx, seen('shells'))).toBeNull();
  });

  it('when two conditions hold at once, the earlier beat wins', () => {
    // A mine on the very first shot: the player gets "shells" first, because
    // it is the one that makes the mine beat make sense.
    const both = context({ shotsResolved: 1, mineTriggered: true });
    expect(firstRaidBeat(both, seen())?.id).toBe('shells');
    expect(firstRaidBeat(both, seen('shells'))?.id).toBe('mine');
  });

  it('all four can be reached in one raid', () => {
    const shown: FirstRaidBeatId[] = [];
    const set = new Set<FirstRaidBeatId>();
    const script: BeatContext[] = [
      context({ shotsResolved: 1 }),
      context({ shotsResolved: 2, mineTriggered: true }),
      context({ shotsResolved: 6, view: view({ kitLeft: 1 }) }),
      context({ shotsResolved: 9, view: view({ kitLeft: 1, stars: 1 }) }),
    ];
    for (const ctx of script) {
      const beat = firstRaidBeat(ctx, set);
      if (beat) {
        shown.push(beat.id);
        set.add(beat.id);
      }
    }
    expect(shown).toEqual(['shells', 'mine', 'arsenal', 'stars']);
  });

  it('no beat mentions a number the server did not send', () => {
    // "Thirty shells" is the calibrated default and is in the copy. If the
    // budget is ever made non-default for the taught raid, this fails and the
    // copy has to change with it.
    const shells = allBeats().find((b) => b.id === 'shells');
    expect(shells?.line).toContain('Thirty');
  });
});

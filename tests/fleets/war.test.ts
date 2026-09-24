/**
 * War matchmaking and scoring — part-08 §7.3 and §7.4.
 *
 *   7.3 "only opted-in members count; sizes; widening; the give-up path"
 *   7.4 "best-stars-per-target, both tiebreaks, and a member who never attacks"
 */
import { describe, expect, it } from 'vitest';

import {
  BATTLE_MS,
  GIVE_UP_LINE,
  PARTICIPATION_STEEL,
  PREP_MS,
  RAIDS_PER_MEMBER,
  SEARCH_GIVE_UP_MS,
  WAR_CHEST_BASE,
  WAR_SIZES,
  WAR_WIN_GEMS,
  WIDEN_EVERY_MS,
  WINDOW_START,
  WINDOW_STEP,
  bestPerTarget,
  canSearch,
  canTransition,
  dueTransition,
  findOpponent,
  memberRewards,
  raidsLeft,
  renownWindow,
  searchRating,
  shouldGiveUp,
  sideScore,
  warResult,
  warSchedule,
  type OptedInMember,
  type SearchingFleet,
  type War,
  type WarMember,
  type WarRaid,
} from '@engine/fleets';

const raid = (
  attackerId: string,
  targetUserId: string,
  stars: number,
  destruction: number,
  finishedAt: number,
): WarRaid => ({ warId: 'w', raidId: `${attackerId}-${targetUserId}-${finishedAt}`, attackerId, targetUserId, stars, destruction, finishedAt });

const warMember = (userId: string, fleetId: string, raidsUsed: number): WarMember => ({
  warId: 'w',
  userId,
  fleetId,
  renown: 800,
  raidsUsed,
});

const opted = (userId: string, renown: number, optedIn = true): OptedInMember => ({
  userId,
  renown,
  optedIn,
});

// ===========================================================================
// §7.3 — matchmaking
// ===========================================================================

describe('only opted-in members count', () => {
  it('rates a fleet on the members who signed up, not the roster', () => {
    const members = [
      opted('a', 2_000),
      opted('b', 2_000),
      opted('c', 2_000),
      opted('d', 2_000),
      opted('e', 2_000),
      // Twenty-five quiet Sailors who did not opt in.
      ...Array.from({ length: 25 }, (_, n) => opted(`q${n}`, 100, false)),
    ];
    const rating = searchRating(members, 5);
    expect(rating?.rating).toBe(2_000); // not (5*2000 + 25*100) / 30 = 417
    expect(rating?.roster).toHaveLength(5);
  });

  it('returns null — not zero — when too few opted in', () => {
    // Zero would pair a short-handed fleet against the weakest on the server.
    expect(searchRating([opted('a', 900), opted('b', 900)], 5)).toBeNull();
  });

  it('sends the strongest `size` when more opted in than needed', () => {
    const members = [opted('a', 100), opted('b', 900), opted('c', 500), opted('d', 700), opted('e', 300), opted('f', 800)];
    const rating = searchRating(members, 5);
    expect(rating?.roster.map((m) => m.userId)).toEqual(['b', 'f', 'd', 'c', 'e']);
    expect(rating?.rating).toBe(Math.round((900 + 800 + 700 + 500 + 300) / 5));
  });

  it('refuses a search a fleet cannot field, and counts who has signed', () => {
    const check = canSearch([opted('a', 900), opted('b', 900)], 5);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('2 have');
  });

  it('says "1 has", not "1 have"', () => {
    expect(canSearch([opted('a', 900)], 5).reason).toContain('1 has');
  });

  it('allows a search at exactly the size', () => {
    const five = Array.from({ length: 5 }, (_, n) => opted(`m${n}`, 800));
    expect(canSearch(five, 5).ok).toBe(true);
  });

  it('only 5, 10 and 15 are war sizes', () => {
    expect(WAR_SIZES).toEqual([5, 10, 15]);
    const many = Array.from({ length: 30 }, (_, n) => opted(`m${n}`, 800));
    expect(canSearch(many, 7 as never).ok).toBe(false);
    for (const size of WAR_SIZES) {
      expect(canSearch(many, size).ok, String(size)).toBe(true);
    }
  });
});

describe('the widening window', () => {
  it('opens at 150 and widens every 30 s', () => {
    expect(WIDEN_EVERY_MS).toBe(30_000);
    expect(renownWindow(0)).toBe(WINDOW_START);
    expect(renownWindow(29_999)).toBe(WINDOW_START);
    expect(renownWindow(30_000)).toBe(WINDOW_START + WINDOW_STEP);
    expect(renownWindow(60_000)).toBe(WINDOW_START + 2 * WINDOW_STEP);
  });

  it('never narrows', () => {
    let previous = 0;
    for (let t = 0; t <= SEARCH_GIVE_UP_MS; t += 15_000) {
      const w = renownWindow(t);
      expect(w).toBeGreaterThanOrEqual(previous);
      previous = w;
    }
  });

  it('finds nobody at first and somebody once it has widened', () => {
    const me: SearchingFleet = { fleetId: 'me', size: 5, rating: 1_000, startedAt: 0 };
    const far: SearchingFleet = { fleetId: 'far', size: 5, rating: 1_500, startedAt: 0 };

    expect(findOpponent(me, [far], 0)).toBeNull();
    // 500 apart needs a window of 500: 150 + 3*120 = 510, at 90 s.
    expect(findOpponent(me, [far], 90_000)?.fleetId).toBe('far');
  });

  it('uses the WIDER of the two windows, so a long waiter is findable', () => {
    // `patient` has been searching 10 minutes; `me` just arrived. Without the
    // max(), `me`'s narrow window would hide a fleet that has waited longest.
    const me: SearchingFleet = { fleetId: 'me', size: 5, rating: 1_000, startedAt: 600_000 };
    const patient: SearchingFleet = { fleetId: 'patient', size: 5, rating: 1_900, startedAt: 0 };
    expect(findOpponent(me, [patient], 600_000)?.fleetId).toBe('patient');
  });

  it('never pairs a fleet with itself, or across sizes', () => {
    const me: SearchingFleet = { fleetId: 'me', size: 5, rating: 1_000, startedAt: 0 };
    expect(findOpponent(me, [me], 999_999)).toBeNull();
    const tenner: SearchingFleet = { fleetId: 'x', size: 10, rating: 1_000, startedAt: 0 };
    expect(findOpponent(me, [tenner], 999_999)).toBeNull();
  });

  it('prefers the closest rating, then the longest waiter', () => {
    const me: SearchingFleet = { fleetId: 'me', size: 5, rating: 1_000, startedAt: 0 };
    const near: SearchingFleet = { fleetId: 'near', size: 5, rating: 1_050, startedAt: 500_000 };
    const far: SearchingFleet = { fleetId: 'far', size: 5, rating: 1_140, startedAt: 0 };
    expect(findOpponent(me, [far, near], 600_000)?.fleetId).toBe('near');

    const tieA: SearchingFleet = { fleetId: 'a', size: 5, rating: 1_100, startedAt: 400_000 };
    const tieB: SearchingFleet = { fleetId: 'b', size: 5, rating: 1_100, startedAt: 100_000 };
    expect(findOpponent(me, [tieA, tieB], 600_000)?.fleetId).toBe('b');
  });
});

describe('the give-up path', () => {
  it('gives up after 30 minutes', () => {
    expect(SEARCH_GIVE_UP_MS).toBe(30 * 60 * 1_000);
    expect(shouldGiveUp(29 * 60_000)).toBe(false);
    expect(shouldGiveUp(30 * 60_000)).toBe(true);
  });

  it('has a friendly message — §4 asks for one by name', () => {
    expect(GIVE_UP_LINE).toBeTruthy();
    expect(GIVE_UP_LINE.toLowerCase()).not.toContain('error');
    expect(GIVE_UP_LINE.toLowerCase()).not.toContain('fail');
    // It suggests what to do next, which is what makes it friendly.
    expect(GIVE_UP_LINE).toContain('again');
  });
});

// ===========================================================================
// §7.4 — scoring
// ===========================================================================

describe('best stars per target', () => {
  const targets = ['t1', 't2', 't3'];

  it('takes the best anyone achieved, not the last or the first', () => {
    const raids = [
      raid('a1', 't1', 1, 0.3, 100),
      raid('a2', 't1', 3, 1.0, 200),
      raid('a3', 't1', 2, 0.6, 300),
    ];
    const [t1] = bestPerTarget(['t1'], raids);
    expect(t1?.stars).toBe(3);
    expect(t1?.byUserId).toBe('a2');
    expect(t1?.attempts).toBe(3);
  });

  it('an untouched target scores zero and records no attempts', () => {
    const scores = bestPerTarget(targets, [raid('a1', 't1', 2, 0.5, 100)]);
    const t3 = scores.find((s) => s.targetUserId === 't3')!;
    expect(t3).toMatchObject({ stars: 0, destruction: 0, attempts: 0, byUserId: null });
  });

  it('a side’s total is the sum of its targets’ bests', () => {
    const raids = [
      raid('a1', 't1', 3, 1.0, 100),
      raid('a2', 't2', 2, 0.55, 200),
      raid('a1', 't2', 1, 0.2, 300),
    ];
    const score = sideScore(targets, raids);
    expect(score.stars).toBe(5);
    expect(score.destruction).toBeCloseTo(1.55, 6);
  });

  it('picks the more destructive raid when the stars tie', () => {
    // This matters: the chosen raid's destruction feeds the fleet's total,
    // which is the FIRST tiebreak between fleets.
    const raids = [raid('a1', 't1', 2, 0.55, 100), raid('a2', 't1', 2, 0.72, 200)];
    const [t1] = bestPerTarget(['t1'], raids);
    expect(t1?.destruction).toBeCloseTo(0.72, 6);
    expect(t1?.byUserId).toBe('a2');
  });

  it('picks the earlier raid when stars AND destruction tie', () => {
    const raids = [raid('late', 't1', 2, 0.5, 900), raid('early', 't1', 2, 0.5, 100)];
    expect(bestPerTarget(['t1'], raids)[0]?.byUserId).toBe('early');
  });
});

describe('the war result', () => {
  const A = ['a1', 'a2'];
  const B = ['b1', 'b2'];

  it('is decided on stars first', () => {
    const result = warResult(A, [raid('a1', 'b1', 3, 1.0, 100)], B, [raid('b1', 'a1', 1, 0.2, 100)]);
    expect(result.winner).toBe('a');
    expect(result.decidedBy).toBe('stars');
  });

  it('TIEBREAK 1: total destruction', () => {
    const result = warResult(
      A,
      [raid('a1', 'b1', 2, 0.80, 100)],
      B,
      [raid('b1', 'a1', 2, 0.55, 100)],
    );
    expect(result.winner).toBe('a');
    expect(result.decidedBy).toBe('destruction');
  });

  it('TIEBREAK 2: the earlier finish', () => {
    const result = warResult(
      A,
      [raid('a1', 'b1', 2, 0.5, 500)],
      B,
      [raid('b1', 'a1', 2, 0.5, 100)],
    );
    expect(result.winner).toBe('b');
    expect(result.decidedBy).toBe('finish');
  });

  it('a war nobody fought is a DRAW, not a race won by a zero timestamp', () => {
    const result = warResult(A, [], B, []);
    expect(result.winner).toBe('draw');
    expect(result.decidedBy).toBe('draw');
  });

  it('one side attacking and the other not is a win on stars, not on finish', () => {
    const result = warResult(A, [raid('a1', 'b1', 1, 0.2, 100)], B, []);
    expect(result.winner).toBe('a');
    expect(result.decidedBy).toBe('stars');
  });

  it('scores each side over the OTHER side’s harbours', () => {
    // A raid by a1 against b1 counts for A. If the sides were swapped, A's
    // stars would be 0 and this would be a draw.
    const result = warResult(A, [raid('a1', 'b1', 3, 1, 100)], B, []);
    expect(result.a.stars).toBe(3);
    expect(result.b.stars).toBe(0);
  });
});

// ===========================================================================
// §7.4 — "a member who never attacks"
// ===========================================================================

describe('rewards', () => {
  const size = 5 as const;

  it('a member who used NO raids gets nothing, and is marked', () => {
    const rewards = memberRewards([warMember('idle', 'f', 0)], size, 5, true);
    expect(rewards[0]).toMatchObject({ steel: 0, coins: 0, gems: 0, noShow: true, participated: false });
  });

  it('a member who used BOTH raids gets the participation bonus', () => {
    const rewards = memberRewards([warMember('keen', 'f', RAIDS_PER_MEMBER)], size, 5, true);
    expect(rewards[0]?.participated).toBe(true);
    expect(rewards[0]!.steel).toBeGreaterThan(PARTICIPATION_STEEL);
  });

  it('a member who used ONE raid is paid, but gets no participation bonus', () => {
    const half = memberRewards([warMember('half', 'f', 1)], size, 5, true)[0]!;
    const full = memberRewards([warMember('full', 'f', 2)], size, 5, true)[0]!;
    expect(half.noShow).toBe(false);
    expect(half.participated).toBe(false);
    expect(full.steel - half.steel).toBe(PARTICIPATION_STEEL);
  });

  it('winners get 10 gems each; losers get none', () => {
    expect(memberRewards([warMember('w', 'f', 2)], size, 5, true)[0]?.gems).toBe(WAR_WIN_GEMS);
    expect(memberRewards([warMember('l', 'f', 2)], size, 5, false)[0]?.gems).toBe(0);
  });

  it('the loser gets a third', () => {
    const won = memberRewards([warMember('w', 'f', 2)], size, 6, true)[0]!;
    const lost = memberRewards([warMember('l', 'f', 2)], size, 6, false)[0]!;
    // Coins have no participation bonus on top, so the ratio is clean.
    expect(lost.coins).toBe(Math.floor(won.coins / 3));
  });

  it('a draw pays both sides the loser share, and no gems', () => {
    const draw = memberRewards([warMember('d', 'f', 2)], size, 4, false, true)[0]!;
    const lost = memberRewards([warMember('l', 'f', 2)], size, 4, false)[0]!;
    expect(draw.coins).toBe(lost.coins);
    expect(draw.gems).toBe(0);
  });

  it('the chest scales with war size and with stars', () => {
    const small = memberRewards([warMember('m', 'f', 2)], 5, 0, true)[0]!;
    const big = memberRewards([warMember('m', 'f', 2)], 15, 0, true)[0]!;
    expect(WAR_CHEST_BASE[15].steel).toBeGreaterThan(WAR_CHEST_BASE[5].steel);
    // Per head, a 15v15 chest split 15 ways is not automatically bigger, so
    // this asserts the chest itself, which is the number the doc describes.
    expect(big.coins + small.coins).toBeGreaterThan(0);

    const noStars = memberRewards([warMember('m', 'f', 2)], 5, 0, true)[0]!;
    const manyStars = memberRewards([warMember('m', 'f', 2)], 5, 15, true)[0]!;
    expect(manyStars.steel).toBeGreaterThan(noStars.steel);
  });

  it('splits the chest between the members who showed up', () => {
    const one = memberRewards([warMember('a', 'f', 2)], size, 5, true)[0]!;
    const five = memberRewards(
      Array.from({ length: 5 }, (_, n) => warMember(`m${n}`, 'f', 2)),
      size,
      5,
      true,
    )[0]!;
    expect(five.coins).toBeLessThan(one.coins);
  });

  it('never pays a negative or a fraction', () => {
    for (const size of WAR_SIZES) {
      for (const stars of [0, 7, 45]) {
        for (const won of [true, false]) {
          const rewards = memberRewards(
            Array.from({ length: size }, (_, n) => warMember(`m${n}`, 'f', n % 3)),
            size,
            stars,
            won,
          );
          for (const r of rewards) {
            expect(Number.isInteger(r.steel)).toBe(true);
            expect(Number.isInteger(r.coins)).toBe(true);
            expect(r.steel).toBeGreaterThanOrEqual(0);
            expect(r.coins).toBeGreaterThanOrEqual(0);
            expect(r.gems).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

// ===========================================================================
// The clock and the state machine
// ===========================================================================

describe('the war clock', () => {
  it('is 22 hours of prep and 24 of battle', () => {
    expect(PREP_MS).toBe(22 * 3_600_000);
    expect(BATTLE_MS).toBe(24 * 3_600_000);
  });

  it('schedules both ends from the pairing', () => {
    const schedule = warSchedule(1_000);
    expect(schedule.prepEndsAt).toBe(1_000 + PREP_MS);
    expect(schedule.battleEndsAt).toBe(1_000 + PREP_MS + BATTLE_MS);
  });

  it('gives each member two raids', () => {
    expect(RAIDS_PER_MEMBER).toBe(2);
    expect(raidsLeft(warMember('a', 'f', 0))).toBe(2);
    expect(raidsLeft(warMember('a', 'f', 2))).toBe(0);
    expect(raidsLeft(warMember('a', 'f', 9))).toBe(0);
  });
});

describe('the state machine', () => {
  const war = (patch: Partial<War>): War => ({
    id: 'w',
    fleetA: 'a',
    fleetB: 'b',
    size: 5,
    state: 'prep',
    searchStartedAt: 0,
    prepEndsAt: null,
    battleEndsAt: null,
    settledAt: null,
    starsA: 0,
    starsB: 0,
    ...patch,
  });

  it('allows only the legal moves', () => {
    expect(canTransition('searching', 'prep')).toBe(true);
    expect(canTransition('prep', 'battle')).toBe(true);
    expect(canTransition('battle', 'settling')).toBe(true);
    expect(canTransition('settling', 'ended')).toBe(true);

    // And nothing else. In particular, nothing goes backwards.
    expect(canTransition('battle', 'prep')).toBe(false);
    expect(canTransition('ended', 'settling')).toBe(false);
    expect(canTransition('ended', 'battle')).toBe(false);
    expect(canTransition('cancelled', 'prep')).toBe(false);
    expect(canTransition('searching', 'battle')).toBe(false);
  });

  it('says what the clock is due', () => {
    expect(dueTransition(war({ state: 'prep', prepEndsAt: 500 }), 400)).toBeNull();
    expect(dueTransition(war({ state: 'prep', prepEndsAt: 500 }), 500)).toBe('battle');
    expect(dueTransition(war({ state: 'battle', battleEndsAt: 500 }), 600)).toBe('settling');
    expect(dueTransition(war({ state: 'searching', searchStartedAt: 0 }), SEARCH_GIVE_UP_MS)).toBe('cancelled');
    expect(dueTransition(war({ state: 'searching', searchStartedAt: 0 }), 1_000)).toBeNull();
  });

  it('settling is not time-driven — it ends when the payment commits', () => {
    expect(dueTransition(war({ state: 'settling' }), 0)).toBe('ended');
    expect(dueTransition(war({ state: 'settling' }), 999_999_999)).toBe('ended');
  });

  it('an ended or cancelled war is never due for anything', () => {
    expect(dueTransition(war({ state: 'ended' }), 999_999_999)).toBeNull();
    expect(dueTransition(war({ state: 'cancelled' }), 999_999_999)).toBeNull();
  });
});

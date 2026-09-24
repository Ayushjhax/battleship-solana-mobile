/**
 * Resets, rerolls and the Captain's Log — part-04 §5.2, §5.3, §5.7.
 *
 * §5.7 is the unusual one and the reason this file matters: "Ink pacing test:
 * a simulated active player finishes 30 pages between day 18 and 24; a casual
 * player lands between page 10 and 18. **This test locks the pacing target, so
 * if someone changes a reward it fails loudly.**"
 *
 * So the pacing assertions below are not describing the code — they are a
 * contract the code has to keep, and the failure message says what to do about
 * it (§2: "Tune `inkPerPage` first, never the rewards").
 */
import { describe, expect, it } from 'vitest';

import {
  ACTIVE_PLAYER,
  CASUAL_PLAYER,
  CONTRACTS,
  DAY_MS,
  FREE_REROLLS_PER_DAY,
  INK,
  INK_PER_PAGE,
  PREMIUM_GEMS,
  REROLL_GEM_COST,
  SEASON_DAYS,
  SEASON_PAGES,
  claimablePages,
  dailyExpired,
  dailySlots,
  eligible,
  freeRerolls,
  inkForContract,
  inkForMatch,
  inkIntoPage,
  issue,
  nextDailyReset,
  nextWeeklyReset,
  pageFor,
  rerollCost,
  reroll,
  rewardFor,
  rewardForPage,
  simulate,
  utcDay,
  wasActiveAt,
  weekStart,
  weeklyExpired,
  withPremium,
} from '@engine/bounties';

const iso = (s: string) => Date.parse(s);

// ===========================================================================
// §5.2 — reset boundaries
// ===========================================================================

describe('the UTC day boundary', () => {
  it('rolls at 00:00:00 UTC and not a millisecond before', () => {
    const justBefore = iso('2026-09-23T23:59:59.999Z');
    const exactly = iso('2026-09-24T00:00:00.000Z');

    expect(utcDay(justBefore)).toBe('2026-09-23');
    expect(utcDay(exactly)).toBe('2026-09-24');

    const issued = iso('2026-09-23T10:00:00Z');
    expect(dailyExpired(issued, justBefore)).toBe(false);
    expect(dailyExpired(issued, exactly)).toBe(true);
  });

  it('is the SAME instant for a player in any timezone', () => {
    // §5.2 asks for "a player in a different timezone". There is no timezone
    // parameter anywhere in this module, and that is the answer: a daily
    // rolling at local midnight would give Auckland and Los Angeles different
    // numbers of days per season, and there is no fair way to pick.
    const instant = iso('2026-09-24T00:00:00Z');
    expect(utcDay(instant)).toBe('2026-09-24');
    // The same wall-clock moment, expressed from a +13 offset, is the same ms.
    expect(utcDay(Date.parse('2026-09-24T13:00:00+13:00'))).toBe('2026-09-24');
  });

  it('survives a clock jump backwards without expiring early', () => {
    const issued = iso('2026-09-23T12:00:00Z');
    // A leap-second-ish stumble: time goes back a second.
    expect(dailyExpired(issued, issued - 1_000)).toBe(false);
  });

  it('expires at the next MIDNIGHT, not 24 hours after it was issued', () => {
    // A daily issued at noon has twelve hours, not twenty-four. §1 says
    // "reset 00:00 UTC", and a rolling 24-hour window would drift the board
    // later every day until it rolled at a different hour each week.
    const noon = iso('2026-09-23T12:00:00Z');
    expect(dailyExpired(noon, noon + 11 * 3_600_000)).toBe(false);
    expect(dailyExpired(noon, noon + 12 * 3_600_000)).toBe(true);
    expect(nextDailyReset(noon)).toBe(iso('2026-09-24T00:00:00Z'));
    // ...and a full DAY_MS later is well past it.
    expect(dailyExpired(noon, noon + DAY_MS)).toBe(true);
  });

  it('the next reset is always in the future and always at midnight', () => {
    for (const at of ['2026-01-01T00:00:00Z', '2026-06-15T13:45:12Z', '2026-12-31T23:59:59Z']) {
      const now = iso(at);
      const next = nextDailyReset(now);
      expect(next).toBeGreaterThan(now);
      expect(new Date(next).toISOString()).toContain('T00:00:00.000Z');
    }
  });
});

describe('the UTC week boundary', () => {
  it('starts on MONDAY, not Sunday', () => {
    // 2026-09-21 is a Monday.
    const monday = iso('2026-09-21T00:00:00Z');
    expect(weekStart(iso('2026-09-21T00:00:00Z'))).toBe(monday);
    expect(weekStart(iso('2026-09-24T18:00:00Z'))).toBe(monday);
    // Sunday belongs to the week that STARTED, not to the next one — the
    // classic off-by-one, since getUTCDay() is 0 for Sunday.
    expect(weekStart(iso('2026-09-27T23:59:59Z'))).toBe(monday);
    expect(weekStart(iso('2026-09-28T00:00:00Z'))).toBe(monday + 7 * DAY_MS);
  });

  it('expires a weekly exactly seven days after its Monday', () => {
    const issued = iso('2026-09-23T10:00:00Z'); // a Wednesday
    expect(nextWeeklyReset(issued)).toBe(iso('2026-09-28T00:00:00Z'));
    expect(weeklyExpired(issued, iso('2026-09-27T23:59:59Z'))).toBe(false);
    expect(weeklyExpired(issued, iso('2026-09-28T00:00:00Z'))).toBe(true);
  });
});

// ===========================================================================
// §4 — a daily rolls over mid-match
// ===========================================================================

describe('a match that spans a reset', () => {
  it('settles against the set that was active when it STARTED', () => {
    const issued = iso('2026-09-23T00:00:00Z');
    const expires = iso('2026-09-24T00:00:00Z');
    const startedBefore = iso('2026-09-23T23:50:00Z');
    const startedAfter = iso('2026-09-24T00:10:00Z');

    expect(wasActiveAt(issued, expires, startedBefore)).toBe(true);
    expect(wasActiveAt(issued, expires, startedAfter)).toBe(false);
  });
});

// ===========================================================================
// §5.3 — rerolls
// ===========================================================================

describe('rerolls', () => {
  const pool = CONTRACTS.map((c) => ({ id: c.id, tier: c.tier, scope: c.scope }));
  const current = { id: 'win-1', tier: 'easy', scope: 'daily' };

  it('the first is free, the rest cost 10 gems', () => {
    expect(FREE_REROLLS_PER_DAY).toBe(1);
    expect(REROLL_GEM_COST).toBe(10);
    expect(rerollCost(0, false)).toEqual({ free: true, gems: 0 });
    expect(rerollCost(1, false)).toEqual({ free: false, gems: 10 });
    expect(rerollCost(9, false)).toEqual({ free: false, gems: 10 });
  });

  it('premium gets one extra free one a day — §2', () => {
    expect(freeRerolls(false)).toBe(1);
    expect(freeRerolls(true)).toBe(2);
    expect(rerollCost(1, true).free).toBe(true);
    expect(rerollCost(2, true).free).toBe(false);
  });

  it('draws from the SAME tier', () => {
    const out = reroll(current, pool, [], 0, 0, false, 3);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const drawn = CONTRACTS.find((c) => c.id === out.contractId)!;
    expect(drawn.tier).toBe('easy');
    expect(drawn.scope).toBe('daily');
  });

  it('NEVER returns the same contract twice in a day', () => {
    const seen: string[] = [];
    let holding = current;
    for (let n = 0; n < 4; n++) {
      const out = reroll(holding, pool, seen, n, 999, false, n * 13);
      if (!out.ok) break;
      expect(seen, `roll ${n}`).not.toContain(out.contractId);
      expect(out.contractId).not.toBe(holding.id);
      seen.push(holding.id);
      holding = { ...holding, id: out.contractId };
    }
    expect(seen.length).toBeGreaterThan(1);
  });

  it('refuses when the gems are short', () => {
    const out = reroll(current, pool, [], 1, 5, false, 1);
    expect(out.ok === false && out.error).toBe('not-enough-gems');
  });

  it('refuses when the tier is exhausted', () => {
    const everyEasyDaily = CONTRACTS.filter((c) => c.tier === 'easy' && c.scope === 'daily').map((c) => c.id);
    const out = reroll(current, pool, everyEasyDaily, 0, 0, false, 1);
    expect(out.ok === false && out.error).toBe('no-alternative');
  });

  it('is DETERMINISTIC, so a retried request is not a second reroll', () => {
    const a = reroll(current, pool, [], 0, 0, false, 42);
    const b = reroll(current, pool, [], 0, 0, false, 42);
    expect(a).toEqual(b);
  });
});

// ===========================================================================
// Issuing (§1, §4)
// ===========================================================================

describe('issuing', () => {
  const pool = CONTRACTS.map((c) => ({ id: c.id, tier: c.tier, scope: c.scope, target: c.target }));
  const now = iso('2026-09-23T09:00:00Z');

  it('gives 3 daily slots at Harbour Office 1, rising to 5', () => {
    expect(dailySlots(0)).toBe(3);
    expect(dailySlots(1)).toBe(3);
    expect(dailySlots(2)).toBe(4);
    expect(dailySlots(3)).toBe(5);
    expect(dailySlots(9)).toBe(5);
  });

  it('issues distinct contracts', () => {
    const set = issue(pool, 'daily', 5, now, 7);
    expect(set).toHaveLength(5);
    expect(new Set(set.map((s) => s.contractId)).size).toBe(5);
  });

  it('sets the expiry to the next reset', () => {
    expect(issue(pool, 'daily', 3, now, 1)[0]?.expiresAt).toBe(nextDailyReset(now));
    expect(issue(pool, 'weekly', 3, now, 1)[0]?.expiresAt).toBe(nextWeeklyReset(now));
  });

  it('is deterministic, so issuing twice is idempotent', () => {
    expect(issue(pool, 'daily', 3, now, 5)).toEqual(issue(pool, 'daily', 3, now, 5));
  });

  it('§4 — a raid contract is NEVER drawn when the flag is off', () => {
    const noRaids = eligible('daily', new Set<string>());
    expect(noRaids.every((c) => !c.requires)).toBe(true);
    expect(noRaids.some((c) => c.metric === 'raid_stars')).toBe(false);

    const withRaids = eligible('daily', new Set(['portCity.raids']));
    expect(withRaids.some((c) => c.metric === 'raid_stars')).toBe(true);
  });
});

// ===========================================================================
// Rewards
// ===========================================================================

describe('contract rewards', () => {
  it('are §1’s table', () => {
    expect(rewardFor('easy', 'daily')).toMatchObject({ coins: 150, steel: 200, ink: 60 });
    expect(rewardFor('medium', 'daily')).toMatchObject({ coins: 350, steel: 500, ink: 120 });
    expect(rewardFor('hard', 'daily')).toMatchObject({ coins: 700, steel: 1_200, ink: 250 });
  });

  it('a weekly pays four times a daily', () => {
    const daily = rewardFor('medium', 'daily');
    const weekly = rewardFor('medium', 'weekly');
    expect(weekly.coins).toBe(daily.coins * 4);
    expect(weekly.ink).toBe(daily.ink * 4);
  });

  it('a hard contract pays gems', () => {
    expect(rewardFor('hard', 'daily').gems).toBeGreaterThan(0);
    expect(rewardFor('easy', 'daily').gems).toBe(0);
  });
});

// ===========================================================================
// The Log (§2)
// ===========================================================================

describe('the Captain’s Log', () => {
  it('is 28 days, 30 pages, 600 ink a page', () => {
    expect(SEASON_DAYS).toBe(28);
    expect(SEASON_PAGES).toBe(30);
    expect(INK_PER_PAGE).toBe(600);
  });

  it('ink comes from §2’s table', () => {
    expect(inkForMatch(false)).toBe(20);
    expect(inkForMatch(true)).toBe(60); // 20 played + 40 more for the win
    expect(inkForContract('easy', 'daily')).toBe(60);
    expect(inkForContract('medium', 'daily')).toBe(120);
    expect(inkForContract('hard', 'daily')).toBe(250);
    expect(inkForContract('hard', 'weekly')).toBe(1_000);
    expect(INK.raidWithStar).toBe(30);
    expect(INK.dailyPuzzle).toBe(50);
  });

  it('premium adds 10%, floored', () => {
    expect(withPremium(100, false)).toBe(100);
    expect(withPremium(100, true)).toBe(110);
    expect(withPremium(55, true)).toBe(60); // 60.5 floors to 60
  });

  it('pages are ink / 600, capped at 30', () => {
    expect(pageFor(0)).toBe(0);
    expect(pageFor(599)).toBe(0);
    expect(pageFor(600)).toBe(1);
    expect(pageFor(600 * 30)).toBe(30);
    expect(pageFor(600 * 99)).toBe(30);
    expect(pageFor(-500)).toBe(0);
  });

  it('shows progress into the current page', () => {
    expect(inkIntoPage(900)).toEqual({ page: 1, into: 300, needed: 600 });
  });

  it('claimable pages are the earned ones not yet claimed', () => {
    expect(claimablePages(1_800, [])).toEqual([1, 2, 3]);
    expect(claimablePages(1_800, [1, 3])).toEqual([2]);
    expect(claimablePages(1_800, [1, 2, 3])).toEqual([]);
    expect(claimablePages(0, [])).toEqual([]);
  });

  it('premium pays BOTH tracks, retroactively — §2', () => {
    const free = rewardForPage(5, false);
    const premium = rewardForPage(5, true);
    expect(premium.coins).toBeGreaterThan(free.coins);
    expect(premium.steel).toBeGreaterThan(free.steel);
  });

  it('the free track has a cosmetic at 10, 20 and 30', () => {
    expect(rewardForPage(10, false).cosmetic).toBe(true);
    expect(rewardForPage(20, false).cosmetic).toBe(true);
    expect(rewardForPage(30, false).cosmetic).toBe(true);
    expect(rewardForPage(11, false).cosmetic).toBe(false);
  });

  it('the premium track costs 500 gems', () => {
    expect(PREMIUM_GEMS).toBe(500);
  });
});

// ===========================================================================
// §5.7 — THE PACING LOCK
// ===========================================================================

describe('the pacing target (§5.7 — this test locks it)', () => {
  it('an ACTIVE player finishes all 30 pages between day 18 and 24', () => {
    const active = simulate(ACTIVE_PLAYER);
    expect(
      active.finishesOnDay,
      `active player earns ${active.inkPerDay} ink/day and finishes on day ${active.finishesOnDay}. ` +
        '§2: tune inkPerPage first, never the rewards.',
    ).not.toBeNull();
    expect(active.finishesOnDay!).toBeGreaterThanOrEqual(18);
    expect(active.finishesOnDay!).toBeLessThanOrEqual(24);
  });

  it('a CASUAL player lands between page 10 and 18', () => {
    const casual = simulate(CASUAL_PLAYER);
    expect(
      casual.finalPage,
      `casual player earns ${casual.inkPerDay} ink/day and reaches page ${casual.finalPage}. ` +
        '§2: tune inkPerPage first, never the rewards.',
    ).toBeGreaterThanOrEqual(10);
    expect(casual.finalPage).toBeLessThanOrEqual(18);
  });

  it('a casual player does NOT finish the season', () => {
    expect(simulate(CASUAL_PLAYER).finishesOnDay).toBeNull();
  });

  it('premium is a boost, not a shortcut — it does not double the pace', () => {
    const plain = simulate(ACTIVE_PLAYER).inkPerDay;
    const premium = simulate({ ...ACTIVE_PLAYER, premium: true }).inkPerDay;
    expect(premium).toBeGreaterThan(plain);
    expect(premium).toBeLessThan(plain * 1.2);
  });
});

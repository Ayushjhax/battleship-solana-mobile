/**
 * part-07 §8.6 — "Revenge skips the search cost exactly once per incoming
 * raid" — plus §4's log rules: newest first, last 30, dog ears, the menu card.
 *
 * "Exactly once" is the one with teeth. Revenge is a FREE search, so a client
 * that lets a player take it twice is giving away a currency. The obvious
 * implementations both fail in ways that only show up in use:
 *
 *   - a boolean on the screen dies when the screen unmounts;
 *   - filtering the list breaks when the list is refetched mid-flow and the
 *     server's `revengeAvailable` has not caught up yet.
 *
 * So there are two gates, and the tests below check the client one survives
 * both of those.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ATTENTION_STARS,
  LOG_LIMIT,
  __resetRevengeForTests,
  applyRevengeTaken,
  attentionCard,
  canTakeRevenge,
  destructionLine,
  logBadge,
  markRevengeTaken,
  orderLog,
  renownLine,
  tookLine,
  unreadCount,
  whenLine,
} from '@/raid/ui/defenceLog';
import { raidedWhileAwayLine } from '@/raid/ui/captainCopy';
import type { DefenceLogEntry } from '@/raid/types';

const NOW = Date.parse('2026-09-23T12:00:00Z');

function entry(patch: Partial<DefenceLogEntry> = {}): DefenceLogEntry {
  return {
    raidId: 'r1',
    attackerId: 'a1',
    attackerName: 'Corsair',
    avatarId: 2,
    avatarColor: 'violet',
    countryCode: 'IN',
    at: new Date(NOW - 60_000).toISOString(),
    stars: 2,
    destruction: 0.62,
    takenCoins: 120,
    takenSteel: 340,
    renownDelta: -13,
    read: false,
    revengeAvailable: true,
    ...patch,
  };
}

beforeEach(() => __resetRevengeForTests());

// ===========================================================================
// §8.6 — exactly once
// ===========================================================================

describe('revenge is free, exactly once per incoming raid', () => {
  it('is available on a fresh unread raid, and is free', () => {
    const check = canTakeRevenge(entry());
    expect(check.ok).toBe(true);
    expect(check.free).toBe(true);
  });

  it('is refused the SECOND time, in the same session', () => {
    const one = entry();
    expect(canTakeRevenge(one).ok).toBe(true);
    markRevengeTaken(one.raidId);
    expect(canTakeRevenge(one).ok).toBe(false);
    expect(canTakeRevenge(one).free).toBe(false);
  });

  it('stays refused even if a refetch hands back a STALE entry', () => {
    // The server has not caught up: its row still says revengeAvailable.
    // The in-session guard must still refuse, or a slow refetch is a free
    // second search.
    const stale = entry({ revengeAvailable: true });
    markRevengeTaken(stale.raidId);
    expect(canTakeRevenge(stale).ok).toBe(false);
  });

  it('is refused when the SERVER says it is gone, even on a fresh session', () => {
    // The other direction: a reinstall clears the client guard, and the
    // server's flag is what stops it.
    expect(canTakeRevenge(entry({ revengeAvailable: false })).ok).toBe(false);
  });

  it('taking revenge on one raid does not spend another', () => {
    const first = entry({ raidId: 'r1' });
    const second = entry({ raidId: 'r2' });
    markRevengeTaken(first.raidId);
    expect(canTakeRevenge(first).ok).toBe(false);
    expect(canTakeRevenge(second).ok).toBe(true);
  });

  it('a pirate cove cannot be revenged — there is nobody there', () => {
    const check = canTakeRevenge(entry({ attackerId: null }));
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('pirate cove');
  });

  it('applyRevengeTaken updates the list without waiting for a refetch', () => {
    const list = [entry({ raidId: 'r1' }), entry({ raidId: 'r2' })];
    const after = applyRevengeTaken(list, 'r1');
    expect(after[0]).toMatchObject({ raidId: 'r1', revengeAvailable: false, read: true });
    expect(after[1]).toMatchObject({ raidId: 'r2', revengeAvailable: true });
  });

  it('the reason never shows a code', () => {
    markRevengeTaken('r1');
    const reason = canTakeRevenge(entry()).reason ?? '';
    expect(reason).not.toContain('-');
    expect(reason.length).toBeGreaterThan(10);
  });
});

// ===========================================================================
// §4 — the log itself
// ===========================================================================

describe('the log', () => {
  const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

  it('is newest first', () => {
    const list = [
      entry({ raidId: 'old', at: at(600) }),
      entry({ raidId: 'new', at: at(1) }),
      entry({ raidId: 'mid', at: at(60) }),
    ];
    expect(orderLog(list).map((e) => e.raidId)).toEqual(['new', 'mid', 'old']);
  });

  it('keeps only the last 30', () => {
    expect(LOG_LIMIT).toBe(30);
    const many = Array.from({ length: 50 }, (_, n) =>
      entry({ raidId: `r${n}`, at: at(n) }),
    );
    const ordered = orderLog(many);
    expect(ordered).toHaveLength(30);
    // And it keeps the NEWEST 30, not the first 30 it was handed.
    expect(ordered[0]?.raidId).toBe('r0');
    expect(ordered[29]?.raidId).toBe('r29');
  });

  it('counts unread for the badge, and hides the badge at zero', () => {
    expect(unreadCount([entry({ read: false }), entry({ raidId: 'r2', read: true })])).toBe(1);
    expect(logBadge([entry({ read: false })])).toBe(1);
    expect(logBadge([entry({ read: true })])).toBeNull();
    expect(logBadge([])).toBeNull();
  });
});

describe('the menu attention card', () => {
  it('appears for an unread raid of 2 stars or more', () => {
    expect(ATTENTION_STARS).toBe(2);
    expect(attentionCard([entry({ stars: 2, read: false })])).not.toBeNull();
    expect(attentionCard([entry({ stars: 3, read: false })])).not.toBeNull();
  });

  it('does not appear for a 1-star raid, or a read one', () => {
    expect(attentionCard([entry({ stars: 1, read: false })])).toBeNull();
    expect(attentionCard([entry({ stars: 3, read: true })])).toBeNull();
  });

  it('picks the newest qualifying raid', () => {
    const card = attentionCard([
      entry({ raidId: 'old', stars: 3, at: new Date(NOW - 600_000).toISOString() }),
      entry({ raidId: 'new', stars: 2, at: new Date(NOW - 1_000).toISOString() }),
    ]);
    expect(card?.raidId).toBe('new');
  });

  it('reads as a sentence, with the steel', () => {
    expect(raidedWhileAwayLine(2, 340)).toBe('Your harbour was raided. Two stars, 340 steel gone.');
    expect(raidedWhileAwayLine(3, 0)).toBe('Your harbour was raided. Three stars, nothing taken.');
    expect(raidedWhileAwayLine(1, 10)).toContain('One star');
  });
});

// ===========================================================================
// The note's text
// ===========================================================================

describe('a note reads in plain English', () => {
  it('says what was taken', () => {
    expect(tookLine(entry())).toBe('Took 120 coins and 340 steel');
    expect(tookLine(entry({ takenCoins: 0 }))).toBe('Took 340 steel');
    expect(tookLine(entry({ takenCoins: 0, takenSteel: 0 }))).toBe('Took nothing');
  });

  it('signs the renown', () => {
    expect(renownLine(entry({ renownDelta: -13 }))).toBe('-13 renown');
    expect(renownLine(entry({ renownDelta: 9 }))).toBe('+9 renown');
    expect(renownLine(entry({ renownDelta: 0 }))).toBe('No renown moved');
  });

  it('rounds the destruction', () => {
    expect(destructionLine(entry({ destruction: 0.615 }))).toBe('62% destroyed');
    expect(destructionLine(entry({ destruction: 1 }))).toBe('100% destroyed');
  });

  it('says when, in words', () => {
    expect(whenLine(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now');
    expect(whenLine(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 minutes ago');
    expect(whenLine(new Date(NOW - 60 * 60_000).toISOString(), NOW)).toBe('1 hour ago');
    expect(whenLine(new Date(NOW - 26 * 3_600_000).toISOString(), NOW)).toBe('yesterday');
    expect(whenLine(new Date(NOW - 72 * 3_600_000).toISOString(), NOW)).toBe('3 days ago');
  });

  it('a clock skewed into the future reads "just now", not a negative', () => {
    expect(whenLine(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
  });

  it('an unparseable date does not produce NaN on screen', () => {
    expect(whenLine('not a date', NOW)).toBe('just now');
  });
});

/**
 * BUG-020: the leaderboard keeps its last page in memory so re-opening the
 * screen paints at once — but that page holds the "you" row, and the cache
 * was one module variable. After a sign-out and a sign-in as someone else,
 * the screen opened on the previous account's place on the ladder until the
 * refresh landed. The page is now kept against the account it was read for.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/net/api', () => ({}));

import { cachePage, cachedPage, type Page } from '../../src/features/leaderboard/pageCache';

function pageFor(name: string, position: number): Page {
  const row = {
    name,
    avatar_id: 1,
    avatar_color: 'ink',
    country_code: 'IN',
    battles_won: 3,
    rank_points: 75,
  };
  return {
    rows: [row],
    me: { ...row, rank_position: position },
    loadedAt: 0,
    tookMs: 0,
  } as unknown as Page;
}

describe('leaderboard page cache', () => {
  it("never opens on another account's page", () => {
    const alices = pageFor('alice', 1);
    cachePage('alice', alices);

    expect(cachedPage('bob')).toBeNull();
    expect(cachedPage('alice')).toBe(alices);
  });

  it('keeps no page for a player without an account', () => {
    cachePage(null, pageFor('nobody', 4));
    expect(cachedPage(null)).toBeNull();
  });
});

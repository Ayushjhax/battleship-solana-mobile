/**
 * The leaderboard's last good page, kept in memory so coming back to the
 * screen paints at once (the 400 ms budget in app/leaderboard.tsx).
 *
 * The page holds the "you" row — the reader's own place on the ladder — so it
 * is kept against the account it was read for and shown to that account only.
 * One shared page opened a newly signed-in account on the previous one's row
 * until the refresh landed (BUG-020). A player with no account keeps none.
 */
import type { LeaderboardEntry, MyLeaderboardRow } from '@/net/api';

export interface Page {
  readonly rows: readonly LeaderboardEntry[];
  readonly me: MyLeaderboardRow | null;
  readonly loadedAt: number;
  readonly tookMs: number;
}

let cached: { readonly account: string; readonly page: Page } | null = null;

export function cachedPage(account: string | null): Page | null {
  return account !== null && cached?.account === account ? cached.page : null;
}

export function cachePage(account: string | null, page: Page): void {
  cached = account === null ? null : { account, page };
}

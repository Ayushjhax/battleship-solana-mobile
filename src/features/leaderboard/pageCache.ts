/**
 * The leaderboard's last good page, kept in memory so coming back to the
 * screen paints at once (the 400 ms budget in app/leaderboard.tsx).
 */
import type { LeaderboardEntry, MyLeaderboardRow } from '@/net/api';

export interface Page {
  readonly rows: readonly LeaderboardEntry[];
  readonly me: MyLeaderboardRow | null;
  readonly loadedAt: number;
  readonly tookMs: number;
}

let cached: Page | null = null;

export function cachedPage(): Page | null {
  return cached;
}

export function cachePage(page: Page): void {
  cached = page;
}

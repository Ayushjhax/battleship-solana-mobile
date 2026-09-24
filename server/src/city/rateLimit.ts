/**
 * City action rate limiting — 00-OVERVIEW.md §5, DECISIONS.md D5.
 *
 * Ten actions per ten seconds per user, and going over is a TYPED ERROR, not a
 * disconnect. This deliberately does not reuse the socket limiter in
 * server/src/ws.ts, which closes the connection after ten messages a second:
 * city traffic must never be able to drop a player out of a live match.
 *
 * In-memory and per-process, like the room registry. A second instance would
 * each keep their own window — acceptable for a limiter whose job is to stop
 * a runaway client, not to meter a quota.
 */

export const CITY_RATE_LIMIT = 10;
export const CITY_RATE_WINDOW_MS = 10_000;

const hits = new Map<string, number[]>();

/** Records an attempt. Returns false when the caller is over the limit. */
export function allowCityAction(userId: string, now: number = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((at) => now - at < CITY_RATE_WINDOW_MS);
  if (recent.length >= CITY_RATE_LIMIT) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);

  // Opportunistic sweep so an idle process does not hold every id it ever saw.
  if (hits.size > 1_000) {
    for (const [key, times] of hits) {
      if (times.every((at) => now - at >= CITY_RATE_WINDOW_MS)) hits.delete(key);
    }
  }
  return true;
}

/** Test-only: forget every window. */
export function __resetCityRateLimitForTests(): void {
  hits.clear();
}

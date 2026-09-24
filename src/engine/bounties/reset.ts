/**
 * Reset boundaries and rerolls — part-04 §1, §4, tested by §5.2 and §5.3.
 *
 * §1: "3 daily contracts (reset 00:00 UTC) and 3 weekly (reset Monday 00:00
 * UTC)." §5.2 asks for the boundaries "at 23:59:59 and 00:00:00 UTC, including
 * a player in a different timezone, and a leap-second-ish clock jump".
 *
 * ALL OF THIS IS UTC, ALWAYS. The player's timezone never enters — which is
 * the whole reason §5.2 asks for a test with one. A daily that rolled at local
 * midnight would give a player in Auckland a different number of days per
 * season than one in Los Angeles, and there is no fair way to pick.
 *
 * `now` is a parameter. There is no `Date.now()` in this file, so the server's
 * clock is the only clock.
 */

export const DAY_MS = 24 * 60 * 60 * 1_000;

/** The UTC day, as `YYYY-MM-DD` — the same key the offline cap uses. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The instant the current UTC day began. */
export function dayStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** The instant the next UTC day begins — when the dailies roll. */
export function nextDailyReset(now: number): number {
  return dayStart(now) + DAY_MS;
}

/**
 * The instant the current UTC week began (Monday 00:00 UTC).
 *
 * `getUTCDay()` is 0 for Sunday, so Sunday is six days into the week and not
 * the start of one. Getting that wrong shifts every weekly by a day for one
 * seventh of the year, which is exactly the sort of thing that is noticed in
 * week three and not in week one.
 */
export function weekStart(now: number): number {
  const start = dayStart(now);
  const weekday = new Date(start).getUTCDay();
  const sinceMonday = (weekday + 6) % 7;
  return start - sinceMonday * DAY_MS;
}

export function nextWeeklyReset(now: number): number {
  return weekStart(now) + 7 * DAY_MS;
}

/** Has the daily set issued at `issuedAt` expired by `now`? */
export function dailyExpired(issuedAt: number, now: number): boolean {
  return now >= nextDailyReset(issuedAt);
}

export function weeklyExpired(issuedAt: number, now: number): boolean {
  return now >= nextWeeklyReset(issuedAt);
}

/**
 * §4 — "A daily rolls over while the player is in a match: the match settles
 * against the contract set that was ACTIVE WHEN IT STARTED."
 *
 * So progress is credited against the set that was live at `startedAt`, not
 * at `settledAt`. This function says whether a contract issued at `issuedAt`
 * was that set.
 */
export function wasActiveAt(issuedAt: number, expiresAt: number, matchStartedAt: number): boolean {
  return matchStartedAt >= issuedAt && matchStartedAt < expiresAt;
}

// ---------------------------------------------------------------------------
// Rerolls (§1, §5.3)
// ---------------------------------------------------------------------------

/** §1 — "One free reroll per day; more cost 10 gems." */
export const FREE_REROLLS_PER_DAY = 1;
export const REROLL_GEM_COST = 10;

/** §2 — the premium track gives "one extra daily reroll per day". */
export const PREMIUM_EXTRA_REROLLS = 1;

export function freeRerolls(premium: boolean): number {
  return FREE_REROLLS_PER_DAY + (premium ? PREMIUM_EXTRA_REROLLS : 0);
}

export interface RerollCost {
  readonly free: boolean;
  readonly gems: number;
}

export function rerollCost(usedToday: number, premium: boolean): RerollCost {
  return usedToday < freeRerolls(premium)
    ? { free: true, gems: 0 }
    : { free: false, gems: REROLL_GEM_COST };
}

export type RerollError = 'not-enough-gems' | 'no-alternative' | 'unknown-slot';

export type RerollResult =
  | { readonly ok: true; readonly contractId: string; readonly gems: number }
  | { readonly ok: false; readonly error: RerollError };

/**
 * §1 — "Rerolling draws from the same tier and never returns the same
 * contract twice in a day."
 *
 * `seenToday` is every contract id this player has held in this slot today,
 * including the one currently there. Deterministic: the caller passes a seed
 * so a retried request returns the same contract rather than rerolling twice.
 */
export function reroll(
  current: { id: string; tier: string; scope: string },
  pool: readonly { id: string; tier: string; scope: string }[],
  seenToday: readonly string[],
  usedToday: number,
  gems: number,
  premium: boolean,
  seed: number,
): RerollResult {
  const cost = rerollCost(usedToday, premium);
  if (!cost.free && gems < cost.gems) return { ok: false, error: 'not-enough-gems' };

  const seen = new Set([...seenToday, current.id]);
  const candidates = pool.filter(
    (contract) =>
      contract.tier === current.tier && contract.scope === current.scope && !seen.has(contract.id),
  );
  if (candidates.length === 0) return { ok: false, error: 'no-alternative' };

  // Deterministic pick: the same seed gives the same contract, so a retried
  // request is idempotent rather than a second reroll.
  const picked = candidates[Math.abs(seed) % candidates.length]!;
  return { ok: true, contractId: picked.id, gems: cost.gems };
}

// ---------------------------------------------------------------------------
// Issuing
// ---------------------------------------------------------------------------

export interface IssuedContract {
  readonly slot: number;
  readonly contractId: string;
  readonly target: number;
  readonly scope: 'daily' | 'weekly';
  readonly expiresAt: number;
}

/**
 * Draws a fresh set. Deterministic from the seed, so the same player on the
 * same day gets the same board however many times it is issued — which is
 * what makes issuing idempotent without a request log.
 */
export function issue(
  pool: readonly { id: string; tier: string; scope: string; target: number }[],
  scope: 'daily' | 'weekly',
  slots: number,
  now: number,
  seed: number,
  slotOffset = 0,
): IssuedContract[] {
  const eligible = pool.filter((contract) => contract.scope === scope);
  if (eligible.length === 0) return [];

  const expiresAt = scope === 'daily' ? nextDailyReset(now) : nextWeeklyReset(now);
  const out: IssuedContract[] = [];
  const taken = new Set<string>();

  for (let n = 0; n < slots; n++) {
    // Walk from a seeded offset so the set is spread across the catalogue
    // rather than always starting at index 0.
    const start = Math.abs(seed + n * 7_919) % eligible.length;
    let picked: (typeof eligible)[number] | null = null;
    for (let step = 0; step < eligible.length; step++) {
      const candidate = eligible[(start + step) % eligible.length]!;
      if (!taken.has(candidate.id)) {
        picked = candidate;
        break;
      }
    }
    if (!picked) break;
    taken.add(picked.id);
    out.push({
      slot: slotOffset + n,
      contractId: picked.id,
      target: picked.target,
      scope,
      expiresAt,
    });
  }
  return out;
}

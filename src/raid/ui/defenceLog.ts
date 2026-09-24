/**
 * The defence log and revenge — part-07 §4, tested by §8.6.
 *
 * §4: "A list of ink notes, newest first ... Unread entries are dog-eared.
 * Keep the last 30." And §8.6: "**Revenge skips the search cost exactly once
 * per incoming raid.**"
 *
 * That "exactly once" is the whole reason this is a pure module. Revenge is
 * free, so a client that let a player take it twice would be handing out free
 * searches — and the obvious implementations (a boolean on the screen, a
 * filter on a list) both break when the list is refetched mid-flow.
 *
 * The rule here: the SERVER's `revengeAvailable` is the truth, and the client
 * additionally refuses any raid id it has already spent in this session. Two
 * gates, because the client one survives a slow refetch and the server one
 * survives a reinstall.
 */
import type { DefenceLogEntry } from '../types';

/** §4 — "Keep the last 30." */
export const LOG_LIMIT = 30;

/** §4 — the menu card threshold. */
export const ATTENTION_STARS = 2;

/**
 * Newest first, trimmed to the limit. Sorting here rather than trusting the
 * server's order means a log rendered from cache during a slow load is still
 * in the right order.
 */
export function orderLog(entries: readonly DefenceLogEntry[]): DefenceLogEntry[] {
  return [...entries]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, LOG_LIMIT);
}

export function unreadCount(entries: readonly DefenceLogEntry[]): number {
  return entries.filter((entry) => !entry.read).length;
}

/** §1 — "Defence log (badge when unread)". */
export function logBadge(entries: readonly DefenceLogEntry[]): number | null {
  const n = unreadCount(entries);
  return n > 0 ? n : null;
}

/**
 * §4 — "a raid that took >= 2 stars while the player was away also shows a
 * one-time card on the menu". The newest qualifying unread entry, or null.
 */
export function attentionCard(entries: readonly DefenceLogEntry[]): DefenceLogEntry | null {
  return orderLog(entries).find((entry) => !entry.read && entry.stars >= ATTENTION_STARS) ?? null;
}

// ---------------------------------------------------------------------------
// Revenge (§8.6)
// ---------------------------------------------------------------------------

/**
 * Raid ids whose revenge this session has already spent. Module-level because
 * it must outlive any one screen: the player can take revenge from the menu
 * card, navigate away, and come back to the log with the same entry still on
 * screen if the refetch has not landed.
 */
const spent = new Set<string>();

export interface RevengeCheck {
  readonly ok: boolean;
  /** Free means the search cost is waived (§4: "revenge is free"). */
  readonly free: boolean;
  readonly reason: string | null;
}

export function canTakeRevenge(entry: DefenceLogEntry): RevengeCheck {
  if (spent.has(entry.raidId)) {
    return { ok: false, free: false, reason: 'You have already had that one back.' };
  }
  if (!entry.revengeAvailable) {
    return { ok: false, free: false, reason: 'You have already had that one back.' };
  }
  if (!entry.attackerId) {
    // A cove cannot be revenged — there is nobody there (§5 of part-06).
    return { ok: false, free: false, reason: 'There is nobody at a pirate cove to answer to.' };
  }
  return { ok: true, free: true, reason: null };
}

/**
 * Marks the revenge as taken. Called when the raid OPENS, not when it
 * settles: the free search has been spent by then, and a player who backs out
 * of the kit screen has already cost the house nothing.
 */
export function markRevengeTaken(raidId: string): void {
  spent.add(raidId);
}

/** The entry as it should now render, without waiting for a refetch. */
export function applyRevengeTaken(
  entries: readonly DefenceLogEntry[],
  raidId: string,
): DefenceLogEntry[] {
  return entries.map((entry) =>
    entry.raidId === raidId ? { ...entry, revengeAvailable: false, read: true } : entry,
  );
}

export function __resetRevengeForTests(): void {
  spent.clear();
}

// ---------------------------------------------------------------------------
// Rendering helpers (§4's note text)
// ---------------------------------------------------------------------------

export function tookLine(entry: DefenceLogEntry): string {
  const parts: string[] = [];
  if (entry.takenCoins > 0) parts.push(`${entry.takenCoins} coins`);
  if (entry.takenSteel > 0) parts.push(`${entry.takenSteel} steel`);
  return parts.length === 0 ? 'Took nothing' : `Took ${parts.join(' and ')}`;
}

export function renownLine(entry: DefenceLogEntry): string {
  if (entry.renownDelta === 0) return 'No renown moved';
  return entry.renownDelta > 0
    ? `+${entry.renownDelta} renown`
    : `${entry.renownDelta} renown`;
}

export function destructionLine(entry: DefenceLogEntry): string {
  return `${Math.round(entry.destruction * 100)}% destroyed`;
}

/** "3 minutes ago", "2 hours ago", "yesterday". */
export function whenLine(at: string, now: number): string {
  const ms = now - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * The matchmaker's bot fallback, as data.
 *
 * Kept out of the screen so the exact player-facing copy and the "is this a
 * bot?" decision are testable without a React renderer, and so no other
 * surface can quietly describe a fallback bot as a human captain.
 */
import type { OpponentSummary } from '@/net/protocol';

/** The one notice shown when the queue falls back to a bot. */
export const BOT_FALLBACK_NOTICE = 'No opponent found. Playing against a bot instead.';

/** True when the server identified the opponent as the matchmaking bot. */
export function isBotOpponent(opponent: Pick<OpponentSummary, 'isBot'> | null | undefined): boolean {
  return opponent?.isBot === true;
}

/** What to call the opponent on a player card — never a human name for a bot. */
export function opponentDisplayName(opponent: Pick<OpponentSummary, 'name' | 'isBot'>): string {
  return opponent.isBot ? 'Bot' : opponent.name;
}

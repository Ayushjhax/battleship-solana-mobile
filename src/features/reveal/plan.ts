/**
 * Who sees the winner's base, and whose it is. Pure TypeScript.
 *
 * Only the LOSER of an online match (a server bot counts: its board is on the
 * server) or of a match against the offline AI is shown the winner's board,
 * for REVEAL_MS, before the existing defeat screen. The winner goes straight
 * to victory and never waits. Hot-seat (both fleets were on this device all
 * along), the tutorial, and any ending without a confirmed winner keep the
 * existing flow untouched.
 *
 * "Confirmed" means the view's winner is a real player id, is not us, and is
 * the combatant we played — so the name and portrait on the reveal are the
 * winner's, not a guess.
 */
import type { BattleMode } from '@/state/battle';

/** How long the board is on screen, from the moment it is shown. */
export const REVEAL_MS = 5_000;
/**
 * Online, the loser's battle screen waits at most this long for the server's
 * `over` (it follows GAME_OVER once the match is settled). No `over`, or one
 * without a usable board, and the loser goes straight to the defeat screen.
 */
export const REVEAL_WAIT_MS = 2_500;

export type RevealSource = 'none' | 'local' | 'server';

/** The winner as the reveal shows them — the same fields the result's card uses. */
export interface RevealWinner {
  readonly id: string;
  readonly name: string;
  /** Rank points before this match settled: the rank they fought at. */
  readonly points: number;
  readonly avatarId: number;
  readonly avatarColor: string;
  readonly countryCode: string;
}

export interface FinishFacts {
  readonly mode: BattleMode;
  readonly tutorial: boolean;
  /** The device owner's player id. */
  readonly ownerId: string;
  /** The finished view's winner. */
  readonly winnerId: string | null | undefined;
  /** The combatant the owner played. */
  readonly opponentId: string | null | undefined;
}

export function revealSource(facts: FinishFacts): RevealSource {
  if (facts.tutorial || (facts.mode !== 'ai' && facts.mode !== 'online')) return 'none';
  const winner = facts.winnerId;
  if (!winner || !facts.ownerId || winner === facts.ownerId) return 'none';
  if (!facts.opponentId || facts.opponentId !== winner) return 'none';
  return facts.mode === 'online' ? 'server' : 'local';
}

/** Loosely held fields -> the winner card, with the result screen's own fallbacks. */
export function revealWinner(from: {
  id: string;
  name?: unknown;
  points?: unknown;
  avatarId?: unknown;
  avatarColor?: unknown;
  countryCode?: unknown;
}): RevealWinner {
  const name = typeof from.name === 'string' ? from.name.trim() : '';
  const points = typeof from.points === 'number' && Number.isFinite(from.points) ? Math.max(0, from.points) : 0;
  const avatarId =
    typeof from.avatarId === 'number' && Number.isInteger(from.avatarId) && from.avatarId >= 1 ? from.avatarId : 2;
  return {
    id: from.id,
    name: name || 'Opponent',
    points,
    avatarId,
    avatarColor: typeof from.avatarColor === 'string' ? from.avatarColor : '',
    countryCode: typeof from.countryCode === 'string' ? from.countryCode : '',
  };
}

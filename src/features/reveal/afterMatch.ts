/**
 * Where a finished match goes: the loser to the winner's-base reveal when the
 * winner's final board is to hand, everyone else to the existing result.
 * The battle screen calls this once GAME_OVER has played out.
 *
 *   local   (vs the offline AI) the board is the local match's own final
 *           state — decided at once.
 *   server  (online, server bots included) the board rides the server's `over`,
 *           which follows GAME_OVER once the match is settled. If it is here,
 *           decided at once; otherwise wait for it, at most REVEAL_WAIT_MS.
 *           An `over` for another winner, one without a usable board, a
 *           connection that gives up, or the wait running out: the result.
 *
 * `go` is called exactly once — or never, if the returned cancel runs first
 * (the battle screen unmounted), so nothing navigates from a dead screen.
 */
import type { MatchState } from '@engine/types';

import { useMatchClient, type MatchOver } from '@/net/match-client';

import { REVEAL_WAIT_MS, revealSource, type FinishFacts, type RevealWinner } from './plan';
import { useReveal } from './revealStore';
import { parseRevealBoard } from './snapshot';

export interface AfterMatch {
  /** The match: its server id online, the result id offline. */
  readonly key: string | null;
  readonly facts: FinishFacts;
  /** The combatant who won, if we could name them. */
  readonly winner: RevealWinner | null;
  /** Offline only: the whole final state. */
  readonly match: MatchState | null;
  readonly waitMs?: number;
  /** A reveal key to show, or null for the result. */
  readonly go: (revealKey: string | null) => void;
}

export function routeAfterMatch(input: AfterMatch): () => void {
  let settled = false;
  let unsubscribe: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const release = () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const finish = (revealKey: string | null) => {
    if (settled) return;
    settled = true;
    release();
    input.go(revealKey);
  };
  const cancel = () => {
    settled = true;
    release();
  };

  const { key, winner, facts } = input;
  const source = revealSource(facts);
  if (source === 'none' || !key || !winner || winner.id !== facts.winnerId) {
    finish(null);
    return cancel;
  }

  const show = (raw: unknown) => {
    const board = parseRevealBoard(raw);
    finish(board && useReveal.getState().open(key, winner, board) ? key : null);
  };

  if (source === 'local') {
    const match = input.match;
    const board =
      match && match.phase === 'over' && match.winner === winner.id
        ? match.players.find((p) => p.id === winner.id)?.board
        : undefined;
    show(board);
    return cancel;
  }

  const fromOver = (matchId: string | null, over: MatchOver | null): boolean => {
    if (!over || matchId !== key) return false;
    if (over.winnerId !== winner.id) finish(null);
    else show(over.reveal);
    return true;
  };
  const now = useMatchClient.getState();
  if (fromOver(now.matchId, now.over)) return cancel;
  unsubscribe = useMatchClient.subscribe((s) => {
    if (fromOver(s.matchId, s.over)) return;
    if (s.status === 'failed' || s.status === 'idle') finish(null);
  });
  timer = setTimeout(() => finish(null), input.waitMs ?? REVEAL_WAIT_MS);
  return cancel;
}

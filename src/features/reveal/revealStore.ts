/**
 * The one reveal in flight, outside React. Not persisted: it lives from the
 * end of a lost match to the defeat screen, about five seconds.
 *
 * Why a store and not route params: the countdown's deadline must survive the
 * screen re-mounting (it is set ONCE, when the board is first shown), and a
 * duplicate end-of-match signal for a match already revealed must not open it
 * again. Both are keyed by the match.
 *
 *   open(key)   the battle screen hands over the winner and the board. False,
 *               and nothing changes, for a match that was already opened.
 *   start(key)  the reveal screen is showing the board: the deadline is set
 *               now + REVEAL_MS the first time, and returned as-is after that.
 *   leave(key)  true exactly once per match: the one call that may navigate
 *               to the defeat screen. It releases the board.
 */
import type { Board } from '@engine/types';
import { create } from 'zustand';

import { REVEAL_MS, type RevealWinner } from './plan';

export interface RevealSession {
  readonly key: string;
  readonly winner: RevealWinner;
  readonly board: Board;
  /** Epoch ms the countdown ends; null until the board is first on screen. */
  readonly deadline: number | null;
}

interface RevealState {
  session: RevealSession | null;
  /** Matches already opened, newest last — bounded, so a long session holds a handful of ids. */
  opened: readonly string[];
  /** Matches already left for the defeat screen. */
  left: readonly string[];
  open: (key: string, winner: RevealWinner, board: Board) => boolean;
  start: (key: string, now: number) => number | null;
  leave: (key: string) => boolean;
}

const KEEP = 12;

const remember = (list: readonly string[], key: string) => [...list, key].slice(-KEEP);

export const useReveal = create<RevealState>((set, get) => ({
  session: null,
  opened: [],
  left: [],

  open: (key, winner, board) => {
    const s = get();
    if (!key || s.opened.includes(key)) return false;
    set({ session: { key, winner, board, deadline: null }, opened: remember(s.opened, key) });
    return true;
  },

  start: (key, now) => {
    const session = get().session;
    if (!session || session.key !== key) return null;
    if (session.deadline !== null) return session.deadline;
    const deadline = now + REVEAL_MS;
    set({ session: { ...session, deadline } });
    return deadline;
  },

  leave: (key) => {
    const s = get();
    if (!key || s.left.includes(key)) return false;
    set({
      left: remember(s.left, key),
      session: s.session?.key === key ? null : s.session,
    });
    return true;
  },
}));

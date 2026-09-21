/**
 * The matched -> battle handoff, as a plain object so the race that used to
 * live in searching.tsx can be tested.
 *
 * The bug: one effect did both jobs — send the fleet once, and schedule the
 * arena reveal — and it listed `status` in its dependencies. Sending is
 * once-per-match and was guarded by a ref; the timer was not. The server flips
 * `matched` -> `active` the moment both fleets are in, which lands inside the
 * 2 s hold, so the effect re-ran, its cleanup cleared the pending timer, and
 * the ref guard returned early before scheduling a new one. Navigation never
 * fired: the player sat watching the reveal while the match ran without them.
 *
 * The two jobs are separated here, and the reveal is keyed on the match alone.
 * Anything that is not a new match — a status change, a re-render, a reconnect
 * — must leave a scheduled reveal running.
 */

export interface MatchHandoffOptions {
  readonly holdMs: number;
  /** Sends the fleet. Called at most once per match id. */
  readonly onReady: (matchId: string) => void;
  /** Navigates into the battle. Called at most once per match id. */
  readonly onNavigate: (matchId: string) => void;
  /**
   * The match the client is on when the timer fires. A reveal for a match that
   * has since been replaced or cancelled must not navigate.
   */
  readonly currentMatchId: () => string | null;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface MatchSnapshot {
  readonly matchId: string | null;
  readonly hasPlayers: boolean;
  readonly cancelling: boolean;
}

export interface MatchHandoff {
  /** Feed the latest snapshot; safe to call on every render. */
  sync: (snapshot: MatchSnapshot) => void;
  /** Tear down any pending reveal — the screen unmounting. */
  dispose: () => void;
  /** Test/debug visibility. */
  readonly state: {
    readonly readySentFor: string | null;
    readonly revealScheduledFor: string | null;
  };
}

export function createMatchHandoff(options: MatchHandoffOptions): MatchHandoff {
  const {
    holdMs,
    onReady,
    onNavigate,
    currentMatchId,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  let readySentFor: string | null = null;
  let revealScheduledFor: string | null = null;
  let timer: unknown = null;

  function cancelReveal(): void {
    if (timer !== null) clearTimer(timer);
    timer = null;
    revealScheduledFor = null;
  }

  return {
    sync({ matchId, hasPlayers, cancelling }) {
      if (cancelling) {
        // Leaving the queue: nothing should land us in a battle afterwards.
        cancelReveal();
        return;
      }
      if (!matchId || !hasPlayers) return;

      if (readySentFor !== matchId) {
        readySentFor = matchId;
        onReady(matchId);
      }

      // Keyed on the match, never on status: a re-sync for the same match must
      // leave the running timer exactly as it is.
      if (revealScheduledFor === matchId) return;
      cancelReveal();
      revealScheduledFor = matchId;
      timer = setTimer(() => {
        timer = null;
        if (currentMatchId() === matchId) onNavigate(matchId);
      }, holdMs);
    },

    dispose() {
      cancelReveal();
      readySentFor = null;
    },

    get state() {
      return { readySentFor, revealScheduledFor };
    },
  };
}

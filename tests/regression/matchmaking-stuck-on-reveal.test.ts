/**
 * Regression: "Matchmaking throws either player into in-game waiting sometimes
 * after clicking Battle."
 *
 * searching.tsx had one effect doing two jobs — send the fleet once, and hold
 * the arena reveal before navigating — and it listed `status` among its
 * dependencies. Sending was guarded by a ref; the timer was not. The server
 * flips `matched` -> `active` as soon as both fleets are in, which lands inside
 * the 2 s hold, so the effect re-ran: cleanup cleared the pending timer, then
 * the ref guard returned early before scheduling a replacement. Navigation
 * never fired and the player sat on the reveal while the match ran without
 * them. "Sometimes" was whichever arrived first, the status flip or the timer.
 *
 * The sequencing now lives in createMatchHandoff, keyed on the match alone.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createMatchHandoff, type MatchHandoff } from '../../src/features/matchmaking/handoff';

const HOLD_MS = 2000;
const MATCH = 'match-1';

let ready: Mock<(matchId: string) => void>;
let navigate: Mock<(matchId: string) => void>;
let liveMatchId: string | null;

function build(overrides: { currentMatchId?: () => string | null } = {}): MatchHandoff {
  return createMatchHandoff({
    holdMs: HOLD_MS,
    onReady: ready,
    onNavigate: navigate,
    currentMatchId: overrides.currentMatchId ?? (() => liveMatchId),
  });
}

/** What the screen feeds in once both players are known. */
function matched(cancelling = false) {
  return { matchId: MATCH, hasPlayers: true, cancelling };
}

beforeEach(() => {
  vi.useFakeTimers();
  ready = vi.fn<(matchId: string) => void>();
  navigate = vi.fn<(matchId: string) => void>();
  liveMatchId = MATCH;
});

describe('the reveal survives everything that is not a new match', () => {
  it('navigates after the hold in the simple case', () => {
    const handoff = build();

    handoff.sync(matched());
    vi.advanceTimersByTime(HOLD_MS);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(MATCH);
  });

  it('still navigates when the status flips mid-hold', () => {
    // The exact failure: matched -> active arrives 300 ms into the 2 s hold.
    const handoff = build();

    handoff.sync(matched());
    vi.advanceTimersByTime(300);
    handoff.sync(matched()); // re-sync triggered by the status change
    vi.advanceTimersByTime(HOLD_MS);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does not restart the clock on a re-sync', () => {
    const handoff = build();

    handoff.sync(matched());
    vi.advanceTimersByTime(1900);
    handoff.sync(matched());
    vi.advanceTimersByTime(100);

    // 2000 ms total have passed; a restarted timer would still be waiting.
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('survives a burst of re-syncs, as a re-rendering screen produces', () => {
    const handoff = build();

    handoff.sync(matched());
    for (let tick = 0; tick < 20; tick += 1) {
      vi.advanceTimersByTime(50);
      handoff.sync(matched());
    }
    vi.advanceTimersByTime(HOLD_MS);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('navigates exactly once however many syncs arrive after it fired', () => {
    const handoff = build();

    handoff.sync(matched());
    vi.advanceTimersByTime(HOLD_MS);
    handoff.sync(matched());
    handoff.sync(matched());
    vi.advanceTimersByTime(HOLD_MS);

    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe('sending the fleet', () => {
  it('sends once for a match, however many syncs arrive', () => {
    const handoff = build();

    handoff.sync(matched());
    handoff.sync(matched());
    handoff.sync(matched());

    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledWith(MATCH);
  });

  it('sends immediately, without waiting out the reveal', () => {
    const handoff = build();

    handoff.sync(matched());

    // The opponent's 90 s layout deadline is their problem; ours is already in.
    expect(ready).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sends again for a genuinely new match', () => {
    const handoff = build({ currentMatchId: () => liveMatchId });

    handoff.sync(matched());
    liveMatchId = 'match-2';
    handoff.sync({ matchId: 'match-2', hasPlayers: true, cancelling: false });

    expect(ready).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenLastCalledWith('match-2');
  });

  it('does nothing until both players are known', () => {
    const handoff = build();

    handoff.sync({ matchId: MATCH, hasPlayers: false, cancelling: false });
    vi.advanceTimersByTime(HOLD_MS);

    expect(ready).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does nothing without a match id', () => {
    const handoff = build();

    handoff.sync({ matchId: null, hasPlayers: true, cancelling: false });
    vi.advanceTimersByTime(HOLD_MS);

    expect(ready).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('a new match replaces the one being revealed', () => {
  it('cancels the old reveal and does not navigate to the stale match', () => {
    const handoff = build();

    handoff.sync(matched());
    vi.advanceTimersByTime(500);
    liveMatchId = 'match-2';
    handoff.sync({ matchId: 'match-2', hasPlayers: true, cancelling: false });
    vi.advanceTimersByTime(HOLD_MS);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('match-2');
  });

  it('refuses to navigate when the client has moved off that match', () => {
    const handoff = build();

    handoff.sync(matched());
    liveMatchId = null; // the socket dropped the match during the hold
    vi.advanceTimersByTime(HOLD_MS);

    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('cancelling the queue', () => {
  it('stops a scheduled reveal from firing', () => {
    const handoff = build();

    handoff.sync(matched());
    vi.advanceTimersByTime(500);
    handoff.sync(matched(true));
    vi.advanceTimersByTime(HOLD_MS);

    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not send a fleet while cancelling', () => {
    const handoff = build();

    handoff.sync(matched(true));

    expect(ready).not.toHaveBeenCalled();
  });
});

describe('unmounting', () => {
  it('drops a pending reveal so a left screen cannot navigate later', () => {
    const handoff = build();

    handoff.sync(matched());
    handoff.dispose();
    vi.advanceTimersByTime(HOLD_MS);

    expect(navigate).not.toHaveBeenCalled();
  });

  it('is safe to dispose twice', () => {
    const handoff = build();

    handoff.sync(matched());
    handoff.dispose();

    expect(() => handoff.dispose()).not.toThrow();
  });
});

/**
 * The battle's way out (src/features/reveal/afterMatch.ts), against the real
 * match-client store and the real reveal session: the loser is shown the
 * winner's board when it is to hand, the winner never waits, and every other
 * case — no board, a bad board, a late or missing `over`, an unmount — lands
 * on the existing result exactly once, or not at all after an unmount.
 */
import { createMatch, reduce } from '@engine/match';
import type { MatchAction, MatchState, Ship } from '@engine/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('../../src/net/api', () => ({
  getAccessToken: vi.fn(async () => ({ ok: true as const, value: 'me' })),
}));

const { useMatchClient } = await import('../../src/net/match-client');
const { routeAfterMatch } = await import('../../src/features/reveal/afterMatch');
const { revealWinner, REVEAL_WAIT_MS } = await import('../../src/features/reveal/plan');
const { useReveal } = await import('../../src/features/reveal/revealStore');

function ship(id: string, cls: Ship['class'], len: number, r: number, c: number): Ship {
  return { id, class: cls, len, origin: { r, c }, orientation: 'h', hits: [] };
}
const FLEET: readonly Ship[] = [
  ship('battleship-1', 'battleship', 4, 0, 0),
  ship('cruiser-1', 'cruiser', 3, 2, 0),
  ship('cruiser-2', 'cruiser', 3, 2, 4),
  ship('destroyer-1', 'destroyer', 2, 4, 0),
  ship('destroyer-2', 'destroyer', 2, 4, 3),
  ship('destroyer-3', 'destroyer', 2, 4, 6),
  ship('boat-1', 'boat', 1, 6, 0),
  ship('boat-2', 'boat', 1, 6, 2),
];
const CELLS = FLEET.flatMap((s) => Array.from({ length: s.len }, (_, i) => ({ r: s.origin.r, c: s.origin.c + i })));

/** 'ai' sinks 'me' — every one of its shots a hit, so the turn never passes back. */
function aiWins(): MatchState {
  const apply = (s: MatchState, a: MatchAction) => reduce(s, a).state;
  let s = createMatch({ id: 'local-1', mode: 'classic', seed: 3, playerIds: ['me', 'ai'] });
  s = apply(s, { type: 'SUBMIT_LAYOUT', playerId: 'me', ships: FLEET, arsenal: [] });
  s = apply(s, { type: 'SUBMIT_LAYOUT', playerId: 'ai', ships: FLEET, arsenal: [] });
  if (s.turn === 'me') s = apply(s, { type: 'FIRE', playerId: 'me', at: { r: 9, c: 9 } });
  for (const at of CELLS) if (s.phase === 'playing') s = apply(s, { type: 'FIRE', playerId: 'ai', at });
  expect(s.winner).toBe('ai');
  return s;
}

const THEM = revealWinner({ id: 'them', name: 'Berhan', points: 900, avatarId: 3, avatarColor: '', countryCode: 'RU' });
const serverBoard = () => ({ ships: FLEET.map((s) => ({ ...s, hits: [s.origin] })), arsenal: [], marks: { '0,0': 'hit' } });

function run(over: Partial<Parameters<typeof routeAfterMatch>[0]> = {}) {
  const go = vi.fn();
  const cancel = routeAfterMatch({
    key: 'match-1',
    facts: { mode: 'online', tutorial: false, ownerId: 'me', winnerId: 'them', opponentId: 'them' },
    winner: THEM,
    match: null,
    ...over,
    go,
  });
  return { go, cancel };
}

function overFrame(extra: Record<string, unknown> = {}) {
  return {
    winnerId: 'them',
    reason: 'fleet' as const,
    rewards: { points: 5, coins: 10 },
    ...extra,
  };
}

beforeEach(() => {
  useReveal.setState({ session: null, opened: [], left: [] });
  useMatchClient.setState({ matchId: 'match-1', status: 'active', over: null });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the winner', () => {
  it('goes straight to the result, at once, online or offline', () => {
    const online = run({ facts: { mode: 'online', tutorial: false, ownerId: 'me', winnerId: 'me', opponentId: 'them' } });
    expect(online.go).toHaveBeenCalledTimes(1);
    expect(online.go).toHaveBeenCalledWith(null);
    const offline = run({ facts: { mode: 'ai', tutorial: false, ownerId: 'me', winnerId: 'me', opponentId: 'ai' } });
    expect(offline.go).toHaveBeenCalledWith(null);
    expect(useReveal.getState().session).toBeNull();
  });
});

describe('a loss to the offline AI', () => {
  it('reveals the AI’s actual final board', () => {
    const match = aiWins();
    const { go } = run({
      key: 'result-1',
      facts: { mode: 'ai', tutorial: false, ownerId: 'me', winnerId: 'ai', opponentId: 'ai' },
      winner: revealWinner({ id: 'ai', name: 'Admiral Bot' }),
      match,
    });
    expect(go).toHaveBeenCalledWith('result-1');
    const session = useReveal.getState().session;
    expect(session?.winner.name).toBe('Admiral Bot');
    expect(session?.board.ships).toEqual(match.players[1].board.ships);
    expect(session?.board.marks).toEqual(match.players[1].board.marks);
  });

  it('without a finished local match, goes to the result instead of showing anything', () => {
    const { go } = run({
      key: 'result-2',
      facts: { mode: 'ai', tutorial: false, ownerId: 'me', winnerId: 'ai', opponentId: 'ai' },
      winner: revealWinner({ id: 'ai' }),
      match: null,
    });
    expect(go).toHaveBeenCalledWith(null);
  });
});

describe('an online loss', () => {
  it('with the settled `over` already here, reveals at once', () => {
    useMatchClient.setState({ over: overFrame({ reveal: serverBoard() }), status: 'over' });
    const { go } = run();
    expect(go).toHaveBeenCalledWith('match-1');
    expect(useReveal.getState().session?.board.ships).toHaveLength(8);
  });

  it('waits for an `over` that follows GAME_OVER, then reveals', () => {
    vi.useFakeTimers();
    const { go } = run();
    expect(go).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVEAL_WAIT_MS / 2);
    useMatchClient.setState({ over: overFrame({ reveal: serverBoard() }), status: 'over' });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith('match-1');
    vi.advanceTimersByTime(REVEAL_WAIT_MS * 2);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('an older server (no reveal) goes straight to the result', () => {
    useMatchClient.setState({ over: overFrame(), status: 'over' });
    const { go } = run();
    expect(go).toHaveBeenCalledWith(null);
  });

  it('a malformed reveal cannot trap the player', () => {
    for (const reveal of [{ ships: 'nope' }, { ships: [{ id: 'x' }] }, 42, null]) {
      useReveal.setState({ session: null, opened: [], left: [] });
      useMatchClient.setState({ over: overFrame({ reveal }), status: 'over' });
      const { go } = run();
      expect(go).toHaveBeenCalledWith(null);
    }
  });

  it('an `over` naming someone else as the winner is not trusted for a reveal', () => {
    useMatchClient.setState({ over: overFrame({ winnerId: 'me', reveal: serverBoard() }), status: 'over' });
    const { go } = run();
    expect(go).toHaveBeenCalledWith(null);
  });

  it('an `over` from another match is ignored; the bounded wait then ends on the result', () => {
    vi.useFakeTimers();
    useMatchClient.setState({ matchId: 'older-match', over: overFrame({ reveal: serverBoard() }), status: 'over' });
    const { go } = run();
    expect(go).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVEAL_WAIT_MS);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(null);
  });

  it('no `over` at all: the wait is bounded', () => {
    vi.useFakeTimers();
    const { go } = run();
    vi.advanceTimersByTime(REVEAL_WAIT_MS - 1);
    expect(go).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(go).toHaveBeenCalledWith(null);
  });

  it('a connection that gives up ends the wait on the result', () => {
    const { go } = run();
    useMatchClient.setState({ status: 'failed' });
    expect(go).toHaveBeenCalledWith(null);
  });

  it('an unmount during the wait navigates nowhere and leaves nothing behind', () => {
    vi.useFakeTimers();
    const { go, cancel } = run();
    cancel();
    useMatchClient.setState({ over: overFrame({ reveal: serverBoard() }), status: 'over' });
    vi.advanceTimersByTime(REVEAL_WAIT_MS * 2);
    expect(go).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(useReveal.getState().session).toBeNull();
  });

  it('a duplicate end of the same match never reopens the reveal', () => {
    useMatchClient.setState({ over: overFrame({ reveal: serverBoard() }), status: 'over' });
    expect(run().go).toHaveBeenCalledWith('match-1');
    const first = useReveal.getState().session;
    expect(run().go).toHaveBeenCalledWith(null);
    expect(useReveal.getState().session).toBe(first);
  });
});

describe('nothing is disclosed before the end', () => {
  it('the session is empty all through a match — only the finished-match path fills it', () => {
    // During play there is no `over`, so there is nothing to parse or store.
    useMatchClient.setState({ over: null, status: 'active' });
    expect(useReveal.getState().session).toBeNull();
    vi.useFakeTimers();
    const { cancel } = run();
    expect(useReveal.getState().session).toBeNull();
    cancel();
  });
});

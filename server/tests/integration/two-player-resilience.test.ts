/**
 * What an online match does when the network misbehaves: a player drops, a
 * player comes back, a player stalls, a player floods. Same real server stack
 * as two-player-match.test.ts.
 *
 * These are the paths a phone actually takes — backgrounded app, lost signal,
 * lift ride — and the ones a player experiences as "the game froze" rather
 * than as an error message.
 */
import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import type { Ship } from '@engine/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayoutPayload } from '../../src/protocol';
import { pair, startServer, until, type Harness, type TestPlayer } from '../helpers/twoPlayerHarness';

const ALICE = 'alice';
const BOB = 'bob';

vi.mock('../../src/auth', () => ({
  verifyAccessToken: vi.fn(async (token: string) =>
    token
      ? { ok: true, token: { userId: token, isAnonymous: false } }
      : { ok: false, reason: 'no token' },
  ),
}));

vi.mock('../../src/db', () => ({
  BOT_PLAYER_ID: 'b0000000-0000-4000-8000-000000000001',
  appendMatchEvent: vi.fn(async () => {}),
  applyMatchResult: vi.fn(async () => true),
  cancelWageredMatchBeforeStart: vi.fn(async () => ({ refunded: false, balance: null })),
  dbEndReason: vi.fn((reason: string) => reason),
  fetchOpponentSummary: vi.fn(async (id: string) => ({
    id,
    name: id,
    avatarId: 1,
    avatarColor: '#3E2FB8',
    countryCode: 'IN',
    rankPoints: 0,
    isBot: false,
  })),
  fetchPointBalance: vi.fn(async () => 500),
  insertMatch: vi.fn(async () => {}),
  insertWageredMatch: vi.fn(async () => {}),
  refundPointWager: vi.fn(async () => ({ refunded: false, balance: null })),
  reservePointWager: vi.fn(async () => ({ ok: true, balance: 450, reason: null })),
}));

function layoutPayload(seed: number): LayoutPayload {
  const ships = autoPlaceFleet(createRng(seed)) as Ship[];
  return {
    ships: ships.map((ship) => ({
      id: ship.id,
      class: ship.class,
      len: ship.len,
      origin: ship.origin,
      orientation: ship.orientation,
    })),
    arsenal: [],
  } as LayoutPayload;
}

let harness: Harness;

beforeEach(async () => {
  vi.resetModules();
  harness = await startServer();
});

afterEach(async () => {
  await harness.stop();
});

async function startedMatch() {
  const [alice, bob] = await pair(harness, ALICE, BOB);
  alice.ready(layoutPayload(11));
  bob.ready(layoutPayload(22));
  await until(() => alice.has('turn') && bob.has('turn'), 'the first turn');
  return { alice, bob, matchId: alice.last('matched')?.matchId as string };
}

function whoseTurn(player: TestPlayer): string {
  const turn = player.last('turn');
  if (!turn) throw new Error('no turn message yet');
  return turn.playerId;
}

describe('a player drops mid-match', () => {
  it('tells the one still here, rather than leaving them staring at a board', async () => {
    const { alice, bob } = await startedMatch();

    bob.kill();

    await until(
      () => alice.all('state').some((message) => message.opponentDisconnected === true),
      'the disconnect notice',
    );
    const latest = alice.all('state').at(-1);
    expect(latest?.opponentDisconnected).toBe(true);
  });

  it('does not end the match immediately — there is a grace window', async () => {
    const { alice, bob } = await startedMatch();

    bob.kill();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(alice.has('over')).toBe(false);
  });

  it('keeps the match alive for the dropped player to come back to', async () => {
    const { alice, bob, matchId } = await startedMatch();
    bob.kill();
    await until(
      () => alice.all('state').some((message) => message.opponentDisconnected === true),
      'the disconnect notice',
    );

    const returning = harness.player(BOB);
    await returning.open();
    returning.hello(matchId);

    await until(() => returning.has('state'), 'a fresh state on resume');
    expect(returning.last('state')?.view).toBeDefined();
  });
});

describe('a player reconnects', () => {
  it('receives the event log and a fresh state, not a half-played board', async () => {
    const { alice, bob, matchId } = await startedMatch();
    // Play one real shot so there is history worth replaying.
    const mover = whoseTurn(alice) === ALICE ? alice : bob;
    mover.fire({ r: 0, c: 0 });
    await until(() => alice.has('events'), 'the first events');

    bob.kill();
    const returning = harness.player(BOB);
    await returning.open();
    returning.hello(matchId);

    await until(() => returning.has('state'), 'state after resume');
    // The client absorbs the log silently and snaps to this state — a resync,
    // never an animated replay.
    expect(returning.last('state')?.view).toBeDefined();
    expect(returning.last('state')?.seq).toBeGreaterThan(0);
  });

  it('clears the opponent-disconnected flag for the player who waited', async () => {
    const { alice, bob, matchId } = await startedMatch();
    bob.kill();
    await until(
      () => alice.all('state').some((message) => message.opponentDisconnected === true),
      'the disconnect notice',
    );

    const returning = harness.player(BOB);
    await returning.open();
    returning.hello(matchId);
    await until(() => returning.has('state'), 'resume');

    await until(() => {
      const latest = alice.all('state').at(-1);
      return latest?.opponentDisconnected !== true;
    }, 'the reconnect notice');
  });

  it('refuses to resume a match the player was never in', async () => {
    await startedMatch();
    const stranger = harness.player('mallory');
    await stranger.open();

    stranger.hello('11111111-2222-4333-8444-555555555555');

    await until(() => stranger.has('hello:ok') || stranger.has('error'), 'a verdict');
    // Either way it must not hand over somebody else's board.
    expect(stranger.has('state')).toBe(false);
  });

  it('the turn holder is unchanged by a reconnect', async () => {
    const { alice, bob, matchId } = await startedMatch();
    const before = whoseTurn(alice);

    bob.kill();
    const returning = harness.player(BOB);
    await returning.open();
    returning.hello(matchId);
    await until(() => returning.has('state'), 'resume');

    expect(whoseTurn(alice)).toBe(before);
  });
});

describe('the server protects itself without breaking honest play', () => {
  it('cuts a socket that floods it', async () => {
    const { alice } = await startedMatch();

    for (let burst = 0; burst < 30; burst += 1) alice.ping();

    await until(() => alice.has('error'), 'a rate limit');
    expect(alice.last('error')?.code).toBe('rate_limited');
  });

  it('a normally-paced match never trips the limit', async () => {
    // The pace a real client can manage: every shot waits on a server round
    // trip before the next is even possible.
    const { alice, bob } = await startedMatch();
    await new Promise((resolve) => setTimeout(resolve, 1100));

    for (let round = 0; round < 8; round += 1) {
      const mover = whoseTurn(alice) === ALICE ? alice : bob;
      mover.fire({ r: round, c: (round * 3) % 10 });
      await new Promise((resolve) => setTimeout(resolve, 160));
    }

    for (const player of [alice, bob]) {
      expect(player.all('error').map((e) => e.code)).not.toContain('rate_limited');
    }
  });

  it('rejects a malformed frame without killing the match', async () => {
    const { alice } = await startedMatch();

    // Not valid against the protocol schema.
    alice.send({ t: 'action', v: 1, seq: -1, action: { type: 'NONSENSE' } } as never);

    await until(() => alice.has('error'), 'an error');
    expect(alice.has('over')).toBe(false);
  });

  it('ignores a duplicate action seq instead of firing twice', async () => {
    const { alice, bob } = await startedMatch();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const mover = whoseTurn(alice) === ALICE ? alice : bob;
    const seq = Date.now() * 10;

    const shot = { r: 5, c: 5 };
    // The layout handshake already produced `events`, so waiting on "any
    // events" would return before the shot's own batch landed and compare the
    // wrong baseline — which is what the first version of this test did.
    const beforeShot = mover.all('events').length;
    mover.send({ t: 'action', v: 1, seq, action: { type: 'FIRE', at: shot } } as never);
    await until(() => mover.all('events').length > beforeShot, "the shot's own events");
    const afterFirst = mover.all('events').length;

    // The retry a flaky connection produces.
    mover.send({ t: 'action', v: 1, seq, action: { type: 'FIRE', at: shot } } as never);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(mover.all('events').length).toBe(afterFirst);
  });
});

describe('leaving the queue', () => {
  it('cancelling before a match frees the player', async () => {
    const solo = harness.player(ALICE);
    await solo.open();
    solo.hello();
    await until(() => solo.has('hello:ok'), 'hello:ok');
    solo.queue();
    await until(() => solo.has('queued'), 'queued');

    solo.cancelQueue();

    await until(() => solo.has('queue:cancelled'), 'the cancellation');
    expect(solo.last('queue:cancelled')?.reason).toBe('cancelled');
  });

  it('a second player can still be matched afterwards', async () => {
    const first = harness.player(ALICE);
    await first.open();
    first.hello();
    await until(() => first.has('hello:ok'), 'hello:ok');
    first.queue();
    await until(() => first.has('queued'), 'queued');
    first.cancelQueue();
    await until(() => first.has('queue:cancelled'), 'the cancellation');

    const [two, three] = await pair(harness, 'carol', 'dave');

    expect(two.last('matched')?.matchId).toBe(three.last('matched')?.matchId);
  });
});

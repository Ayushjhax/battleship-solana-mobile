/**
 * BUG-011: a Cancel that crosses `matched`.
 *
 * Unwagered rooms had no pre-start cancel at all: the cancelling app left, and
 * 45 s later the room forfeited it — a loss on the canceller's record, and the
 * opponent sat in placement waiting it out. Now the match closes with no
 * result (no win, no loss, no rating change) and both captains are told.
 *
 * Both kinds also had a race while the room was still being built: a cancel
 * landing between the pairing and the room's `matched` was either ignored
 * (unwagered) or applied — stakes refunded — after which the room carried on
 * and sent `matched` anyway (wagered). A cancel during the build is now
 * honoured the moment the room is ready, and `matched` never goes out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  type DbCall,
  installAuthMock,
  installDbMock,
  startTestServer,
  type TestClient,
} from '../../src/__tests__/testUtils';

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const HOLD_A = '11111111-1111-4111-8111-111111111111';
const HOLD_B = '22222222-2222-4222-8222-222222222222';

function queue(client: TestClient, wagerRequestId?: string): void {
  client.send({
    t: 'queue',
    v: 1,
    mode: 'classic',
    wagered: wagerRequestId !== undefined,
    opponent: 'player',
    ...(wagerRequestId ? { wagerRequestId } : {}),
  });
}

const calls = (dbCalls: DbCall[], fn: string) => dbCalls.filter((call) => call.fn === fn);

describe('a Cancel that crosses `matched`', () => {
  beforeEach(() => {
    vi.resetModules();
    installAuthMock();
    // Short enough to wait out: a forfeit would have landed by the time we look.
    process.env.SEABATTLE_DISCONNECT_GRACE_MS = '300';
  });
  afterEach(() => {
    delete process.env.SEABATTLE_DISCONNECT_GRACE_MS;
  });

  it('closes an unwagered match with no result, and tells the opponent', async () => {
    const dbCalls = installDbMock().calls;
    const server = await startTestServer();
    const alice = await connectClient(server.port, 'alice');
    const bob = await connectClient(server.port, 'bob');
    queue(alice);
    queue(bob);
    const matched = await alice.waitFor((m) => m.t === 'matched', 5000);
    await bob.waitFor((m) => m.t === 'matched', 5000);

    alice.send({ t: 'cancelQueue', v: 1 });
    const mine = await alice.waitFor((m) => m.t === 'queue:cancelled', 3000);
    const theirs = await bob.waitFor((m) => m.t === 'queue:cancelled', 3000);

    expect(mine).toMatchObject({ reason: 'cancelled', refunded: false });
    expect(theirs).toMatchObject({ reason: 'opponent_cancelled', refunded: false });
    expect(calls(dbCalls, 'cancelMatchBeforeStart')).toEqual([
      { fn: 'cancelMatchBeforeStart', args: [matched.matchId, 'alice'] },
    ]);
    alice.close();
    await settle(600);
    expect(calls(dbCalls, 'applyMatchResult')).toHaveLength(0);
    const { rooms } = await import('../../src/room');
    expect(rooms.size).toBe(0);

    bob.close();
    await server.close();
  }, 20000);

  it('honours an unwagered cancel that lands while the room is being built', async () => {
    // Profile reads are the room build's last await; slow them to hold the window open.
    const dbCalls = installDbMock({ profileDelayMs: 400 }).calls;
    const server = await startTestServer();
    const alice = await connectClient(server.port, 'alice');
    const bob = await connectClient(server.port, 'bob');
    queue(alice);
    await alice.waitFor((m) => m.t === 'queued', 5000);
    queue(bob);
    await bob.waitFor((m) => m.t === 'queued', 5000);
    // Paired now; the room is still reading both profiles.
    alice.send({ t: 'cancelQueue', v: 1 });

    await alice.waitFor((m) => m.t === 'queue:cancelled', 3000);
    const theirs = await bob.waitFor((m) => m.t === 'queue:cancelled', 3000);
    expect(theirs).toMatchObject({ reason: 'opponent_cancelled', refunded: false });
    await settle(900);
    expect(alice.history().some((m) => m.t === 'matched')).toBe(false);
    expect(bob.history().some((m) => m.t === 'matched')).toBe(false);
    expect(calls(dbCalls, 'cancelMatchBeforeStart')).toHaveLength(1);
    expect(calls(dbCalls, 'applyMatchResult')).toHaveLength(0);

    alice.close();
    bob.close();
    await server.close();
  }, 20000);

  it('refunds both stakes for a wagered cancel during the build, and never sends `matched`', async () => {
    const dbCalls = installDbMock({ profileDelayMs: 400 }).calls;
    const server = await startTestServer();
    const alice = await connectClient(server.port, 'alice');
    const bob = await connectClient(server.port, 'bob');
    queue(alice, HOLD_A);
    await alice.waitFor((m) => m.t === 'queued', 5000);
    queue(bob, HOLD_B);
    await bob.waitFor((m) => m.t === 'queued', 5000);
    alice.send({ t: 'cancelQueue', v: 1 });

    const mine = await alice.waitFor((m) => m.t === 'queue:cancelled', 3000);
    const theirs = await bob.waitFor((m) => m.t === 'queue:cancelled', 3000);
    expect(mine).toMatchObject({ reason: 'cancelled', refunded: true });
    expect(theirs).toMatchObject({ reason: 'opponent_cancelled', refunded: true });
    await settle(900);
    expect(bob.history().some((m) => m.t === 'matched')).toBe(false);
    expect(calls(dbCalls, 'cancelWageredMatchBeforeStart')).toHaveLength(1);
    expect(calls(dbCalls, 'applyMatchResult')).toHaveLength(0);

    alice.close();
    bob.close();
    await server.close();
  }, 20000);
});

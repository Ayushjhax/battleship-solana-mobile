/**
 * BUG-002: a late close of a player's OLD socket detached their live seat.
 *
 * A phone that changes network opens a new socket and re-attaches to its
 * match long before the server notices the old one is dead (its heartbeat
 * takes 30-90 s). The close handler then acted on the player id alone: it
 * nulled the seat's socket, so the room stopped sending the player anything
 * (pings were still answered, so the app saw nothing wrong), told the
 * opponent they had dropped, and forfeited them 45 s later.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  installAuthMock,
  installDbMock,
  readyUpBoth,
  reconnectClient,
  startTestServer,
} from '../../src/__tests__/testUtils';

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a stale socket closing after its player reconnected', () => {
  beforeEach(() => {
    vi.resetModules();
    installAuthMock();
    installDbMock();
  });

  it('leaves the live seat attached and the opponent undisturbed', async () => {
    const server = await startTestServer();
    const aliceOld = await connectClient(server.port, 'alice');
    const bob = await connectClient(server.port, 'bob');
    aliceOld.send({ t: 'queue', v: 1, mode: 'classic' });
    bob.send({ t: 'queue', v: 1, mode: 'classic' });
    const matched = await aliceOld.waitFor((m) => m.t === 'matched', 5000);
    await bob.waitFor((m) => m.t === 'matched', 5000);
    await readyUpBoth(aliceOld, bob);

    // The new socket attaches while the server still believes the old one is open.
    const aliceNew = await reconnectClient(server.port, 'alice', matched.matchId as string);
    await aliceNew.waitFor((m) => m.t === 'state', 5000);
    // ...and only later does the server learn the old one is gone.
    aliceOld.close();
    await settle(300);

    const bobLast = bob.history().filter((m) => m.t === 'state').at(-1);
    expect(bobLast?.opponentDisconnected).toBeUndefined();

    // Whoever is to move fires; alice's live socket must hear about it.
    const turn = bob.history().filter((m) => m.t === 'turn').at(-1) as { playerId: string };
    const shooter = turn.playerId === 'bob' ? bob : aliceNew;
    const before = aliceNew.history().length;
    shooter.send({ t: 'action', v: 1, seq: 1, action: { type: 'FIRE', at: { r: 9, c: 9 } } });
    await aliceNew.waitFor((m) => m.t === 'events', 3000);
    expect(aliceNew.history().slice(before).some((m) => m.t === 'state')).toBe(true);

    aliceNew.close();
    bob.close();
    await server.close();
  }, 20000);

  it('still treats a close of the CURRENT socket as a disconnect', async () => {
    const server = await startTestServer();
    const alice = await connectClient(server.port, 'alice');
    const bob = await connectClient(server.port, 'bob');
    alice.send({ t: 'queue', v: 1, mode: 'classic' });
    bob.send({ t: 'queue', v: 1, mode: 'classic' });
    await alice.waitFor((m) => m.t === 'matched', 5000);
    await bob.waitFor((m) => m.t === 'matched', 5000);
    await readyUpBoth(alice, bob);

    alice.close();
    const flagged = await bob.waitFor((m) => m.t === 'state' && m.opponentDisconnected === true, 3000);
    expect(flagged.opponentDisconnected).toBe(true);

    bob.close();
    await server.close();
  }, 20000);
});

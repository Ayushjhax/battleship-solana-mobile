/**
 * BUG-003: re-queueing from a new socket stranded the player.
 *
 * When a phone reconnects while it is in line, the server may still hold the
 * old socket (it only notices a dead one through its heartbeat). The new
 * socket's `queue` was refused with `already_queued` — which the app reads as
 * "my place survived the blip" — but the place still pointed at the OLD
 * socket: `matched` went to a dead socket, or the old socket's late close
 * removed the place while the app kept showing "In line" forever.
 *
 * The app now presents a per-install `clientId` in `hello`. A queue from the
 * same install takes over its own place; another device signed in to the
 * same account is still refused, exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectClient, installAuthMock, installDbMock, startTestServer } from '../../src/__tests__/testUtils';

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const INSTALL = '0f0e0d0c-0b0a-4908-8706-050403020100';
const OTHER_PHONE = '1f1e1d1c-1b1a-4918-8716-151413121110';

describe('a player re-queueing from a new socket', () => {
  beforeEach(() => {
    vi.resetModules();
    installAuthMock();
    installDbMock();
  });

  it('moves their place in line to the new socket, which then gets the match', async () => {
    const server = await startTestServer();
    const oldSocket = await connectClient(server.port, 'alice', { clientId: INSTALL });
    oldSocket.send({ t: 'queue', v: 1, mode: 'classic' });
    await oldSocket.waitFor((m) => m.t === 'queued', 5000);

    const newSocket = await connectClient(server.port, 'alice', { clientId: INSTALL });
    newSocket.send({ t: 'queue', v: 1, mode: 'classic' });
    const reply = await newSocket.waitFor((m) => m.t === 'queued' || m.t === 'error', 5000);
    expect(reply.t).toBe('queued');

    const bob = await connectClient(server.port, 'bob');
    bob.send({ t: 'queue', v: 1, mode: 'classic' });
    const matched = await newSocket.waitFor((m) => m.t === 'matched', 5000);
    expect((matched.opponent as { id: string }).id).toBe('bob');
    expect(oldSocket.history().some((m) => m.t === 'matched')).toBe(false);

    oldSocket.close();
    newSocket.close();
    bob.close();
    await server.close();
  }, 20000);

  it('keeps that place when the old socket finally closes', async () => {
    const server = await startTestServer();
    const oldSocket = await connectClient(server.port, 'alice', { clientId: INSTALL });
    oldSocket.send({ t: 'queue', v: 1, mode: 'classic' });
    await oldSocket.waitFor((m) => m.t === 'queued', 5000);
    const newSocket = await connectClient(server.port, 'alice', { clientId: INSTALL });
    newSocket.send({ t: 'queue', v: 1, mode: 'classic' });
    await newSocket.waitFor((m) => m.t === 'queued' || m.t === 'error', 5000);

    // The heartbeat finally notices the dead socket.
    oldSocket.close();
    await settle(300);

    const bob = await connectClient(server.port, 'bob');
    bob.send({ t: 'queue', v: 1, mode: 'classic' });
    const matched = await bob.waitFor((m) => m.t === 'matched', 3000);
    expect((matched.opponent as { id: string }).id).toBe('alice');
    await newSocket.waitFor((m) => m.t === 'matched', 3000);

    newSocket.close();
    bob.close();
    await server.close();
  }, 20000);

  it('still refuses a second device signed in to the same account', async () => {
    const server = await startTestServer();
    const phone = await connectClient(server.port, 'alice', { clientId: INSTALL });
    phone.send({ t: 'queue', v: 1, mode: 'classic' });
    await phone.waitFor((m) => m.t === 'queued', 5000);

    const tablet = await connectClient(server.port, 'alice', { clientId: OTHER_PHONE });
    tablet.send({ t: 'queue', v: 1, mode: 'classic' });
    const reply = await tablet.waitFor((m) => m.t === 'queued' || m.t === 'error', 5000);
    expect(reply).toMatchObject({ t: 'error', code: 'already_queued' });

    // ...and the first device keeps its place.
    const bob = await connectClient(server.port, 'bob');
    bob.send({ t: 'queue', v: 1, mode: 'classic' });
    await phone.waitFor((m) => m.t === 'matched', 5000);

    phone.close();
    tablet.close();
    bob.close();
    await server.close();
  }, 20000);
});

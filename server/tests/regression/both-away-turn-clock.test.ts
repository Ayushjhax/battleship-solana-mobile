/**
 * BUG-017: with both captains away, the room waits ABANDON_GRACE_MS and then
 * closes the match with no winner — but the turn clock kept running through
 * that wait. Turn timeouts could pile up into a forfeit first, handing a win
 * (and a wager) in a match neither captain was playing. The clock now stops
 * while every human is away and restarts when one comes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  installAuthMock,
  installDbMock,
  readyUpBoth,
  reconnectClient,
  startTestServer,
} from '../../src/__tests__/testUtils';

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ENV = {
  SEABATTLE_TURN_TIMEOUT_MS: '250',
  SEABATTLE_ABANDON_GRACE_MS: '1500',
  SEABATTLE_DISCONNECT_GRACE_MS: '10000',
};

describe('both captains away', () => {
  beforeEach(() => {
    vi.resetModules();
    installAuthMock();
    Object.assign(process.env, ENV);
  });
  afterEach(() => {
    for (const key of Object.keys(ENV)) delete process.env[key];
  });

  it('stops the turn clock, so the match is abandoned with no winner rather than forfeited', async () => {
    const dbCalls = installDbMock().calls;
    const server = await startTestServer();
    const alice = await connectClient(server.port, 'alice');
    const bob = await connectClient(server.port, 'bob');
    alice.send({ t: 'queue', v: 1, mode: 'classic' });
    bob.send({ t: 'queue', v: 1, mode: 'classic' });
    await alice.waitFor((m) => m.t === 'matched', 5000);
    await bob.waitFor((m) => m.t === 'matched', 5000);
    await readyUpBoth(alice, bob);

    alice.close();
    bob.close();
    // Several turn timeouts' worth, inside the abandon grace.
    await settle(1100);
    expect(dbCalls.filter((call) => call.fn === 'applyMatchResult')).toHaveLength(0);
    await settle(800);
    expect(dbCalls.filter((call) => call.fn === 'abandonMatch')).toHaveLength(1);
    expect(dbCalls.filter((call) => call.fn === 'applyMatchResult')).toHaveLength(0);

    await server.close();
  }, 20000);

  it('starts the clock again when one of them comes back', async () => {
    installDbMock();
    const server = await startTestServer();
    const alice = await connectClient(server.port, 'alice');
    const bob = await connectClient(server.port, 'bob');
    alice.send({ t: 'queue', v: 1, mode: 'classic' });
    bob.send({ t: 'queue', v: 1, mode: 'classic' });
    const matched = await alice.waitFor((m) => m.t === 'matched', 5000);
    await bob.waitFor((m) => m.t === 'matched', 5000);
    await readyUpBoth(alice, bob);
    alice.close();
    bob.close();
    await settle(400);

    const back = await reconnectClient(server.port, 'alice', matched.matchId as string);
    const turn = await back.waitFor((m) => m.t === 'turn', 3000);
    expect(turn.endsAt as number).toBeGreaterThan(Date.now());
    // The match is live again: the clock runs out and play moves on.
    await back.waitFor((m) => m.t === 'events' && JSON.stringify(m.events).includes('"TIMEOUT"'), 3000);

    back.close();
    await server.close();
  }, 20000);
});

/**
 * BUG-016: a wagered match whose settlement failed kept retrying every 5 s,
 * forever, with the room still registered — so both players were told
 * "already in a match" whenever they tried to queue, until the database came
 * back (or, for a settlement that could never succeed, until a restart). The
 * players are now released at once while the settlement keeps retrying in the
 * background, with backoff and a cap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  installAuthMock,
  installDbMock,
  readyUpBoth,
  startTestServer,
} from '../../src/__tests__/testUtils';

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const HOLD_A = '11111111-1111-4111-8111-111111111111';
const HOLD_B = '22222222-2222-4222-8222-222222222222';

async function finishedWageredMatch(settleFailures: number) {
  const dbCalls = installDbMock({ settleFailures }).calls;
  const server = await startTestServer();
  const alice = await connectClient(server.port, 'alice');
  const bob = await connectClient(server.port, 'bob');
  for (const [client, hold] of [[alice, HOLD_A], [bob, HOLD_B]] as const) {
    client.send({ t: 'queue', v: 1, mode: 'classic', wagered: true, opponent: 'player', wagerRequestId: hold });
    await client.waitFor((m) => m.t === 'queued', 5000);
  }
  await alice.waitFor((m) => m.t === 'matched', 5000);
  await bob.waitFor((m) => m.t === 'matched', 5000);
  await readyUpBoth(alice, bob);
  alice.send({ t: 'resign', v: 1 });
  await bob.waitFor((m) => m.t === 'events' && JSON.stringify(m.events).includes('GAME_OVER'), 5000);
  return { dbCalls, server, alice, bob };
}

const settlements = (calls: { fn: string }[]) => calls.filter((call) => call.fn === 'applyMatchResult').length;

describe('a wagered settlement the database refuses', () => {
  beforeEach(() => {
    vi.resetModules();
    installAuthMock();
    process.env.SEABATTLE_SETTLE_RETRY_MS = '20';
  });
  afterEach(() => {
    delete process.env.SEABATTLE_SETTLE_RETRY_MS;
  });

  it('lets both players queue again while it keeps retrying, then delivers the result', async () => {
    const { dbCalls, server, alice, bob } = await finishedWageredMatch(2);

    alice.send({ t: 'queue', v: 1, mode: 'classic' });
    // The "settlement is delayed" notice (code `internal`) is expected; a
    // refusal to queue would be `not_in_room` / `already_queued`.
    const reply = await alice.waitFor((m) => m.t === 'queued' || (m.t === 'error' && m.code !== 'internal'), 3000);
    expect(reply).toMatchObject({ t: 'queued' });

    // Two refusals, then the retry that lands — and the result still reaches bob.
    const over = await bob.waitFor((m) => m.t === 'over', 5000);
    expect(over).toMatchObject({ winnerId: 'bob' });
    expect(settlements(dbCalls)).toBe(3);

    alice.close();
    bob.close();
    await server.close();
  }, 20000);

  it('gives up after a bounded number of tries', async () => {
    const { dbCalls, server, alice, bob } = await finishedWageredMatch(1_000);
    await settle(3000);
    const tries = settlements(dbCalls);
    expect(tries).toBeGreaterThan(1);
    expect(tries).toBeLessThanOrEqual(10);
    await settle(1000);
    expect(settlements(dbCalls)).toBe(tries);

    alice.close();
    bob.close();
    await server.close();
  }, 20000);
});

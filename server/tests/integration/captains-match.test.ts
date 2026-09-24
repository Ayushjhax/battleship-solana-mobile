/**
 * Part 10A at the server boundary — the flag gate, the wire, and what both
 * players are allowed to see.
 *
 * A captain is Port City state, so with `portCity.captains` off (the default)
 * the match server must behave exactly as it did before: a captain is refused,
 * not silently dropped. With the flag on, the captain rides `ready`, is
 * validated by the same reducer the client runs, and becomes public to both
 * seats — that public reveal is the counterplay the design promises.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  KNOWN_LAYOUT,
  connectClient,
  installAuthMock,
  installDbMock,
  startTestServer,
  type TestClient,
  type TestServer,
} from '../../src/__tests__/testUtils';

/** The current client's protocol — what `hello` now carries. */
const MODERN = 3;

const LAYOUT = { ships: KNOWN_LAYOUT, arsenal: [] };

async function setUpAdvanced(server: TestServer): Promise<[TestClient, TestClient]> {
  const alice = await connectClient(server.port, 'alice', MODERN);
  const bob = await connectClient(server.port, 'bob', MODERN);
  alice.send({ t: 'queue', v: 1, mode: 'advanced' });
  await alice.waitFor((m) => m.t === 'queued');
  bob.send({ t: 'queue', v: 1, mode: 'advanced' });
  await bob.waitFor((m) => m.t === 'queued');
  await alice.waitFor((m) => m.t === 'matched');
  await bob.waitFor((m) => m.t === 'matched');
  return [alice, bob];
}

function viewOf(message: Record<string, unknown>): Record<string, unknown> {
  return message.view as Record<string, unknown>;
}

function captainOf(side: Record<string, unknown>): unknown {
  return side.captainId;
}

describe('captains at the server boundary', () => {
  let server: TestServer;
  let clients: TestClient[];

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.PORT_CITY_CAPTAINS;
    clients = [];
    installAuthMock();
    installDbMock();
    server = await startTestServer();
  });

  afterEach(async () => {
    delete process.env.PORT_CITY_CAPTAINS;
    for (const client of clients) client.close();
    await server.close();
  });

  async function connect(playerId: string, protocol?: number): Promise<TestClient> {
    const client = await connectClient(server.port, playerId, protocol);
    clients.push(client);
    return client;
  }

  it('with the flag OFF, a captain is refused and the match does not start', async () => {
    const [alice, bob] = await setUpAdvanced(server);
    clients.push(alice, bob);
    alice.send({ t: 'ready', v: 1, layout: { ...LAYOUT, captainId: 'berhan' } });
    const error = await alice.waitFor((m) => m.t === 'error');
    expect(error.code).toBe('illegal_action');
    expect(String(error.message)).toContain('captains');

    // The refused player can still submit a plain layout and start.
    bob.send({ t: 'ready', v: 1, layout: LAYOUT });
    alice.send({ t: 'ready', v: 1, layout: LAYOUT });
    await alice.waitFor(
      (m) => m.t === 'events' && (m.events as { type: string }[]).some((e) => e.type === 'MATCH_STARTED'),
    );
    await bob.waitFor(
      (m) => m.t === 'events' && (m.events as { type: string }[]).some((e) => e.type === 'MATCH_STARTED'),
    );
  });

  it('with the flag ON, each seat sees the other’s captain in the view', async () => {
    process.env.PORT_CITY_CAPTAINS = 'on';
    const [alice, bob] = await setUpAdvanced(server);
    clients.push(alice, bob);
    alice.send({ t: 'ready', v: 1, layout: { ...LAYOUT, captainId: 'berhan' } });
    bob.send({ t: 'ready', v: 1, layout: { ...LAYOUT, captainId: 'tomas' } });

    const aliceState = await alice.waitFor((m) => m.t === 'state' && viewOf(m).phase === 'playing');
    const bobState = await bob.waitFor((m) => m.t === 'state' && viewOf(m).phase === 'playing');

    const aliceView = viewOf(aliceState);
    const bobView = viewOf(bobState);
    expect(captainOf(aliceView.you as Record<string, unknown>)).toBe('berhan');
    expect(captainOf(aliceView.enemy as Record<string, unknown>)).toBe('tomas');
    expect(captainOf(bobView.you as Record<string, unknown>)).toBe('tomas');
    expect(captainOf(bobView.enemy as Record<string, unknown>)).toBe('berhan');
    // Nothing else new on the enemy side.
    expect('ships' in (aliceView.enemy as Record<string, unknown>)).toBe(false);
  });

  it('with the flag ON, Classic still refuses a captain', async () => {
    process.env.PORT_CITY_CAPTAINS = 'on';
    const alice = await connect('alice', MODERN);
    const bob = await connect('bob', MODERN);
    alice.send({ t: 'queue', v: 1, mode: 'classic' });
    await alice.waitFor((m) => m.t === 'queued');
    bob.send({ t: 'queue', v: 1, mode: 'classic' });
    await bob.waitFor((m) => m.t === 'queued');
    await alice.waitFor((m) => m.t === 'matched');
    await bob.waitFor((m) => m.t === 'matched');

    alice.send({ t: 'ready', v: 1, layout: { ...LAYOUT, captainId: 'rosa' } });
    const error = await alice.waitFor((m) => m.t === 'error');
    expect(error.code).toBe('illegal_action');
    expect(String(error.message)).toContain('classic');
  });

  it('with the flag ON, an old client is asked to upgrade before it can queue', async () => {
    process.env.PORT_CITY_CAPTAINS = 'on';
    // No `protocol` field at all — a build from before Part 5.
    const alice = await connect('alice');
    alice.send({ t: 'queue', v: 1, mode: 'advanced' });
    const error = await alice.waitFor((m) => m.t === 'error');
    expect(error.code).toBe('upgrade_required');
  });

  it('with every flag OFF, an old client still queues exactly as before', async () => {
    const alice = await connect('alice');
    alice.send({ t: 'queue', v: 1, mode: 'advanced', opponent: 'bot' });
    await alice.waitFor((m) => m.t === 'queued');
  });
});

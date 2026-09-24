/**
 * Part 10B at the server boundary — ranked uses ONE season sea for both
 * players, and Classic is Open Sea forever.
 *
 * The sea is in the `matched` frame before placement (the layout has to be
 * legal on it) and in both players' `state` frames as the public terrain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import { terrainForSea } from '@engine/terrain';

import { KNOWN_LAYOUT, connectClient, installAuthMock, installDbMock, startTestServer, type TestClient, type TestServer } from '../../src/__tests__/testUtils';

const MODERN = 3;
const LAYOUT = { ships: KNOWN_LAYOUT, arsenal: [] };

describe('ranked and the season sea', () => {
  let server: TestServer;
  let clients: TestClient[];

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.PORT_CITY_SEAS;
    delete process.env.SEASON_SEA;
    clients = [];
    installAuthMock();
    installDbMock();
    server = await startTestServer();
  });

  afterEach(async () => {
    delete process.env.PORT_CITY_SEAS;
    delete process.env.SEASON_SEA;
    for (const client of clients) client.close();
    await server.close();
  });

  async function connect(playerId: string): Promise<TestClient> {
    const client = await connectClient(server.port, playerId, MODERN);
    clients.push(client);
    return client;
  }

  async function pair(mode: 'classic' | 'advanced'): Promise<[TestClient, TestClient]> {
    const alice = await connect('alice');
    const bob = await connect('bob');
    alice.send({ t: 'queue', v: 1, mode });
    await alice.waitFor((m) => m.t === 'queued');
    bob.send({ t: 'queue', v: 1, mode });
    await bob.waitFor((m) => m.t === 'queued');
    await alice.waitFor((m) => m.t === 'matched');
    await bob.waitFor((m) => m.t === 'matched');
    return [alice, bob];
  }

  it('both seats get the same announced sea, and it is open by default', async () => {
    process.env.PORT_CITY_SEAS = 'on';
    process.env.SEASON_SEA = 'archipelago';
    const [alice, bob] = await pair('advanced');
    // `matched` may already be consumed in `pair`; grab it from history.
    const aliceMatched = alice.history().find((m) => m.t === 'matched');
    const bobMatched = bob.history().find((m) => m.t === 'matched');
    expect(aliceMatched?.sea).toBe('archipelago');
    expect(bobMatched?.sea).toBe('archipelago');
  });

  it('the authoritative view carries that sea as public terrain', async () => {
    process.env.PORT_CITY_SEAS = 'on';
    process.env.SEASON_SEA = 'strait';
    const [alice, bob] = await pair('advanced');
    // A fleet that is actually legal on the Strait (KNOWN_LAYOUT's cruiser
    // sits on an island there), placed by the real generator on that terrain.
    const straitFleet = autoPlaceFleet(createRng(11), terrainForSea('strait'));
    alice.send({ t: 'ready', v: 1, layout: { ships: straitFleet, arsenal: [] } });
    bob.send({ t: 'ready', v: 1, layout: { ships: straitFleet, arsenal: [] } });
    const state = await alice.waitFor((m) => m.t === 'state' && (m.view as { phase: string }).phase === 'playing');
    const terrain = (state.view as { terrain: string[][] }).terrain;
    expect(terrain[0]?.[4]).toBe('island');
    expect(terrain[3]?.[0]).toBe('reef');
  });

  it('with the flag off, ranked is Open Sea exactly as before', async () => {
    const [alice, bob] = await pair('advanced');
    const aliceMatched = alice.history().find((m) => m.t === 'matched');
    const bobMatched = bob.history().find((m) => m.t === 'matched');
    expect(aliceMatched?.sea).toBeUndefined();
    expect(bobMatched?.sea).toBeUndefined();

    alice.send({ t: 'ready', v: 1, layout: LAYOUT });
    bob.send({ t: 'ready', v: 1, layout: LAYOUT });
    const state = await alice.waitFor((m) => m.t === 'state' && (m.view as { phase: string }).phase === 'playing');
    const terrain = (state.view as { terrain: string[][] }).terrain;
    expect(terrain.every((row) => row.every((cell) => cell === 'water'))).toBe(true);
  });

  it('Classic is Open Sea even with the season on a terrain sea', async () => {
    process.env.PORT_CITY_SEAS = 'on';
    process.env.SEASON_SEA = 'coral';
    const [alice, bob] = await pair('classic');
    alice.send({ t: 'ready', v: 1, layout: LAYOUT });
    bob.send({ t: 'ready', v: 1, layout: LAYOUT });
    const state = await alice.waitFor((m) => m.t === 'state' && (m.view as { phase: string }).phase === 'playing');
    const terrain = (state.view as { terrain: string[][] }).terrain;
    expect(terrain.every((row) => row.every((cell) => cell === 'water'))).toBe(true);
  });
});

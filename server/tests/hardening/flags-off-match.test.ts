/**
 * Hardening — every PORT_CITY_* variable unset, the match wire.
 *
 * room.ts promises that with the flags off the wire is byte-for-byte the game
 * from before Part 10: `matched` carries no `sea`, no seat carries a captain,
 * a `ready` that names one is refused rather than silently dropped, and both
 * Classic and Advanced play to a normal fleet victory.
 *
 * The room tests already cover the mechanics; this file pins the FLAG-OFF
 * shapes specifically, with the environment swept clean first, against a real
 * server over real sockets (auth and db mocked, as room.test.ts does).
 */
import type { Coord } from '@engine/types';
import { WATER } from '@engine/terrain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  installAuthMock,
  installDbMock,
  KNOWN_LAYOUT,
  readyUpBoth,
  shipCellsOf,
  startTestServer,
  type DbCall,
  type TestClient,
  type TestServer,
} from '../../src/__tests__/testUtils';
import { FEATURE_KEYS, envNameFor } from '../../src/features';

const OPPONENT_CELLS = shipCellsOf(KNOWN_LAYOUT);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ViewShape {
  phase: string;
  terrain: unknown;
  you: { ready: boolean; captainId: string | null; captainUsed: boolean };
  enemy: { captainId: string | null; captainUsed: boolean };
}

async function setUpMatch(
  server: TestServer,
  mode: 'classic' | 'advanced' = 'classic',
): Promise<[TestClient, TestClient, Record<string, unknown>]> {
  const alice = await connectClient(server.port, 'alice');
  const bob = await connectClient(server.port, 'bob');
  alice.send({ t: 'queue', v: 1, mode });
  await alice.waitFor((m) => m.t === 'queued');
  bob.send({ t: 'queue', v: 1, mode });
  await bob.waitFor((m) => m.t === 'queued');
  const matched = await alice.waitFor((m) => m.t === 'matched');
  await bob.waitFor((m) => m.t === 'matched');
  return [alice, bob, matched];
}

/** Whoever's turn it is fires straight through every known ship cell. */
async function playToVictory(
  alice: TestClient,
  bob: TestClient,
  cells: readonly Coord[] = OPPONENT_CELLS,
  startSeq = 0,
): Promise<Record<string, unknown>> {
  const turnMsg = await alice.waitFor((m) => m.t === 'turn');
  const shooterId = turnMsg.playerId as string;
  const shooter = shooterId === alice.playerId ? alice : bob;
  const other = shooter === alice ? bob : alice;
  await sleep(1100); // let the setup burst leave the rate-limit window

  let seq = startSeq;
  for (const at of cells) {
    shooter.send({ t: 'action', v: 1, seq: seq++, action: { type: 'FIRE', at } });
    const events = (await shooter.waitFor((m) => m.t === 'events')).events as { type: string }[];
    if (events.some((e) => e.type === 'REJECTED')) {
      throw new Error(`unexpected rejection: ${JSON.stringify(events)}`);
    }
    await sleep(110);
  }
  const over = await shooter.waitFor((m) => m.t === 'over');
  await other.waitFor((m) => m.t === 'over');
  return over;
}

describe('every Port City flag off — the match wire', () => {
  let server: TestServer;
  let dbCalls: DbCall[];

  beforeEach(async () => {
    vi.resetModules();
    for (const key of FEATURE_KEYS) delete process.env[envNameFor(key)];
    delete process.env.SEABATTLE_TURN_TIMEOUT_MS;
    delete process.env.SEABATTLE_DISCONNECT_GRACE_MS;
    installAuthMock();
    dbCalls = installDbMock().calls;
    server = await startTestServer();
  });

  afterEach(async () => {
    await server?.close();
  });

  it('matched carries no sea, and no view carries a captain', async () => {
    const [alice, bob, matched] = await setUpMatch(server);
    expect('sea' in matched).toBe(false);
    expect(matched.mode).toBe('classic');

    await readyUpBoth(alice, bob);
    const state = await alice.waitFor(
      (m) => m.t === 'state' && (m.view as ViewShape).phase === 'playing',
    );
    const view = state.view as ViewShape;
    expect(view.terrain).toEqual(WATER);
    for (const side of [view.you, view.enemy]) {
      expect(side.captainId).toBeNull();
      expect(side.captainUsed).toBe(false);
    }

    // No frame of the whole exchange mentions a sea key at all.
    for (const frame of alice.history()) {
      expect(JSON.stringify(frame)).not.toContain('"sea"');
    }

    alice.close();
    bob.close();
  });

  it('refuses a ready that names a captain, and does not half-apply it', async () => {
    const [alice, bob] = await setUpMatch(server);

    alice.send({
      t: 'ready',
      v: 1,
      layout: { ships: KNOWN_LAYOUT, arsenal: [], captainId: 'berhan' },
    });
    const error = await alice.waitFor((m) => m.t === 'error');
    expect(error.code).toBe('illegal_action');
    expect(String(error.message)).toMatch(/captain/i);

    // If the refused ready had been applied at all, the valid one below would
    // be rejected as "already ready" and the match would never start.
    await readyUpBoth(alice, bob);
    const over = await playToVictory(alice, bob);
    expect(over.reason).toBe('fleet');

    alice.close();
    bob.close();
  }, 30_000);

  it('a Classic match plays exactly as before', async () => {
    const [alice, bob, matched] = await setUpMatch(server, 'classic');
    expect('sea' in matched).toBe(false);

    await readyUpBoth(alice, bob);
    const over = await playToVictory(alice, bob);
    expect(over.reason).toBe('fleet');
    expect(['alice', 'bob']).toContain(over.winnerId);
    expect(over.rewards).toEqual({ points: 25, coins: 50 });

    // Settled once, with the pre-Part-10 reward table.
    const settled = dbCalls.filter((c) => c.fn === 'applyMatchResult');
    expect(settled).toHaveLength(1);

    alice.close();
    bob.close();
  }, 30_000);

  it('an Advanced match plays exactly as before', async () => {
    const [alice, bob, matched] = await setUpMatch(server, 'advanced');
    expect(matched.mode).toBe('advanced');
    expect('sea' in matched).toBe(false);

    await readyUpBoth(alice, bob);
    const state = await alice.waitFor(
      (m) => m.t === 'state' && (m.view as ViewShape).phase === 'playing',
    );
    expect((state.view as ViewShape).terrain).toEqual(WATER);

    const over = await playToVictory(alice, bob);
    expect(over.reason).toBe('fleet');
    expect(over.rewards).toEqual({ points: 25, coins: 50 });

    alice.close();
    bob.close();
  }, 30_000);
});

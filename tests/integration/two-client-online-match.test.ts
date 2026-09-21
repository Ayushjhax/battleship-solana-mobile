/**
 * Two real `useMatchClient` instances playing each other through the real
 * server. This closes the last gap in the online coverage: until now the
 * server was proven against raw protocol sockets, and the client was proven
 * against a fake server, but the two had never been run against each other.
 *
 * Both halves here are the shipped code:
 *   - the client  — src/net/match-client.ts, over a real WebSocket
 *   - the server  — server/src/ws.ts + matchmaker.ts + room.ts + the engine
 *
 * Only the process edges are faked: Supabase and JWT verification on the
 * server, `getAccessToken` and expo-network on the client.
 *
 * Two mechanics make this possible and are worth knowing before editing:
 *
 *  1. `useMatchClient` is a module-level singleton, so two instances need two
 *     module graphs — `vi.resetModules()` between imports gives exactly that,
 *     verified by the isolation assertion in the first test.
 *  2. A `vi.mock` factory is cached and does NOT re-run per graph, so the two
 *     clients cannot each close over their own identity. The token is instead
 *     switched externally and each client is walked to `queued` before the
 *     next one connects, which pins its hello to the right player.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import type { Ship } from '@engine/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ALICE = 'alice';
const BOB = 'bob';

/** Which player the NEXT `getAccessToken` call belongs to. See the header. */
const auth = { token: ALICE };

vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isInternetReachable: true, isConnected: true }),
}));
vi.mock('../../src/net/api', () => ({
  getAccessToken: vi.fn(async () => ({ ok: true as const, value: auth.token })),
}));

// --- the server's two process edges -----------------------------------------
vi.mock('../../server/src/auth', () => ({
  verifyAccessToken: vi.fn(async (token: string) =>
    token
      ? { ok: true, token: { userId: token, isAnonymous: false } }
      : { ok: false, reason: 'no token' },
  ),
}));
vi.mock('../../server/src/db', () => ({
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(15);
  }
}

type ClientModule = typeof import('../../src/net/match-client');
type Client = ClientModule['useMatchClient'];

function fleet(seed: number) {
  const ships = autoPlaceFleet(createRng(seed)) as Ship[];
  return {
    ships,
    layout: {
      ships: ships.map((ship) => ({
        id: ship.id,
        class: ship.class,
        len: ship.len,
        origin: ship.origin,
        orientation: ship.orientation,
      })),
      arsenal: [],
    },
  };
}

function hullCells(ships: readonly Ship[]): string[] {
  const cells: string[] = [];
  for (const ship of ships) {
    for (let step = 0; step < ship.len; step += 1) {
      const r = ship.origin.r + (ship.orientation === 'v' ? step : 0);
      const c = ship.origin.c + (ship.orientation === 'h' ? step : 0);
      cells.push(`${r},${c}`);
    }
  }
  return cells;
}

let http: Server;
let stopWs: () => void;

beforeEach(async () => {
  vi.resetModules();
  const { attachWebSocketServer } = await import('../../server/src/ws');
  http = createServer();
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  // The client reads this at connect time.
  process.env.EXPO_PUBLIC_WS_URL = `ws://127.0.0.1:${port}/ws`;
  const wss = attachWebSocketServer(http, () => {});
  stopWs = () => {
    for (const socket of wss.clients) socket.terminate();
    wss.close();
  };
  auth.token = ALICE;
});

afterEach(async () => {
  stopWs?.();
  await new Promise<void>((resolve) => {
    const done = setTimeout(resolve, 800);
    http.close(() => {
      clearTimeout(done);
      resolve();
    });
  });
});

/**
 * Bring up one client in its own module graph, as the given player, and walk
 * it to `queued` before returning — which is what pins its hello to that id.
 */
async function connectAs(playerId: string): Promise<{ client: Client; module: ClientModule }> {
  auth.token = playerId;
  vi.resetModules();
  const module = await import('../../src/net/match-client');
  const client = module.useMatchClient;
  client.getState().queue('classic', { wagered: false, opponent: 'player' });
  await until(
    () => client.getState().status === 'queued' || client.getState().status === 'matched',
    `${playerId} to reach the queue`,
  );
  return { client, module };
}

/** Both clients connected, paired, fleets in, first turn dealt. */
async function startedMatch() {
  const alice = await connectAs(ALICE);
  const bob = await connectAs(BOB);

  await until(
    () => alice.client.getState().status === 'matched' && bob.client.getState().status === 'matched',
    'both clients matched',
  );

  const aliceFleet = fleet(11);
  const bobFleet = fleet(22);
  alice.client.getState().ready(aliceFleet.layout as never);
  bob.client.getState().ready(bobFleet.layout as never);

  await until(
    () => alice.client.getState().view !== null && bob.client.getState().view !== null,
    'both clients to receive a view',
  );
  return { alice: alice.client, bob: bob.client, aliceFleet, bobFleet };
}

function turnHolder(client: Client): string | undefined {
  return client.getState().view?.turn;
}

function disconnectAll(...clients: Client[]) {
  for (const client of clients) client.getState().disconnect();
}

describe('two real clients reach each other through the real server', () => {
  it('holds two genuinely independent client instances', async () => {
    const alice = await connectAs(ALICE);
    const bob = await connectAs(BOB);

    // If these were the same singleton, everything below would be meaningless.
    expect(alice.client).not.toBe(bob.client);
    expect(alice.client.getState().you?.id).toBe(ALICE);
    expect(bob.client.getState().you?.id).toBe(BOB);
    disconnectAll(alice.client, bob.client);
  });

  it('pairs them into one match, each seeing the other as the opponent', async () => {
    const alice = await connectAs(ALICE);
    const bob = await connectAs(BOB);
    await until(
      () =>
        alice.client.getState().status === 'matched' && bob.client.getState().status === 'matched',
      'both matched',
    );

    expect(alice.client.getState().matchId).toBe(bob.client.getState().matchId);
    expect(alice.client.getState().opponent?.id).toBe(BOB);
    expect(bob.client.getState().opponent?.id).toBe(ALICE);
    disconnectAll(alice.client, bob.client);
  });

  it('starts once both have sent their fleet', async () => {
    const { alice, bob } = await startedMatch();

    expect(alice.getState().view?.phase).toBe('playing');
    expect(bob.getState().view?.phase).toBe('playing');
    expect(turnHolder(alice)).toBe(turnHolder(bob));
    disconnectAll(alice, bob);
  });
});

describe('a shot travels from one client to the other', () => {
  it('lands on both clients and hands the turn over', async () => {
    const { alice, bob, aliceFleet, bobFleet } = await startedMatch();
    await sleep(1100); // let the setup burst leave the rate-limit window

    const first = turnHolder(alice);
    const mover = first === ALICE ? alice : bob;
    const watcher = first === ALICE ? bob : alice;
    const enemyHulls = new Set(hullCells(first === ALICE ? bobFleet.ships : aliceFleet.ships));

    // A cell that is certainly water, so the turn must change hands.
    let target = { r: 0, c: 0 };
    outer: for (let r = 0; r < 10; r += 1) {
      for (let c = 0; c < 10; c += 1) {
        if (!enemyHulls.has(`${r},${c}`)) {
          target = { r, c };
          break outer;
        }
      }
    }

    const watcherEventsBefore = watcher.getState().eventsNonce;
    mover.getState().fire(target);

    await until(() => turnHolder(alice) !== first, 'the turn to change hands');
    // The opponent was told about it, not just the shooter.
    expect(watcher.getState().eventsNonce).toBeGreaterThan(watcherEventsBefore);
    expect(turnHolder(alice)).toBe(turnHolder(bob));
    disconnectAll(alice, bob);
  });

  it('both clients converge on the same view of the board', async () => {
    const { alice, bob } = await startedMatch();
    await sleep(1100);

    for (let round = 0; round < 6; round += 1) {
      const mover = turnHolder(alice) === ALICE ? alice : bob;
      mover.getState().fire({ r: round, c: (round * 3) % 10 });
      await sleep(180);
    }

    // Each sees its own board as "you" and the other's as "enemy", but the
    // move count and the turn are facts they must agree on exactly.
    expect(alice.getState().view?.moves).toBe(bob.getState().view?.moves);
    expect(turnHolder(alice)).toBe(turnHolder(bob));
    disconnectAll(alice, bob);
  });

  it('an out-of-turn shot is refused by the server and moves nothing', async () => {
    // `match-client.fire()` has no turn guard of its own — it always sends.
    // The guard players actually hit is in the battle store's `aim()`, and the
    // authority is the server. This checks the authority: a shot that slips
    // past any client-side check must still change nothing.
    const { alice, bob } = await startedMatch();
    await sleep(1100);
    const waiting = turnHolder(alice) === ALICE ? bob : alice;
    const before = waiting.getState().view?.moves;
    const errorsBefore = waiting.getState().errorNonce;

    waiting.getState().fire({ r: 9, c: 9 });
    await sleep(400);

    expect(waiting.getState().view?.moves).toBe(before);
    expect(turnHolder(alice)).toBe(turnHolder(bob));
    // And the player is told, rather than left wondering why nothing happened.
    expect(waiting.getState().errorNonce).toBeGreaterThan(errorsBefore);
    disconnectAll(alice, bob);
  });

  it('never shows either client the other’s ship positions', async () => {
    const { alice, bob, aliceFleet, bobFleet } = await startedMatch();
    await sleep(1100);

    for (let round = 0; round < 5; round += 1) {
      const mover = turnHolder(alice) === ALICE ? alice : bob;
      mover.getState().fire({ r: round, c: round });
      await sleep(180);
    }

    const aliceEnemy = JSON.stringify(alice.getState().view?.enemy ?? {});
    const bobEnemy = JSON.stringify(bob.getState().view?.enemy ?? {});
    for (const cell of hullCells(bobFleet.ships)) {
      const [r, c] = cell.split(',');
      expect(aliceEnemy).not.toMatch(new RegExp(`"origin":\\{"r":${r},"c":${c}\\}`));
    }
    for (const cell of hullCells(aliceFleet.ships)) {
      const [r, c] = cell.split(',');
      expect(bobEnemy).not.toMatch(new RegExp(`"origin":\\{"r":${r},"c":${c}\\}`));
    }
    disconnectAll(alice, bob);
  });
});

describe('a full match between two clients', () => {
  it('runs to a winner both clients agree on', async () => {
    const { alice, bob, aliceFleet, bobFleet } = await startedMatch();
    await sleep(1100);

    const targets: Record<string, string[]> = {
      [ALICE]: hullCells(bobFleet.ships),
      [BOB]: hullCells(aliceFleet.ships),
    };
    const next: Record<string, number> = { [ALICE]: 0, [BOB]: 0 };

    for (let move = 0; move < 200 && !alice.getState().over; move += 1) {
      const holder = turnHolder(alice);
      if (!holder) break;
      const mover = holder === ALICE ? alice : bob;
      const list = targets[holder] ?? [];
      const index = next[holder] ?? 0;
      const cell = list[index];
      if (!cell) break;
      next[holder] = index + 1;
      const [r, c] = cell.split(',').map(Number);
      mover.getState().fire({ r: r as number, c: c as number });
      // ws.ts cuts any socket above 10 messages a second, with no grace.
      await sleep(160);
    }

    await until(
      () => alice.getState().over !== null && bob.getState().over !== null,
      'both clients to see the result',
      20000,
    );

    expect(alice.getState().over?.winnerId).toBe(bob.getState().over?.winnerId);
    expect([ALICE, BOB]).toContain(alice.getState().over?.winnerId);
    expect(alice.getState().status).toBe('over');
    expect(bob.getState().status).toBe('over');
    disconnectAll(alice, bob);
  }, 60000);

  it('a resignation ends it for both', async () => {
    const { alice, bob } = await startedMatch();
    await sleep(1100);

    alice.getState().resign();

    await until(
      () => alice.getState().over !== null && bob.getState().over !== null,
      'both clients to see the result',
    );
    expect(alice.getState().over?.winnerId).toBe(BOB);
    expect(bob.getState().over?.winnerId).toBe(BOB);
    disconnectAll(alice, bob);
  });
});

describe('one client drops while the other plays on', () => {
  it('tells the remaining client the opponent is gone', async () => {
    const { alice, bob } = await startedMatch();

    bob.getState().disconnect();

    await until(
      () => alice.getState().opponentDisconnected === true,
      'the disconnect notice on the client',
    );
    expect(alice.getState().opponentDisconnected).toBe(true);
    disconnectAll(alice);
  });

  it('does not end the match on the remaining client', async () => {
    const { alice, bob } = await startedMatch();

    bob.getState().disconnect();
    await sleep(500);

    expect(alice.getState().over).toBeNull();
    disconnectAll(alice);
  });
});

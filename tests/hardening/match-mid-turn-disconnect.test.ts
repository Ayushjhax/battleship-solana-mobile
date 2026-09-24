/**
 * Hardening — a match socket that dies mid-turn.
 *
 * The fake-server coverage in src/net/__tests__/match-client.test.ts proves
 * the CLIENT's reconnect bookkeeping (resumeMatchId, replay absorbed, fresh
 * authoritative view). tests/integration/two-client-online-match.test.ts
 * proves the REAL server tells the remaining player the opponent is gone. What
 * neither does is drop the transport in the middle of a live turn and then
 * prove, end to end, that the turn's action lands exactly once and both sides
 * resync to the same board.
 *
 * One side is the shipped app client (src/net/match-client.ts). The other is a
 * raw protocol socket from the server suite's helpers, because the app client
 * is a module singleton and two of them need two module graphs — and the
 * token-switching trick that gives them identities cannot survive a reconnect
 * (a reconnect re-reads the shared token). A raw socket's identity is fixed by
 * its own hello, so it survives the drop.
 *
 * The server module namespace is imported once and HELD across the client's
 * `vi.resetModules()` call on purpose: the in-memory rooms map must survive
 * the restart, which is exactly the "process stayed up, transport died" case.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import type { Coord, Ship } from '@engine/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  reconnectClient,
  type TestClient,
} from '../../server/src/__tests__/testUtils';

const ALICE = 'alice';
const BOB = 'bob';

const auth = { token: ALICE };

vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isInternetReachable: true, isConnected: true }),
}));
vi.mock('../../src/net/api', () => ({
  getAccessToken: vi.fn(async () => ({ ok: true as const, value: auth.token })),
}));

vi.mock('../../server/src/auth', () => ({
  verifyAccessToken: vi.fn(async (token: string) =>
    token
      ? { ok: true, token: { userId: token, isAnonymous: false } }
      : { ok: false, reason: 'no token' },
  ),
}));
vi.mock('../../server/src/db', () => ({
  BOT_PLAYER_ID: 'b0000000-0000-4000-8000-000000000001',
  abandonMatch: vi.fn(async () => true),
  appendMatchEvent: vi.fn(async () => {}),
  applyMatchResult: vi.fn(async () => ({ salvageA: 0, salvageB: 0 })),
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

function hullCells(ships: readonly Ship[]): Coord[] {
  const out: Coord[] = [];
  for (const ship of ships) {
    for (let step = 0; step < ship.len; step += 1) {
      out.push(
        ship.orientation === 'v'
          ? { r: ship.origin.r + step, c: ship.origin.c }
          : { r: ship.origin.r, c: ship.origin.c + step },
      );
    }
  }
  return out;
}

const key = (at: Coord) => `${at.r},${at.c}`;

// ---------------------------------------------------------------------------
// The real server, killable and restartable on the same port
// ---------------------------------------------------------------------------

let http: Server;
let port = 0;
/** Held across vi.resetModules() so the in-memory rooms survive a restart. */
let serverModules: { ws: typeof import('../../server/src/ws') };
let wss: ReturnType<(typeof serverModules)['ws']['attachWebSocketServer']> | null = null;

async function startServer(): Promise<void> {
  http = createServer();
  await new Promise<void>((resolve) => http.listen(port || 0, '127.0.0.1', resolve));
  port = (http.address() as AddressInfo).port;
  process.env.EXPO_PUBLIC_WS_URL = `ws://127.0.0.1:${port}/ws`;
  wss = serverModules.ws.attachWebSocketServer(http, () => {});
}

/** The process stays up; only the transport dies. Rooms survive. */
async function killServer(): Promise<void> {
  const current = wss;
  wss = null;
  if (!current) return;
  for (const socket of current.clients) socket.terminate();
  await new Promise<void>((resolve) => current.close(() => http.close(() => resolve())));
}

let alice: Client | null = null;
let bob: TestClient | null = null;
let matchId = '';

beforeEach(async () => {
  vi.resetModules();
  serverModules = { ws: await import('../../server/src/ws') };
  port = 0;
  auth.token = ALICE;
  await startServer();
});

afterEach(async () => {
  alice?.getState().disconnect();
  alice = null;
  bob?.close();
  bob = null;
  await killServer();
});

/** App client (alice) paired with a raw protocol socket (bob), fleets in. */
async function startedMatch() {
  auth.token = ALICE;
  vi.resetModules();
  const module = await import('../../src/net/match-client');
  alice = module.useMatchClient;
  alice.getState().queue('classic', { wagered: false, opponent: 'player' });
  await until(() => alice!.getState().status === 'queued', 'alice to reach the queue');

  bob = await connectClient(port, BOB);
  bob.send({ t: 'queue', v: 1, mode: 'classic' });
  await bob.waitFor((m) => m.t === 'queued');

  const bobMatched = await bob.waitFor((m) => m.t === 'matched');
  matchId = bobMatched.matchId as string;
  await until(() => alice!.getState().status === 'matched', 'alice to be matched');
  expect(alice.getState().matchId).toBe(matchId);
  expect(alice.getState().opponent?.id).toBe(BOB);

  const aliceFleet = fleet(11);
  const bobFleet = fleet(22);
  alice.getState().ready(aliceFleet.layout as never);
  bob.send({ t: 'ready', v: 1, layout: bobFleet.layout });

  await until(() => alice!.getState().view?.phase === 'playing', 'alice to see the board');
  await bob.waitFor(
    (m) => m.t === 'state' && (m.view as { phase?: string }).phase === 'playing',
  );
  return { aliceFleet, bobFleet };
}

/** Sends a FIRE from whichever side holds the turn. */
function fireFrom(shooter: 'alice' | 'bob', at: Coord, seq: number): void {
  if (shooter === 'alice') alice!.getState().fire(at);
  else bob!.send({ t: 'action', v: 1, seq, action: { type: 'FIRE', at } });
}

/** A raw-client view of the board, from the latest `state` frame. */
function bobView(): {
  moves: number;
  turn: string;
  you: { board: { marks: Record<string, string> } };
  enemy: { marks: Record<string, string> };
} {
  const states = bob!.history().filter((m) => m.t === 'state');
  return (states[states.length - 1] as { view: never }).view;
}

async function resyncBoth(): Promise<void> {
  await startServer();
  await until(() => alice!.getState().status === 'active', 'alice to resync', 15_000);
  bob = await reconnectClient(port, BOB, matchId);
  await bob.waitFor((m) => m.t === 'state');
}

describe('a socket drop mid-turn', () => {
  it('applies the turn’s action exactly once and resyncs both sides to the same board', async () => {
    const { aliceFleet, bobFleet } = await startedMatch();
    await sleep(1100); // let the setup burst leave the server's rate-limit window

    const turn = alice!.getState().view?.turn;
    const shooter: 'alice' | 'bob' = turn === ALICE ? 'alice' : 'bob';
    const enemyHulls = hullCells(shooter === 'alice' ? bobFleet.ships : aliceFleet.ships);
    // A hull cell: the shot is a HIT, so the turn stays with the shooter and
    // "play continues" is deterministic after the reconnect.
    const target = enemyHulls[0] as Coord;
    const movesBefore = alice!.getState().view?.moves ?? 0;

    fireFrom(shooter, target, 1);
    await until(
      () => alice!.getState().view?.moves === movesBefore + 1,
      'the shot to land',
    );
    const hitMark = key(target);

    await killServer();
    await until(() => alice!.getState().status === 'reconnecting', 'alice reconnecting');

    await resyncBoth();

    // Exactly once: the same move count on both sides, one more than before.
    expect(alice!.getState().view?.moves).toBe(movesBefore + 1);
    expect(bobView().moves).toBe(movesBefore + 1);
    // The hit sits on the enemy board for the shooter and the own board for
    // the defender — the same fact seen from each side.
    expect(
      shooter === 'alice'
        ? alice!.getState().view?.enemy.marks[hitMark]
        : alice!.getState().view?.you.board.marks[hitMark],
    ).toBe('hit');
    expect(
      shooter === 'alice'
        ? bobView().you.board.marks[hitMark]
        : bobView().enemy.marks[hitMark],
    ).toBe('hit');
    // The replay was absorbed, not animated: the HUD snaps to the truth.
    expect(alice!.getState().pendingEvents).toHaveLength(0);
    expect(alice!.getState().reconnectAttempt).toBe(0);
    expect(alice!.getState().reconnectDeadline).toBeNull();

    // And play continues: the shooter still holds the turn and fires again.
    await sleep(1100);
    const second = enemyHulls[1] as Coord;
    fireFrom(shooter, second, 2);
    await until(
      () => alice!.getState().view?.moves === movesBefore + 2,
      'the second shot to land',
    );
    expect(
      shooter === 'alice'
        ? alice!.getState().view?.enemy.marks[key(second)]
        : alice!.getState().view?.you.board.marks[key(second)],
    ).toBe('hit');
    expect(bobView().moves).toBe(movesBefore + 2);
  }, 45_000);

  it('never applies an action that was in flight when the socket died more than once', async () => {
    const { aliceFleet, bobFleet } = await startedMatch();
    await sleep(1100);

    const turn = alice!.getState().view?.turn;
    const shooter: 'alice' | 'bob' = turn === ALICE ? 'alice' : 'bob';
    const enemyHulls = hullCells(shooter === 'alice' ? bobFleet.ships : aliceFleet.ships);
    const target = enemyHulls[0] as Coord;
    const movesBefore = alice!.getState().view?.moves ?? 0;

    // Fire, then kill the transport immediately: the action may or may not
    // have reached the room. Either outcome is legal; applying it twice is not.
    fireFrom(shooter, target, 1);
    await killServer();
    await until(() => alice!.getState().status === 'reconnecting', 'alice reconnecting');

    await resyncBoth();

    const aliceMoves = alice!.getState().view?.moves ?? -1;
    const rawMoves = bobView().moves;
    expect(aliceMoves).toBe(rawMoves);
    expect(aliceMoves - movesBefore).toBeGreaterThanOrEqual(0);
    expect(aliceMoves - movesBefore).toBeLessThanOrEqual(1);

    // A mark without a move (or a move without a mark) is the inconsistency
    // this test exists to catch: both sides must agree on the same board.
    const aliceMark =
      shooter === 'alice'
        ? alice!.getState().view?.enemy.marks[key(target)]
        : alice!.getState().view?.you.board.marks[key(target)];
    const rawMark =
      shooter === 'alice'
        ? bobView().you.board.marks[key(target)]
        : bobView().enemy.marks[key(target)];
    const marked = aliceMark !== undefined;
    expect(marked).toBe(aliceMoves === movesBefore + 1);
    expect(rawMark !== undefined).toBe(marked);
  }, 45_000);
});

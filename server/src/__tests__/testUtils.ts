/**
 * Shared test doubles. Room/matchmaker tests are hermetic: they mock `./auth`
 * (the JWKS check is network I/O, not this module's concern) and `./db`
 * (Supabase is the *subject* of supabase/verify-offline.mjs and
 * server/scripts/verify-rls.ts, not something these unit tests should touch).
 * What's left — protocol parsing, the reducer wiring, timers, the masking
 * boundary — is exactly what room.ts and ws.ts are responsible for.
 *
 * These tests talk over REAL sockets to a REAL http+ws server on an
 * ephemeral port: "two mock sockets" plays out as two real client
 * connections against a server whose only mocked seams are the two
 * network-dependent modules named above.
 */
import { createServer, type Server } from 'node:http';
import type { Coord, Ship, ShipClass } from '@engine/types';
import { vi } from 'vitest';
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Mocks — call BEFORE dynamically importing ../ws, ../room or ../matchmaker
// ---------------------------------------------------------------------------

/** hello's token IS the player id here — auth.ts's real JWKS check is out of scope. */
export function installAuthMock(): void {
  vi.doMock('../auth', () => ({
    verifyAccessToken: vi.fn(async (token: string) => ({ ok: true as const, token: { userId: token, isAnonymous: false } })),
  }));
}

export interface DbCall {
  readonly fn: string;
  readonly args: readonly unknown[];
}

/** Every db.ts export, recording calls so a test can assert on them. */
export interface DbMockOptions {
  /**
   * Holds up applyMatchResult, so a test can act inside the window where a
   * room is finished but its settlement has not returned and the registry has
   * not been cleaned yet.
   */
  readonly settleDelayMs?: number;
  /**
   * Reject the first N refundPointWager calls. Lets the bot-fallback tests
   * prove the fallback is deferred (and the entry re-queued) until the online
   * stake is actually released.
   */
  readonly refundFailures?: number;
}

export function installDbMock(options: DbMockOptions = {}): { calls: DbCall[] } {
  const calls: DbCall[] = [];
  const wagerPlayers = new Map<string, readonly string[]>();
  let refundFailuresLeft = options.refundFailures ?? 0;
  const record =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
    };

  vi.doMock('../db', () => ({
    BOT_PLAYER_ID: 'b0000000-0000-4000-8000-000000000001',
    fetchOpponentSummary: vi.fn(async (userId: string) => {
      record('fetchOpponentSummary')(userId);
      return {
        id: userId,
        name: userId,
        avatarId: 1,
        avatarColor: 'violet',
        countryCode: null,
        rankPoints: 0,
        isBot: userId === 'b0000000-0000-4000-8000-000000000001',
      };
    }),
    insertMatch: vi.fn(async (...args: unknown[]) => record('insertMatch')(...args)),
    insertWageredMatch: vi.fn(async (input: { id: string; playerA: string; playerB: string }, ...rest: unknown[]) => {
      record('insertWageredMatch')(input, ...rest);
      wagerPlayers.set(input.id, [input.playerA, input.playerB]);
    }),
    reservePointWager: vi.fn(async (profileId: string, requestId: string) => {
      record('reservePointWager')(profileId, requestId);
      return { ok: true, requestId, balance: 50, reason: null };
    }),
    refundPointWager: vi.fn(async (profileId: string, requestId: string) => {
      record('refundPointWager')(profileId, requestId);
      if (refundFailuresLeft > 0) {
        refundFailuresLeft -= 1;
        throw new Error('refund temporarily unavailable');
      }
      return 100;
    }),
    cancelWageredMatchBeforeStart: vi.fn(async (matchId: string, cancelledBy: string) => {
      record('cancelWageredMatchBeforeStart')(matchId, cancelledBy);
      return (wagerPlayers.get(matchId) ?? [])
        .filter((profileId) => profileId !== 'b0000000-0000-4000-8000-000000000001')
        .map((profileId) => ({ profileId, balance: 100 }));
    }),
    fetchPointBalance: vi.fn(async () => 100),
    appendMatchEvent: vi.fn(async (...args: unknown[]) => record('appendMatchEvent')(...args)),
    abandonMatch: vi.fn(async (matchId: string) => {
      record('abandonMatch')(matchId);
      return true;
    }),
    applyMatchResult: vi.fn(async (...args: unknown[]) => {
      record('applyMatchResult')(...args);
      if (options.settleDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.settleDelayMs));
      }
      // Mirrors db.ts's MatchSettlement shape (0015 + 0025).
      return { settled: true, salvageA: 0, salvageB: 0, wager: null };
    }),
    dbEndReason: (reason: string) => (reason === 'fleet' ? 'victory' : reason === 'forfeit' ? 'timeout' : 'resign'),
  }));

  return { calls };
}

// ---------------------------------------------------------------------------
// A known, valid, fully-deterministic fleet — so tests can fire at exact
// cells instead of hunting, and the leak test knows exactly what "secret"
// means at every point in the match.
// ---------------------------------------------------------------------------

function ship(id: string, cls: ShipClass, len: number, r: number, c: number, orientation: 'h' | 'v'): Ship {
  return { id, class: cls, len, origin: { r, c }, orientation, hits: [] };
}

/** Rows 0, 2, 4, 6 with gaps — halo-valid, used identically on both boards. */
export const KNOWN_LAYOUT: readonly Ship[] = [
  ship('battleship-1', 'battleship', 4, 0, 0, 'h'),
  ship('cruiser-1', 'cruiser', 3, 2, 0, 'h'),
  ship('cruiser-2', 'cruiser', 3, 2, 4, 'h'),
  ship('destroyer-1', 'destroyer', 2, 4, 0, 'h'),
  ship('destroyer-2', 'destroyer', 2, 4, 3, 'h'),
  ship('destroyer-3', 'destroyer', 2, 4, 6, 'h'),
  ship('boat-1', 'boat', 1, 6, 0, 'h'),
  ship('boat-2', 'boat', 1, 6, 2, 'h'),
];

export function shipCellsOf(ships: readonly Ship[]): Coord[] {
  const out: Coord[] = [];
  for (const s of ships) {
    for (let i = 0; i < s.len; i++) {
      out.push(s.orientation === 'h' ? { r: s.origin.r, c: s.origin.c + i } : { r: s.origin.r + i, c: s.origin.c });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// A tiny real HTTP+ws test server
// ---------------------------------------------------------------------------

export interface TestServer {
  readonly port: number;
  readonly logs: string[];
  close(): Promise<void>;
}

/** Boots the real transport (ws.ts) on an ephemeral port. Import AFTER mocking. */
export async function startTestServer(): Promise<TestServer> {
  const { attachWebSocketServer } = await import('../ws');
  const server: Server = createServer();
  const logs: string[] = [];
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const wss = attachWebSocketServer(server, (msg) => logs.push(msg));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    port,
    logs,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

// ---------------------------------------------------------------------------
// A tiny real-socket test client
// ---------------------------------------------------------------------------

export interface TestClient {
  readonly playerId: string;
  send(message: Record<string, unknown>): void;
  /** The next message this socket receives, in arrival order. */
  next(timeoutMs?: number): Promise<Record<string, unknown>>;
  /** Consumes messages until one matches; discards everything before it. */
  waitFor(pred: (m: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
  /** Every message received so far, in order — the leak test's transcript. */
  history(): readonly Record<string, unknown>[];
  raw(): WebSocket;
  close(): void;
}

function wireClient(socket: WebSocket, playerId: string): Omit<TestClient, 'send'> & { resolveOpen: Promise<void> } {
  const buffer: Record<string, unknown>[] = [];
  const seen: Record<string, unknown>[] = [];
  const pending: ((m: Record<string, unknown>) => void)[] = [];

  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    seen.push(msg);
    const resolve = pending.shift();
    if (resolve) resolve(msg);
    else buffer.push(msg);
  });

  const next = (timeoutMs = 5000): Promise<Record<string, unknown>> => {
    const queued = buffer.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`[${playerId}] timed out waiting for a message`)), timeoutMs);
      pending.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  };

  const waitFor = async (
    pred: (m: Record<string, unknown>) => boolean,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`[${playerId}] timed out waiting for a matching message`);
      const msg = await next(remaining);
      if (pred(msg)) return msg;
    }
  };

  const resolveOpen = new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  return {
    playerId,
    next,
    waitFor,
    history: () => seen,
    raw: () => socket,
    close: () => socket.close(),
    resolveOpen,
  };
}

async function handshake(port: number, playerId: string, resumeMatchId?: string, protocol?: number): Promise<TestClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const wired = wireClient(socket, playerId);
  await wired.resolveOpen;
  const client: TestClient = { ...wired, send: (message) => socket.send(JSON.stringify(message)) };
  client.send({
    t: 'hello',
    v: 1,
    token: playerId,
    ...(resumeMatchId ? { resumeMatchId } : {}),
    ...(protocol !== undefined ? { protocol } : {}),
  });
  await client.waitFor((m) => m.t === 'hello:ok', 5000);
  return client;
}

export function connectClient(port: number, playerId: string, protocol?: number): Promise<TestClient> {
  return handshake(port, playerId, undefined, protocol);
}

/** Re-attaches an existing playerId with a brand new socket — a "reconnect". */
export function reconnectClient(port: number, playerId: string, resumeMatchId?: string): Promise<TestClient> {
  return handshake(port, playerId, resumeMatchId);
}

/** Places KNOWN_LAYOUT on both boards and drives both `ready` calls. */
export async function readyUpBoth(alice: TestClient, bob: TestClient): Promise<void> {
  const layout = { ships: KNOWN_LAYOUT, arsenal: [] };
  alice.send({ t: 'ready', v: 1, layout });
  bob.send({ t: 'ready', v: 1, layout });
  await alice.waitFor((m) => m.t === 'events' && matchStarted(m), 5000);
  await bob.waitFor((m) => m.t === 'events' && matchStarted(m), 5000);
}

function matchStarted(m: Record<string, unknown>): boolean {
  const events = m.events as { type: string }[] | undefined;
  return Array.isArray(events) && events.some((e) => e.type === 'MATCH_STARTED');
}

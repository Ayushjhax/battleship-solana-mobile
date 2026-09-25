/**
 * The match client against a fake server that speaks the frozen protocol
 * (server/src/protocol.ts) and runs the REAL engine for its room, mirroring
 * server/src/room.ts: events + state + turn after every action, and on
 * hello+resume a full event-log replay followed by a fresh state.
 *
 * Only src/net/api.ts is mocked — the JWT is whatever `hello` carries here.
 * Everything else is the real client over a real socket (Node's global
 * WebSocket, the same API React Native exposes).
 */
import { createServer, type Server } from 'node:http';
import { createMatch, projectView, reduce } from '@engine/match';
import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import type { MatchEvent, MatchState } from '@engine/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';

import { toLayoutPayload, type ClientMessage, type ServerMessage } from '../protocol';

vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('../api', () => ({
  getAccessToken: vi.fn(async () => ({ ok: true as const, value: 'alice' })),
}));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(pred: () => boolean, timeoutMs = 5000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(15);
  }
}

// ---------------------------------------------------------------------------
// A minimal room, the way room.ts does it
// ---------------------------------------------------------------------------

const ALICE = 'alice';
const BOT = 'bot';
const MATCH_ID = '11111111-2222-4333-8444-555555555555';

class FakeRoom {
  state: MatchState;
  outSeq = 0;
  eventLog: { seq: number; events: MatchEvent[] }[] = [];
  constructor(seed = 7) {
    this.state = createMatch({ id: MATCH_ID, mode: 'classic', seed, playerIds: [ALICE, BOT] });
  }
  apply(action: Parameters<typeof reduce>[1]): { events: MatchEvent[]; rejected: boolean } {
    const r = reduce(this.state, action);
    this.state = r.state;
    const rejected = r.events.some((e) => e.type === 'REJECTED');
    if (!rejected) {
      this.outSeq += 1;
      this.eventLog.push({ seq: this.outSeq, events: [...r.events] });
    }
    return { events: [...r.events], rejected };
  }
  snapshot(playerId: string, opponentDisconnected = false): ServerMessage {
    return {
      t: 'state',
      v: 1,
      seq: this.outSeq,
      view: projectView(this.state, playerId),
      ...(opponentDisconnected ? { opponentDisconnected: true } : {}),
    };
  }
}

interface FakeServer {
  readonly port: number;
  readonly received: ClientMessage[];
  room: FakeRoom;
  /** The socket currently attached to alice, if any. */
  alice: WebSocket | null;
  /** A half-open socket: stays open, answers nothing. */
  mute: boolean;
  /** What `queue` is answered with, if not `queued`. */
  queueReply: ServerMessage | null;
  send(message: ServerMessage): void;
  sendRaw(raw: string): void;
  /** Kill every client socket and stop listening — "the server died". */
  kill(): Promise<void>;
  /** Stop listening and close cleanly. */
  close(): Promise<void>;
}

function startFakeServer(port: number, initialRoom = new FakeRoom()): Promise<FakeServer> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ server: http, path: '/ws' });
  const received: ClientMessage[] = [];
  const server: FakeServer = {
    port,
    received,
    room: initialRoom,
    alice: null,
    mute: false,
    queueReply: null,
    send(message) {
      if (!server.mute) server.alice?.send(JSON.stringify(message));
    },
    sendRaw(raw) {
      if (!server.mute) server.alice?.send(raw);
    },
    kill: () =>
      new Promise((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
    close: () =>
      new Promise((resolve) => {
        for (const c of wss.clients) c.close(1001, 'bye');
        wss.close(() => http.close(() => resolve()));
      }),
  };

  const broadcastAfter = (events: MatchEvent[]) => {
    server.send({ t: 'events', v: 1, seq: server.room.outSeq, events });
    server.send(server.room.snapshot(ALICE));
    if (server.room.state.phase === 'playing') {
      server.send({ t: 'turn', v: 1, playerId: server.room.state.turn, endsAt: Date.now() + 22_000 });
    }
    if (server.room.state.phase === 'over') {
      const over = events.find((e) => e.type === 'GAME_OVER');
      server.send({
        t: 'over',
        v: 1,
        winnerId: over && 'winner' in over ? over.winner : ALICE,
        reason: 'fleet',
        rewards: { points: 25, coins: 50 },
      });
    }
  };

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString('utf8')) as ClientMessage;
      received.push(message);
      if (server.mute) return;
      switch (message.t) {
        case 'hello': {
          server.alice = socket;
          socket.send(JSON.stringify({ t: 'hello:ok', v: 1, playerId: ALICE }));
          // attach(): the room re-attaches by player id whether or not a resume id
          // came along (an app killed mid-match returns with an empty store) —
          // `matched` again, the whole log, a fresh view, turn, state again.
          if (message.resumeMatchId || server.room.eventLog.length > 0) {
            sendMatched(server);
            for (const entry of server.room.eventLog)
              server.send({ t: 'events', v: 1, seq: entry.seq, events: entry.events });
            server.send(server.room.snapshot(ALICE));
            if (server.room.state.phase === 'playing')
              server.send({ t: 'turn', v: 1, playerId: server.room.state.turn, endsAt: Date.now() + 22_000 });
            server.send(server.room.snapshot(ALICE));
          }
          return;
        }
        case 'queue':
          if (server.room.eventLog.length > 0) {
            server.send({ t: 'error', v: 1, code: 'not_in_room', message: 'already in a match' });
            return;
          }
          server.send(server.queueReply ?? { t: 'queued', v: 1, position: 1, onlineCount: 3 });
          return;
        case 'cancelQueue':
          server.send({
            t: 'queue:cancelled',
            v: 1,
            refunded: true,
            reason: 'cancelled',
            pointBalance: 100,
          });
          return;
        case 'ready': {
          const mine = server.room.apply({ type: 'SUBMIT_LAYOUT', playerId: ALICE, ships: message.layout.ships, arsenal: message.layout.arsenal });
          if (mine.rejected) {
            server.send({ t: 'error', v: 1, code: 'illegal_action', message: 'bad layout' });
            return;
          }
          broadcastAfter(mine.events);
          const bot = server.room.apply({ type: 'SUBMIT_LAYOUT', playerId: BOT, ships: autoPlaceFleet(createRng(99)), arsenal: [] });
          broadcastAfter(bot.events);
          return;
        }
        case 'action': {
          const action = message.action.type === 'FIRE'
            ? ({ type: 'FIRE', playerId: ALICE, at: message.action.at } as const)
            : ({ type: 'USE_ARSENAL', playerId: ALICE, itemId: message.action.itemId, at: message.action.at, row: message.action.row } as const);
          const r = server.room.apply(action);
          if (r.rejected) {
            const reason = r.events.find((e) => e.type === 'REJECTED');
            server.send({ t: 'error', v: 1, code: 'illegal_action', message: reason && 'reason' in reason ? reason.reason : 'no' });
            return;
          }
          broadcastAfter(r.events);
          return;
        }
        case 'resign': {
          const r = server.room.apply({ type: 'RESIGN', playerId: ALICE });
          broadcastAfter(r.events);
          return;
        }
        case 'ping':
          server.send({ t: 'pong', v: 1 });
          return;
      }
    });
    socket.on('close', () => {
      if (server.alice === socket) server.alice = null;
    });
  });

  return new Promise((resolve) => http.listen(port, '127.0.0.1', () => resolve(server)));
}

function sendMatched(server: FakeServer): void {
  server.send({
    t: 'matched',
    v: 1,
    matchId: MATCH_ID,
    you: { id: ALICE, name: 'Alice', avatarId: 1, avatarColor: 'violet', countryCode: 'IN', rankPoints: 100, isBot: false },
    opponent: { id: BOT, name: 'Berhan', avatarId: 4, avatarColor: 'charcoal', countryCode: 'RU', rankPoints: 13365, isBot: true },
    mode: 'classic',
    fuelBudget: 260,
    layoutDeadline: Date.now() + 90_000,
    wagered: false,
    wagerStake: 0,
  });
}

// ---------------------------------------------------------------------------

let port = 18_400;
let server: FakeServer;

describe('match client', () => {
  beforeEach(async () => {
    vi.resetModules();
    port += 1;
    process.env.EXPO_PUBLIC_WS_URL = `ws://127.0.0.1:${port}/ws`;
    server = await startFakeServer(port);
  });

  afterEach(async () => {
    const { useMatchClient } = await import('../match-client');
    useMatchClient.getState().disconnect();
    await server.close().catch(() => {});
  });

  async function client() {
    return (await import('../match-client')).useMatchClient;
  }

  async function playUntilPlaying(): Promise<Awaited<ReturnType<typeof client>>> {
    const mc = await client();
    mc.getState().queue('classic');
    await until(() => mc.getState().status === 'queued', 5000, 'queued');
    sendMatched(server);
    await until(() => mc.getState().status === 'matched', 5000, 'matched');
    mc.getState().ready(toLayoutPayload(autoPlaceFleet(createRng(3)), []));
    await until(() => mc.getState().view?.phase === 'playing', 5000, 'playing view');
    return mc;
  }

  it('connects, queues, matches, readies, and receives a playing view plus the start events', async () => {
    const mc = await playUntilPlaying();
    const s = mc.getState();
    expect(s.status).toBe('active');
    expect(s.playerId).toBe(ALICE);
    expect(s.matchId).toBe(MATCH_ID);
    expect(s.opponent?.name).toBe('Berhan');
    expect(s.turnPlayerId).toBe(s.view?.turn);
    expect(s.turnReceivedAt).not.toBeNull();
    const types = s.pendingEvents.map((e) => e.type);
    expect(types).toContain('LAYOUT_ACCEPTED');
    expect(types).toContain('MATCH_STARTED');
    expect(s.eventsNonce).toBe(2);

    // hello carried `v: 1` and no resume id on a first connection
    const hello = server.received.find((m) => m.t === 'hello');
    expect(hello).toMatchObject({ t: 'hello', v: 1, token: 'alice' });
    expect(hello && 'resumeMatchId' in hello ? hello.resumeMatchId : undefined).toBeUndefined();
  });

  it('fires with a client seq, gets the verdict back, and drops a duplicate events batch', async () => {
    const mc = await playUntilPlaying();
    mc.getState().takePendingEvents();
    if (mc.getState().view?.turn !== ALICE) {
      // Not our turn on this seed — make it so: the fake room is ours to poke.
      server.room.state = { ...server.room.state, turn: ALICE };
    }
    const nonce = mc.getState().eventsNonce;
    mc.getState().fire({ r: 0, c: 0 });
    await until(() => mc.getState().eventsNonce > nonce, 5000, 'shot events');
    const events = mc.getState().takePendingEvents();
    expect(['HIT', 'MISS']).toContain(events[0]?.type);
    expect(mc.getState().view?.enemy.marks['0,0']).toBeDefined();

    const sent = server.received.filter((m) => m.t === 'action') as { seq: number }[];
    expect(sent[0]).toMatchObject({ t: 'action', v: 1, action: { type: 'FIRE', at: { r: 0, c: 0 } } });
    expect(sent[0]!.seq).toBeGreaterThan(1_700_000_000_000); // wall-clock based, monotonic across restarts

    // The server re-sends the same batch (same seq): must not land twice.
    const last = server.room.eventLog[server.room.eventLog.length - 1]!;
    const before = mc.getState().eventsNonce;
    server.send({ t: 'events', v: 1, seq: last.seq, events: last.events });
    await sleep(120);
    expect(mc.getState().eventsNonce).toBe(before);
    expect(mc.getState().pendingEvents).toHaveLength(0);
  });

  it('drops a malformed or unknown inbound message without crashing', async () => {
    const mc = await playUntilPlaying();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = { ...mc.getState() };
    server.sendRaw('this is not json');
    server.sendRaw(JSON.stringify({ t: 'teleport', v: 1 }));
    server.sendRaw(JSON.stringify({ t: 'state', v: 1, seq: 999, view: { nope: true } }));
    server.sendRaw(JSON.stringify({ t: 'turn', v: 2, playerId: ALICE, endsAt: 1 }));
    await sleep(150);
    expect(warn).toHaveBeenCalledTimes(4);
    expect(mc.getState().status).toBe('active');
    expect(mc.getState().view).toBe(before.view);
    expect(mc.getState().eventsNonce).toBe(before.eventsNonce);
    warn.mockRestore();
  });

  it('surfaces an illegal_action as an error nonce, not a crash', async () => {
    const mc = await playUntilPlaying();
    // Firing out of turn or at a taken cell — force a rejection by firing twice at the same cell.
    server.room.state = { ...server.room.state, turn: ALICE };
    mc.getState().fire({ r: 5, c: 5 });
    await until(() => mc.getState().view?.enemy.marks['5,5'] !== undefined, 5000, 'first shot');
    server.room.state = { ...server.room.state, turn: ALICE };
    const errors = mc.getState().errorNonce;
    mc.getState().fire({ r: 5, c: 5 });
    await until(() => mc.getState().errorNonce > errors, 5000, 'error');
    expect(mc.getState().lastError?.code).toBe('illegal_action');
    expect(mc.getState().status).toBe('active');
  });

  it('when the server dies mid-match it reconnects with resumeMatchId, absorbs the replay, and resyncs', async () => {
    const mc = await playUntilPlaying();
    server.room.state = { ...server.room.state, turn: ALICE };
    mc.getState().fire({ r: 1, c: 1 });
    await until(() => mc.getState().view?.enemy.marks['1,1'] !== undefined, 5000, 'shot');
    mc.getState().takePendingEvents();
    const room = server.room;
    const viewBefore = mc.getState().view;

    await server.kill();
    await until(() => mc.getState().status === 'reconnecting', 5000, 'reconnecting');
    expect(mc.getState().reconnectDeadline).not.toBeNull();
    expect(mc.getState().matchId).toBe(MATCH_ID);

    // "Restarting it recovers": same port, same room.
    server = await startFakeServer(port, room);
    await until(() => mc.getState().status === 'active', 8000, 'resynced');

    const hello = server.received.find((m) => m.t === 'hello');
    expect(hello).toMatchObject({ t: 'hello', v: 1, resumeMatchId: MATCH_ID });
    // The replay (three logged batches) was absorbed, not queued for animation.
    expect(mc.getState().pendingEvents).toHaveLength(0);
    // The view is the fresh authoritative one, with our earlier shot still on it.
    expect(mc.getState().view).not.toBe(viewBefore);
    expect(mc.getState().view?.enemy.marks['1,1']).toBeDefined();
    expect(mc.getState().reconnectAttempt).toBe(0);
    expect(mc.getState().reconnectDeadline).toBeNull();

    // And play continues: a live event after the resync IS animated.
    server.room.state = { ...server.room.state, turn: ALICE };
    const nonce = mc.getState().eventsNonce;
    mc.getState().fire({ r: 2, c: 2 });
    await until(() => mc.getState().eventsNonce > nonce, 5000, 'post-resync shot');
    expect(mc.getState().takePendingEvents()[0]?.type).toMatch(/HIT|MISS/);
  });

  it('an app killed mid-match comes back with an empty store and lands in the live match', async () => {
    const mc = await playUntilPlaying();
    server.room.state = { ...server.room.state, turn: ALICE };
    mc.getState().fire({ r: 3, c: 3 });
    await until(() => mc.getState().view?.enemy.marks['3,3'] !== undefined, 5000, 'shot');
    const room = server.room;
    // "Kill the app": a brand-new module instance, nothing remembered.
    mc.getState().disconnect();
    vi.resetModules();
    const fresh = (await import('../match-client')).useMatchClient;
    expect(fresh).not.toBe(mc);
    expect(fresh.getState().matchId).toBeNull();

    // The user taps Play online again; the server attaches them to the live room instead.
    fresh.getState().queue('classic');
    await until(() => fresh.getState().status === 'active', 8000, 'landed in the live match');
    expect(fresh.getState().matchId).toBe(MATCH_ID);
    expect(fresh.getState().opponent?.name).toBe('Berhan');
    expect(fresh.getState().view?.enemy.marks['3,3']).toBeDefined();
    expect(fresh.getState().pendingEvents).toHaveLength(0); // replay absorbed
    expect(room.eventLog.length).toBeGreaterThan(2);

    // And the seq keeps rising across the restart: the next shot is applied, not deduped.
    server.room.state = { ...server.room.state, turn: ALICE };
    const actionsBefore = server.received.filter((m) => m.t === 'action') as { seq: number }[];
    const nonce = fresh.getState().eventsNonce;
    fresh.getState().fire({ r: 4, c: 4 });
    await until(() => fresh.getState().eventsNonce > nonce, 5000, 'post-restart shot');
    expect(fresh.getState().view?.enemy.marks['4,4']).toBeDefined();
    const actions = server.received.filter((m) => m.t === 'action') as { seq: number }[];
    expect(actions.length).toBe(actionsBefore.length + 1);
    expect(actions.at(-1)!.seq).toBeGreaterThan(actionsBefore.at(-1)!.seq);
    fresh.getState().disconnect();
  });

  it('re-sends ready after a reconnect if the layout never landed', async () => {
    const mc = await client();
    mc.getState().queue('classic');
    await until(() => mc.getState().status === 'queued', 5000, 'queued');
    sendMatched(server);
    await until(() => mc.getState().status === 'matched', 5000, 'matched');
    const room = server.room;
    // Kill the server BEFORE the client sends ready; ready() then has no socket.
    await server.kill();
    await until(() => mc.getState().status === 'reconnecting', 5000, 'reconnecting');
    mc.getState().ready(toLayoutPayload(autoPlaceFleet(createRng(3)), []));

    server = await startFakeServer(port, room);
    await until(() => mc.getState().view?.phase === 'playing', 8000, 'playing after resend');
    expect(server.received.some((m) => m.t === 'ready')).toBe(true);
  });

  it('treats a half-open socket as dead after a nudge, and reconnects', async () => {
    const mc = await playUntilPlaying();
    // Airplane mode on Android: the socket stays "open" but nothing moves.
    server.mute = true;
    mc.getState().nudge();
    await until(() => mc.getState().status === 'reconnecting', 8000, 'declared dead');
    expect(server.received.some((m) => m.t === 'ping')).toBe(true);
    // The radio comes back: the next attempt lands and resyncs.
    server.mute = false;
    await until(() => mc.getState().status === 'active', 8000, 'resynced');
    expect(mc.getState().view?.phase).toBe('playing');
  });

  it('a nudge cuts a scheduled backoff short', async () => {
    const mc = await playUntilPlaying();
    const room = server.room;
    await server.kill();
    await until(() => mc.getState().status === 'reconnecting', 5000, 'reconnecting');
    // Let the first retry fail so the next wait is a long one (1 s+), then nudge.
    await sleep(900);
    server = await startFakeServer(port, room);
    const t0 = Date.now();
    mc.getState().nudge();
    await until(() => mc.getState().status === 'active', 3000, 'resynced after nudge');
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('a token that cannot be refreshed mid-match is a retry, not a failure', async () => {
    const mc = await playUntilPlaying();
    const api = await import('../api');
    const token = vi.mocked(api.getAccessToken);
    token.mockResolvedValueOnce({ ok: false, error: { code: 'offline', message: 'fetch failed' } });
    const room = server.room;
    await server.kill();
    await until(() => mc.getState().status === 'reconnecting', 5000, 'reconnecting');
    server = await startFakeServer(port, room);
    await until(() => mc.getState().status === 'active', 10_000, 'resynced after a token hiccup');
    expect(mc.getState().failure).toBeNull();
  });

  it('plays ten consecutive matches with no unhandled rejection and no state leaking between them', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    const mc = await client();
    try {
      for (let n = 0; n < 10; n++) {
        server.room = new FakeRoom(100 + n);
        mc.getState().queue('classic');
        await until(() => mc.getState().status === 'queued', 5000, `queued #${n}`);
        sendMatched(server);
        await until(() => mc.getState().status === 'matched', 5000, `matched #${n}`);
        mc.getState().ready(toLayoutPayload(autoPlaceFleet(createRng(3)), []));
        await until(() => mc.getState().view?.phase === 'playing', 5000, `playing #${n}`);
        expect(mc.getState().over).toBeNull();
        expect(mc.getState().takePendingEvents().map((e) => e.type)).toContain('MATCH_STARTED');
        server.room.state = { ...server.room.state, turn: ALICE };
        const nonce = mc.getState().eventsNonce;
        mc.getState().fire({ r: n % 10, c: 0 });
        await until(() => mc.getState().eventsNonce > nonce, 5000, `shot #${n}`);
        mc.getState().takePendingEvents();
        mc.getState().resign();
        await until(() => mc.getState().status === 'over', 5000, `over #${n}`);
        expect(mc.getState().pendingEvents.map((e) => e.type)).toContain('GAME_OVER');
        mc.getState().disconnect();
        expect(mc.getState().status).toBe('idle');
        await until(() => server.alice === null, 5000, `server saw the close #${n}`);
      }
    } finally {
      process.off('unhandledRejection', onRejection);
    }
    expect(rejections).toEqual([]);
  });

  it('cancelQueue closes the socket and goes back to idle', async () => {
    const mc = await client();
    mc.getState().queue('classic');
    await until(() => mc.getState().status === 'queued', 5000, 'queued');
    await mc.getState().cancelQueue();
    expect(mc.getState().status).toBe('idle');
    await until(() => server.alice === null, 5000, 'server saw the close');
    expect(server.received.some((m) => m.t === 'cancelQueue')).toBe(true);
  });

  it('offers a match the app was killed out of, without replaying it', async () => {
    // A room mid-match on the server, and a client that knows nothing about it
    // — exactly the state after the app is force-quit and reopened.
    server.room.apply({ type: 'SUBMIT_LAYOUT', playerId: ALICE, ships: autoPlaceFleet(createRng(3)), arsenal: [] });
    server.room.apply({ type: 'SUBMIT_LAYOUT', playerId: BOT, ships: autoPlaceFleet(createRng(99)), arsenal: [] });
    server.room.state = { ...server.room.state, turn: ALICE };
    server.room.apply({ type: 'FIRE', playerId: ALICE, at: { r: 0, c: 0 } });

    const mc = await client();
    expect(mc.getState().status).toBe('idle');
    mc.getState().discover();

    await until(() => mc.getState().resumeOffer !== null, 8000, 'a resume offer');
    const offered = mc.getState();
    expect(offered.resumeOffer?.matchId).toBe(MATCH_ID);
    expect(offered.resumeOffer?.opponentName).toBe('Berhan');
    // The replayed log is absorbed, never animated: the board is restored from
    // the authoritative view, not by re-playing the match from the first shot.
    await until(() => mc.getState().view !== null, 8000, 'the authoritative view');
    expect(mc.getState().pendingEvents).toHaveLength(0);
    expect(mc.getState().view?.enemy.marks['0,0']).toBeDefined();
    expect(mc.getState().view?.you.board.ships.length).toBeGreaterThan(0);

    // Taking the match clears the offer, so a later reconnect never re-prompts.
    mc.getState().enterMatch();
    expect(mc.getState().resumeOffer).toBeNull();
  }, 20000);

  it('stays idle and silent when there is no match to resume', async () => {
    const mc = await client();
    mc.getState().discover();
    // The fake room has no event log, so `hello` is answered with hello:ok
    // alone — the discovery window closes and the client goes back to sleep.
    await until(() => server.received.some((m) => m.t === 'hello'), 8000, 'hello');
    await sleep(4500);

    const s = mc.getState();
    expect(s.resumeOffer).toBeNull();
    expect(s.status).toBe('idle');
    expect(s.failure).toBeNull();
    expect(s.matchId).toBeNull();
  }, 20000);

  it('lets queueing win a race against an open discovery socket', async () => {
    const mc = await client();
    mc.getState().discover();
    mc.getState().queue('classic');

    await until(() => mc.getState().status === 'queued', 8000, 'queued');
    // The discovery timer must not fire and tear this down underneath us.
    await sleep(4500);
    expect(mc.getState().status).toBe('queued');
  }, 20000);

  it('queues even when the launch-time discovery had to retry', async () => {
    // The app asks "is there a match to resume?" on launch. If that first
    // socket cannot reach the server (a cold start, a network blip), its
    // retry must not leave the client looking busy: the player's queue()
    // afterwards has to reach the server.
    await server.close();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mc = await client();
    mc.getState().discover();
    await sleep(300);
    server = await startFakeServer(port);
    await sleep(1500);

    mc.getState().queue('advanced', { wagered: true });
    await until(() => mc.getState().status === 'queued', 10_000, 'queued');
    const queued = server.received.find((m) => m.t === 'queue');
    expect(queued).toMatchObject({ t: 'queue', wagered: true });
    expect(mc.getState().status).toBe('queued');
    log.mockRestore();
  }, 20000);

  it('queues after a launch-time discovery could not get a token', async () => {
    // A session refresh that fails at launch (slow network, a refresh race)
    // is a transient for the match client. During discovery nobody asked to
    // play yet — it must not leave the client "connecting" with no queue in
    // it, where the player's queue() would be taken for a screen re-mount.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const api = await import('../api');
    vi.mocked(api.getAccessToken).mockResolvedValueOnce({
      ok: false,
      error: { code: 'offline', message: 'Network request failed' },
    } as never);
    const mc = await client();
    mc.getState().discover();
    await sleep(5000);

    mc.getState().queue('advanced', { wagered: true });
    await until(() => mc.getState().status === 'queued', 10_000, 'queued');
    expect(server.received.some((m) => m.t === 'queue')).toBe(true);
    log.mockRestore();
  }, 25000);

  it('says so when this account is already searching on another device', async () => {
    // Two phones on one account: the second is refused `already_queued` on
    // its very first ask. It used to read that as "still in line" and spin.
    server.queueReply = { t: 'error', v: 1, code: 'already_queued', message: 'already queued' };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mc = await client();
    mc.getState().queue('advanced', { wagered: true });
    await until(() => mc.getState().status === 'failed', 8000, 'failed');
    expect(mc.getState().failure?.reason).toBe('already_searching');
    log.mockRestore();
  }, 20000);

  it('drops a discovery that cannot connect instead of looking busy', async () => {
    await server.close();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mc = await client();
    mc.getState().discover();
    await sleep(400);
    expect(mc.getState().status).toBe('idle');
    expect(mc.getState().failure).toBeNull();
    log.mockRestore();
    server = await startFakeServer(port);
  }, 20000);

  it('gives up cleanly when nothing is listening', async () => {
    await server.close();
    process.env.EXPO_PUBLIC_WS_URL = `ws://127.0.0.1:${port + 500}/ws`;
    const mc = await client();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mc.getState().queue('classic');
    await until(() => mc.getState().status === 'failed', 14_000, 'failed');
    expect(mc.getState().failure?.reason).toBe('unreachable');
    log.mockRestore();
    server = await startFakeServer(port);
  });
});

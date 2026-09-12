/**
 * WebSocket surface. Parses every inbound frame with the protocol schema,
 * enforces the safety rails, and dispatches to the matchmaker/room. No game
 * logic lives here — see room.ts.
 *
 * The JWT verified in `hello` is the ONLY auth gate: every later message is
 * attributed to the id that verification produced, never to anything the
 * client claims about itself.
 */
import type { Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { verifyAccessToken } from './auth';
import { decode, encode, PROTOCOL_VERSION, toMatchAction, toSubmitLayoutAction, type ErrorCode, type ServerMessage } from './protocol';
import { dequeue, enqueue } from './matchmaker';
import { findRoomForPlayer, rooms } from './room';

const MAX_MESSAGE_BYTES = 16 * 1024;
const RATE_LIMIT_MSGS = 10;
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_ILLEGAL = 5;
const HEARTBEAT_INTERVAL_MS = 30_000;

interface Connection {
  socket: WebSocket;
  playerId: string | null;
  isAlive: boolean;
  missedPongs: number;
  /** Timestamps of recent inbound messages, for the 10 msg/s rate limit. */
  recentMessages: number[];
  /** Rejected actions + protocol violations; five and the socket is cut. */
  illegalCount: number;
}

function send(conn: Connection, message: ServerMessage): void {
  if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(encode(message));
}

function sendError(conn: Connection, code: ErrorCode, message: string): void {
  send(conn, { t: 'error', v: 1, code, message });
}

function violate(conn: Connection, reason: string, log: (msg: string) => void): void {
  conn.illegalCount += 1;
  log(`[ws] player=${conn.playerId ?? 'unauthenticated'} violation (${conn.illegalCount}/${MAX_ILLEGAL}): ${reason}`);
  if (conn.illegalCount >= MAX_ILLEGAL) {
    log(`[ws] player=${conn.playerId ?? 'unauthenticated'} disconnected — five illegal messages, a cheating signal`);
    conn.socket.close(4001, 'too many illegal messages');
  }
}

function messageBytes(raw: RawData): number {
  if (typeof raw === 'string') return Buffer.byteLength(raw, 'utf8');
  if (Array.isArray(raw)) return raw.reduce((n, b) => n + b.length, 0);
  return raw.byteLength;
}

export function attachWebSocketServer(server: Server, log: (msg: string) => void = console.log): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (socket: WebSocket) => {
    const conn: Connection = { socket, playerId: null, isAlive: true, missedPongs: 0, recentMessages: [], illegalCount: 0 };
    connections.set(socket, conn);

    socket.on('pong', () => {
      conn.isAlive = true;
      conn.missedPongs = 0;
    });

    socket.on('message', (raw, isBinary) => {
      void handleMessage(conn, raw, isBinary, log);
    });

    socket.on('close', () => {
      if (conn.playerId) {
        dequeue(conn.playerId);
        findRoomForPlayer(conn.playerId)?.handleDisconnect(conn.playerId);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const conn = connOf(client);
      if (!conn) continue;
      if (!conn.isAlive) {
        conn.missedPongs += 1;
        if (conn.missedPongs >= 2) {
          client.terminate();
          continue;
        }
      }
      conn.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();
  wss.on('close', () => clearInterval(heartbeat));

  // ws doesn't expose a per-socket bag, so we keep our own WeakMap-backed lookup.
  return wss;
}

// A WeakMap keyed by the live WebSocket keeps Connection state without
// bolting untyped properties onto ws's own instances.
const connections = new WeakMap<WebSocket, Connection>();
function connOf(socket: WebSocket): Connection | undefined {
  return connections.get(socket);
}

async function handleMessage(conn: Connection, raw: RawData, _isBinary: boolean, log: (msg: string) => void): Promise<void> {
  // Rate limit: 10 messages/second per socket, then close.
  const now = Date.now();
  conn.recentMessages = conn.recentMessages.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  conn.recentMessages.push(now);
  if (conn.recentMessages.length > RATE_LIMIT_MSGS) {
    sendError(conn, 'rate_limited', 'too many messages');
    log(`[ws] player=${conn.playerId ?? 'unauthenticated'} rate-limited, closing`);
    conn.socket.close(4002, 'rate limited');
    return;
  }

  // 16KB message size cap.
  if (messageBytes(raw) > MAX_MESSAGE_BYTES) {
    sendError(conn, 'too_large', 'message exceeds 16KB');
    conn.socket.close(4003, 'message too large');
    return;
  }

  const decoded = decode(raw.toString('utf8'));
  if (!decoded.ok) {
    sendError(conn, 'bad_message', decoded.error);
    violate(conn, `unparseable/unknown message: ${decoded.error}`, log);
    return;
  }
  const message = decoded.message;

  if (message.t === 'ping') {
    send(conn, { t: 'pong', v: 1 });
    return;
  }

  if (message.t === 'hello') {
    const result = await verifyAccessToken(message.token);
    if (!result.ok) {
      sendError(conn, 'unauthenticated', result.reason);
      log(`[ws] hello rejected: ${result.reason}`);
      conn.socket.close(4401, 'unauthenticated');
      return;
    }
    conn.playerId = result.token.userId;
    send(conn, { t: 'hello:ok', v: 1, playerId: conn.playerId });

    // Reconnect: re-attach to an in-progress match regardless of whether the
    // client remembered its matchId — the player's verified id is authority
    // enough, and a stale/absent resumeMatchId shouldn't strand a reconnect.
    findRoomForPlayer(conn.playerId)?.attach(conn.playerId, conn.socket);
    return;
  }

  // Every other message requires a verified identity first.
  if (!conn.playerId) {
    sendError(conn, 'unauthenticated', 'send hello first');
    violate(conn, `${message.t} before hello`, log);
    return;
  }
  const playerId = conn.playerId;

  switch (message.t) {
    case 'queue': {
      const room = findRoomForPlayer(playerId);
      if (room) {
        sendError(conn, 'not_in_room', 'already in a match');
        return;
      }
      await enqueue(message.mode, playerId, conn.socket);
      return;
    }

    case 'cancelQueue':
      dequeue(playerId);
      return;

    case 'ready': {
      const room = findRoomForPlayer(playerId);
      if (!room) {
        sendError(conn, 'not_in_room', 'no active match');
        return;
      }
      const action = toSubmitLayoutAction(playerId, message.layout);
      const result = room.handleReady(playerId, action.type === 'SUBMIT_LAYOUT' ? [...action.ships] : [], action.type === 'SUBMIT_LAYOUT' ? [...action.arsenal] : []);
      if (!result.ok) violate(conn, `layout rejected: ${result.reason}`, log);
      return;
    }

    case 'action': {
      const room = findRoomForPlayer(playerId);
      if (!room) {
        sendError(conn, 'not_in_room', 'no active match');
        return;
      }
      const result = room.handleAction(playerId, message.seq, toMatchAction(playerId, message.action));
      if (!result.ok) violate(conn, `action rejected: ${result.reason}`, log);
      return;
    }

    case 'resign': {
      const room = findRoomForPlayer(playerId);
      if (!room) {
        sendError(conn, 'not_in_room', 'no active match');
        return;
      }
      room.handleResign(playerId);
      return;
    }
  }
}

export function serverStats(): { rooms: number } {
  return { rooms: rooms.size };
}

export { PROTOCOL_VERSION };

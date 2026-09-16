/**
 * FIFO matchmaking with separate normal/wager pools. Wager stakes are held
 * in Postgres before a player enters a queue and refunded atomically if they
 * leave before a room is created. Wagered bot games use the same authoritative
 * Room as online play, so an offline client cannot claim a fabricated win.
 */
import type { WebSocket } from 'ws';

import type { MatchMode } from '@engine/types';
import { FUEL_BUDGET } from '@engine/types';

import {
  BOT_PLAYER_ID,
  fetchOpponentSummary,
  refundPointWager,
  reservePointWager,
} from './db';
import { envMs } from './env';
import { encode, type ServerMessage } from './protocol';
import { createRoom, findRoomForPlayer, rooms } from './room';

const RANK_WINDOW_START = 150;
const RANK_WINDOW_STEP = 150;
const RANK_WINDOW_STEP_MS = envMs('SEABATTLE_RANK_WINDOW_STEP_MS', 5_000);
const RANK_WINDOW_UNCAPPED_MS = envMs('SEABATTLE_RANK_WINDOW_UNCAPPED_MS', 30_000);
const BOT_AFTER_MS = envMs('SEABATTLE_BOT_AFTER_MS', 45_000);
const SWEEP_INTERVAL_MS = envMs('SEABATTLE_SWEEP_INTERVAL_MS', 1_000);

type QueueKey = `${MatchMode}:${'normal' | 'wager'}`;

interface Waiting {
  readonly playerId: string;
  readonly socket: WebSocket;
  readonly since: number;
  readonly rankPoints: number;
  readonly wagered: boolean;
  readonly wagerRequestId: string | null;
}

const queues: Record<QueueKey, Waiting[]> = {
  'classic:normal': [],
  'classic:wager': [],
  'advanced:normal': [],
  'advanced:wager': [],
};
const queueKeys = Object.keys(queues) as QueueKey[];
let sweepTimer: NodeJS.Timeout | null = null;
const pendingDequeues = new Map<string, Promise<QueueCancellation>>();

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(encode(message));
}

function keyFor(mode: MatchMode, wagered: boolean): QueueKey {
  return `${mode}:${wagered ? 'wager' : 'normal'}`;
}

function rankWindow(waitMs: number): number {
  if (waitMs >= RANK_WINDOW_UNCAPPED_MS) return Infinity;
  const steps = Math.floor(waitMs / RANK_WINDOW_STEP_MS);
  return RANK_WINDOW_START + steps * RANK_WINDOW_STEP;
}

function totalOnlineCount(): number {
  return totalQueued() + rooms.size * 2;
}

function waitingFor(playerId: string): Waiting | undefined {
  for (const key of queueKeys) {
    const found = queues[key].find((entry) => entry.playerId === playerId);
    if (found) return found;
  }
  return undefined;
}

export async function enqueue(
  mode: MatchMode,
  playerId: string,
  socket: WebSocket,
  options: {
    wagered: boolean;
    opponent: 'player' | 'bot';
    wagerRequestId?: string;
  },
): Promise<void> {
  // A reconnect can arrive while the prior socket's asynchronous refund is
  // still in flight. Serialize those operations per player so a new hold can
  // never accidentally reuse one that is about to be refunded.
  await pendingDequeues.get(playerId);
  if (findRoomForPlayer(playerId)) {
    send(socket, { t: 'error', v: 1, code: 'already_queued', message: 'already in a match' });
    return;
  }
  if (waitingFor(playerId)) {
    send(socket, { t: 'error', v: 1, code: 'already_queued', message: 'already queued' });
    return;
  }

  let wagerRequestId: string | null = null;
  let pointBalance: number | undefined;
  if (options.wagered) {
    if (!options.wagerRequestId) {
      send(socket, { t: 'error', v: 1, code: 'bad_message', message: 'wager request id is required' });
      return;
    }
    try {
      const reservation = await reservePointWager(playerId, options.wagerRequestId);
      pointBalance = reservation.balance;
      if (!reservation.ok) {
        send(socket, {
          t: 'error',
          v: 1,
          code: 'insufficient_points',
          message: 'You need 50 points to enter this wager.',
        });
        return;
      }
      wagerRequestId = reservation.requestId;
    } catch (error) {
      send(socket, {
        t: 'error',
        v: 1,
        code: 'internal',
        message: error instanceof Error ? error.message : 'could not reserve wager points',
      });
      return;
    }
  }

  const summary = await fetchOpponentSummary(playerId);
  const entry: Waiting = {
    playerId,
    socket,
    since: Date.now(),
    rankPoints: summary.rankPoints,
    wagered: options.wagered,
    wagerRequestId,
  };

  if (options.opponent === 'bot') {
    send(socket, {
      t: 'queued',
      v: 1,
      position: 1,
      onlineCount: totalOnlineCount() + 1,
      ...(pointBalance === undefined ? {} : { pointBalance }),
    });
    await pairWithBot(mode, entry);
    return;
  }

  const key = keyFor(mode, options.wagered);
  queues[key].push(entry);
  send(socket, {
    t: 'queued',
    v: 1,
    position: queues[key].length,
    onlineCount: totalOnlineCount(),
    ...(pointBalance === undefined ? {} : { pointBalance }),
  });
  ensureSweeping();
  await tryPair(key);
}

export interface QueueCancellation {
  readonly cancelled: boolean;
  readonly refunded: boolean;
  readonly pointBalance?: number;
  /** A room cancellation already notified every connected player. */
  readonly notifiedByRoom?: boolean;
}

export async function dequeue(playerId: string): Promise<QueueCancellation> {
  const prior = pendingDequeues.get(playerId);
  const work = (async (): Promise<QueueCancellation> => {
    await prior;
    const removedEntries: Waiting[] = [];
    for (const key of queueKeys) {
      const removed = queues[key].filter((entry) => entry.playerId === playerId);
      queues[key] = queues[key].filter((entry) => entry.playerId !== playerId);
      removedEntries.push(...removed);
    }

    let pointBalance: number | undefined;
    let refunded = false;
    for (const entry of removedEntries) {
      if (!entry.wagerRequestId) continue;
      try {
        pointBalance = await refundPointWager(entry.playerId, entry.wagerRequestId);
        refunded = true;
      } catch (error) {
        console.error(`[matchmaker] wager refund failed for ${entry.playerId}`, error);
      }
    }
    return {
      cancelled: removedEntries.length > 0,
      refunded,
      ...(pointBalance === undefined ? {} : { pointBalance }),
    };
  })();
  pendingDequeues.set(playerId, work);
  try {
    return await work;
  } finally {
    if (pendingDequeues.get(playerId) === work) pendingDequeues.delete(playerId);
  }
}

/** Cancel either a queued hold or a wagered room that has not begun playing. */
export async function cancelBeforeMatchStart(
  playerId: string,
  wagerRequestId?: string,
): Promise<QueueCancellation> {
  const queued = await dequeue(playerId);
  if (queued.cancelled) return queued;

  const room = findRoomForPlayer(playerId);
  if (room) {
    const balances = await room.cancelBeforeStart(playerId);
    if (balances) {
      const mine = balances.find((entry) => entry.profileId === playerId);
      return {
        cancelled: true,
        refunded: mine !== undefined,
        ...(mine ? { pointBalance: mine.balance } : {}),
        notifiedByRoom: true,
      };
    }
  }

  // REST retries arrive after the socket acknowledgement. The RPC is
  // idempotent, so this also recovers a response lost after the refund.
  if (wagerRequestId) {
    const pointBalance = await refundPointWager(playerId, wagerRequestId);
    return { cancelled: false, refunded: false, pointBalance };
  }
  return queued;
}

export function queueLength(mode: MatchMode): number {
  return queues[keyFor(mode, false)].length + queues[keyFor(mode, true)].length;
}

export function totalQueued(): number {
  return queueKeys.reduce((sum, key) => sum + queues[key].length, 0);
}

function ensureSweeping(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    for (const key of queueKeys) void tryPair(key);
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

async function tryPair(key: QueueKey): Promise<void> {
  const queue = queues[key];
  const now = Date.now();
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    if (!a) continue;
    let bestIndex = -1;
    let bestDiff = Infinity;
    for (let j = i + 1; j < queue.length; j++) {
      const b = queue[j];
      if (!b) continue;
      const window = Math.max(rankWindow(now - a.since), rankWindow(now - b.since));
      const diff = Math.abs(a.rankPoints - b.rankPoints);
      if (diff <= window && diff < bestDiff) {
        bestDiff = diff;
        bestIndex = j;
      }
    }
    if (bestIndex !== -1) {
      const b = queue[bestIndex] as Waiting;
      queue.splice(bestIndex, 1);
      queue.splice(i, 1);
      await pair(key.startsWith('classic') ? 'classic' : 'advanced', a, b);
      return tryPair(key);
    }
  }

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    if (entry && now - entry.since >= BOT_AFTER_MS) {
      queue.splice(i, 1);
      await pairWithBot(key.startsWith('classic') ? 'classic' : 'advanced', entry);
      return tryPair(key);
    }
  }
}

async function refundEntries(...entries: Waiting[]): Promise<void> {
  await Promise.allSettled(
    entries
      .filter((entry) => entry.wagerRequestId)
      .map((entry) => refundPointWager(entry.playerId, entry.wagerRequestId as string)),
  );
}

async function pair(mode: MatchMode, a: Waiting, b: Waiting): Promise<void> {
  try {
    await createRoom(
      mode,
      randomSeed(),
      { playerId: a.playerId, socket: a.socket, isBot: false },
      { playerId: b.playerId, socket: b.socket, isBot: false },
      FUEL_BUDGET,
      { wagered: a.wagered, holdA: a.wagerRequestId, holdB: b.wagerRequestId },
    );
  } catch (error) {
    await refundEntries(a, b);
    const message = error instanceof Error ? error.message : 'could not create match';
    send(a.socket, { t: 'error', v: 1, code: 'internal', message });
    send(b.socket, { t: 'error', v: 1, code: 'internal', message });
  }
}

async function pairWithBot(mode: MatchMode, human: Waiting): Promise<void> {
  try {
    await createRoom(
      mode,
      randomSeed(),
      { playerId: human.playerId, socket: human.socket, isBot: false },
      { playerId: BOT_PLAYER_ID, socket: null, isBot: true },
      FUEL_BUDGET,
      { wagered: human.wagered, holdA: human.wagerRequestId, holdB: null },
    );
  } catch (error) {
    await refundEntries(human);
    send(human.socket, {
      t: 'error',
      v: 1,
      code: 'internal',
      message: error instanceof Error ? error.message : 'could not create bot match',
    });
  }
}

function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

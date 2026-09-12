/**
 * One queue per mode. FIFO pairing with a widening rank window: ±150 to
 * start, +150 every 5s, uncapped after 30s so nobody waits forever for an
 * exact-rank opponent. A player waiting 45s alone gets a bot match — driven
 * server-side by src/engine/ai.ts (see room.ts) — so a quiet lobby never
 * stalls a demo. Only the database knows it was a bot.
 */
import type { WebSocket } from 'ws';

import type { MatchMode } from '@engine/types';
import { FUEL_BUDGET } from '@engine/types';

import { BOT_PLAYER_ID, fetchOpponentSummary } from './db';
import { envMs } from './env';
import { encode, type ServerMessage } from './protocol';
import { createRoom, findRoomForPlayer, rooms } from './room';

const RANK_WINDOW_START = 150;
const RANK_WINDOW_STEP = 150;
const RANK_WINDOW_STEP_MS = envMs('SEABATTLE_RANK_WINDOW_STEP_MS', 5_000);
const RANK_WINDOW_UNCAPPED_MS = envMs('SEABATTLE_RANK_WINDOW_UNCAPPED_MS', 30_000);
// Test-overridable — see room.ts's envMs for why (same rationale, small helper).
const BOT_AFTER_MS = envMs('SEABATTLE_BOT_AFTER_MS', 45_000);
const SWEEP_INTERVAL_MS = envMs('SEABATTLE_SWEEP_INTERVAL_MS', 1_000);

interface Waiting {
  readonly playerId: string;
  readonly socket: WebSocket;
  readonly since: number;
  readonly rankPoints: number;
}

const queues: Record<MatchMode, Waiting[]> = { classic: [], advanced: [] };
let sweepTimer: NodeJS.Timeout | null = null;

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(encode(message));
}

function rankWindow(waitMs: number): number {
  if (waitMs >= RANK_WINDOW_UNCAPPED_MS) return Infinity;
  const steps = Math.floor(waitMs / RANK_WINDOW_STEP_MS);
  return RANK_WINDOW_START + steps * RANK_WINDOW_STEP;
}

function totalOnlineCount(): number {
  return queues.classic.length + queues.advanced.length + findOnlineFromRooms();
}

// Rooms track their own two seats; a rough online count for `queued` is the
// queue plus everyone currently in an active match. Good enough for a lobby
// counter — it is cosmetic, never used for anything authoritative.
function findOnlineFromRooms(): number {
  return rooms.size * 2;
}

export async function enqueue(mode: MatchMode, playerId: string, socket: WebSocket): Promise<void> {
  if (findRoomForPlayer(playerId)) {
    send(socket, { t: 'error', v: 1, code: 'already_queued', message: 'already in a match' });
    return;
  }
  if (queues[mode].some((w) => w.playerId === playerId)) {
    send(socket, { t: 'error', v: 1, code: 'already_queued', message: 'already queued' });
    return;
  }

  const summary = await fetchOpponentSummary(playerId);
  const entry: Waiting = { playerId, socket, since: Date.now(), rankPoints: summary.rankPoints };
  queues[mode].push(entry);
  send(socket, { t: 'queued', v: 1, position: queues[mode].length, onlineCount: totalOnlineCount() });

  ensureSweeping();
  await tryPair(mode);
}

export function dequeue(playerId: string): void {
  for (const mode of Object.keys(queues) as MatchMode[]) {
    queues[mode] = queues[mode].filter((w) => w.playerId !== playerId);
  }
}

export function queueLength(mode: MatchMode): number {
  return queues[mode].length;
}

export function totalQueued(): number {
  return queues.classic.length + queues.advanced.length;
}

function ensureSweeping(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void tryPair('classic');
    void tryPair('advanced');
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

async function tryPair(mode: MatchMode): Promise<void> {
  const queue = queues[mode];
  const now = Date.now();

  // Oldest first: give the longest-waiting player first shot at a match,
  // widening by whichever of the pair has waited longer (nobody should be
  // stuck behind a picky newcomer's narrow window).
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
      await pair(mode, a, b);
      return tryPair(mode); // the indices shifted; restart the sweep
    }
  }

  // Nobody to pair with: offer a bot to anyone who has waited long enough.
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    if (entry && now - entry.since >= BOT_AFTER_MS) {
      queue.splice(i, 1);
      await pairWithBot(mode, entry);
      return tryPair(mode);
    }
  }
}

async function pair(mode: MatchMode, a: Waiting, b: Waiting): Promise<void> {
  const seed = randomSeed();
  await createRoom(
    mode,
    seed,
    { playerId: a.playerId, socket: a.socket, isBot: false },
    { playerId: b.playerId, socket: b.socket, isBot: false },
    FUEL_BUDGET,
  );
}

async function pairWithBot(mode: MatchMode, human: Waiting): Promise<void> {
  const seed = randomSeed();
  await createRoom(
    mode,
    seed,
    { playerId: human.playerId, socket: human.socket, isBot: false },
    { playerId: BOT_PLAYER_ID, socket: null, isBot: true },
    FUEL_BUDGET,
  );
}

function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

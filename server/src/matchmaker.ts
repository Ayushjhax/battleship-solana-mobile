/**
 * Queue and pairing. Deliberately simple: first two players wanting the same
 * mode get a room. P13 adds rank banding and reconnect-to-room.
 */
import type { MatchMode } from '@engine/types';
import type { WebSocket } from 'ws';
import { Room } from './room';

interface Waiting {
  readonly playerId: string;
  readonly socket: WebSocket;
  readonly since: number;
}

const queues: Record<MatchMode, Waiting[]> = { classic: [], advanced: [] };
export const rooms = new Map<string, Room>();

export function enqueue(mode: MatchMode, playerId: string, socket: WebSocket, now: number): Room | null {
  const queue = queues[mode];
  const opponent = queue.shift();
  if (!opponent) {
    queue.push({ playerId, socket, since: now });
    return null;
  }

  const room = new Room(`m_${now.toString(36)}_${playerId.slice(0, 4)}`, mode, [
    { playerId: opponent.playerId, socket: opponent.socket },
    { playerId, socket },
  ]);
  rooms.set(room.id, room);
  return room;
}

export function dequeue(playerId: string): void {
  for (const mode of Object.keys(queues) as MatchMode[]) {
    queues[mode] = queues[mode].filter((w) => w.playerId !== playerId);
  }
}

export function queueLength(mode: MatchMode): number {
  return queues[mode].length;
}

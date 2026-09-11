/**
 * One live match, held in memory. The room owns the authoritative MatchState
 * and is the only place a full board exists — clients receive projectView()
 * output and nothing else (docs/brief.md 4.1).
 */
import type { MatchMode, MatchState } from '@engine/types';
import { TURN_SECONDS } from '@engine/types';
import type { WebSocket } from 'ws';
import { encode, type ServerMessage } from './protocol';

export interface Seat {
  readonly playerId: string;
  socket: WebSocket | null;
}

export class Room {
  readonly id: string;
  readonly mode: MatchMode;
  readonly seats: [Seat, Seat];
  state: MatchState | null = null;
  turnTimer: NodeJS.Timeout | null = null;

  constructor(id: string, mode: MatchMode, seats: [Seat, Seat]) {
    this.id = id;
    this.mode = mode;
    this.seats = seats;
  }

  send(playerId: string, message: ServerMessage): void {
    const seat = this.seats.find((s) => s.playerId === playerId);
    seat?.socket?.send(encode(message));
  }

  broadcast(message: ServerMessage): void {
    for (const seat of this.seats) seat.socket?.send(encode(message));
  }

  /** TODO(P12): engine.reduce() on every action, then push masked views. */
  turnDeadline(from: number): number {
    return from + TURN_SECONDS * 1000;
  }
}

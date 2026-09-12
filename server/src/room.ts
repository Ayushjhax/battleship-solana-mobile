/**
 * One live match, held in memory. THE critical property (docs/brief.md 4.1):
 * this is the only place a full MatchState exists. Every outbound `state`
 * message carries `projectView()` output, never the state itself — grep
 * `__tests__/leak.test.ts` proves it holds across a full match.
 *
 * Every inbound action goes through `reduce()` — the exact function the
 * client uses offline (src/engine/match.ts) — and nothing else changes
 * `state`. An action the reducer rejects is reported back to the caller
 * (ws.ts counts these; five from one connection is a cheating signal and
 * disconnects the socket) and is NOT applied.
 */
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

import {
  TURN_SECONDS,
  createMatch,
  createRng,
  opponentOf,
  playerIndex,
  projectView,
  reduce,
  type ArsenalItem,
  type GameOverReason,
  type MatchAction,
  type MatchEvent,
  type MatchMode,
  type MatchState,
  type Ship,
} from '@engine/index';
import { autoPlaceFleet } from '@engine/placement';
import { chooseMove } from '@engine/ai';
import { REWARD } from '@engine/ranks';

import { appendMatchEvent, applyMatchResult, BOT_PLAYER_ID, dbEndReason, fetchOpponentSummary, insertMatch, type DbEndReason } from './db';
import { envMs } from './env';
import { encode, PROTOCOL_VERSION, type OpponentSummary, type ServerMessage } from './protocol';

const LATENCY_GRACE_MS = 2000;

// Overridable so room.test.ts can shrink 90s/45s/22s waits to milliseconds —
// the room reads these once per module load, never mid-match.
const TURN_TIMEOUT_MS = envMs('SEABATTLE_TURN_TIMEOUT_MS', TURN_SECONDS * 1000 + LATENCY_GRACE_MS);
const LAYOUT_DEADLINE_MS = envMs('SEABATTLE_LAYOUT_DEADLINE_MS', 90_000);
const DISCONNECT_GRACE_MS = envMs('SEABATTLE_DISCONNECT_GRACE_MS', 45_000);
const BOT_LAYOUT_DELAY_MS = envMs('SEABATTLE_BOT_LAYOUT_DELAY_MS', 1200);
const BOT_THINK_MIN_MS = envMs('SEABATTLE_BOT_THINK_MIN_MS', 900);
const BOT_THINK_SPREAD_MS = envMs('SEABATTLE_BOT_THINK_SPREAD_MS', 600);

interface Seat {
  readonly playerId: string;
  readonly isBot: boolean;
  socket: WebSocket | null;
  connected: boolean;
  disconnectTimer: NodeJS.Timeout | null;
  /** Highest client action `seq` already applied — dedupes a retried send after reconnect. */
  lastAppliedActionSeq: number;
}

export interface HandleResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export class Room {
  readonly id: string;
  readonly mode: MatchMode;
  readonly seats: [Seat, Seat];
  readonly createdAt: number;

  state: MatchState;
  private outSeq = 0;
  private readonly eventLog: { seq: number; events: MatchEvent[] }[] = [];
  private turnTimer: NodeJS.Timeout | null = null;
  private layoutTimer: NodeJS.Timeout | null = null;
  private botTurnTimer: NodeJS.Timeout | null = null;
  private finished = false;
  /** Set just before a disconnect-forced RESIGN so the DB record says why. */
  private forcedDbReason: DbEndReason | null = null;
  /** What `matched` carried, re-sent on attach so a client that lost its store can rebuild the HUD. */
  private matched: { summaries: [OpponentSummary, OpponentSummary]; fuelBudget: number; layoutDeadline: number } | null = null;
  private readonly onFinished: (room: Room) => void;

  constructor(
    matchId: string,
    mode: MatchMode,
    seed: number,
    seatDefs: readonly [{ playerId: string; socket: WebSocket | null; isBot: boolean }, { playerId: string; socket: WebSocket | null; isBot: boolean }],
    onFinished: (room: Room) => void,
  ) {
    this.id = matchId;
    this.mode = mode;
    this.createdAt = Date.now();
    this.onFinished = onFinished;
    this.seats = seatDefs.map((s) => ({
      playerId: s.playerId,
      isBot: s.isBot,
      socket: s.socket,
      connected: s.socket !== null || s.isBot,
      disconnectTimer: null,
      lastAppliedActionSeq: -1,
    })) as [Seat, Seat];
    this.state = createMatch({ id: matchId, mode, seed, playerIds: [seatDefs[0].playerId, seatDefs[1].playerId] });
  }

  // -------------------------------------------------------------------------
  // Wire I/O
  // -------------------------------------------------------------------------

  private seatOf(playerId: string): Seat | undefined {
    return this.seats.find((s) => s.playerId === playerId);
  }

  private send(playerId: string, message: ServerMessage): void {
    const seat = this.seatOf(playerId);
    if (!seat?.socket || seat.socket.readyState !== seat.socket.OPEN) return;
    seat.socket.send(encode(message));
  }

  /** The authoritative snapshot a player may see: their own view, at the current seq. */
  private snapshotFor(playerId: string): ServerMessage {
    const other = this.seatOf(opponentOf(this.state, playerId));
    return {
      t: 'state',
      v: 1,
      seq: this.outSeq,
      view: projectView(this.state, playerId),
      ...(other && !other.connected ? { opponentDisconnected: true } : {}),
    };
  }

  private broadcastState(): void {
    for (const seat of this.seats) this.send(seat.playerId, this.snapshotFor(seat.playerId));
  }

  private broadcastEvents(events: readonly MatchEvent[]): void {
    if (events.length === 0) return;
    for (const seat of this.seats) this.send(seat.playerId, { t: 'events', v: 1, seq: this.outSeq, events });
  }

  private broadcastTurn(): void {
    if (this.state.phase !== 'playing') return;
    for (const seat of this.seats) {
      this.send(seat.playerId, { t: 'turn', v: 1, playerId: this.state.turn, endsAt: Date.now() + TURN_TIMEOUT_MS });
    }
  }

  /**
   * hello (with or without resumeMatchId — an app that was killed mid-match
   * comes back with an empty store): `matched` again so the client knows who
   * it is playing, then the event log, then a fresh authoritative view.
   */
  attach(playerId: string, socket: WebSocket): boolean {
    const seat = this.seatOf(playerId);
    if (!seat) return false;
    seat.socket = socket;
    seat.connected = true;
    if (seat.disconnectTimer) {
      clearTimeout(seat.disconnectTimer);
      seat.disconnectTimer = null;
    }

    this.sendMatched(playerId);
    for (const entry of this.eventLog) this.send(playerId, { t: 'events', v: 1, seq: entry.seq, events: entry.events });
    this.send(playerId, this.snapshotFor(playerId));
    this.broadcastTurn();
    // The reconnecting player's opponent gets to stop seeing "Reconnecting…".
    this.broadcastState();
    return true;
  }

  handleDisconnect(playerId: string): void {
    const seat = this.seatOf(playerId);
    if (!seat || this.finished) return;
    seat.socket = null;
    seat.connected = false;
    this.broadcastState();

    seat.disconnectTimer = setTimeout(() => {
      if (this.finished || seat.connected) return;
      this.forcedDbReason = 'disconnect';
      this.applyAction({ type: 'RESIGN', playerId });
    }, DISCONNECT_GRACE_MS);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(fuelBudget: number): Promise<void> {
    await insertMatch({
      id: this.id,
      mode: this.mode,
      playerA: this.state.players[0].id,
      playerB: this.state.players[1].id,
      seed: this.state.seed,
      isBot: this.seats.some((s) => s.isBot),
    });

    // A fixed-length array literal (not .map, which loses tuple-ness) keeps
    // this a real 2-tuple under noUncheckedIndexedAccess.
    const summaries: [OpponentSummary, OpponentSummary] = await Promise.all([
      fetchOpponentSummary(this.seats[0].playerId),
      fetchOpponentSummary(this.seats[1].playerId),
    ]);
    const layoutDeadline = Date.now() + LAYOUT_DEADLINE_MS;
    this.matched = { summaries, fuelBudget, layoutDeadline };
    for (const seat of this.seats) this.sendMatched(seat.playerId);

    this.layoutTimer = setTimeout(() => this.autoPlaceOverdueLayouts(), LAYOUT_DEADLINE_MS);
    for (const seat of this.seats) if (seat.isBot) this.scheduleBotLayout(seat.playerId);
  }

  private sendMatched(playerId: string): void {
    const seat = this.seatOf(playerId);
    if (!seat || !this.matched) return;
    const i = this.seats.indexOf(seat);
    this.send(playerId, {
      t: 'matched',
      v: 1,
      matchId: this.id,
      you: this.matched.summaries[i] as OpponentSummary,
      opponent: this.matched.summaries[1 - i] as OpponentSummary,
      mode: this.mode,
      fuelBudget: this.matched.fuelBudget,
      layoutDeadline: this.matched.layoutDeadline,
    });
  }

  private autoPlaceOverdueLayouts(): void {
    this.layoutTimer = null;
    if (this.finished || this.state.phase !== 'placing') return;
    for (const seat of this.seats) {
      const index = playerIndex(this.state, seat.playerId);
      if (index !== -1 && !this.state.players[index].ready) {
        const ships: Ship[] = autoPlaceFleet(createRng(this.state.seed + index + 1));
        this.applyAction({ type: 'SUBMIT_LAYOUT', playerId: seat.playerId, ships, arsenal: [] });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Inbound actions — the ONLY path that touches `state`
  // -------------------------------------------------------------------------

  handleReady(playerId: string, ships: Ship[], arsenal: ArsenalItem[]): HandleResult {
    return this.applyAction({ type: 'SUBMIT_LAYOUT', playerId, ships, arsenal });
  }

  handleAction(playerId: string, seq: number, action: MatchAction): HandleResult {
    const seat = this.seatOf(playerId);
    if (seat) {
      if (seq <= seat.lastAppliedActionSeq) {
        // A retried send after a reconnect — already applied, not illegal.
        this.send(playerId, this.snapshotFor(playerId));
        return { ok: true };
      }
      seat.lastAppliedActionSeq = seq;
    }
    return this.applyAction(action);
  }

  handleResign(playerId: string): HandleResult {
    return this.applyAction({ type: 'RESIGN', playerId });
  }

  private applyAction(action: MatchAction): HandleResult {
    if (this.finished) return { ok: false, reason: 'match is over' };

    const { state: nextState, events } = reduce(this.state, action);
    const rejected = events.find((e): e is Extract<MatchEvent, { type: 'REJECTED' }> => e.type === 'REJECTED');
    this.state = nextState;

    if (rejected) {
      this.send(action.playerId, { t: 'error', v: 1, code: 'illegal_action', message: rejected.reason });
      return { ok: false, reason: rejected.reason };
    }

    this.outSeq += 1;
    this.eventLog.push({ seq: this.outSeq, events: [...events] });
    void appendMatchEvent(this.id, this.outSeq, events);

    this.broadcastEvents(events);
    this.broadcastState();

    if (this.state.phase === 'over') {
      this.finish(events);
    } else if (this.state.phase === 'playing') {
      this.broadcastTurn();
      this.rearmTurnTimer();
      this.scheduleBotTurnIfNeeded();
    } else if (this.layoutTimer && this.state.players.every((p) => p.ready)) {
      clearTimeout(this.layoutTimer);
      this.layoutTimer = null;
    }

    return { ok: true };
  }

  private rearmTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    const turn = this.state.turn;
    this.turnTimer = setTimeout(() => {
      if (this.finished || this.state.turn !== turn || this.state.phase !== 'playing') return;
      this.applyAction({ type: 'TIMEOUT', playerId: turn });
    }, TURN_TIMEOUT_MS);
  }

  // -------------------------------------------------------------------------
  // The server-driven bot opponent — indistinguishable over the wire
  // -------------------------------------------------------------------------

  private scheduleBotLayout(botId: string): void {
    setTimeout(() => {
      if (this.finished || this.state.phase !== 'placing') return;
      const index = playerIndex(this.state, botId);
      if (index === -1 || this.state.players[index].ready) return;
      const ships = autoPlaceFleet(createRng(this.state.seed + index + 101));
      this.applyAction({ type: 'SUBMIT_LAYOUT', playerId: botId, ships, arsenal: [] });
    }, BOT_LAYOUT_DELAY_MS);
  }

  private scheduleBotTurnIfNeeded(): void {
    if (this.botTurnTimer) {
      clearTimeout(this.botTurnTimer);
      this.botTurnTimer = null;
    }
    const seat = this.seats.find((s) => s.isBot);
    if (!seat || this.state.phase !== 'playing' || this.state.turn !== seat.playerId) return;

    const rng = createRng(this.state.seed * 31 + this.state.moves + 7);
    const delay = BOT_THINK_MIN_MS + rng.int(BOT_THINK_SPREAD_MS + 1);
    this.botTurnTimer = setTimeout(() => {
      this.botTurnTimer = null;
      if (this.finished || this.state.phase !== 'playing' || this.state.turn !== seat.playerId) return;
      const view = projectView(this.state, seat.playerId);
      const action = chooseMove(view, 'normal', createRng(this.state.seed * 17 + this.state.moves + 3));
      this.applyAction(action);
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------

  private finish(events: readonly MatchEvent[]): void {
    this.finished = true;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    if (this.botTurnTimer) clearTimeout(this.botTurnTimer);
    for (const seat of this.seats) if (seat.disconnectTimer) clearTimeout(seat.disconnectTimer);

    const over = events.find((e): e is Extract<MatchEvent, { type: 'GAME_OVER' }> => e.type === 'GAME_OVER');
    const winnerId = over?.winner ?? this.state.winner ?? this.state.players[0].id;
    const reason: GameOverReason = over?.reason ?? 'resign';

    // this.forcedDbReason distinguishes a 45s-disconnect-forced forfeit from a
    // deliberate resign — both are RESIGN at the engine level (reason=
    // 'resign' either way), but the DB record should say which really happened.
    // The row and both profiles are settled in ONE transaction (0008).
    void applyMatchResult(this.id, winnerId, this.forcedDbReason ?? dbEndReason(reason), REWARD);

    for (const seat of this.seats) {
      const won = seat.playerId === winnerId;
      this.send(seat.playerId, { t: 'over', v: 1, winnerId, reason, rewards: won ? REWARD.win : REWARD.loss });
    }

    this.onFinished(this);
  }

  isFull(): boolean {
    return this.seats.every((s) => s.socket !== null || s.isBot);
  }

  hasPlayer(playerId: string): boolean {
    return this.seatOf(playerId) !== undefined;
  }
}

// ---------------------------------------------------------------------------
// Registry — matchmaker creates rooms here; ws.ts looks players up here
// ---------------------------------------------------------------------------

export const rooms = new Map<string, Room>();
export const roomIdForPlayer = new Map<string, string>();

export interface RoomSeatInput {
  readonly playerId: string;
  readonly socket: WebSocket | null;
  readonly isBot: boolean;
}

export async function createRoom(
  mode: MatchMode,
  seed: number,
  seatA: RoomSeatInput,
  seatB: RoomSeatInput,
  fuelBudget: number,
): Promise<Room> {
  const matchId = randomUUID();
  const room = new Room(matchId, mode, seed, [seatA, seatB], (finished) => {
    rooms.delete(finished.id);
    for (const seat of finished.seats) {
      if (roomIdForPlayer.get(seat.playerId) === finished.id) roomIdForPlayer.delete(seat.playerId);
    }
  });
  rooms.set(matchId, room);
  roomIdForPlayer.set(seatA.playerId, matchId);
  roomIdForPlayer.set(seatB.playerId, matchId);
  await room.start(fuelBudget);
  return room;
}

export function findRoomForPlayer(playerId: string): Room | undefined {
  const matchId = roomIdForPlayer.get(playerId);
  return matchId ? rooms.get(matchId) : undefined;
}

export { BOT_PLAYER_ID, PROTOCOL_VERSION };

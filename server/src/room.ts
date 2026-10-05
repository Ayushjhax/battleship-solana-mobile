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
  type Board,
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

import {
  abandonMatch,
  appendMatchEvent,
  applyMatchResult,
  BOT_PLAYER_ID,
  cancelMatchBeforeStart,
  cancelWageredMatchBeforeStart,
  dbEndReason,
  fetchOpponentSummary,
  fetchPointBalance,
  insertMatch,
  insertWageredMatch,
  type DbEndReason,
  type CancelledWagerBalance,
} from './db';
import { envMs } from './env';
import { encode, PROTOCOL_VERSION, type OpponentSummary, type ServerMessage } from './protocol';

const LATENCY_GRACE_MS = 2000;

// Overridable so room.test.ts can shrink 90s/45s/22s waits to milliseconds —
// the room reads these once per module load, never mid-match.
const TURN_TIMEOUT_MS = envMs('SEABATTLE_TURN_TIMEOUT_MS', TURN_SECONDS * 1000 + LATENCY_GRACE_MS);
const LAYOUT_DEADLINE_MS = envMs('SEABATTLE_LAYOUT_DEADLINE_MS', 90_000);
const DISCONNECT_GRACE_MS = envMs('SEABATTLE_DISCONNECT_GRACE_MS', 45_000);
/**
 * Both human captains are away. Neither should lose a match the other is not
 * playing either, so the room simply waits: if they both come back it carries
 * on exactly where it stopped. Shorter than the single-player grace because
 * nobody is sitting in front of a frozen board waiting it out.
 */
const ABANDON_GRACE_MS = envMs('SEABATTLE_ABANDON_GRACE_MS', 20_000);
const BOT_LAYOUT_DELAY_MS = envMs('SEABATTLE_BOT_LAYOUT_DELAY_MS', 1200);
const BOT_THINK_MIN_MS = envMs('SEABATTLE_BOT_THINK_MIN_MS', 900);
const BOT_THINK_SPREAD_MS = envMs('SEABATTLE_BOT_THINK_SPREAD_MS', 600);

/** The shortest gap between two relayed emotes from one player. */
const EMOTE_MIN_GAP_MS = 250;
/** First wait before re-trying a wagered settlement the database refused; it doubles, capped at 12x. */
const SETTLE_RETRY_MS = envMs('SEABATTLE_SETTLE_RETRY_MS', 5_000);
/** After this many refusals the stakes stay held for apply_match_result to be run by hand. */
const MAX_SETTLE_ATTEMPTS = 10;

interface Seat {
  readonly playerId: string;
  readonly isBot: boolean;
  socket: WebSocket | null;
  connected: boolean;
  disconnectTimer: NodeJS.Timeout | null;
  /** Highest client action `seq` already applied — dedupes a retried send after reconnect. */
  lastAppliedActionSeq: number;
}

export interface RoomWagerInput {
  readonly wagered: boolean;
  readonly holdA: string | null;
  readonly holdB: string | null;
}

export interface HandleResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/** What a pre-game cancel did. */
export type PreStartCancel =
  /** Done: the match is closed (stakes refunded if it was wagered) and every captain told. */
  | { readonly kind: 'cancelled'; readonly balances: readonly CancelledWagerBalance[] }
  /** The room is still being built; it cancels itself, and tells everyone, as soon as it is. */
  | { readonly kind: 'pending' }
  /** Too late (the match is under way or over), or the database refused. */
  | { readonly kind: 'refused' };

export class Room {
  readonly id: string;
  readonly mode: MatchMode;
  readonly seats: [Seat, Seat];
  private readonly lastEmoteAt = new Map<string, number>();
  readonly createdAt: number;

  state: MatchState;
  private outSeq = 0;
  private readonly eventLog: { seq: number; events: MatchEvent[] }[] = [];
  private turnTimer: NodeJS.Timeout | null = null;
  /**
   * When the live turn actually expires. Broadcast as-is, so a player who
   * reconnects mid-turn is shown the time they really have left rather than a
   * fresh countdown the server has no intention of honouring.
   */
  private turnEndsAt: number | null = null;
  private layoutTimer: NodeJS.Timeout | null = null;
  private botTurnTimer: NodeJS.Timeout | null = null;
  /** Running while every human seat is disconnected. See ABANDON_GRACE_MS. */
  private abandonTimer: NodeJS.Timeout | null = null;
  private finished = false;
  /** The room has left the registry (onFinished ran); its players may queue again. */
  private released = false;
  private settleAttempts = 0;
  private cancellingBeforeStart = false;
  /** A pre-game cancel that arrived while start() was still building the room. */
  private cancelOnStart: string | null = null;
  /** Set just before a disconnect-forced RESIGN so the DB record says why. */
  private forcedDbReason: DbEndReason | null = null;
  /** What `matched` carried, re-sent on attach so a client that lost its store can rebuild the HUD. */
  private matched: { summaries: [OpponentSummary, OpponentSummary]; fuelBudget: number; layoutDeadline: number } | null = null;
  private readonly onFinished: (room: Room) => void;
  private readonly wager: RoomWagerInput;

  constructor(
    matchId: string,
    mode: MatchMode,
    seed: number,
    seatDefs: readonly [{ playerId: string; socket: WebSocket | null; isBot: boolean }, { playerId: string; socket: WebSocket | null; isBot: boolean }],
    onFinished: (room: Room) => void,
    wager: RoomWagerInput = { wagered: false, holdA: null, holdB: null },
  ) {
    this.id = matchId;
    this.mode = mode;
    this.createdAt = Date.now();
    this.onFinished = onFinished;
    this.wager = wager;
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
    const endsAt = this.turnEndsAt ?? Date.now() + TURN_TIMEOUT_MS;
    for (const seat of this.seats) {
      this.send(seat.playerId, { t: 'turn', v: 1, playerId: this.state.turn, endsAt });
    }
  }

  /**
   * hello (with or without resumeMatchId — an app that was killed mid-match
   * comes back with an empty store): `matched` again so the client knows who
   * it is playing, then the event log, then a fresh authoritative view.
   */
  attach(playerId: string, socket: WebSocket): boolean {
    const seat = this.seatOf(playerId);
    if (!seat || this.finished) return false;
    seat.socket = socket;
    seat.connected = true;
    if (seat.disconnectTimer) {
      clearTimeout(seat.disconnectTimer);
      seat.disconnectTimer = null;
    }
    // Somebody is back, so the room is no longer abandoned. Anyone still away
    // goes back on their own forfeit clock — returning first must not buy the
    // other captain an indefinite wait.
    if (this.abandonTimer) {
      clearTimeout(this.abandonTimer);
      this.abandonTimer = null;
      for (const other of this.seats) {
        if (!other.isBot && !other.connected) this.armForfeit(other);
      }
      // The turn clock stopped while nobody was here; the turn starts afresh.
      if (this.state.phase === 'playing') this.rearmTurnTimer();
    }

    this.sendMatched(playerId);
    for (const entry of this.eventLog) this.send(playerId, { t: 'events', v: 1, seq: entry.seq, events: entry.events });
    this.send(playerId, this.snapshotFor(playerId));
    this.broadcastTurn();
    // The reconnecting player's opponent gets to stop seeing "Reconnecting…".
    this.broadcastState();
    return true;
  }

  /**
   * `socket` is the one that closed. A player who changed network has usually
   * re-attached on a new socket long before the server notices the old one is
   * dead, and that late close must not detach the live seat.
   */
  handleDisconnect(playerId: string, socket: WebSocket): void {
    const seat = this.seatOf(playerId);
    if (!seat || this.finished || seat.socket !== socket) return;
    seat.socket = null;
    seat.connected = false;
    this.broadcastState();

    // Nobody left to play or to award: hold the room briefly instead of
    // forfeiting one of two captains who both walked away. abandonMatch()
    // closes it with no winner if neither returns.
    if (this.seats.every((s) => !s.isBot && !s.connected)) {
      for (const other of this.seats) {
        if (other.disconnectTimer) {
          clearTimeout(other.disconnectTimer);
          other.disconnectTimer = null;
        }
      }
      // Nobody is playing, so nobody's turn can time out: left running, the
      // clock could forfeit a captain inside the abandon grace (BUG-017).
      if (this.turnTimer) {
        clearTimeout(this.turnTimer);
        this.turnTimer = null;
      }
      this.abandonTimer = setTimeout(() => void this.abandonRoom(), ABANDON_GRACE_MS);
      return;
    }

    this.armForfeit(seat);
  }

  /** The lone-absentee clock: 45 s away and the match is forfeited. */
  private armForfeit(seat: Seat): void {
    if (seat.disconnectTimer) clearTimeout(seat.disconnectTimer);
    seat.disconnectTimer = setTimeout(() => {
      if (this.finished || seat.connected) return;
      this.forcedDbReason = 'disconnect';
      this.applyAction({ type: 'RESIGN', playerId: seat.playerId });
    }, DISCONNECT_GRACE_MS);
  }

  /**
   * Neither captain came back. The match closes with no winner, no rank
   * movement and no refund — the row and both stakes settle in one statement
   * (0013). Nobody is connected, so there is nothing to notify.
   */
  private async abandonRoom(): Promise<void> {
    this.abandonTimer = null;
    if (this.finished) return;
    if (this.seats.some((seat) => seat.connected)) return;
    this.finished = true;
    this.clearAllTimers();
    try {
      await abandonMatch(this.id);
    } catch (error) {
      console.error(`[room ${this.id}] could not record the abandonment`, error);
    }
    this.onFinished(this);
  }

  private clearAllTimers(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    if (this.botTurnTimer) clearTimeout(this.botTurnTimer);
    if (this.abandonTimer) clearTimeout(this.abandonTimer);
    this.turnTimer = this.layoutTimer = this.botTurnTimer = this.abandonTimer = null;
    for (const seat of this.seats) {
      if (seat.disconnectTimer) clearTimeout(seat.disconnectTimer);
      seat.disconnectTimer = null;
    }
  }

  /**
   * A cancel sent from the matchmaking screen may cross the `matched` frame.
   * It is still a true pre-game cancel while the engine is in placement, never
   * a forfeit: a wagered room refunds every human hold atomically (0011), an
   * unwagered one closes its match with no result (0016), and both captains
   * are told. A cancel that lands while the room is still being built is held
   * and applied the moment it is ready, before anyone is sent `matched`.
   */
  async cancelBeforeStart(playerId: string): Promise<PreStartCancel> {
    if (
      this.finished ||
      this.cancellingBeforeStart ||
      this.state.phase !== 'placing' ||
      !this.seatOf(playerId)
    ) {
      return { kind: 'refused' };
    }
    if (!this.matched) {
      this.cancelOnStart ??= playerId;
      return { kind: 'pending' };
    }
    return this.cancelNow(playerId);
  }

  private async cancelNow(playerId: string): Promise<PreStartCancel> {
    this.cancellingBeforeStart = true;
    try {
      let balances: readonly CancelledWagerBalance[] = [];
      if (this.wager.wagered) {
        balances = await cancelWageredMatchBeforeStart(this.id, playerId);
        if (balances.length === 0) {
          this.cancellingBeforeStart = false;
          return { kind: 'refused' };
        }
      } else if (!(await cancelMatchBeforeStart(this.id, playerId))) {
        this.cancellingBeforeStart = false;
        return { kind: 'refused' };
      }

      this.finished = true;
      this.clearAllTimers();

      const byProfile = new Map(balances.map((entry) => [entry.profileId, entry.balance]));
      for (const seat of this.seats) {
        if (seat.isBot) continue;
        const balance = byProfile.get(seat.playerId);
        this.send(seat.playerId, {
          t: 'queue:cancelled',
          v: 1,
          refunded: balance !== undefined,
          reason: seat.playerId === playerId ? 'cancelled' : 'opponent_cancelled',
          ...(balance === undefined ? {} : { pointBalance: balance }),
        });
      }
      this.onFinished(this);
      return { kind: 'cancelled', balances };
    } catch (error) {
      this.cancellingBeforeStart = false;
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(fuelBudget: number): Promise<void> {
    const matchInput = {
      id: this.id,
      mode: this.mode,
      playerA: this.state.players[0].id,
      playerB: this.state.players[1].id,
      seed: this.state.seed,
      isBot: this.seats.some((s) => s.isBot),
    };
    if (this.wager.wagered) {
      if (!this.wager.holdA) throw new Error('wagered room has no player A hold');
      await insertWageredMatch(
        matchInput,
        { profileId: this.seats[0].playerId, requestId: this.wager.holdA },
        this.wager.holdB
          ? { profileId: this.seats[1].playerId, requestId: this.wager.holdB }
          : null,
      );
    } else {
      await insertMatch(matchInput);
    }

    // A fixed-length array literal (not .map, which loses tuple-ness) keeps
    // this a real 2-tuple under noUncheckedIndexedAccess.
    const summaries: [OpponentSummary, OpponentSummary] = await Promise.all([
      fetchOpponentSummary(this.seats[0].playerId),
      fetchOpponentSummary(this.seats[1].playerId),
    ]);
    const layoutDeadline = Date.now() + LAYOUT_DEADLINE_MS;
    this.matched = { summaries, fuelBudget, layoutDeadline };

    // A cancel that landed while the room was being built: apply it before
    // anyone is told there is a match. Only if it can't be applied does the
    // match go ahead.
    const heldCancel = this.cancelOnStart;
    this.cancelOnStart = null;
    if (heldCancel) {
      try {
        if ((await this.cancelNow(heldCancel)).kind === 'cancelled') return;
      } catch (error) {
        console.error(`[room ${this.id}] could not cancel before the start`, error);
      }
    }
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
      wagered: this.wager.wagered,
      wagerStake: this.wager.wagered ? 50 : 0,
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

  /**
   * Hands a player's emote to the other seat. Cosmetic: a bot seat, a closed
   * socket or a finished room drops it, and one emote per player per
   * EMOTE_MIN_GAP_MS keeps a stuck finger from flooding the opponent.
   */
  relayEmote(from: string, emoteId: number): void {
    if (this.finished) return;
    const now = Date.now();
    if (now - (this.lastEmoteAt.get(from) ?? 0) < EMOTE_MIN_GAP_MS) return;
    this.lastEmoteAt.set(from, now);
    const other = this.seats.find((s) => s.playerId !== from);
    if (!other || other.isBot || !this.seats.some((s) => s.playerId === from)) return;
    this.send(other.playerId, { t: 'emote', v: 1, from, emoteId });
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
      // Arm first: the broadcast carries the deadline the timer will enforce.
      this.rearmTurnTimer();
      this.broadcastTurn();
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
    this.turnEndsAt = Date.now() + TURN_TIMEOUT_MS;
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
    this.clearAllTimers();

    const over = events.find((e): e is Extract<MatchEvent, { type: 'GAME_OVER' }> => e.type === 'GAME_OVER');
    const confirmed = over?.winner ?? this.state.winner;
    const winnerId = confirmed ?? this.state.players[0].id;
    const reason: GameOverReason = over?.reason ?? 'resign';
    // The winner's board, copied NOW from the terminal state — before the
    // settlement's await and before the room is swept — for the loser's reveal.
    const reveal = confirmed ? this.finalBoardOf(confirmed) : null;

    // this.forcedDbReason distinguishes a 45s-disconnect-forced forfeit from a
    // deliberate resign — both are RESIGN at the engine level (reason=
    // 'resign' either way), but the DB record should say which really happened.
    // The row and both profiles are settled in ONE transaction (0008).
    void this.settleAndNotify(winnerId, reason, reveal);
  }

  /**
   * A detached copy of `playerId`'s board, only from a finished match and only
   * for one of its two players — the whole of what `over.reveal` may carry.
   */
  private finalBoardOf(playerId: string): Board | null {
    if (this.state.phase !== 'over') return null;
    const index = playerIndex(this.state, playerId);
    if (index === -1) return null;
    return structuredClone(this.state.players[index].board) as Board;
  }

  /** Takes the room out of the registry once, so its players can queue again. */
  private release(): void {
    if (this.released) return;
    this.released = true;
    this.onFinished(this);
  }

  private async settleAndNotify(
    winnerId: string,
    reason: GameOverReason,
    reveal: Board | null,
  ): Promise<void> {
    this.settleAttempts += 1;
    try {
      await applyMatchResult(
        this.id,
        winnerId,
        this.forcedDbReason ?? dbEndReason(reason),
        REWARD,
      );
    } catch (error) {
      console.error(`[room ${this.id}] settlement failed (attempt ${this.settleAttempts})`, error);
      if (this.wager.wagered) {
        // A wager is retried, safely (apply_match_result is idempotent) — but
        // never while holding the players: a room left in the registry told
        // both "already in a match" for as long as the database was down.
        if (this.settleAttempts === 1) {
          for (const seat of this.seats) {
            this.send(seat.playerId, {
              t: 'error',
              v: 1,
              code: 'internal',
              message: 'Wager settlement is delayed; the server is retrying safely.',
            });
          }
          this.release();
        }
        if (this.settleAttempts >= MAX_SETTLE_ATTEMPTS) {
          console.error(
            `[room ${this.id}] giving up after ${this.settleAttempts} settlement attempts; ` +
              'both stakes stay held for apply_match_result to be run by hand',
          );
          return;
        }
        const delay = Math.min(SETTLE_RETRY_MS * 2 ** (this.settleAttempts - 1), SETTLE_RETRY_MS * 12);
        setTimeout(() => void this.settleAndNotify(winnerId, reason, reveal), delay).unref?.();
        return;
      }
    }

    const balances = await Promise.all(
      this.seats.map(async (seat) =>
        seat.isBot || !this.wager.wagered
          ? null
          : fetchPointBalance(seat.playerId).catch(() => null),
      ),
    );
    for (let index = 0; index < this.seats.length; index++) {
      const seat = this.seats[index] as Seat;
      const won = seat.playerId === winnerId;
      const balance = balances[index] ?? null;
      this.send(seat.playerId, {
        t: 'over',
        v: 1,
        winnerId,
        reason,
        rewards: won ? REWARD.win : REWARD.loss,
        ...(this.wager.wagered && balance !== null
          ? { wager: { stake: 50, prize: won ? 100 : 0, balance } }
          : {}),
        // The loser's reveal: the winner's board, now the match is settled.
        // Never to the winner, never to a bot, never before this frame.
        ...(!won && !seat.isBot && reveal ? { reveal } : {}),
      });
    }
    this.release();
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
  wager: RoomWagerInput = { wagered: false, holdA: null, holdB: null },
): Promise<Room> {
  const matchId = randomUUID();
  const room = new Room(matchId, mode, seed, [seatA, seatB], (finished) => {
    rooms.delete(finished.id);
    for (const seat of finished.seats) {
      if (roomIdForPlayer.get(seat.playerId) === finished.id) roomIdForPlayer.delete(seat.playerId);
    }
  }, wager);
  rooms.set(matchId, room);
  roomIdForPlayer.set(seatA.playerId, matchId);
  roomIdForPlayer.set(seatB.playerId, matchId);
  try {
    await room.start(fuelBudget);
    return room;
  } catch (error) {
    rooms.delete(matchId);
    if (roomIdForPlayer.get(seatA.playerId) === matchId) roomIdForPlayer.delete(seatA.playerId);
    if (roomIdForPlayer.get(seatB.playerId) === matchId) roomIdForPlayer.delete(seatB.playerId);
    throw error;
  }
}

export function findRoomForPlayer(playerId: string): Room | undefined {
  const matchId = roomIdForPlayer.get(playerId);
  return matchId ? rooms.get(matchId) : undefined;
}

export { BOT_PLAYER_ID, PROTOCOL_VERSION };

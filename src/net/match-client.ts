/**
 * The live match socket — P13. One connection for the whole app, held at
 * module level so it survives the route change from /searching to /battle.
 * searching.tsx opens it (`queue`), battle.tsx rides it, the result flow
 * calls `disconnect()`.
 *
 * Game state comes from here EXCLUSIVELY. The Supabase Realtime channel on
 * `match:{matchId}` (src/net/chat.ts) carries emotes only — nothing here
 * reads it, nothing there moves a ship. See CLAUDE.md > State.
 *
 * Every inbound frame passes through `decodeServerMessage()` (src/net/
 * protocol.ts). A frame that fails validation is logged and dropped; nothing
 * in this file throws past its own handler, and every promise is caught, so
 * the app never sees an unhandled rejection from the network.
 *
 * Sequence numbers. The wire's `seq` on `state`/`events` is the room's own
 * monotonic counter (server/src/room.ts `outSeq`), not an echo of the
 * client's action seq — the room dedupes retried actions server-side via
 * `seat.lastAppliedActionSeq` instead. The client mirrors that: it drops an
 * `events` batch at or below the last one applied and a `state` below the
 * last one applied (equal is allowed — `opponentDisconnected` can flip
 * without the seq moving). That is what protects against duplicate delivery,
 * which in practice means the overlap of a reconnect replay.
 *
 * Reconnect is a hard resync, not an animated replay. `attach()` on the
 * server replays the WHOLE event log since move one before sending a fresh
 * view — feeding fifty moves of HIT/MISS into the EventPlayer after a two
 * second blip would be absurd. So from `hello`+`resumeMatchId` until the
 * first `state` arrives, `events` batches are absorbed (seq bookkeeping
 * only) and the view then snaps to the authoritative snapshot. Only events
 * that arrive AFTER that are animated. docs/brief.md is silent on this; the
 * choice lives here.
 *
 * Liveness. Android will happily keep a dead socket "open" for a minute
 * after the radio drops, and the server's own heartbeat (30 s ping, two
 * misses) takes longer than its 45 s disconnect grace to notice. So while
 * in a match the client sends the protocol's `ping` every LIVENESS_PING_MS
 * and treats LIVENESS_DEAD_MS of silence — no frame of any kind — as a
 * dropped socket: close it and go through the normal reconnect. `nudge()`
 * (the screens call it when the app returns to the foreground) pings at
 * once and cuts any backoff wait short.
 */
import type { Coord, GameOverReason, MatchEvent, MatchMode, PlayerView } from '@engine/types';
import { create } from 'zustand';

import { isForcedOffline } from '@/state/demo';
import { usePoints } from '@/state/points';
import { randomUuid } from '@/util/uuid';
import { getAccessToken } from './api';
import {
  actionMessage,
  cancelQueueMessage,
  decodeServerMessage,
  encodeClientMessage,
  helloMessage,
  pingMessage,
  queueMessage,
  readyMessage,
  resignMessage,
  type ActionPayload,
  type ClientMessage,
  type ErrorCode,
  type LayoutPayload,
  type MatchRewards,
  type OpponentSummary,
  type ServerMessage,
} from './protocol';

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export type MatchClientStatus =
  | 'idle'
  /** Socket opening, or hello sent and not yet acknowledged. */
  | 'connecting'
  | 'queued'
  | 'cancelling'
  /** `matched` received; `ready` may or may not be acknowledged yet. */
  | 'matched'
  /** A live view is flowing. Placing or playing — see `view.phase`. */
  | 'active'
  /** Our socket dropped mid-match; the backoff loop is running. */
  | 'reconnecting'
  | 'over'
  /** Terminal until `retry()` or `disconnect()`. See `failure`. */
  | 'failed';

export type FailureReason =
  | 'no_ws_url'
  | 'forced_offline'
  | 'no_session'
  | 'unauthenticated'
  | 'unreachable'
  | 'match_gone'
  | 'rate_limited'
  | 'kicked'
  | 'insufficient_points'
  | 'match_cancelled'
  | 'layout_rejected'
  | 'already_searching'
  | 'server_error';

export interface MatchFailure {
  readonly reason: FailureReason;
  readonly detail: string;
}

/** A live match the server still holds for us, waiting on rejoin or resign. */
export interface ResumeOffer {
  readonly matchId: string;
  readonly opponentName: string;
  readonly wagered: boolean;
  readonly wagerStake: number;
}

export interface MatchOver {
  readonly winnerId: string;
  readonly reason: GameOverReason;
  readonly rewards: MatchRewards;
  readonly wager?: { stake: number; prize: number; balance: number };
}

interface MatchClientData {
  status: MatchClientStatus;
  failure: MatchFailure | null;
  /** Our id as the server verified it from the JWT — never from a message body. */
  playerId: string | null;
  matchId: string | null;
  mode: MatchMode | null;
  wagered: boolean;
  wagerStake: number;
  queueOpponent: 'player' | 'bot';
  wagerRequestId: string | null;
  you: OpponentSummary | null;
  opponent: OpponentSummary | null;
  fuelBudget: number;
  /** Epoch ms. The server auto-places for anyone who hasn't sent `ready` by then. */
  layoutDeadline: number | null;
  /** The last authoritative, masked view. Never MatchState. */
  view: PlayerView | null;
  opponentDisconnected: boolean;
  /** Epoch ms the opponent was flagged gone, for the "waiting 45 seconds" countdown. */
  opponentDroppedAt: number | null;
  /** Event batches received and not yet taken by the battle store. */
  pendingEvents: readonly MatchEvent[];
  /** Bumps once per batch appended to pendingEvents — subscribe on this, not on the array. */
  eventsNonce: number;
  turnPlayerId: string | null;
  /** Epoch ms, SERVER clock — informational; phone clocks drift. */
  turnEndsAt: number | null;
  /** Epoch ms, THIS clock, when the `turn` message landed — what the HUD counts from. */
  turnReceivedAt: number | null;
  queuePosition: number | null;
  onlineCount: number | null;
  over: MatchOver | null;
  /**
   * Set when the server attaches us to a match this session never entered —
   * the app was closed (or crashed) mid-game and the room is still open.
   * ResumeMatchPrompt turns it into a rejoin-or-resign choice.
   */
  resumeOffer: ResumeOffer | null;
  lastError: { code: ErrorCode; message: string } | null;
  /** Bumps on every server `error` — an illegal_action clears an optimistic shot. */
  errorNonce: number;
  reconnectAttempt: number;
  /** Epoch ms after which the server will have forfeited us, if we're still gone. */
  reconnectDeadline: number | null;
}

interface MatchClientActions {
  /** Open the socket, `hello`, then `queue` for `mode`. Idempotent while already queued. */
  queue: (
    mode: MatchMode,
    options?: { wagered?: boolean; opponent?: 'player' | 'bot' },
  ) => void;
  cancelQueue: () => Promise<void>;
  /** `ready` with the placed fleet. Re-sent automatically after a reconnect if it never landed. */
  /**
   * Quietly ask the server whether it still holds a match for us — the app was
   * closed mid-game, or crashed. Only runs from `idle`, never interrupts a
   * live flow, and stays silent when there is nothing to find.
   */
  discover: () => void;
  /** This session is taking the match onto the battle screen. Clears the offer. */
  enterMatch: () => void;
  /**
   * Give the offered match up: the opponent wins it immediately. False when
   * the socket was already gone, in which case the offer is left standing.
   */
  declineResume: () => boolean;
  ready: (layout: LayoutPayload) => void;
  /**
   * Refuse to play on a layout the engine has already rejected, rather than
   * sending it and letting the server's deadline auto-place a random fleet.
   */
  failLayout: (reason: string) => void;
  fire: (at: Coord) => void;
  useArsenal: (itemId: string, target: { at?: Coord; row?: number }) => void;
  resign: () => void;
  /** Drain pendingEvents. The battle store calls this once per eventsNonce. */
  takePendingEvents: () => readonly MatchEvent[];
  /**
   * The app came back to the foreground (or the network came back): probe
   * the socket now rather than waiting for the next ping, and if a reconnect
   * is scheduled, run it now rather than waiting out the backoff.
   */
  nudge: () => void;
  /** From `failed`: start over with whatever we were doing (queue or resume). */
  retry: () => void;
  /** Close the socket, forget the match, back to idle. Never reconnects after this. */
  disconnect: () => void;
}

export type MatchClientState = MatchClientData & MatchClientActions;

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Exponential backoff base steps, capped; jittered ±25 % so a fleet of phones doesn't stampede. */
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
/** Mirrors server/src/room.ts DISCONNECT_GRACE_MS — after this the room has forfeited us. */
export const DISCONNECT_GRACE_MS = 45_000;
/** A socket that hasn't opened by then is treated as a failed attempt. */
const OPEN_TIMEOUT_MS = 8_000;
/** hello+resume acknowledged but no `state` — the room is gone. */
const RESYNC_TIMEOUT_MS = 6_000;
/** Outside a match there is nothing to protect; stop trying after ~7.5 s (500+1000+2000+4000). */
const MAX_INITIAL_ATTEMPTS = 4;
/**
 * How long a discovery connect waits for a `matched` after `hello:ok`. The
 * room attaches synchronously inside the hello handler, so anything that has
 * not arrived by now does not exist.
 */
const DISCOVER_TIMEOUT_MS = 4_000;

/** In a match: a protocol `ping` this often, and this much silence means the socket is dead. */
const LIVENESS_PING_MS = 10_000;
const LIVENESS_DEAD_MS = 20_000;
/** After nudge(): how long the pong may take before the socket is declared dead. */
const NUDGE_DEAD_MS = 4_000;

/** Server-chosen close codes (server/src/ws.ts). None of these are worth a reconnect. */
const CLOSE_ILLEGAL = 4001;
const CLOSE_RATE_LIMITED = 4002;
const CLOSE_TOO_LARGE = 4003;
const CLOSE_UNAUTHENTICATED = 4401;

// ---------------------------------------------------------------------------
// Module-level transport state — not store state, nothing here is rendered
// ---------------------------------------------------------------------------

let socket: WebSocket | null = null;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let resyncTimer: ReturnType<typeof setTimeout> | null = null;
let livenessTimer: ReturnType<typeof setInterval> | null = null;
let deadTimer: ReturnType<typeof setTimeout> | null = null;
let cancelTimer: ReturnType<typeof setTimeout> | null = null;
let cancelResolve: (() => void) | null = null;
let cancelInFlight: Promise<void> | null = null;
let lastInboundAt = 0;
let outboundSeq = 0;
let lastStateSeq = -1;
let lastEventsSeq = -1;
let resyncing = false;
let authRetried = false;
/** What `hello:ok` should be followed by when we are NOT resuming a match. */
let intent: {
  mode: MatchMode;
  wagered: boolean;
  opponent: 'player' | 'bot';
  wagerRequestId: string | null;
} | null = null;
/** The layout we sent (or tried to send) — re-sent after a resync if it never landed. */
let lastLayout: LayoutPayload | null = null;
/**
 * A `ready` is out and the server has not confirmed it. While this is true an
 * `illegal_action` can only be about our layout — which cannot be read off
 * `status` instead, because the OPPONENT's accepted layout broadcasts a state
 * that moves us to `active` before our own rejection arrives.
 */
let layoutPending = false;
/** disconnect() was called — every close from here on is expected and final. */
let closedOnPurpose = false;
/** Set when we lose the socket mid-match; cleared on resync. */
let disconnectedAt: number | null = null;
/**
 * The match this app session has actually opened the battle screen for. A
 * `matched` for anything else is a match we walked away from and the server
 * still has — an offer to rejoin, not a match to drop the player into.
 */
let enteredMatchId: string | null = null;
/** A quiet connect that exists only to ask "do I still have a match?". */
let discovering = false;
let discoverTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * This intent's queue messages sent, and whether the server ever answered
 * one with `queued`. An `already_queued` on the very first send, before any
 * `queued`, cannot be our own survivor of a blip: another device signed in
 * to this account holds the place in line.
 */
let queueSends = 0;
let queueAcked = false;

const EMPTY: MatchClientData = {
  status: 'idle',
  failure: null,
  playerId: null,
  matchId: null,
  mode: null,
  wagered: false,
  wagerStake: 0,
  queueOpponent: 'player',
  wagerRequestId: null,
  you: null,
  opponent: null,
  fuelBudget: 0,
  layoutDeadline: null,
  view: null,
  opponentDisconnected: false,
  opponentDroppedAt: null,
  pendingEvents: [],
  eventsNonce: 0,
  turnPlayerId: null,
  turnEndsAt: null,
  turnReceivedAt: null,
  queuePosition: null,
  onlineCount: null,
  over: null,
  resumeOffer: null,
  lastError: null,
  errorNonce: 0,
  reconnectAttempt: 0,
  reconnectDeadline: null,
};

function wsUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_WS_URL?.trim() ?? '';
  return url.length > 0 ? url : null;
}

function log(message: string, ...rest: unknown[]): void {
  console.log(`[match] ${message}`, ...rest);
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer) clearTimeout(timer);
  return null;
}

function clearAllTimers(): void {
  openTimer = clearTimer(openTimer);
  reconnectTimer = clearTimer(reconnectTimer);
  resyncTimer = clearTimer(resyncTimer);
  deadTimer = clearTimer(deadTimer);
  stopLiveness();
}

function settlePendingCancellation(): void {
  cancelTimer = clearTimer(cancelTimer);
  const resolve = cancelResolve;
  cancelResolve = null;
  cancelInFlight = null;
  resolve?.();
}

function stopLiveness(): void {
  if (livenessTimer) clearInterval(livenessTimer);
  livenessTimer = null;
}

/** Runs for the life of one socket; a dead one is closed and handed to the reconnect path. */
function startLiveness(): void {
  stopLiveness();
  lastInboundAt = Date.now();
  livenessTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastInboundAt > LIVENESS_DEAD_MS) {
      declareDead('no frame in 20s');
      return;
    }
    if (useMatchClient.getState().matchId) send(pingMessage());
  }, LIVENESS_PING_MS);
}

/** Close a socket we no longer trust, and let onclose's reconnect logic take it from there. */
function declareDead(why: string): void {
  const s = socket;
  if (!s) return;
  log(`socket declared dead: ${why}`);
  socket = null;
  stopLiveness();
  deadTimer = clearTimer(deadTimer);
  s.onopen = null;
  s.onmessage = null;
  s.onerror = null;
  s.onclose = null;
  try {
    s.close();
  } catch {
    /* already gone */
  }
  if (!closedOnPurpose) scheduleReconnect(why);
}

function send(message: ClientMessage): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(encodeClientMessage(message));
    return true;
  } catch (error) {
    console.warn('[match] send failed', error);
    return false;
  }
}

function fail(reason: FailureReason, detail: string): void {
  settlePendingCancellation();
  clearAllTimers();
  dropSocket();
  // Discovery is a background question nobody asked out loud. If it cannot be
  // answered — no session yet, server down, offline — the answer is simply
  // "no match", and the app carries on. A visible failure here would ambush a
  // player who was only opening the menu.
  if (discovering && !useMatchClient.getState().matchId) {
    log(`discovery gave up: ${reason} — ${detail}`);
    endDiscovery();
    useMatchClient.setState({ ...EMPTY });
    return;
  }
  log(`failed: ${reason} — ${detail}`);
  useMatchClient.setState({ status: 'failed', failure: { reason, detail }, reconnectDeadline: null });
}

function endDiscovery(): void {
  discovering = false;
  discoverTimer = clearTimer(discoverTimer);
}

/** Detach handlers and close, without triggering the reconnect path. */
function dropSocket(): void {
  const s = socket;
  socket = null;
  stopLiveness();
  deadTimer = clearTimer(deadTimer);
  if (!s) return;
  s.onopen = null;
  s.onmessage = null;
  s.onerror = null;
  s.onclose = null;
  try {
    if (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING) s.close();
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

async function connect(): Promise<void> {
  const url = wsUrl();
  if (!url) {
    fail('no_ws_url', 'EXPO_PUBLIC_WS_URL is not set. Copy .env.example to .env and fill it in.');
    return;
  }
  if (isForcedOffline()) {
    fail('forced_offline', 'The demo menu has hard offline on; no socket is opened.');
    return;
  }

  const token = await getAccessToken();
  if (!token.ok) {
    // No session at all, and nothing to protect: that's final. Anything else
    // (a refresh that couldn't reach Supabase in airplane mode, say) is the
    // same transient as a socket that won't open — retry on the backoff.
    if (token.error.code === 'unauthenticated' && !useMatchClient.getState().matchId) {
      fail('no_session', `No signed-in session to present to the match server (${token.error.message}).`);
      return;
    }
    scheduleReconnect(`no access token (${token.error.code})`);
    return;
  }
  // A retry/disconnect may have raced the token fetch.
  if (closedOnPurpose) return;

  dropSocket();
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (error) {
    scheduleReconnect(`could not open a socket to ${url}: ${String(error)}`);
    return;
  }
  socket = ws;
  const resumeMatchId = useMatchClient.getState().matchId ?? undefined;

  openTimer = clearTimer(openTimer);
  openTimer = setTimeout(() => {
    if (socket !== ws) return;
    log('open timed out');
    dropSocket();
    scheduleReconnect('the server did not answer in time');
  }, OPEN_TIMEOUT_MS);

  ws.onopen = () => {
    if (socket !== ws) return;
    openTimer = clearTimer(openTimer);
    startLiveness();
    resyncing = resumeMatchId !== undefined;
    if (resyncing) {
      resyncTimer = clearTimer(resyncTimer);
      resyncTimer = setTimeout(() => {
        if (!resyncing) return;
        fail('match_gone', 'The server no longer has this match. Its 45-second grace ran out while we were away.');
      }, RESYNC_TIMEOUT_MS);
    }
    send(helloMessage(token.value, resumeMatchId));
  };

  ws.onmessage = (event) => {
    if (socket !== ws) return;
    lastInboundAt = Date.now();
    deadTimer = clearTimer(deadTimer);
    const decoded = decodeServerMessage(event.data);
    if (!decoded.ok) {
      console.warn('[match] dropped an inbound message that failed validation:', decoded.error);
      return;
    }
    try {
      handleMessage(decoded.message);
    } catch (error) {
      // A bug in a handler must never take the socket down with it.
      console.warn('[match] handler threw; message ignored', error);
    }
  };

  ws.onerror = () => {
    // onclose follows with the real story; nothing to do here.
  };

  ws.onclose = (event) => {
    if (socket !== ws) return;
    socket = null;
    openTimer = clearTimer(openTimer);
    stopLiveness();
    deadTimer = clearTimer(deadTimer);
    const code = typeof event.code === 'number' ? event.code : 0;
    log(`closed code=${code} reason=${typeof event.reason === 'string' ? event.reason : ''}`);

    if (closedOnPurpose) return;
    const s = useMatchClient.getState();
    if (s.status === 'over' || s.status === 'failed' || s.status === 'idle') return;

    // The server refunds a queued wager when its socket closes. A reconnect
    // is therefore a fresh reservation and must use a fresh idempotency key.
    if (!s.matchId && intent?.wagered) {
      const wagerRequestId = randomUuid();
      intent = { ...intent, wagerRequestId };
      useMatchClient.setState({ wagerRequestId });
    }

    if (code === CLOSE_UNAUTHENTICATED) {
      if (!authRetried) {
        // Supabase refreshes an expired token on getSession(); one more try with a fresh one.
        authRetried = true;
        scheduleReconnect('token rejected; refreshing');
        return;
      }
      fail('unauthenticated', 'The match server rejected this sign-in twice. Restart the app to sign in again.');
      return;
    }
    if (code === CLOSE_RATE_LIMITED) {
      fail('rate_limited', 'The server closed the connection for sending too fast.');
      return;
    }
    if (code === CLOSE_ILLEGAL || code === CLOSE_TOO_LARGE) {
      fail('kicked', 'The server closed the connection after rejecting what this app sent.');
      return;
    }
    scheduleReconnect(`connection lost (code ${code})`);
  };
}

function scheduleReconnect(why: string): void {
  if (closedOnPurpose) return;
  const s = useMatchClient.getState();
  if (s.status === 'over' || s.status === 'failed') return;

  // Discovery (the launch-time "is there a match to resume?") has nothing to
  // protect and nobody waiting on it, so a transient there — a token refresh
  // that failed, a socket that would not open — is simply "no match". Retrying
  // it used to leave the store 'connecting' with no queue behind it: the
  // discovery timer only tears down an idle store, and the player's queue()
  // then took the busy store for a screen re-mount and never queued.
  if (discovering && !s.matchId && !intent) {
    fail('unreachable', why);
    return;
  }

  const inMatch = s.matchId !== null;
  if (inMatch && disconnectedAt === null) {
    disconnectedAt = Date.now();
    useMatchClient.setState({ reconnectDeadline: disconnectedAt + DISCONNECT_GRACE_MS });
  }
  if (inMatch && disconnectedAt !== null && Date.now() - disconnectedAt > DISCONNECT_GRACE_MS) {
    fail('unreachable', "Couldn't raise the server inside 45 seconds. The match was forfeited.");
    return;
  }

  const attempt = s.reconnectAttempt;
  if (!inMatch && attempt >= MAX_INITIAL_ATTEMPTS) {
    fail('unreachable', `Couldn't reach the match server after ${attempt} tries.`);
    return;
  }
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] as number;
  const delay = Math.round(base * (0.75 + Math.random() * 0.5));
  log(`${why}; reconnecting in ${delay}ms (attempt ${attempt + 1})`);

  useMatchClient.setState({
    status: inMatch || s.status === 'queued' || s.status === 'matched' ? 'reconnecting' : 'connecting',
    reconnectAttempt: attempt + 1,
  });

  reconnectTimer = clearTimer(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect().catch((error: unknown) => {
      console.warn('[match] connect threw', error);
      scheduleReconnect('connect threw');
    });
  }, delay);
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

function handleMessage(message: ServerMessage): void {
  const set = useMatchClient.setState;
  const s = useMatchClient.getState();

  switch (message.t) {
    case 'hello:ok': {
      authRetried = false;
      set({ playerId: message.playerId, reconnectAttempt: 0 });
      if (resyncing) {
        // The room replays its log and sends a fresh `state`; that's the resync.
        return;
      }
      if (s.matchId) {
        // We reconnected but weren't told to resume (a matchId with no socket in
        // the room) — the server attaches by player id anyway. Treat as resync.
        resyncing = true;
        return;
      }
      if (intent) {
        set({ status: 'connecting' });
        queueSends += 1;
        send(
          queueMessage(
            intent.mode,
            intent.wagered,
            intent.opponent,
            intent.wagerRequestId ?? undefined,
          ),
        );
      }
      return;
    }

    case 'queued':
      queueAcked = true;
      if (message.pointBalance !== undefined) usePoints.getState().sync(message.pointBalance);
      set({
        status: s.status === 'cancelling' ? 'cancelling' : 'queued',
        queuePosition: message.position,
        onlineCount: message.onlineCount,
      });
      return;

    case 'queue:cancelled': {
      if (message.pointBalance !== undefined) usePoints.getState().sync(message.pointBalance);
      const cancelledByOpponent = message.reason === 'opponent_cancelled';
      closedOnPurpose = true;
      clearAllTimers();
      dropSocket();
      intent = null;
      lastLayout = null;
      layoutPending = false;
      resyncing = false;
      disconnectedAt = null;
      outboundSeq = 0;
      lastStateSeq = -1;
      lastEventsSeq = -1;
      set(
        cancelledByOpponent
          ? {
              ...EMPTY,
              status: 'failed',
              failure: {
                reason: 'match_cancelled',
                detail: 'The other captain cancelled before the battle began. Your wager was refunded.',
              },
            }
          : { ...EMPTY },
      );
      settlePendingCancellation();
      return;
    }

    case 'matched': {
      if (s.status === 'cancelling') {
        set({
          status: 'cancelling',
          matchId: message.matchId,
          mode: message.mode,
          you: message.you,
          opponent: message.opponent,
          fuelBudget: message.fuelBudget,
          layoutDeadline: message.layoutDeadline,
          wagered: message.wagered,
          wagerStake: message.wagerStake,
          queuePosition: null,
        });
        return;
      }
      const resumed = message.matchId === s.matchId || s.status !== 'queued';
      if (resumed) {
        // The server attached us to a match already in progress — the normal
        // resume, or an app that was killed and reopened with an empty store.
        // The replay that follows is absorbed; the `state` after it is truth.
        resyncing = true;
        intent = null;
        discovering = false;
        discoverTimer = clearTimer(discoverTimer);
        outboundSeq = Math.max(outboundSeq, Date.now());
        set({
          status: s.matchId === message.matchId ? s.status : 'reconnecting',
          matchId: message.matchId,
          mode: message.mode,
          you: message.you,
          opponent: message.opponent,
          fuelBudget: message.fuelBudget,
          layoutDeadline: message.layoutDeadline,
          wagered: message.wagered,
          wagerStake: message.wagerStake,
          queuePosition: null,
          // A match this session never opened the battle screen for: the
          // player chooses whether to go back to it. The socket stays attached
          // either way, so the room is not forfeited while they decide.
          ...(enteredMatchId === message.matchId
            ? {}
            : {
                resumeOffer: {
                  matchId: message.matchId,
                  opponentName: message.opponent.name,
                  wagered: message.wagered,
                  wagerStake: message.wagerStake,
                },
              }),
        });
        return;
      }
      // Action seqs only need to rise monotonically per seat, across an app
      // restart too — wall-clock ms does that without any stored counter.
      outboundSeq = Date.now();
      lastStateSeq = -1;
      lastEventsSeq = -1;
      lastLayout = null;
      layoutPending = false;
      intent = null;
      set({
        status: 'matched',
        matchId: message.matchId,
        mode: message.mode,
        you: message.you,
        opponent: message.opponent,
        fuelBudget: message.fuelBudget,
        layoutDeadline: message.layoutDeadline,
        wagered: message.wagered,
        wagerStake: message.wagerStake,
        view: null,
        opponentDisconnected: false,
        opponentDroppedAt: null,
        pendingEvents: [],
        turnPlayerId: null,
        turnEndsAt: null,
        turnReceivedAt: null,
        over: null,
        queuePosition: null,
      });
      return;
    }

    case 'state': {
      if (message.seq < lastStateSeq) return; // stale
      lastStateSeq = message.seq;
      const gone = message.opponentDisconnected === true;
      // The server has our board: nothing after this can be a layout refusal.
      if (message.view.you.ready) layoutPending = false;
      const patch: Partial<MatchClientData> = {
        view: message.view,
        opponentDisconnected: gone,
        opponentDroppedAt: gone ? (s.opponentDroppedAt ?? Date.now()) : null,
      };
      if (resyncing) {
        resyncing = false;
        resyncTimer = clearTimer(resyncTimer);
        disconnectedAt = null;
        patch.status = 'active';
        patch.reconnectDeadline = null;
        patch.reconnectAttempt = 0;
        set(patch);
        // Our `ready` may have died with the old socket.
        if (message.view.phase === 'placing' && !message.view.you.ready && lastLayout) {
          log('resynced into placing without an accepted layout — resending ready');
          send(readyMessage(lastLayout));
        }
        return;
      }
      if (s.status === 'matched' || s.status === 'connecting' || s.status === 'reconnecting') {
        patch.status = 'active';
      }
      set(patch);
      return;
    }

    case 'events': {
      if (message.seq <= lastEventsSeq) return; // duplicate / replay overlap
      lastEventsSeq = message.seq;
      if (resyncing) return; // absorbed — the view that follows is the truth
      set({
        pendingEvents: [...s.pendingEvents, ...message.events],
        eventsNonce: s.eventsNonce + 1,
      });
      return;
    }

    case 'turn':
      set({ turnPlayerId: message.playerId, turnEndsAt: message.endsAt, turnReceivedAt: Date.now() });
      return;

    case 'over':
      if (message.wager) usePoints.getState().sync(message.wager.balance);
      closedOnPurpose = true;
      discovering = false;
      discoverTimer = clearTimer(discoverTimer);
      clearAllTimers();
      set({
        status: 'over',
        // The match ended while the rejoin prompt was up (our grace ran out,
        // or the opponent resigned). There is nothing left to rejoin.
        resumeOffer: null,
        over: {
          winnerId: message.winnerId,
          reason: message.reason,
          rewards: message.rewards,
          ...(message.wager ? { wager: message.wager } : {}),
        },
        turnEndsAt: null,
        opponentDisconnected: false,
        reconnectDeadline: null,
      });
      // Nothing more will come; let the room's socket go.
      dropSocket();
      return;

    case 'error': {
      log(`server error ${message.code}: ${message.message}`);
      set({ lastError: { code: message.code, message: message.message }, errorNonce: s.errorNonce + 1 });
      if (message.code === 'insufficient_points') {
        set({
          status: 'failed',
          failure: { reason: 'insufficient_points', detail: message.message },
        });
        return;
      }
      // An illegal action with a layout in flight can only be that layout.
      // Left alone, the server's 90 s deadline would auto-place a random fleet
      // and the player would walk into a board they never arranged — so say so
      // instead. In-match rejections stay non-fatal: the battle store just
      // unlocks input (see onOnlineError).
      if (message.code === 'illegal_action' && layoutPending) {
        layoutPending = false;
        set({
          status: 'failed',
          failure: { reason: 'layout_rejected', detail: message.message },
        });
        return;
      }
      if (message.code === 'already_queued' && s.status === 'connecting') {
        if (queueSends <= 1 && !queueAcked) {
          // Our first ask, never answered with `queued`: the place in line is
          // another device's on this same account. Staying "queued" here span
          // forever while that device was handed a bot 45 s later.
          fail(
            'already_searching',
            'This account is already looking for a match on another device.',
          );
          return;
        }
        // Our earlier queue survived a blip; we're still in line.
        set({ status: 'queued' });
        return;
      }
      // Before the match is live there is no screen that can absorb an error:
      // the searching screen would spin on a queue the server has already
      // given up on (a failed room build, a wager the database refused). Say
      // so instead. In-match errors stay non-fatal.
      if (
        (s.status === 'connecting' || s.status === 'queued' || s.status === 'matched') &&
        (message.code === 'internal' ||
          message.code === 'not_in_room' ||
          message.code === 'bad_message')
      ) {
        set({ status: 'failed', failure: { reason: 'server_error', detail: message.message } });
      }
      return;
    }

    case 'pong':
      return;
  }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export const useMatchClient = create<MatchClientState>((set, get) => ({
  ...EMPTY,

  queue: (mode, options) => {
    const s = get();
    const wagered = options?.wagered ?? false;
    const opponent = options?.opponent ?? 'player';
    if (
      s.status === 'queued' &&
      s.mode === mode &&
      s.wagered === wagered &&
      s.queueOpponent === opponent
    ) return;
    if (s.status !== 'idle' && s.status !== 'failed' && s.status !== 'over') {
      // Busy with something the player asked for — a queue or a match in
      // flight: a second queue() is a screen re-mount, not a new intent.
      if (intent || s.matchId) return;
      // Busy with nothing: what is left of a background discovery. The player
      // is asking to play now, so it goes and this queue takes its place.
      log('queue() replaces a leftover discovery connection');
      closedOnPurpose = true;
      clearAllTimers();
      dropSocket();
    }
    // A discovery socket may be open and its timer pending; that timer tears
    // the socket down and resets the store, which would cancel this queue.
    endDiscovery();
    closedOnPurpose = false;
    authRetried = false;
    disconnectedAt = null;
    const wagerRequestId = wagered ? randomUuid() : null;
    intent = { mode, wagered, opponent, wagerRequestId };
    queueSends = 0;
    queueAcked = false;
    lastLayout = null;
    layoutPending = false;
    set({
      ...EMPTY,
      status: 'connecting',
      mode,
      wagered,
      queueOpponent: opponent,
      wagerRequestId,
    });
    void connect().catch((error: unknown) => {
      console.warn('[match] connect threw', error);
      scheduleReconnect('connect threw');
    });
  },

  cancelQueue: () => {
    if (cancelInFlight) return cancelInFlight;
    const s = get();
    if (s.status === 'idle') return Promise.resolve();

    closedOnPurpose = true;
    set({ status: 'cancelling' });
    if (!send(cancelQueueMessage())) {
      get().disconnect();
      return Promise.resolve();
    }

    cancelInFlight = new Promise<void>((resolve) => {
      cancelResolve = resolve;
      cancelTimer = setTimeout(() => {
        // Closing the socket makes the server's ordered close cleanup refund
        // the queue. The HTTP confirmation on the screen then reads it back.
        useMatchClient.getState().disconnect();
      }, 4_000);
    });
    return cancelInFlight;
  },

  discover: () => {
    const s = useMatchClient.getState();
    // Anything other than a cold store means this session already owns the
    // socket's lifecycle — queueing, playing, reconnecting, or done.
    if (s.status !== 'idle' || s.resumeOffer || intent || socket || discovering) return;
    if (!wsUrl() || isForcedOffline()) return;

    discovering = true;
    closedOnPurpose = false;
    discoverTimer = clearTimer(discoverTimer);
    discoverTimer = setTimeout(() => {
      // hello:ok came back with no `matched` behind it: no match is waiting.
      if (!discovering) return;
      const now = useMatchClient.getState();
      // queue() may have claimed this socket while we were waiting. Tearing it
      // down here would kill the matchmaking the player actually asked for.
      if (now.matchId || now.status !== 'idle') return;
      log('no match waiting to be resumed');
      endDiscovery();
      closedOnPurpose = true;
      clearAllTimers();
      dropSocket();
      useMatchClient.setState({ ...EMPTY });
    }, DISCOVER_TIMEOUT_MS);
    void connect();
  },

  enterMatch: () => {
    enteredMatchId = useMatchClient.getState().matchId;
    endDiscovery();
    useMatchClient.setState({ resumeOffer: null });
  },

  declineResume: () => {
    const offer = useMatchClient.getState().resumeOffer;
    endDiscovery();
    useMatchClient.setState({ resumeOffer: null });
    if (send(resignMessage())) return true;
    // The socket died between raising the offer and the tap. Put the choice
    // back rather than leaving the player staring at "Resigning…".
    useMatchClient.setState({ resumeOffer: offer });
    return false;
  },

  ready: (layout) => {
    lastLayout = layout;
    layoutPending = true;
    if (!send(readyMessage(layout))) log('ready queued until the socket is back');
  },

  failLayout: (reason) => {
    layoutPending = false;
    useMatchClient.setState({
      status: 'failed',
      failure: { reason: 'layout_rejected', detail: reason },
      reconnectDeadline: null,
    });
  },

  fire: (at) => {
    const action: ActionPayload = { type: 'FIRE', at };
    send(actionMessage(outboundSeq++, action));
  },

  useArsenal: (itemId, target) => {
    const action: ActionPayload = { type: 'USE_ARSENAL', itemId, ...target };
    send(actionMessage(outboundSeq++, action));
  },

  resign: () => {
    send(resignMessage());
  },

  takePendingEvents: () => {
    const events = get().pendingEvents;
    if (events.length > 0) set({ pendingEvents: [] });
    return events;
  },

  nudge: () => {
    if (closedOnPurpose) return;
    const s = get();
    if (s.status === 'idle' || s.status === 'over' || s.status === 'failed') return;
    if (reconnectTimer) {
      // Don't wait out the backoff — the network is probably back.
      reconnectTimer = clearTimer(reconnectTimer);
      log('nudged: reconnecting now');
      void connect().catch((error: unknown) => {
        console.warn('[match] connect threw', error);
        scheduleReconnect('connect threw');
      });
      return;
    }
    if (socket && socket.readyState === WebSocket.OPEN && !deadTimer) {
      send(pingMessage());
      deadTimer = setTimeout(() => {
        deadTimer = null;
        declareDead('no pong after a nudge');
      }, NUDGE_DEAD_MS);
    }
  },

  retry: () => {
    const s = get();
    if (s.status !== 'failed') return;
    closedOnPurpose = false;
    authRetried = false;
    disconnectedAt = null;
    if (s.matchId) {
      set({ status: 'reconnecting', failure: null, reconnectAttempt: 0, reconnectDeadline: null });
    } else if (s.mode) {
      intent = {
        mode: s.mode,
        wagered: s.wagered,
        opponent: s.queueOpponent,
        wagerRequestId: s.wagerRequestId,
      };
      queueSends = 0;
      queueAcked = false;
      set({ status: 'connecting', failure: null, reconnectAttempt: 0 });
    } else {
      set({ ...EMPTY });
      return;
    }
    void connect().catch((error: unknown) => {
      console.warn('[match] connect threw', error);
      scheduleReconnect('connect threw');
    });
  },

  disconnect: () => {
    settlePendingCancellation();
    closedOnPurpose = true;
    clearAllTimers();
    dropSocket();
    intent = null;
    lastLayout = null;
    layoutPending = false;
    resyncing = false;
    disconnectedAt = null;
    outboundSeq = 0;
    lastStateSeq = -1;
    lastEventsSeq = -1;
    set({ ...EMPTY });
  },
}));

/** Copy for the connection UI. Plain, specific, never "something went wrong". */
export function failureCopy(failure: MatchFailure): string {
  switch (failure.reason) {
    case 'no_ws_url':
      return 'This build has no match server address. Set EXPO_PUBLIC_WS_URL in .env and restart Metro.';
    case 'no_session':
      return "You're not signed in, so the match server can't tell who you are. Restart the app to sign in.";
    case 'forced_offline':
      return 'Hard offline is on (five taps on the version number turns it off). Play offline instead.';
    case 'unauthenticated':
      return 'The match server rejected this sign-in. Restart the app to sign in again.';
    case 'unreachable':
      return "Couldn't reach the match server for 45 seconds. If a match was on, it counted as a loss.";
    case 'match_gone':
      return 'The match ended while you were away. The 45-second grace period ran out.';
    case 'rate_limited':
      return 'The server cut the connection for sending too many messages too fast.';
    case 'kicked':
      return 'The server cut the connection after rejecting what this app sent.';
    case 'server_error':
      return failure.detail;
    case 'insufficient_points':
      return 'You need 50 points for this wager. Open the Points exchange to top up.';
    case 'match_cancelled':
      return failure.detail;
    case 'layout_rejected':
      return `The server would not accept your fleet: ${failure.detail}. Go back and arrange it again.`;
    case 'already_searching':
      return 'This account is already searching on another device. To play two phones against each other, sign in with a different account on each.';
  }
}

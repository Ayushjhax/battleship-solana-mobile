/**
 * FIFO matchmaking with separate normal/wager pools. Wager stakes are held
 * in Postgres before a player enters a queue and refunded atomically if they
 * leave before a room is created. After 40 seconds without a human opponent
 * the authoritative fallback leaves the queue, releases the online stake and
 * seats the player against the existing bot in an UNWAGERED Room — so a bot
 * fallback can never inherit an online wager or collect the online platform
 * fee. (An explicitly requested `opponent: 'bot'` queue still uses the same
 * authoritative Room as online play, so an offline client cannot claim a
 * fabricated win.)
 */
import type { WebSocket } from 'ws';

import type { MatchMode } from '@engine/types';
import type { SeaId } from '@engine/terrain';
import { FUEL_BUDGET } from '@engine/types';

import {
  BOT_PLAYER_ID,
  fetchOpponentSummary,
  refundPointWager,
  reservePointWager,
} from './db';
import { envMs } from './env';
import { isEnabled } from './features';
import { encode, type ServerMessage } from './protocol';
import { createRoom, findRoomForPlayer, rooms } from './room';
import { currentSeasonSea } from './seas';

const RANK_WINDOW_START = 150;
const RANK_WINDOW_STEP = 150;
const RANK_WINDOW_STEP_MS = envMs('SEABATTLE_RANK_WINDOW_STEP_MS', 5_000);
const RANK_WINDOW_UNCAPPED_MS = envMs('SEABATTLE_RANK_WINDOW_UNCAPPED_MS', 30_000);
/**
 * How long a successfully queued player waits for a human before the
 * authoritative fallback seats them against the existing bot. The env var
 * keeps its historical name so deployments can still shrink it; the default
 * is the product's 40 seconds.
 */
const BOT_FALLBACK_MS = envMs('SEABATTLE_BOT_AFTER_MS', 40_000);
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

/**
 * The queues are mutated IN PLACE, never reassigned. `tryPair` holds a
 * reference across an await while it builds a room, and swapping the array out
 * from under it would let a player who had already left be paired anyway — and
 * would lose the pairing's own removals.
 */
const queues: Record<QueueKey, Waiting[]> = {
  'classic:normal': [],
  'classic:wager': [],
  'advanced:normal': [],
  'advanced:wager': [],
};
const queueKeys = Object.keys(queues) as QueueKey[];
let sweepTimer: NodeJS.Timeout | null = null;
const pendingDequeues = new Map<string, Promise<QueueCancellation>>();
/**
 * One pairing pass per queue at a time. Every mutation inside a pass is
 * synchronous, but the room build is not, and a second pass starting during
 * that await would scan a queue whose players are already being seated.
 */
const pairing = new Set<QueueKey>();
/** Queues that gained a player while a pass was running. */
const rescan = new Set<QueueKey>();
/**
 * Players with an enqueue in flight. `enqueue` awaits the wager hold and the
 * profile lookup before it pushes, and two sockets for the same account (a
 * second device, or a reconnect racing the old socket's cleanup) could both
 * clear the "already queued" check inside that window and be seated twice.
 */
const joining = new Set<string>();

/** Removes every entry for a player from one queue, in place. Returns them. */
function removeFrom(key: QueueKey, playerId: string): Waiting[] {
  const queue = queues[key];
  const removed: Waiting[] = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i]?.playerId === playerId) removed.push(...queue.splice(i, 1));
  }
  return removed;
}

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
  if (waitingFor(playerId) || joining.has(playerId)) {
    send(socket, { t: 'error', v: 1, code: 'already_queued', message: 'already queued' });
    return;
  }

  joining.add(playerId);
  try {
    await enqueueVerified(mode, playerId, socket, options);
  } finally {
    joining.delete(playerId);
  }
}

async function enqueueVerified(
  mode: MatchMode,
  playerId: string,
  socket: WebSocket,
  options: {
    wagered: boolean;
    opponent: 'player' | 'bot';
    wagerRequestId?: string;
  },
): Promise<void> {
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

  // The player can leave during the reservation and the profile read above.
  // The socket's own close handler already ran `dequeue` and found nothing, so
  // queueing a dead socket here would strand the entry — and the stake with it.
  if (socket.readyState !== socket.OPEN) {
    await refundEntries(entry);
    return;
  }

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
    // The client may render this countdown; the deadline itself is this
    // entry's `since` and is enforced here, so a remount or a reconnect can
    // never move it.
    fallbackInMs: Math.max(0, BOT_FALLBACK_MS - (Date.now() - entry.since)),
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
    for (const key of queueKeys) removedEntries.push(...removeFrom(key, playerId));

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

/**
 * Seats everyone it can from one queue, best rank match first.
 *
 * Non-reentrant per queue, and each pairing removes BOTH entries from the
 * array synchronously before any await. Together those two rules are what let
 * ten players hit `queue` in the same tick and come out as five matches: no
 * entry can be handed to two pairings, and an odd player is simply left in
 * line rather than double-booked.
 */
async function tryPair(key: QueueKey): Promise<void> {
  if (pairing.has(key)) {
    // A pass is mid-flight and may already have scanned past this queue's new
    // arrival. Ask it to go round again rather than leaving them for the sweep.
    rescan.add(key);
    return;
  }
  pairing.add(key);
  try {
    do {
      rescan.delete(key);
      await pairPass(key);
    } while (rescan.has(key));
  } finally {
    pairing.delete(key);
  }
}

async function pairPass(key: QueueKey): Promise<void> {
  const queue = queues[key];
  const mode: MatchMode = key.startsWith('classic') ? 'classic' : 'advanced';

  // Each iteration seats at most one pair and then rescans, because building
  // the room awaits and the queue may have changed underneath.
  for (;;) {
    const now = Date.now();
    let foundA = -1;
    let foundB = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < queue.length && foundA === -1; i++) {
      const a = queue[i];
      if (!a) continue;
      for (let j = i + 1; j < queue.length; j++) {
        const b = queue[j];
        // A player must never be matched with themselves. Two live entries for
        // one account should be impossible (see `joining`), but seating one
        // against itself would corrupt a whole match, so it is checked here too.
        if (!b || b.playerId === a.playerId) continue;
        const window = Math.max(rankWindow(now - a.since), rankWindow(now - b.since));
        const diff = Math.abs(a.rankPoints - b.rankPoints);
        if (diff <= window && diff < bestDiff) {
          bestDiff = diff;
          foundA = i;
          foundB = j;
        }
      }
    }

    if (foundA !== -1 && foundB !== -1) {
      const a = queue[foundA] as Waiting;
      const b = queue[foundB] as Waiting;
      // Highest index first so the lower one does not shift.
      queue.splice(foundB, 1);
      queue.splice(foundA, 1);
      await pair(mode, a, b);
      continue;
    }

    const stale = queue.findIndex((entry) => now - entry.since >= BOT_FALLBACK_MS);
    if (stale === -1) return;
    const entry = queue[stale] as Waiting;
    queue.splice(stale, 1);
    // A deferred fallback (the stake could not be released yet) is put back
    // and the next sweep retries; looping here would hammer the database.
    if (!(await pairWithBotFallback(mode, entry))) return;
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
      rankedSea(),
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
      rankedSea(),
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

/**
 * The 40-second fallback: leave the queue and seat the waiting player against
 * the existing bot, as an UNWAGERED match.
 *
 * The online stake is released first — a bot fallback is offline-style play
 * and must never inherit a real-money/points wager, nor can it collect the
 * online platform fee (the match is is_bot, and 0025 fees human-vs-human
 * only). If the release cannot be confirmed the entry goes back in line and
 * the next sweep retries, so a bot match can never start while an online hold
 * is still live.
 *
 * Returns false when the fallback was deferred and the caller must stop its
 * pass (the entry is queued again); true once it is terminal either way.
 */
async function pairWithBotFallback(mode: MatchMode, human: Waiting): Promise<boolean> {
  if (human.wagerRequestId && !(await releaseWager(human))) {
    queues[keyFor(mode, human.wagered)].unshift(human);
    console.error(
      `[matchmaker] bot fallback deferred for ${human.playerId}: the wager hold could not be released`,
    );
    return false;
  }
  try {
    await createRoom(
      mode,
      randomSeed(),
      { playerId: human.playerId, socket: human.socket, isBot: false },
      { playerId: BOT_PLAYER_ID, socket: null, isBot: true },
      FUEL_BUDGET,
      // No online entry point rides into bot play. An offline-style bot
      // wager is opt-in from the placement screen, never inherited here.
      { wagered: false, holdA: null, holdB: null },
      rankedSea(),
    );
  } catch (error) {
    send(human.socket, {
      t: 'error',
      v: 1,
      code: 'internal',
      message: error instanceof Error ? error.message : 'could not create bot match',
    });
  }
  return true;
}

/** Refund one queued entry's hold. True when there is nothing left to refund. */
async function releaseWager(entry: Waiting): Promise<boolean> {
  if (!entry.wagerRequestId) return true;
  try {
    await refundPointWager(entry.playerId, entry.wagerRequestId);
    return true;
  } catch (error) {
    console.error(`[matchmaker] wager refund failed for ${entry.playerId}`, error);
    return false;
  }
}

/**
 * Part 10B — ranked picks ONE sea for both players, from the season. The
 * Lighthouse never changes this: that is the integrity rule. With the flag
 * off, ranked is Open Sea exactly as before.
 */
function rankedSea(): SeaId {
  return isEnabled('portCity.seas') ? currentSeasonSea(Date.now()) : 'open';
}

function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/**
 * The offline wager's two server round trips, on top of src/net/points.ts.
 *
 * A match against this device's AI never reaches matchmaking, so the stake is
 * held here before the battle starts and settled here once it is over. Both
 * calls are idempotent by requestId, which is what lets the settlement sit in
 * the points store and be retried until the payout lands — a won stake must
 * survive a dropped connection or a killed app.
 *
 * Online wagers do NOT come through here: there the match socket reserves the
 * hold and the authoritative room settles it (server/src/room.ts).
 */
import { hasInternet } from './connectivity';
import { reserveOfflineWager, settleOfflineWager } from './points';
import { usePoints, WAGER_STAKE } from '@/state/points';
import { randomUuid } from '@/util/uuid';

export type WagerStakeResult =
  | { ok: true; balance: number }
  | { ok: false; reason: 'insufficient_points' | 'unavailable'; message: string };

/**
 * Takes the stake and records the live wager. On success the store's balance
 * is already the post-stake one, so the HUD reads right during the match.
 */
export async function stakeOfflineWager(): Promise<WagerStakeResult> {
  if (!(await hasInternet())) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'A wager needs a connection to the game server. Play without one, or try again.',
    };
  }
  try {
    const reservation = await reserveOfflineWager(randomUuid());
    usePoints.getState().sync(reservation.balance);
    if (!reservation.ok) {
      return {
        ok: false,
        reason: 'insufficient_points',
        message: `A wager needs ${WAGER_STAKE} points. Your balance is ${reservation.balance}.`,
      };
    }
    usePoints.getState().beginWager(reservation.requestId);
    return { ok: true, balance: reservation.balance };
  } catch (error) {
    return {
      ok: false,
      reason: 'unavailable',
      message: error instanceof Error ? error.message : 'The wager could not be placed.',
    };
  }
}

let inFlight: Promise<boolean> | null = null;

/**
 * Android's network-state listener fires far more often than the connection
 * actually changes, so an unreachable server would otherwise be retried every
 * few seconds forever. The backoff is per settlement: a new wager starts over.
 */
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
let attempts = 0;
let nextAttemptAt = 0;
let backoffFor: string | null = null;

function resetBackoff(requestId: string | null): void {
  attempts = 0;
  nextAttemptAt = 0;
  backoffFor = requestId;
}

async function flush(): Promise<boolean> {
  const pending = usePoints.getState().pendingWagerSettlement;
  if (!pending) {
    resetBackoff(null);
    return true;
  }
  if (backoffFor !== pending.requestId) resetBackoff(pending.requestId);
  if (Date.now() < nextAttemptAt) return false;
  if (!(await hasInternet())) return false;

  try {
    const result = await settleOfflineWager(pending.requestId, pending.won);
    usePoints.getState().sync(result.balance);
    // `settled: false` means the server has already dealt with this hold —
    // paid, refunded, or taken over by a room. Either way it is finished.
    usePoints.getState().clearWagerSettlement();
    usePoints.getState().setWagerSettlementError(null);
    resetBackoff(null);
    return true;
  } catch (error) {
    attempts += 1;
    nextAttemptAt = Date.now() + Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
    const message = error instanceof Error ? error.message : String(error);
    usePoints.getState().setWagerSettlementError(message);
    console.warn(
      `[wager] offline settlement failed (attempt ${attempts}, retrying in ${Math.round(
        (nextAttemptAt - Date.now()) / 1000,
      )}s): ${message}`,
    );
    return false;
  }
}

/** Dedupes the result screen, foreground and connectivity triggers into one call. */
export function flushPendingWager(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = flush().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Cleans up after the offline wager, which no longer exists.
 *
 * Older builds staked 50 points on a match against this device's own AI and
 * then reported the result themselves, which the server paid out on the
 * device's word (BUG-001). Only a match the server runs from start to finish
 * can carry a stake now, and the settle route is gone. A phone updated in the
 * middle of such a wager can still hold the persisted settlement, though, so
 * that stake is handed back through the same refund route a cancelled
 * matchmaking stake uses — whatever result the device recorded.
 */
import { hasInternet } from './connectivity';
import { cancelPointWager } from './points';
import { usePoints } from '@/state/points';

let inFlight: Promise<boolean> | null = null;

/**
 * Android's network-state listener fires far more often than the connection
 * actually changes, so an unreachable server would otherwise be retried every
 * few seconds forever. The backoff is per stake.
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
    const result = await cancelPointWager(pending.requestId);
    if (result.balance !== null) usePoints.getState().sync(result.balance);
    // Refunded now, or already refunded, settled or taken over by a room
    // earlier: either way nothing is left for this device to do.
    usePoints.getState().clearWagerSettlement();
    resetBackoff(null);
    return true;
  } catch (error) {
    attempts += 1;
    nextAttemptAt = Date.now() + Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
    console.warn(
      `[wager] refunding a stake from an older version failed (attempt ${attempts}, retrying in ${Math.round(
        (nextAttemptAt - Date.now()) / 1000,
      )}s):`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/** Dedupes the foreground and connectivity triggers into one call. */
export function flushPendingWager(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = flush().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Waking the match server.
 *
 * The backend runs on a plan that suspends the instance when nothing has
 * talked to it for a while, so the first request after an idle spell pays for
 * a container cold start — tens of seconds, not milliseconds. Left alone that
 * turns the very first thing a player does after signing in into a request
 * that simply hangs, with the app cheerfully carrying on as though the account
 * sync had failed.
 *
 * So the sync asks here first. /health is the cheapest route on the server (no
 * database work at all), and polling it with a short per-attempt timeout gives
 * the UI something honest to show: a warm server answers the first ping in
 * well under a second and nothing is ever displayed, while a cold one is a
 * visible, counted wait instead of a mystery.
 */
import { isForcedOffline } from '@/state/demo';
import { useBackendWake } from '@/state/backendWake';
import { apiBaseOrNull } from './apiBase';
import { hasInternet } from './connectivity';

/** One ping's patience. Short, because a sleeping host answers nothing at all. */
const PING_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1_500;
/** Total patience before we call it unreachable rather than merely asleep. */
const GIVE_UP_MS = 120_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ping(base: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/health`, {
      method: 'GET',
      signal: controller.signal,
      // A sleeping host can leave a stale cached 200 behind an intermediary.
      headers: { 'Cache-Control': 'no-cache' },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let inFlight: Promise<boolean> | null = null;

async function wake(): Promise<boolean> {
  const store = useBackendWake.getState();
  const base = apiBaseOrNull();
  if (!base) {
    // Nothing configured to wake. The app is local-first; let it through.
    store.skip();
    return false;
  }
  if (isForcedOffline() || !(await hasInternet())) {
    store.skip();
    return false;
  }

  store.begin();
  const deadline = Date.now() + GIVE_UP_MS;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    if (await ping(base)) {
      useBackendWake.getState().succeed();
      return true;
    }
    useBackendWake.getState().noteAttempt(attempts);
    if (Date.now() >= deadline) {
      useBackendWake.getState().fail(
        'The match server did not answer. It may still be starting up, or be down.',
      );
      return false;
    }
    await sleep(RETRY_DELAY_MS);
  }
}

/**
 * Resolves true once the server has answered. Deliberately NOT cached: an app
 * that has been in the background long enough for the instance to suspend
 * again must pay the wait again, and a warm server costs one fast request.
 */
export function ensureBackendAwake(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = wake().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * The gameplay session is provisioned by the backend only after it verifies
 * the Privy identity. This module reads that persisted local session; it must
 * never create an unrelated anonymous Supabase user first.
 *
 * Nothing here may block boot: calls are bounded and resolve to null on a
 * failure so the local-first app can still open while account sync retries.
 */
import { getSessionUserId } from './api';
import { isSupabaseConfigured } from './supabase';

export const BOOT_NETWORK_TIMEOUT_MS = 2500;

/**
 * How long boot may wait for the verified Privy -> gameplay handoff when this
 * device holds no session at all. That happens on a first install and on the
 * first launch after a sign-out, and it is the only moment where the identity
 * is genuinely unknown: routing before it lands sends a returning captain
 * through blank onboarding. It gets its own budget rather than sharing the
 * Supabase read's, which is why the two can no longer race each other out.
 */
export const PRIVY_HANDOFF_TIMEOUT_MS = 10_000;

export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

let sessionInFlight: Promise<string | null> | null = null;

async function ensureSessionOnce(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const session = await getSessionUserId();
  return session.ok ? session.value : null;
}

/** The locally installed gameplay user id, or null until Privy sync finishes. */
export function ensureSession(): Promise<string | null> {
  if (sessionInFlight) return sessionInFlight;
  sessionInFlight = ensureSessionOnce().finally(() => {
    sessionInFlight = null;
  });
  return sessionInFlight;
}

/** Boot-safe variant: never throws, never takes longer than the timeout. */
export function ensureSessionForBoot(): Promise<string | null> {
  return withTimeout(ensureSession(), BOOT_NETWORK_TIMEOUT_MS, null);
}

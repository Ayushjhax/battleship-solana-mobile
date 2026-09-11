/**
 * Auth without accounts — docs/brief.md 4.5. Anonymous sign-in on first
 * launch gives the player a real auth.users row; P11 adds the profiles
 * trigger, RLS and the optional email link.
 *
 * Nothing here may block the boot: every call is wrapped in a timeout and
 * resolves to null on any failure, and the app proceeds offline.
 */
import { isSupabaseConfigured, supabase } from './supabase';

export const BOOT_NETWORK_TIMEOUT_MS = 2500;

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

/** The signed-in user id, signing in anonymously if there is no session. */
export async function ensureSession(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;

  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id) return data.session.user.id;

  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.warn('[auth] anonymous sign-in failed, continuing offline:', error.message);
    return null;
  }
  return anon.user?.id ?? null;
}

/** Boot-safe variant: never throws, never takes longer than the timeout. */
export function ensureSessionForBoot(): Promise<string | null> {
  return withTimeout(ensureSession(), BOOT_NETWORK_TIMEOUT_MS, null);
}

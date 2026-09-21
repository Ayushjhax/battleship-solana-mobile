import { z } from 'zod';

import type { SyncedPrivyAccount } from '@/state/privySync';
import { getAccessToken as getSupabaseAccessToken, installGameplaySession } from './api';
import { hasInternet } from './connectivity';

const AccountSchema = z.object({
  profileId: z.string().uuid(),
  privyUserId: z.string().min(1),
  email: z.string().email().nullable(),
  displayName: z.string().nullable(),
  authProvider: z.string().min(1),
  solanaWalletAddress: z.string().nullable(),
  solanaWalletId: z.string().nullable(),
  privyCreatedAt: z.string().min(1),
  pointBalance: z.number().int().nonnegative(),
  welcomeAwarded: z.boolean(),
});

/**
 * The server is already awake by the time this runs (src/net/wake.ts pings
 * /health first), so this only has to cover the work itself: verifying the
 * Privy token, the Supabase admin calls, and issuing the session handoff.
 */
const SYNC_TIMEOUT_MS = 30_000;

const ResponseSchema = z.object({
  account: AccountSchema,
  session: z.object({ tokenHash: z.string().min(20), type: z.literal('magiclink') }).nullable(),
});

/**
 * The server tags every sync failure with a stable `code` (server/src/errors.ts).
 * Carrying it here lets the UI tell "sign in again" apart from "the server is
 * broken, retrying will not help" — the two used to collapse into one message.
 */
export class PrivySyncError extends Error {
  readonly code: string;
  readonly status: number;
  /** True when a fresh sign-in could plausibly fix it. */
  readonly retryable: boolean;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'PrivySyncError';
    this.code = code;
    this.status = status;
    this.retryable = status >= 500 || code === 'network_unreachable' || code === 'network_timeout';
  }
}

function endpoint(): string | null {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return `${explicit.replace(/\/$/, '')}/auth/privy/sync`;
  const ws = process.env.EXPO_PUBLIC_WS_URL?.trim();
  if (!ws) return null;
  try {
    const url = new URL(ws);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/auth/privy/sync';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function responseFailure(response: Response): Promise<PrivySyncError> {
  let message = `server returned ${response.status}`;
  let code = `http_${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown };
    if (typeof body.error === 'string') message = body.error;
    if (typeof body.code === 'string') code = body.code;
  } catch {
    /* a non-JSON body is still a failure; the status carries the meaning */
  }
  return new PrivySyncError(message, code, response.status);
}

export async function syncPrivyAccount(privyAccessToken: string): Promise<SyncedPrivyAccount> {
  const url = endpoint();
  if (!url) throw new PrivySyncError('Match server URL is not configured', 'not_configured', 0);
  if (!(await hasInternet())) {
    throw new PrivySyncError('You are offline. Account sync will retry later.', 'offline', 0);
  }

  const supabaseToken = await getSupabaseAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${privyAccessToken}`,
    'Content-Type': 'application/json',
  };
  if (supabaseToken.ok) headers['X-Supabase-Access-Token'] = supabaseToken.value;

  // Bounded on purpose. A host that accepts the connection but never answers —
  // an instance still coming up, or a proxy holding the socket open — would
  // otherwise leave this pending forever, and the loader waiting on it with it.
  // Failing is recoverable (the gate offers a retry); hanging is not.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: '{}',
      headers,
      signal: controller.signal,
    });
  } catch {
    // A timeout and a refused connection are different problems with
    // different fixes, and both carry a code so callers never have to match
    // on the sentence.
    throw controller.signal.aborted
      ? new PrivySyncError(
          'The game server took too long to answer. Try again in a moment.',
          'network_timeout',
          0,
        )
      : new PrivySyncError(
          'The game server could not be reached. Start the backend and retry.',
          'network_unreachable',
          0,
        );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw await responseFailure(response);
  const parsed = ResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new PrivySyncError('Account sync returned an invalid response', 'bad_response', 200);
  }
  if (parsed.data.session) {
    const installed = await installGameplaySession(
      parsed.data.session.tokenHash,
      parsed.data.session.type,
    );
    if (!installed.ok) {
      throw new PrivySyncError(
        `Could not open the gameplay session: ${installed.error.message}`,
        'session_install_failed',
        200,
      );
    }
    if (installed.value.userId !== parsed.data.account.profileId) {
      throw new PrivySyncError(
        'Gameplay session did not match the verified Privy account',
        'session_profile_mismatch',
        200,
      );
    }
  }
  return parsed.data.account;
}

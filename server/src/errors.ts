/**
 * Typed auth/session failures.
 *
 * The /auth/privy/sync route used to classify failures by running a regex over
 * `error.message` (`/token|jwt|unauthorized|authentication/i`). Any Supabase
 * admin failure whose text happened to contain "token" — including this
 * module's own `Gameplay session handoff failed: no token` — was reported to
 * the player as "invalid Privy access token", which sent everyone hunting a
 * perfectly good credential. Failures now carry their own code and HTTP status
 * so the route never has to guess, and the player is told which side broke.
 */

export type AuthFailureCode =
  /** The bearer token really is absent, malformed, expired or wrong-audience. */
  | 'privy_token_invalid'
  /** PRIVY_APP_ID / PRIVY_APP_SECRET missing from the server environment. */
  | 'privy_not_configured'
  /** Token verified, but Privy's user API could not be reached. */
  | 'identity_provider_unavailable'
  /** Privy verified, but this game profile is owned by a different Privy user. */
  | 'profile_conflict'
  /** Privy verified; Supabase Auth admin (createUser/getUserById/update) failed. */
  | 'supabase_admin_failed'
  /** Privy verified; the magiclink handoff that opens the gameplay session failed. */
  | 'session_handoff_failed'
  /** Privy verified; a gameplay table read/write failed. */
  | 'database_unavailable';

const STATUS: Record<AuthFailureCode, number> = {
  privy_token_invalid: 401,
  privy_not_configured: 503,
  identity_provider_unavailable: 503,
  profile_conflict: 409,
  supabase_admin_failed: 503,
  session_handoff_failed: 503,
  database_unavailable: 503,
};

/**
 * Player-facing text. Deliberately says which side failed: a 503 here is the
 * server's problem and retrying with a fresh login will not help, so telling
 * someone their token is bad would be a lie that costs them the real fix.
 */
const PUBLIC_MESSAGE: Record<AuthFailureCode, string> = {
  privy_token_invalid: 'invalid Privy access token',
  privy_not_configured: 'sign-in is not configured on the server',
  identity_provider_unavailable: 'the sign-in provider is temporarily unavailable',
  profile_conflict: 'This game profile belongs to another Privy sign-in.',
  supabase_admin_failed: 'the account service is temporarily unavailable',
  session_handoff_failed: 'could not open a gameplay session',
  database_unavailable: 'the account database is temporarily unavailable',
};

export class AuthFailure extends Error {
  readonly code: AuthFailureCode;
  readonly status: number;
  readonly publicMessage: string;

  constructor(code: AuthFailureCode, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${code}: ${detail}` : code, options);
    this.name = 'AuthFailure';
    this.code = code;
    this.status = STATUS[code];
    this.publicMessage = PUBLIC_MESSAGE[code];
  }
}

export function isAuthFailure(error: unknown): error is AuthFailure {
  return error instanceof AuthFailure;
}

/** Narrow an unknown throw to readable text for logs, never for classification. */
export function detailOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

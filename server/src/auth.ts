/**
 * The ONLY auth gate: verify the Supabase access token sent in `hello`
 * against the project's JWKS and extract the user id from `sub`. Never trust
 * a player id sent in a message body — every action is attributed to the
 * connection's verified id, not to anything the client claims.
 *
 * Current Supabase projects sign access tokens asymmetrically (ES256) and
 * publish the public key at /auth/v1/.well-known/jwks.json — verified live
 * against this project on 2026-09-11. `jose`'s remote JWK set caches and
 * rate-limits its own fetches, so this is cheap to call per connection.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface VerifiedToken {
  readonly userId: string;
  readonly isAnonymous: boolean;
}

export type AuthResult = { ok: true; token: VerifiedToken } | { ok: false; reason: string };

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let issuer = '';

function jwksFor(supabaseUrl: string): ReturnType<typeof createRemoteJWKSet> {
  if (jwks) return jwks;
  issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return jwks;
}

export async function verifyAccessToken(token: string): Promise<AuthResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return { ok: false, reason: 'server misconfigured: SUPABASE_URL unset' };

  try {
    const { payload } = await jwtVerify(token, jwksFor(supabaseUrl), {
      issuer,
      audience: 'authenticated',
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return { ok: false, reason: 'token has no subject' };
    }
    return { ok: true, token: { userId: payload.sub, isAnonymous: payload.is_anonymous === true } };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid token';
    return { ok: false, reason };
  }
}

/** Test-only: point verification at a different JWKS/issuer without env vars. */
export function __resetAuthCacheForTests(): void {
  jwks = null;
  issuer = '';
}

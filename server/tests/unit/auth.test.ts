/**
 * The only auth gate for gameplay. These sign real ES256 tokens with a local
 * keypair and let `jose` verify them for real — only the network fetch of the
 * project's JWKS is replaced, so signature, issuer, audience and expiry
 * handling are genuinely exercised rather than asserted against a stub.
 */
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const SUPABASE_URL = 'https://project.supabase.test';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

const keys = vi.hoisted(() => ({
  publicJwk: null as JWK | null,
  privateKey: null as CryptoKey | null,
}));

// Keep `jose` real apart from the remote key set, which would otherwise hit the
// network. `createRemoteJWKSet` returns a resolver function, so the fake is one
// too — handing back the public half of the pair the tests sign with.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    createRemoteJWKSet: () => async () => actual.importJWK(keys.publicJwk as JWK, 'ES256'),
  };
});

async function sign(
  claims: Record<string, unknown>,
  options: { issuer?: string; audience?: string; expiresIn?: string } = {},
) {
  const { issuer = ISSUER, audience = 'authenticated', expiresIn = '1h' } = options;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expiresIn)
    .sign(keys.privateKey as CryptoKey);
}

async function loadAuth() {
  const mod = await import('../../src/auth');
  mod.__resetAuthCacheForTests();
  return mod;
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  keys.publicJwk = await exportJWK(publicKey);
  keys.privateKey = privateKey;
});

beforeEach(() => {
  vi.resetModules();
  process.env.SUPABASE_URL = SUPABASE_URL;
});

describe('verifyAccessToken', () => {
  it('accepts a correctly signed token and returns its subject', async () => {
    const { verifyAccessToken } = await loadAuth();
    const token = await sign({ sub: 'profile-1' });

    const result = await verifyAccessToken(token);

    expect(result).toEqual({ ok: true, token: { userId: 'profile-1', isAnonymous: false } });
  });

  it('flags an anonymous Supabase session', async () => {
    const { verifyAccessToken } = await loadAuth();
    const token = await sign({ sub: 'profile-1', is_anonymous: true });

    const result = await verifyAccessToken(token);

    expect(result).toEqual({ ok: true, token: { userId: 'profile-1', isAnonymous: true } });
  });

  it('treats a non-boolean is_anonymous as not anonymous', async () => {
    const { verifyAccessToken } = await loadAuth();
    const token = await sign({ sub: 'profile-1', is_anonymous: 'yes' });

    const result = await verifyAccessToken(token);

    expect(result).toMatchObject({ ok: true, token: { isAnonymous: false } });
  });

  it('rejects a token with no subject rather than inventing one', async () => {
    const { verifyAccessToken } = await loadAuth();
    const token = await sign({});

    const result = await verifyAccessToken(token);

    expect(result).toEqual({ ok: false, reason: 'token has no subject' });
  });

  it('rejects an empty-string subject', async () => {
    const { verifyAccessToken } = await loadAuth();
    const token = await sign({ sub: '' });

    const result = await verifyAccessToken(token);

    expect(result).toEqual({ ok: false, reason: 'token has no subject' });
  });

  it('rejects a token from another issuer', async () => {
    const { verifyAccessToken } = await loadAuth();
    const token = await sign({ sub: 'profile-1' }, { issuer: 'https://evil.test/auth/v1' });

    const result = await verifyAccessToken(token);

    expect(result.ok).toBe(false);
  });

  it('rejects a token minted for a different audience', async () => {
    const { verifyAccessToken } = await loadAuth();
    const token = await sign({ sub: 'profile-1' }, { audience: 'service_role' });

    const result = await verifyAccessToken(token);

    expect(result.ok).toBe(false);
  });

  it('rejects an expired token', async () => {
    const { verifyAccessToken } = await loadAuth();
    const token = await sign({ sub: 'profile-1' }, { expiresIn: '-5m' });

    const result = await verifyAccessToken(token);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exp/i);
  });

  it('rejects a structurally invalid token without throwing', async () => {
    const { verifyAccessToken } = await loadAuth();

    await expect(verifyAccessToken('not-a-jwt')).resolves.toMatchObject({ ok: false });
    await expect(verifyAccessToken('')).resolves.toMatchObject({ ok: false });
  });

  it('refuses to verify anything when SUPABASE_URL is unset', async () => {
    delete process.env.SUPABASE_URL;
    const { verifyAccessToken } = await loadAuth();

    const result = await verifyAccessToken(await sign({ sub: 'profile-1' }));

    expect(result).toEqual({ ok: false, reason: 'server misconfigured: SUPABASE_URL unset' });
  });

  it('normalises a SUPABASE_URL with a trailing slash to the same issuer', async () => {
    process.env.SUPABASE_URL = `${SUPABASE_URL}/`;
    const { verifyAccessToken } = await loadAuth();
    const token = await sign({ sub: 'profile-1' });

    await expect(verifyAccessToken(token)).resolves.toMatchObject({ ok: true });
  });
});

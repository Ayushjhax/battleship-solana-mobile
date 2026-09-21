/**
 * Regression: "invalid Privy access token" shown for a perfectly good token.
 *
 * /auth/privy/sync used to classify failures by running
 *   /token|jwt|unauthorized|authentication/i
 * over `error.message`. Several server-side failures carry those words —
 * most notably privySession's own `... handoff failed: no token` — so a
 * Supabase outage was reported to the player as a bad credential, and a 401
 * told them to sign in again for a fault no sign-in could fix.
 *
 * These drive the real Fastify route through `inject`, faking only the Privy
 * SDK and Supabase boundaries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthFailure as AuthFailureClass, AuthFailureCode } from '../../src/errors';

const mocks = vi.hoisted(() => ({
  verifyAndLoadPrivyUser: vi.fn(),
  bootstrapPrivySession: vi.fn(),
  upsertPrivyAccount: vi.fn(),
  verifyAccessToken: vi.fn(),
  verifyDatabaseConnection: vi.fn(),
  verifyAuthAdminAccess: vi.fn(),
  checkDatabaseSchema: vi.fn(),
  attachWebSocketServer: vi.fn(),
}));

vi.mock('../../src/privy', () => ({
  verifyAndLoadPrivyUser: mocks.verifyAndLoadPrivyUser,
  normalizePrivyUser: vi.fn(),
}));
vi.mock('../../src/privySession', () => ({
  bootstrapPrivySession: mocks.bootstrapPrivySession,
}));
vi.mock('../../src/db', () => ({
  upsertPrivyAccount: mocks.upsertPrivyAccount,
  verifyDatabaseConnection: mocks.verifyDatabaseConnection,
  verifyAuthAdminAccess: mocks.verifyAuthAdminAccess,
  checkDatabaseSchema: mocks.checkDatabaseSchema,
  applyOfflineResult: vi.fn(),
  fetchProfileRewardTotals: vi.fn(),
  reservePointWager: vi.fn(),
  settleOfflineWager: vi.fn(),
}));
vi.mock('../../src/auth', () => ({ verifyAccessToken: mocks.verifyAccessToken }));
vi.mock('../../src/ws', () => ({ attachWebSocketServer: mocks.attachWebSocketServer }));

const TRUSTED_ACCOUNT = {
  privyUserId: 'did:privy:captain',
  email: 'captain@example.test',
  displayName: 'Captain',
  authProvider: 'google',
  solanaWalletAddress: null,
  solanaWalletId: null,
  linkedAccounts: [],
  privyCreatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * One module graph per test. A static `import { AuthFailure }` would come from
 * a different graph than the route's after resetModules, so `instanceof` in the
 * route would silently never match and every test would pass for a wrong reason.
 */
let AuthFailure: typeof AuthFailureClass;
let app: Awaited<typeof import('../../src/index')>['app'];

function fail(code: AuthFailureCode, detail: string) {
  return new AuthFailure(code, detail);
}

async function startApp() {
  const mod = await import('../../src/index');
  app = mod.app;
  await app.ready();
  return app;
}

function sync(token: string | null = 'a-valid-privy-token') {
  return app.inject({
    method: 'POST',
    url: '/auth/privy/sync',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    payload: '{}',
  });
}

beforeEach(async () => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.verifyAndLoadPrivyUser.mockResolvedValue(TRUSTED_ACCOUNT);
  mocks.verifyDatabaseConnection.mockResolvedValue(undefined);
  mocks.verifyAuthAdminAccess.mockResolvedValue({
    name: 'supabase_auth_admin',
    ok: true,
    detail: null,
  });
  mocks.checkDatabaseSchema.mockResolvedValue({
    name: 'supabase_schema',
    ok: true,
    detail: null,
  });
  ({ AuthFailure } = await import('../../src/errors'));
});

describe('/auth/privy/sync error classification', () => {
  it('does NOT blame the token when the session handoff finds no hashed_token', async () => {
    // The exact original failure: the detail contains the word "token", which
    // the old regex read as a bad credential.
    mocks.bootstrapPrivySession.mockRejectedValue(
      fail('session_handoff_failed', 'Gameplay session handoff failed: link carried no hashed_token'),
    );
    await startApp();

    const response = await sync();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: 'could not open a gameplay session',
      code: 'session_handoff_failed',
    });
    expect(response.json().error).not.toMatch(/invalid Privy access token/);
  });

  it('does NOT blame the token when Supabase Auth admin is unauthorized', async () => {
    // Supabase's wording for a key without service-role rights contains both
    // "authentication" and "token" — two hits on the old regex.
    mocks.bootstrapPrivySession.mockRejectedValue(
      fail(
        'supabase_admin_failed',
        'Supabase Auth user creation failed: invalid authentication token supplied',
      ),
    );
    await startApp();

    const response = await sync();

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('supabase_admin_failed');
    expect(response.json().error).not.toMatch(/invalid Privy access token/);
  });

  it('does NOT blame the token when the gameplay database is down', async () => {
    mocks.bootstrapPrivySession.mockRejectedValue(
      fail('database_unavailable', 'Privy profile lookup failed: JWT expired'),
    );
    await startApp();

    const response = await sync();

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('database_unavailable');
  });

  it('DOES return 401 when the token is genuinely invalid', async () => {
    mocks.verifyAndLoadPrivyUser.mockRejectedValue(
      fail('privy_token_invalid', 'signature verification failed'),
    );
    await startApp();

    const response = await sync('a-forged-token');

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'invalid Privy access token',
      code: 'privy_token_invalid',
    });
  });

  it('returns 401 with no bearer token at all', async () => {
    await startApp();

    const response = await sync(null);

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toMatch(/required/i);
  });

  it('returns 409, not 401, when the profile belongs to another Privy identity', async () => {
    mocks.bootstrapPrivySession.mockRejectedValue(
      fail('profile_conflict', 'Supabase Auth profile belongs to another Privy identity'),
    );
    await startApp();

    const response = await sync();

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('profile_conflict');
  });

  it('reports 503 when Privy itself is not configured on the server', async () => {
    mocks.verifyAndLoadPrivyUser.mockRejectedValue(
      fail('privy_not_configured', 'PRIVY_APP_ID and PRIVY_APP_SECRET must be set'),
    );
    await startApp();

    const response = await sync();

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('privy_not_configured');
  });

  it('tags an unclassified throw rather than guessing at the cause', async () => {
    mocks.bootstrapPrivySession.mockRejectedValue(new Error('something entirely unexpected'));
    await startApp();

    const response = await sync();

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('sync_failed');
  });

  it('succeeds and hands back a session when the bootstrap works', async () => {
    mocks.bootstrapPrivySession.mockResolvedValue({
      profileId: '11111111-1111-4111-8111-111111111111',
      account: { ...TRUSTED_ACCOUNT, pointBalance: 100, welcomeAwarded: true },
      handoff: { tokenHash: 'x'.repeat(40), type: 'magiclink' },
    });
    await startApp();

    const response = await sync();

    expect(response.statusCode).toBe(200);
    expect(response.json().session).toEqual({ tokenHash: 'x'.repeat(40), type: 'magiclink' });
    expect(response.json().account.profileId).toBe('11111111-1111-4111-8111-111111111111');
  });
});

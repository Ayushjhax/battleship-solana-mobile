/**
 * The client half of the sign-in bug. The server now tags every failure with a
 * stable `code`; `syncPrivyAccount` must carry it through instead of flattening
 * everything into a bare message, so the UI can tell "sign in again" apart from
 * "the server is broken and retrying will not help".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAccessToken: vi.fn(),
  installGameplaySession: vi.fn(),
  hasInternet: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../../src/net/api', () => ({
  getAccessToken: mocks.getSupabaseAccessToken,
  installGameplaySession: mocks.installGameplaySession,
}));
vi.mock('../../src/net/connectivity', () => ({ hasInternet: mocks.hasInternet }));

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';

const ACCOUNT = {
  profileId: PROFILE_ID,
  privyUserId: 'did:privy:captain',
  email: 'captain@example.test',
  displayName: 'Captain',
  authProvider: 'google',
  solanaWalletAddress: null,
  solanaWalletId: null,
  privyCreatedAt: '2026-01-01T00:00:00.000Z',
  pointBalance: 100,
  welcomeAwarded: true,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  process.env.EXPO_PUBLIC_WS_URL = 'wss://api.example.test/ws';
  mocks.hasInternet.mockResolvedValue(true);
  mocks.getSupabaseAccessToken.mockResolvedValue({ ok: false, error: new Error('no session') });
  mocks.installGameplaySession.mockResolvedValue({ ok: true, value: { userId: PROFILE_ID } });
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('syncPrivyAccount — carrying the server’s classification', () => {
  it('keeps a 503 session_handoff_failed as a server fault, not a bad token', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ error: 'could not open a gameplay session', code: 'session_handoff_failed' }, 503),
    );
    const { syncPrivyAccount, PrivySyncError } = await import('../../src/net/privySync');

    const error = await syncPrivyAccount('privy-token').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PrivySyncError);
    expect((error as InstanceType<typeof PrivySyncError>).code).toBe('session_handoff_failed');
    expect((error as InstanceType<typeof PrivySyncError>).status).toBe(503);
    expect((error as InstanceType<typeof PrivySyncError>).retryable).toBe(true);
    expect((error as Error).message).not.toMatch(/invalid Privy access token/);
  });

  it('marks a genuine 401 as not retryable so the UI can ask for a fresh sign-in', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ error: 'invalid Privy access token', code: 'privy_token_invalid' }, 401),
    );
    const { syncPrivyAccount, PrivySyncError } = await import('../../src/net/privySync');

    const error = await syncPrivyAccount('forged').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof PrivySyncError>).code).toBe('privy_token_invalid');
    expect((error as InstanceType<typeof PrivySyncError>).retryable).toBe(false);
  });

  it('carries a 409 profile conflict through with its own code', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ error: 'This game profile belongs to another Privy sign-in.', code: 'profile_conflict' }, 409),
    );
    const { syncPrivyAccount, PrivySyncError } = await import('../../src/net/privySync');

    const error = await syncPrivyAccount('privy-token').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof PrivySyncError>).code).toBe('profile_conflict');
    expect((error as InstanceType<typeof PrivySyncError>).retryable).toBe(false);
  });

  it('falls back to the status when the body carries no code', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({}, 500));
    const { syncPrivyAccount, PrivySyncError } = await import('../../src/net/privySync');

    const error = await syncPrivyAccount('privy-token').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof PrivySyncError>).code).toBe('http_500');
    expect((error as Error).message).toBe('server returned 500');
  });

  it('survives a non-JSON error body', async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    } as unknown as Response);
    const { syncPrivyAccount, PrivySyncError } = await import('../../src/net/privySync');

    const error = await syncPrivyAccount('privy-token').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PrivySyncError);
    expect((error as InstanceType<typeof PrivySyncError>).status).toBe(502);
  });

  it('codes an unreachable server as network_unreachable and retryable', async () => {
    mocks.fetch.mockRejectedValue(new TypeError('Network request failed'));
    const { syncPrivyAccount, PrivySyncError } = await import('../../src/net/privySync');

    const error = await syncPrivyAccount('privy-token').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof PrivySyncError>).code).toBe('network_unreachable');
    expect((error as InstanceType<typeof PrivySyncError>).retryable).toBe(true);
  });

  it('refuses to call out at all when the device is offline', async () => {
    mocks.hasInternet.mockResolvedValue(false);
    const { syncPrivyAccount, PrivySyncError } = await import('../../src/net/privySync');

    const error = await syncPrivyAccount('privy-token').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof PrivySyncError>).code).toBe('offline');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('syncPrivyAccount — success path', () => {
  it('installs the handed-back session and returns the account', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ account: ACCOUNT, session: { tokenHash: 'h'.repeat(40), type: 'magiclink' } }),
    );
    const { syncPrivyAccount } = await import('../../src/net/privySync');

    await expect(syncPrivyAccount('privy-token')).resolves.toEqual(ACCOUNT);
    expect(mocks.installGameplaySession).toHaveBeenCalledWith('h'.repeat(40), 'magiclink');
  });

  it('skips session install when the server says one already exists', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ account: ACCOUNT, session: null }));
    const { syncPrivyAccount } = await import('../../src/net/privySync');

    await expect(syncPrivyAccount('privy-token')).resolves.toEqual(ACCOUNT);
    expect(mocks.installGameplaySession).not.toHaveBeenCalled();
  });

  it('forwards an existing Supabase token so the server can reuse the profile', async () => {
    mocks.getSupabaseAccessToken.mockResolvedValue({ ok: true, value: 'existing-jwt' });
    mocks.fetch.mockResolvedValue(jsonResponse({ account: ACCOUNT, session: null }));
    const { syncPrivyAccount } = await import('../../src/net/privySync');

    await syncPrivyAccount('privy-token');

    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.example.test/auth/privy/sync',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Supabase-Access-Token': 'existing-jwt' }),
      }),
    );
  });

  it('rejects a response whose shape does not match the contract', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ account: { profileId: 'not-a-uuid' } }));
    const { syncPrivyAccount, PrivySyncError } = await import('../../src/net/privySync');

    const error = await syncPrivyAccount('privy-token').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof PrivySyncError>).code).toBe('bad_response');
  });

  it('codes a failed session install distinctly', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ account: ACCOUNT, session: { tokenHash: 'h'.repeat(40), type: 'magiclink' } }),
    );
    mocks.installGameplaySession.mockResolvedValue({ ok: false, error: new Error('link expired') });
    const { syncPrivyAccount, PrivySyncError } = await import('../../src/net/privySync');

    const error = await syncPrivyAccount('privy-token').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof PrivySyncError>).code).toBe('session_install_failed');
    expect((error as Error).message).toMatch(/link expired/);
  });

  it('refuses a session that installed under a different profile', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ account: ACCOUNT, session: { tokenHash: 'h'.repeat(40), type: 'magiclink' } }),
    );
    mocks.installGameplaySession.mockResolvedValue({ ok: true, value: { userId: 'someone-else' } });
    const { syncPrivyAccount, PrivySyncError } = await import('../../src/net/privySync');

    const error = await syncPrivyAccount('privy-token').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof PrivySyncError>).code).toBe('session_profile_mismatch');
  });
});

describe('endpoint resolution', () => {
  it('derives an https endpoint from the wss URL when no API URL is set', async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    mocks.fetch.mockResolvedValue(jsonResponse({ account: ACCOUNT, session: null }));
    const { syncPrivyAccount } = await import('../../src/net/privySync');

    await syncPrivyAccount('privy-token');

    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.example.test/auth/privy/sync',
      expect.anything(),
    );
  });

  it('strips a trailing slash from the configured API URL', async () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test/';
    mocks.fetch.mockResolvedValue(jsonResponse({ account: ACCOUNT, session: null }));
    const { syncPrivyAccount } = await import('../../src/net/privySync');

    await syncPrivyAccount('privy-token');

    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.example.test/auth/privy/sync',
      expect.anything(),
    );
  });

  it('fails clearly when no server address is configured at all', async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_WS_URL;
    const { syncPrivyAccount, PrivySyncError } = await import('../../src/net/privySync');

    const error = await syncPrivyAccount('privy-token').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof PrivySyncError>).code).toBe('not_configured');
  });
});

/**
 * verifyAndLoadPrivyUser decides whether a failure is the player's credential
 * or the server's problem. Getting that wrong is what produced a 401 telling
 * people to sign in again for an outage no sign-in could fix, so each boundary
 * is pinned here: only the signature check may yield `privy_token_invalid`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@privy-io/node', () => ({
  PrivyClient: class {
    utils() {
      return { auth: () => ({ verifyAccessToken: mocks.verifyAccessToken }) };
    }
    users() {
      return { _get: mocks.getUser };
    }
  },
}));

const ENV = ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'PRIVY_JWT_VERIFICATION_KEY'] as const;

function setEnv(values: Partial<Record<(typeof ENV)[number], string>> = {}) {
  for (const key of ENV) delete process.env[key];
  Object.assign(process.env, { PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret', ...values });
}

function privyUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'did:privy:captain',
    created_at: 1_700_000_000,
    linked_accounts: [],
    ...overrides,
  };
}

async function load() {
  const privy = await import('../../src/privy');
  privy.__resetPrivyClientForTests();
  const { AuthFailure } = await import('../../src/errors');
  return { ...privy, AuthFailure };
}

beforeEach(() => {
  vi.resetModules();
  mocks.verifyAccessToken.mockReset();
  mocks.getUser.mockReset();
  setEnv();
});

describe('verifyAndLoadPrivyUser failure codes', () => {
  it('codes a rejected signature as privy_token_invalid (401)', async () => {
    mocks.verifyAccessToken.mockRejectedValue(new Error('invalid signature'));
    const { verifyAndLoadPrivyUser, AuthFailure } = await load();

    const error = await verifyAndLoadPrivyUser('forged').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthFailure);
    expect((error as InstanceType<typeof AuthFailure>).code).toBe('privy_token_invalid');
    expect((error as InstanceType<typeof AuthFailure>).status).toBe(401);
  });

  it('codes missing server credentials as privy_not_configured (503)', async () => {
    setEnv({ PRIVY_APP_SECRET: '' });
    const { verifyAndLoadPrivyUser, AuthFailure } = await load();

    const error = await verifyAndLoadPrivyUser('anything').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof AuthFailure>).code).toBe('privy_not_configured');
    expect((error as InstanceType<typeof AuthFailure>).status).toBe(503);
  });

  it('does NOT blame the token when Privy’s user API is unreachable', async () => {
    // The token already verified here; a fetch failure afterwards is an outage.
    mocks.verifyAccessToken.mockResolvedValue({ user_id: 'did:privy:captain' });
    mocks.getUser.mockRejectedValue(new Error('ETIMEDOUT'));
    const { verifyAndLoadPrivyUser, AuthFailure } = await load();

    const error = await verifyAndLoadPrivyUser('good-token').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof AuthFailure>).code).toBe('identity_provider_unavailable');
    expect((error as InstanceType<typeof AuthFailure>).status).toBe(503);
  });

  it('codes a subject mismatch as privy_token_invalid', async () => {
    mocks.verifyAccessToken.mockResolvedValue({ user_id: 'did:privy:captain' });
    mocks.getUser.mockResolvedValue(privyUser({ id: 'did:privy:someone-else' }));
    const { verifyAndLoadPrivyUser, AuthFailure } = await load();

    const error = await verifyAndLoadPrivyUser('good-token').catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof AuthFailure>).code).toBe('privy_token_invalid');
  });

  it('returns the normalised account on success', async () => {
    mocks.verifyAccessToken.mockResolvedValue({ user_id: 'did:privy:captain' });
    mocks.getUser.mockResolvedValue(
      privyUser({
        linked_accounts: [
          { type: 'google_oauth', email: 'captain@example.test', name: 'Captain', subject: 'g1' },
        ],
      }),
    );
    const { verifyAndLoadPrivyUser } = await load();

    await expect(verifyAndLoadPrivyUser('good-token')).resolves.toMatchObject({
      privyUserId: 'did:privy:captain',
      email: 'captain@example.test',
      displayName: 'Captain',
      authProvider: 'google',
    });
  });
});

describe('normalizePrivyUser', () => {
  it('prefers the Google identity for email and display name', async () => {
    const { normalizePrivyUser } = await load();

    const account = normalizePrivyUser(
      privyUser({
        linked_accounts: [
          { type: 'email', address: 'fallback@example.test' },
          { type: 'google_oauth', email: 'google@example.test', name: 'Captain', subject: 'g1' },
        ],
      }) as never,
    );

    expect(account.email).toBe('google@example.test');
    expect(account.authProvider).toBe('google');
  });

  it('falls back to the email identity when there is no Google account', async () => {
    const { normalizePrivyUser } = await load();

    const account = normalizePrivyUser(
      privyUser({ linked_accounts: [{ type: 'email', address: 'only@example.test' }] }) as never,
    );

    expect(account.email).toBe('only@example.test');
    expect(account.authProvider).toBe('email');
    expect(account.displayName).toBeNull();
  });

  it('reports an unknown provider when nothing recognisable is linked', async () => {
    const { normalizePrivyUser } = await load();

    const account = normalizePrivyUser(
      privyUser({ linked_accounts: [{ type: 'phone', number: '+10000000000' }] }) as never,
    );

    expect(account.authProvider).toBe('unknown');
    expect(account.email).toBeNull();
  });

  it('picks up only the embedded Solana wallet', async () => {
    const { normalizePrivyUser } = await load();

    const account = normalizePrivyUser(
      privyUser({
        linked_accounts: [
          {
            type: 'wallet',
            chain_type: 'ethereum',
            connector_type: 'embedded',
            address: '0xdead',
            wallet_client: 'privy',
            id: 'eth-1',
          },
          {
            type: 'wallet',
            chain_type: 'solana',
            connector_type: 'injected',
            address: 'ExternalSolWallet',
            wallet_client: 'phantom',
            id: 'sol-ext',
          },
          {
            type: 'wallet',
            chain_type: 'solana',
            connector_type: 'embedded',
            address: 'EmbeddedSolWallet',
            wallet_client: 'privy',
            id: 'sol-1',
          },
        ],
      }) as never,
    );

    expect(account.solanaWalletAddress).toBe('EmbeddedSolWallet');
    expect(account.solanaWalletId).toBe('sol-1');
  });

  it('leaves the wallet null when no embedded Solana wallet exists', async () => {
    const { normalizePrivyUser } = await load();

    const account = normalizePrivyUser(privyUser() as never);

    expect(account.solanaWalletAddress).toBeNull();
    expect(account.solanaWalletId).toBeNull();
  });

  it('converts the Privy epoch timestamp to an ISO string', async () => {
    const { normalizePrivyUser } = await load();

    const account = normalizePrivyUser(privyUser({ created_at: 1_700_000_000 }) as never);

    expect(account.privyCreatedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });
});

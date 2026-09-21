/**
 * /health said "ok" through a total sign-in outage, because it only reads
 * gameplay tables — something the publishable key can do too. /ready exercises
 * the service-role path that sign-in actually depends on, so a server that
 * cannot log anyone in stops claiming to be healthy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyDatabaseConnection: vi.fn(),
  verifyAuthAdminAccess: vi.fn(),
  checkDatabaseSchema: vi.fn(),
  attachWebSocketServer: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  verifyDatabaseConnection: mocks.verifyDatabaseConnection,
  verifyAuthAdminAccess: mocks.verifyAuthAdminAccess,
  checkDatabaseSchema: mocks.checkDatabaseSchema,
  upsertPrivyAccount: vi.fn(),
  applyOfflineResult: vi.fn(),
  fetchProfileRewardTotals: vi.fn(),
  reservePointWager: vi.fn(),
  settleOfflineWager: vi.fn(),
}));
vi.mock('../../src/privy', () => ({ verifyAndLoadPrivyUser: vi.fn(), normalizePrivyUser: vi.fn() }));
vi.mock('../../src/privySession', () => ({ bootstrapPrivySession: vi.fn() }));
vi.mock('../../src/auth', () => ({ verifyAccessToken: vi.fn() }));
vi.mock('../../src/ws', () => ({ attachWebSocketServer: mocks.attachWebSocketServer }));

const ENV_KEYS = [
  'PRIVY_APP_ID',
  'PRIVY_APP_SECRET',
  'PRIVY_JWT_VERIFICATION_KEY',
  'SOLANA_RPC_URL',
  'TREASURY_PUBLIC_KEY',
  'TREASURY_PRIVATE_KEY',
] as const;

const FULL_ENV: Record<string, string> = {
  PRIVY_APP_ID: 'app-id',
  PRIVY_APP_SECRET: 'app-secret',
  SOLANA_RPC_URL: 'https://rpc.example.test',
  TREASURY_PUBLIC_KEY: 'treasury-public',
  TREASURY_PRIVATE_KEY: '[1,2,3]',
};

function setEnv(values: Record<string, string>) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

type Check = { name: string; ok: boolean; detail: string | null };

function checkNamed(response: { json: () => { checks: Check[] } }, name: string): Check {
  const found = response.json().checks.find((check) => check.name === name);
  if (!found) throw new Error(`readiness report is missing the ${name} check`);
  return found;
}

async function ready() {
  const { app } = await import('../../src/index');
  await app.ready();
  return app.inject({ method: 'GET', url: '/ready' });
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.checkDatabaseSchema.mockResolvedValue({ name: 'supabase_schema', ok: true, detail: null });
  mocks.verifyAuthAdminAccess.mockResolvedValue({
    name: 'supabase_auth_admin',
    ok: true,
    detail: null,
  });
  setEnv(FULL_ENV);
});

describe('GET /ready', () => {
  it('returns 200 with every check green when the server is fully configured', async () => {
    const response = await ready();

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    expect(response.json().checks.map((check: Check) => check.name)).toEqual([
      'privy_config',
      'treasury_config',
      'supabase_schema',
      'supabase_auth_admin',
    ]);
  });

  it('fails with 503 when the Supabase key cannot drive Auth admin', async () => {
    // The exact production condition: tables read fine, admin is refused.
    mocks.verifyAuthAdminAccess.mockResolvedValue({
      name: 'supabase_auth_admin',
      ok: false,
      detail: 'User not allowed',
    });

    const response = await ready();

    expect(response.statusCode).toBe(503);
    expect(response.json().ok).toBe(false);
    expect(checkNamed(response, 'supabase_auth_admin')).toMatchObject({
      ok: false,
      detail: 'User not allowed',
    });
  });

  it('names exactly which Privy variables are missing', async () => {
    setEnv({ ...FULL_ENV, PRIVY_APP_SECRET: '' });

    const response = await ready();

    expect(response.statusCode).toBe(503);
    const privy = checkNamed(response, 'privy_config');
    expect(privy.ok).toBe(false);
    expect(privy.detail).toContain('PRIVY_APP_SECRET');
    expect(privy.detail).not.toContain('PRIVY_APP_ID');
  });

  it('catches a JWT verification key pasted without its PEM wrapper', async () => {
    // A multi-line PEM pasted into .env unquoted collapses to its first line;
    // signature verification then fails and looks like a bad player token.
    setEnv({ ...FULL_ENV, PRIVY_JWT_VERIFICATION_KEY: 'MFkwEwYHKoZIzj0CAQYIKoZI' });

    const response = await ready();

    const privy = checkNamed(response, 'privy_config');
    expect(privy.ok).toBe(false);
    expect(privy.detail).toMatch(/PEM/);
  });

  it('accepts a properly wrapped PEM verification key', async () => {
    setEnv({
      ...FULL_ENV,
      PRIVY_JWT_VERIFICATION_KEY:
        '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZI\n-----END PUBLIC KEY-----',
    });

    const response = await ready();

    expect(response.statusCode).toBe(200);
  });

  it('reports the missing treasury variables that break point purchases', async () => {
    setEnv({ ...FULL_ENV, SOLANA_RPC_URL: '' });

    const response = await ready();

    const treasury = checkNamed(response, 'treasury_config');
    expect(treasury.ok).toBe(false);
    expect(treasury.detail).toContain('SOLANA_RPC_URL');
  });

  it('surfaces a broken gameplay schema', async () => {
    mocks.checkDatabaseSchema.mockResolvedValue({
      name: 'supabase_schema',
      ok: false,
      detail: 'relation "point_accounts" does not exist',
    });

    const response = await ready();

    expect(response.statusCode).toBe(503);
    expect(checkNamed(response, 'supabase_schema').detail).toMatch(/point_accounts/);
  });

  it('never echoes secret values back in the report', async () => {
    setEnv({ ...FULL_ENV, PRIVY_APP_SECRET: 'super-secret-value' });

    const response = await ready();

    expect(response.body).not.toContain('super-secret-value');
    expect(response.body).not.toContain('[1,2,3]');
  });

  it('is marked no-store so a proxy never caches a stale verdict', async () => {
    const response = await ready();

    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /health', () => {
  it('still answers cheaply without touching Supabase', async () => {
    const { app } = await import('../../src/index');
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, service: 'seabattle-match-server' });
    expect(mocks.verifyAuthAdminAccess).not.toHaveBeenCalled();
    expect(mocks.checkDatabaseSchema).not.toHaveBeenCalled();
  });
});

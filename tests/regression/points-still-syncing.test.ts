/**
 * Regression: "Your verified account is still syncing. Return home, then try
 * again." on every attempt to buy points.
 *
 * That message is what `src/net/points.ts` says whenever `ensureSession()`
 * resolves to null. It reads as a transient hiccup, so the advice is to wait —
 * but the session was null because the Privy handoff had already failed on the
 * server, and no amount of returning home would ever install one. The bug was
 * upstream (see server error classification); these tests pin the dependency so
 * the two cannot be confused again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureSession: vi.fn(),
  getAccessToken: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../../src/net/auth', () => ({ ensureSession: mocks.ensureSession }));
vi.mock('../../src/net/api', () => ({ getAccessToken: mocks.getAccessToken }));

const QUOTE = {
  quote: {
    balance: 250,
    points: 100,
    lamports: 1_000_000,
    sol: '0.001',
    treasuryAddress: 'Treasury1111111111111111111111111111111111',
  },
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
  mocks.ensureSession.mockResolvedValue('profile-1');
  mocks.getAccessToken.mockResolvedValue({ ok: true, value: 'supabase-jwt' });
  mocks.fetch.mockResolvedValue(jsonResponse(QUOTE));
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('points requests depend on an installed gameplay session', () => {
  it('reports "still syncing" when no session was ever installed', async () => {
    // The user-visible symptom. It is correct only insofar as there really is
    // no session — the cause lives on the server.
    mocks.ensureSession.mockResolvedValue(null);
    const { fetchPointQuote } = await import('../../src/net/points');

    await expect(fetchPointQuote()).rejects.toThrow(/still syncing/);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('never reaches the network without a session, so no request can 401', async () => {
    mocks.ensureSession.mockResolvedValue(null);
    const { confirmPointBuy } = await import('../../src/net/points');

    await expect(confirmPointBuy('11111111-1111-4111-8111-111111111111', 'sig')).rejects.toThrow(
      /still syncing/,
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('distinguishes a missing session from a session whose token will not mint', async () => {
    mocks.ensureSession.mockResolvedValue('profile-1');
    mocks.getAccessToken.mockResolvedValue({ ok: false, error: new Error('no session') });
    const { fetchPointQuote } = await import('../../src/net/points');

    // Two different faults must not collapse into one message.
    await expect(fetchPointQuote()).rejects.toThrow(/gameplay session is not ready/);
    await expect(fetchPointQuote()).rejects.not.toThrow(/still syncing/);
  });

  it('succeeds and authorizes the call once a session exists', async () => {
    const { fetchPointQuote } = await import('../../src/net/points');

    await expect(fetchPointQuote()).resolves.toEqual(QUOTE.quote);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.example.test/points/quote',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer supabase-jwt' }),
      }),
    );
  });

  it('surfaces the server’s own error text rather than the syncing message', async () => {
    // Once a session exists, a server-side failure must read as a server-side
    // failure — the old flow blurred every cause into "still syncing".
    mocks.fetch.mockResolvedValue(
      jsonResponse({ error: 'points service is temporarily unavailable' }, 503),
    );
    const { fetchPointQuote } = await import('../../src/net/points');

    await expect(fetchPointQuote()).rejects.toThrow(/points service is temporarily unavailable/);
  });

  it('reports an unreachable server distinctly from a missing session', async () => {
    mocks.fetch.mockRejectedValue(new TypeError('Network request failed'));
    const { fetchPointQuote } = await import('../../src/net/points');

    await expect(fetchPointQuote()).rejects.toThrow(/could not be reached/);
  });
});

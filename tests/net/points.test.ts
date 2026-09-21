/**
 * The client's points API. Every call is money-adjacent — a wager hold, a SOL
 * purchase, a payout — so each one validates its response shape and each one
 * must fail loudly rather than return a plausible-looking default. The wager
 * calls are idempotent by requestId; these pin that the id is actually sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureSession: vi.fn(),
  getAccessToken: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../../src/net/auth', () => ({ ensureSession: mocks.ensureSession }));
vi.mock('../../src/net/api', () => ({ getAccessToken: mocks.getAccessToken }));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** The parsed body of the single fetch the call under test made. */
function sentBody(): unknown {
  const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit | undefined;
  return init?.body ? JSON.parse(init.body as string) : undefined;
}

function sentUrl(): string {
  return mocks.fetch.mock.calls[0]?.[0] as string;
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  delete process.env.EXPO_PUBLIC_WS_URL;
  mocks.ensureSession.mockResolvedValue('profile-1');
  mocks.getAccessToken.mockResolvedValue({ ok: true, value: 'supabase-jwt' });
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('confirmPointBuy', () => {
  it('posts the request id and signature and returns the trade result', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ status: 'confirmed', balance: 350, signature: 'sig-1' }),
    );
    const { confirmPointBuy } = await import('../../src/net/points');

    await expect(confirmPointBuy(REQUEST_ID, 'sig-1')).resolves.toEqual({
      status: 'confirmed',
      balance: 350,
      signature: 'sig-1',
    });
    expect(sentUrl()).toBe('https://api.example.test/points/buy');
    expect(sentBody()).toEqual({ requestId: REQUEST_ID, signature: 'sig-1' });
  });

  it('rejects a malformed confirmation rather than assuming success', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ status: 'maybe', balance: 350 }));
    const { confirmPointBuy } = await import('../../src/net/points');

    await expect(confirmPointBuy(REQUEST_ID, 'sig-1')).rejects.toThrow(
      /purchase confirmation was invalid/,
    );
  });

  it('rejects a negative balance', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ status: 'confirmed', balance: -1 }));
    const { confirmPointBuy } = await import('../../src/net/points');

    await expect(confirmPointBuy(REQUEST_ID, 'sig-1')).rejects.toThrow(/invalid/);
  });

  it('surfaces the server error text on a failure status', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ error: 'Transaction is not confirmed yet' }, 409),
    );
    const { confirmPointBuy } = await import('../../src/net/points');

    await expect(confirmPointBuy(REQUEST_ID, 'sig-1')).rejects.toThrow(/not confirmed yet/);
  });

  it('falls back to the status code when the error body is not JSON', async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    } as unknown as Response);
    const { confirmPointBuy } = await import('../../src/net/points');

    await expect(confirmPointBuy(REQUEST_ID, 'sig-1')).rejects.toThrow(/Server returned 502/);
  });
});

describe('requestPointSell', () => {
  it('accepts a pending sale with a null signature', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ status: 'pending', balance: 150, signature: null }),
    );
    const { requestPointSell } = await import('../../src/net/points');

    await expect(requestPointSell(REQUEST_ID)).resolves.toMatchObject({ status: 'pending' });
    expect(sentUrl()).toBe('https://api.example.test/points/sell');
  });

  it('accepts a refunded sale', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ status: 'refunded', balance: 250 }));
    const { requestPointSell } = await import('../../src/net/points');

    await expect(requestPointSell(REQUEST_ID)).resolves.toMatchObject({ status: 'refunded' });
  });

  it('rejects an unrecognised sale status', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ status: 'settled', balance: 250 }));
    const { requestPointSell } = await import('../../src/net/points');

    await expect(requestPointSell(REQUEST_ID)).rejects.toThrow(/sale response was invalid/);
  });
});

describe('reserveOfflineWager', () => {
  it('sends the request id so the hold is idempotent', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ ok: true, requestId: REQUEST_ID, balance: 200, reason: null }),
    );
    const { reserveOfflineWager } = await import('../../src/net/points');

    await expect(reserveOfflineWager(REQUEST_ID)).resolves.toMatchObject({ ok: true });
    expect(sentUrl()).toBe('https://api.example.test/points/wager/reserve');
    expect(sentBody()).toEqual({ requestId: REQUEST_ID });
  });

  it('carries a refusal reason through instead of throwing', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ ok: false, requestId: REQUEST_ID, balance: 10, reason: 'insufficient_points' }),
    );
    const { reserveOfflineWager } = await import('../../src/net/points');

    await expect(reserveOfflineWager(REQUEST_ID)).resolves.toEqual({
      ok: false,
      requestId: REQUEST_ID,
      balance: 10,
      reason: 'insufficient_points',
    });
  });

  it('rejects a reservation whose requestId is not a uuid', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ ok: true, requestId: 'nope', balance: 200, reason: null }),
    );
    const { reserveOfflineWager } = await import('../../src/net/points');

    await expect(reserveOfflineWager(REQUEST_ID)).rejects.toThrow(
      /wager reservation response was invalid/,
    );
  });
});

describe('settleOfflineWager', () => {
  it('reports the win flag and returns the new balance', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ settled: true, balance: 300 }));
    const { settleOfflineWager } = await import('../../src/net/points');

    await expect(settleOfflineWager(REQUEST_ID, true)).resolves.toEqual({
      settled: true,
      balance: 300,
    });
    expect(sentBody()).toEqual({ requestId: REQUEST_ID, won: true });
  });

  it('sends won:false for a loss', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ settled: true, balance: 150 }));
    const { settleOfflineWager } = await import('../../src/net/points');

    await settleOfflineWager(REQUEST_ID, false);

    expect(sentBody()).toEqual({ requestId: REQUEST_ID, won: false });
  });

  it('rejects a settlement missing its balance', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ settled: true }));
    const { settleOfflineWager } = await import('../../src/net/points');

    await expect(settleOfflineWager(REQUEST_ID, true)).rejects.toThrow(
      /wager settlement response was invalid/,
    );
  });
});

describe('cancelPointWager', () => {
  it('returns the refund verdict', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ cancelled: true, refunded: true, balance: 250 }),
    );
    const { cancelPointWager } = await import('../../src/net/points');

    await expect(cancelPointWager(REQUEST_ID)).resolves.toEqual({
      cancelled: true,
      refunded: true,
      balance: 250,
    });
    expect(sentUrl()).toBe('https://api.example.test/points/wager/cancel');
  });

  it('allows a null balance when nothing was held', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ cancelled: false, refunded: false, balance: null }),
    );
    const { cancelPointWager } = await import('../../src/net/points');

    await expect(cancelPointWager(REQUEST_ID)).resolves.toMatchObject({ balance: null });
  });

  it('rejects a cancellation with a non-boolean verdict', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ cancelled: 'yes', refunded: false, balance: null }),
    );
    const { cancelPointWager } = await import('../../src/net/points');

    await expect(cancelPointWager(REQUEST_ID)).rejects.toThrow(
      /wager cancellation response was invalid/,
    );
  });
});

describe('API base resolution', () => {
  it('derives the base from the wss URL when no API URL is configured', async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_WS_URL = 'wss://api.example.test/ws';
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        quote: {
          balance: 0,
          points: 100,
          lamports: 1_000_000,
          sol: '0.001',
          treasuryAddress: 'Treasury1111111111111111111111111111111111',
        },
      }),
    );
    const { fetchPointQuote } = await import('../../src/net/points');

    await fetchPointQuote();

    expect(sentUrl()).toBe('https://api.example.test/points/quote');
  });

  it('fails clearly when neither address is configured', async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_WS_URL;
    const { fetchPointQuote } = await import('../../src/net/points');

    await expect(fetchPointQuote()).rejects.toThrow(/game server is not configured/);
  });

  it('rejects an unparseable ws URL', async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_WS_URL = ':::not a url:::';
    const { fetchPointQuote } = await import('../../src/net/points');

    await expect(fetchPointQuote()).rejects.toThrow(/game server address is invalid/);
  });

  it('rejects a quote whose rate does not match the supported trade', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        quote: {
          balance: 0,
          points: 250,
          lamports: 1_000_000,
          sol: '0.001',
          treasuryAddress: 'Treasury1111111111111111111111111111111111',
        },
      }),
    );
    const { fetchPointQuote } = await import('../../src/net/points');

    await expect(fetchPointQuote()).rejects.toThrow(/points quote was invalid/);
  });
});

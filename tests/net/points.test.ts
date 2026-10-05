/**
 * The client's points API. Every call is money-adjacent — a wager refund, a SOL
 * purchase, a payout — so each one validates its response shape and each one
 * must fail loudly rather than return a plausible-looking default. The calls
 * are idempotent by requestId; these pin that the id is actually sent.
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

describe('offline wagers (BUG-001)', () => {
  it('has no way to reserve or settle a stake outside a server-run match', async () => {
    const points = await import('../../src/net/points');

    // Removed with the server routes: a device could report a win it never
    // played and be paid for it, then sell the points for SOL.
    expect(points).not.toHaveProperty('reserveOfflineWager');
    expect(points).not.toHaveProperty('settleOfflineWager');
  });
});

describe('fetchPointQuote', () => {
  const quote = {
    balance: 250,
    points: 100,
    lamports: 1_000_000,
    sol: '0.001',
    treasuryAddress: 'TreasuryAddress1111111111111111111111111111',
  };

  it('reads how much of the balance can be sold, apart from welcome points', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ quote: { ...quote, sellableBalance: 100, lockedBalance: 150 } }),
    );
    const { fetchPointQuote, sellableOf } = await import('../../src/net/points');

    const read = await fetchPointQuote();
    expect(read).toMatchObject({ balance: 250, sellableBalance: 100, lockedBalance: 150 });
    expect(sellableOf(read)).toBe(100);
  });

  it('treats the whole balance as sellable against a server that predates the split', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ quote }));
    const { fetchPointQuote, sellableOf } = await import('../../src/net/points');

    expect(sellableOf(await fetchPointQuote())).toBe(250);
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

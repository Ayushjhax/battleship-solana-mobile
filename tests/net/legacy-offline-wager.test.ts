/**
 * BUG-001: offline wagers are gone, but a phone updated mid-wager can still
 * hold a persisted settlement from the old app — a stake taken before an
 * offline match, waiting to be paid out on the device's word. The server no
 * longer settles those. The stake goes back instead (through the same refund
 * route a cancelled matchmaking stake uses), whatever the device says the
 * result was.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/localStorage/install', () => ({}));

const store = vi.hoisted(() => {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    },
  });
  return map;
});

const mocks = vi.hoisted(() => ({
  ensureSession: vi.fn(),
  getAccessToken: vi.fn(),
  hasInternet: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../../src/net/auth', () => ({ ensureSession: mocks.ensureSession }));
vi.mock('../../src/net/api', () => ({ getAccessToken: mocks.getAccessToken }));
vi.mock('../../src/net/connectivity', () => ({ hasInternet: mocks.hasInternet }));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function persistLegacySettlement(won: boolean): void {
  // What an older build left in storage: a decided offline wager, unpaid.
  store.set(
    'eob.points',
    JSON.stringify({
      state: {
        balance: 50,
        ready: true,
        pendingBuy: null,
        pendingSellId: null,
        pendingWagerSettlement: { requestId: REQUEST_ID, stake: 50, won },
      },
      version: 1,
    }),
  );
}

function sentUrls(): string[] {
  return mocks.fetch.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  vi.resetModules();
  store.clear();
  for (const mock of Object.values(mocks)) mock.mockReset();
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  mocks.ensureSession.mockResolvedValue('profile-1');
  mocks.getAccessToken.mockResolvedValue({ ok: true, value: 'supabase-jwt' });
  mocks.hasInternet.mockResolvedValue(true);
  mocks.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ cancelled: false, refunded: false, balance: 100 }),
  } as unknown as Response);
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('a settlement left by an older version of the app', () => {
  it.each([true, false])('is refunded, never settled, when the device says won=%s', async (won) => {
    persistLegacySettlement(won);
    const { usePoints } = await import('../../src/state/points');
    const { flushPendingWager } = await import('../../src/net/offlineWager');
    expect(usePoints.getState().pendingWagerSettlement).toMatchObject({ requestId: REQUEST_ID });

    await expect(flushPendingWager()).resolves.toBe(true);

    expect(sentUrls()).toEqual(['https://api.example.test/points/wager/cancel']);
    expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1]?.body as string)).toEqual({ requestId: REQUEST_ID });
    expect(usePoints.getState().pendingWagerSettlement).toBeNull();
    expect(usePoints.getState().balance).toBe(100);
  });

  it('stays queued and retries later when the server cannot be reached', async () => {
    persistLegacySettlement(true);
    mocks.fetch.mockRejectedValue(new TypeError('Network request failed'));
    const { usePoints } = await import('../../src/state/points');
    const { flushPendingWager } = await import('../../src/net/offlineWager');

    await expect(flushPendingWager()).resolves.toBe(false);

    expect(usePoints.getState().pendingWagerSettlement).toMatchObject({ requestId: REQUEST_ID });
  });
});

/**
 * BUG-001: points could be minted without playing and sold for treasury SOL.
 *
 * POST /points/wager/reserve then POST /points/wager/settle {won: true} paid
 * twice the stake on the phone's word alone — +50 points per round trip, as
 * often as a script cared to call it — and points sell for SOL. Offline
 * wagers are removed: only a room the match server runs can carry a stake.
 * Separately, welcome points are now play money, so a sale that only welcome
 * points could cover is refused with a reason the app can show.
 */
import { Keypair } from '@solana/web3.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  sellPoints: vi.fn(),
  reservePointWager: vi.fn(),
  settleOfflineWager: vi.fn(),
  fetchPointBalances: vi.fn(),
  fetchPointBalance: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ verifyAccessToken: mocks.verifyAccessToken }));
vi.mock('../../src/privy', () => ({ verifyAndLoadPrivyUser: vi.fn(), normalizePrivyUser: vi.fn() }));
vi.mock('../../src/privySession', () => ({ bootstrapPrivySession: vi.fn() }));
vi.mock('../../src/ws', () => ({ attachWebSocketServer: vi.fn() }));
vi.mock('../../src/db', () => ({
  verifyDatabaseConnection: vi.fn(),
  verifyAuthAdminAccess: vi.fn(),
  checkDatabaseSchema: vi.fn(),
  upsertPrivyAccount: vi.fn(),
  applyOfflineResult: vi.fn(),
  fetchProfileRewardTotals: vi.fn(),
  reservePointWager: mocks.reservePointWager,
  settleOfflineWager: mocks.settleOfflineWager,
  fetchPointBalances: mocks.fetchPointBalances,
  fetchPointBalance: mocks.fetchPointBalance,
  fetchVerifiedWalletAddress: vi.fn(),
  completePointBuy: vi.fn(),
  beginPointSell: vi.fn(),
  completePointSell: vi.fn(),
  fetchPointTrade: vi.fn(),
  markPointSellBroadcast: vi.fn(),
  refundPointSell: vi.fn(),
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const AUTH = { authorization: 'Bearer gameplay-jwt' };

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('../../src/points');
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.verifyAccessToken.mockResolvedValue({
    ok: true,
    token: { userId: 'profile-1', isAnonymous: false },
  });
  mocks.reservePointWager.mockResolvedValue({ ok: true, requestId: REQUEST_ID, balance: 50, reason: null });
  mocks.settleOfflineWager.mockResolvedValue({ settled: true, balance: 200 });
});

async function server() {
  const { app } = await import('../../src/index');
  await app.ready();
  return app;
}

describe('offline wagers are gone', () => {
  it('no longer serves POST /points/wager/reserve', async () => {
    const app = await server();
    const response = await app.inject({
      method: 'POST',
      url: '/points/wager/reserve',
      headers: AUTH,
      payload: { requestId: REQUEST_ID },
    });

    expect(response.statusCode).toBe(404);
    expect(mocks.reservePointWager).not.toHaveBeenCalled();
  });

  it('no longer serves POST /points/wager/settle, so a reported win pays nothing', async () => {
    const app = await server();
    const response = await app.inject({
      method: 'POST',
      url: '/points/wager/settle',
      headers: AUTH,
      payload: { requestId: REQUEST_ID, won: true },
    });

    expect(response.statusCode).toBe(404);
    expect(mocks.settleOfflineWager).not.toHaveBeenCalled();
  });
});

describe('welcome points cannot be sold', () => {
  it('turns a sale only welcome points could cover into a 409 the app can show', async () => {
    vi.doMock('../../src/points', () => ({
      getPointQuote: vi.fn(),
      creditConfirmedPointPurchase: vi.fn(),
      sellPoints: mocks.sellPoints,
    }));
    mocks.sellPoints.mockRejectedValue(new Error('Welcome points cannot be exchanged for SOL'));
    const app = await server();

    const response = await app.inject({
      method: 'POST',
      url: '/points/sell',
      headers: AUTH,
      payload: { requestId: REQUEST_ID },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'welcome points cannot be exchanged for SOL' });
  });

  it('reports how much of the balance can be sold in the quote', async () => {
    const treasury = Keypair.generate();
    Object.assign(process.env, {
      SOLANA_RPC_URL: 'https://rpc.example.test',
      TREASURY_PUBLIC_KEY: treasury.publicKey.toBase58(),
      TREASURY_PRIVATE_KEY: JSON.stringify(Array.from(treasury.secretKey)),
      SELL_POINTS_COST: '100',
      SELL_SOL_PAYOUT: '0.001',
    });
    mocks.fetchPointBalances.mockResolvedValue({ balance: 250, locked: 150, sellable: 100 });
    mocks.fetchPointBalance.mockResolvedValue(250);
    const { getPointQuote } = await import('../../src/points');

    await expect(getPointQuote('profile-1')).resolves.toMatchObject({
      balance: 250,
      sellableBalance: 100,
      lockedBalance: 150,
    });
  });
});

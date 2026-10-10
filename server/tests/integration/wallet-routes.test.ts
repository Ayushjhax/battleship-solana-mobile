/**
 * The payment-wallet routes (0018) through Fastify's `inject`: who may call
 * them, the codes the app acts on, and what the history leaves out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class WalletSelectionError extends Error {
    constructor(
      readonly reason: 'conflict' | 'not_verified',
      message: string,
    ) {
      super(message);
    }
  }
  class PaymentWalletError extends Error {
    constructor(
      readonly reason: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    WalletSelectionError,
    PaymentWalletError,
    verifyAccessToken: vi.fn(),
    listVerifiedWallets: vi.fn(),
    fetchPaymentWallet: vi.fn(),
    selectPaymentWallet: vi.fn(),
    listPointTrades: vi.fn(),
    createPointBuyOrder: vi.fn(),
    creditConfirmedPointPurchase: vi.fn(),
    reconcilePointPurchase: vi.fn(),
    sellPoints: vi.fn(),
  };
});

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
  listVerifiedWallets: mocks.listVerifiedWallets,
  fetchPaymentWallet: mocks.fetchPaymentWallet,
  selectPaymentWallet: mocks.selectPaymentWallet,
  listPointTrades: mocks.listPointTrades,
  WalletSelectionError: mocks.WalletSelectionError,
}));
vi.mock('../../src/points', () => ({
  getPointQuote: vi.fn(),
  createPointBuyOrder: mocks.createPointBuyOrder,
  creditConfirmedPointPurchase: mocks.creditConfirmedPointPurchase,
  reconcilePointPurchase: mocks.reconcilePointPurchase,
  sellPoints: mocks.sellPoints,
  treasuryNetwork: vi.fn(async () => 'devnet'),
  PaymentWalletError: mocks.PaymentWalletError,
}));

const AUTH = { authorization: 'Bearer gameplay-jwt' };
const ADDRESS = 'So11111111111111111111111111111111111111112';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

async function server() {
  const { app } = await import('../../src/index');
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) if (typeof mock === 'function' && 'mockReset' in mock) mock.mockReset();
  mocks.verifyAccessToken.mockResolvedValue({ ok: true, token: { userId: 'profile-1', isAnonymous: false } });
});

describe('wallet routes', () => {
  it('require a gameplay session', async () => {
    mocks.verifyAccessToken.mockResolvedValue({ ok: false, reason: 'expired' });
    const app = await server();
    for (const [method, url] of [
      ['GET', '/wallets'],
      ['POST', '/wallets/payment'],
      ['POST', '/points/buy/order'],
      ['POST', '/points/buy/reconcile'],
      ['GET', '/points/trades'],
    ] as const) {
      const response = await app.inject({ method, url, headers: AUTH, payload: method === 'POST' ? {} : undefined });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('lists the verified wallets, the payment wallet and the network', async () => {
    mocks.listVerifiedWallets.mockResolvedValue([
      { address: ADDRESS, kind: 'external', wallet_client: 'seed_vault', verified_at: '2026-10-10T00:00:00Z' },
    ]);
    mocks.fetchPaymentWallet.mockResolvedValue({ address: ADDRESS, kind: 'external', chosen: false, problem: null });
    const app = await server();

    const response = await app.inject({ method: 'GET', url: '/wallets', headers: AUTH });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      wallets: [{ address: ADDRESS, kind: 'external', walletClient: 'seed_vault', verifiedAt: '2026-10-10T00:00:00Z' }],
      paymentWallet: { address: ADDRESS, kind: 'external', chosen: false, problem: null },
      network: 'devnet',
    });
  });

  it('turns another account’s wallet into a recoverable 409 conflict', async () => {
    mocks.selectPaymentWallet.mockRejectedValue(
      new mocks.WalletSelectionError('conflict', 'That wallet belongs to another account.'),
    );
    const app = await server();

    const response = await app.inject({ method: 'POST', url: '/wallets/payment', headers: AUTH, payload: { address: ADDRESS } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'That wallet belongs to another account.', code: 'wallet_conflict' });
  });

  it('refuses a wallet the account never verified', async () => {
    mocks.selectPaymentWallet.mockRejectedValue(
      new mocks.WalletSelectionError('not_verified', 'That wallet is not verified for this account.'),
    );
    const app = await server();

    const response = await app.inject({ method: 'POST', url: '/wallets/payment', headers: AUTH, payload: { address: ADDRESS } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'wallet_not_verified' });
  });

  it('says why no order can be made when the payment wallet is unavailable', async () => {
    mocks.createPointBuyOrder.mockRejectedValue(
      new mocks.PaymentWalletError('payment_wallet_unavailable', 'Choose a payment wallet again.'),
    );
    const app = await server();

    const response = await app.inject({ method: 'POST', url: '/points/buy/order', headers: AUTH, payload: { requestId: REQUEST_ID } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'Choose a payment wallet again.', code: 'payment_wallet_unavailable' });
  });

  it('refuses a payment from another wallet as a 422, not a retryable outage', async () => {
    mocks.creditConfirmedPointPurchase.mockRejectedValue(new Error('payment came from another wallet'));
    const app = await server();

    const response = await app.inject({
      method: 'POST',
      url: '/points/buy',
      headers: AUTH,
      payload: { requestId: REQUEST_ID, signature: '5'.repeat(88) },
    });

    expect(response.statusCode).toBe(422);
  });

  it('shows the history without any signed transaction or internal fields', async () => {
    mocks.listPointTrades.mockResolvedValue([
      {
        request_id: REQUEST_ID,
        profile_id: 'profile-1',
        privy_user_id: 'did:privy:x',
        kind: 'sell',
        status: 'broadcasting',
        points: 100,
        lamports: 1_000_000,
        signature: '5'.repeat(88),
        signed_transaction: 'SECRET-ISH-BYTES',
        blockhash: 'hash',
        last_valid_block_height: 10,
        payer_address: null,
        destination_address: ADDRESS,
        error: 'internal detail',
        expires_at: null,
        created_at: '2026-10-10T00:00:00Z',
        updated_at: '2026-10-10T00:00:01Z',
      },
    ]);
    const app = await server();

    const response = await app.inject({ method: 'GET', url: '/points/trades', headers: AUTH });

    expect(response.statusCode).toBe(200);
    const [trade] = response.json().trades;
    expect(trade).toEqual({
      requestId: REQUEST_ID,
      kind: 'sell',
      status: 'broadcasting',
      points: 100,
      lamports: 1_000_000,
      signature: '5'.repeat(88),
      payer: null,
      destination: ADDRESS,
      error: null,
      expiresAt: null,
      createdAt: '2026-10-10T00:00:00Z',
      updatedAt: '2026-10-10T00:00:01Z',
    });
    expect(response.body).not.toContain('SECRET-ISH-BYTES');
  });
});

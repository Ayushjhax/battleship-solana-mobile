/**
 * Buying and selling points with the account's payment wallet (0018).
 *
 * The wallet that pays for points, and the one a sale's SOL goes to, is the
 * account's payment wallet — the embedded wallet by default, or an external
 * wallet Privy verified (a wallet-only player's sign-in wallet, or one a
 * Google/email player linked and chose). These pin what the server promises
 * whichever it is:
 *
 *  - a buy order fixes its payer before anything is paid, and only a
 *    confirmed, successful transfer of the exact amount from that payer to the
 *    treasury credits it — once, whatever is retried or replayed;
 *  - a payment the app never reported (it closed after paying) is found by a
 *    reconcile and credited once, never asked for again;
 *  - a sale's destination is fixed when its points are reserved; a retry after
 *    a timeout pays that same address or nothing, and never signs twice.
 *
 * The SQL behind each step is exercised for real in supabase/verify-offline.mjs
 * (0018 section). Here the database is an in-memory stand-in with the same
 * rules, and the RPC is faked; Transaction, PublicKey and Keypair stay real,
 * so the transfer the treasury actually signs is decoded and checked.
 */
import { Keypair, PublicKey, SystemInstruction, Transaction } from '@solana/web3.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Trade = {
  request_id: string;
  profile_id: string;
  kind: 'buy' | 'sell';
  status: string;
  points: number;
  lamports: number;
  signature: string | null;
  signed_transaction: string | null;
  blockhash: string | null;
  last_valid_block_height: number | null;
  payer_address: string | null;
  destination_address: string | null;
  expires_at: string | null;
  error: string | null;
  created_at: string;
};

const state = vi.hoisted(() => ({
  trades: new Map<string, Trade>(),
  balance: 0,
  paymentWallet: { address: null as string | null, kind: null as string | null, chosen: false, problem: null as string | null },
  wallets: [] as { address: string; kind: 'embedded' | 'external' }[],
  embedded: '',
}));

const rpc = vi.hoisted(() => ({
  getGenesisHash: vi.fn(),
  getParsedTransaction: vi.fn(),
  getSignaturesForAddress: vi.fn(),
  getBalance: vi.fn(),
  getLatestBlockhash: vi.fn(),
  getSignatureStatuses: vi.fn(),
  getBlockHeight: vi.fn(),
  sendRawTransaction: vi.fn(),
  confirmTransaction: vi.fn(),
}));

vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    Connection: class {
      getGenesisHash = rpc.getGenesisHash;
      getParsedTransaction = rpc.getParsedTransaction;
      getSignaturesForAddress = rpc.getSignaturesForAddress;
      getBalance = rpc.getBalance;
      getLatestBlockhash = rpc.getLatestBlockhash;
      getSignatureStatuses = rpc.getSignatureStatuses;
      getBlockHeight = rpc.getBlockHeight;
      sendRawTransaction = rpc.sendRawTransaction;
      confirmTransaction = rpc.confirmTransaction;
    },
  };
});

const db = vi.hoisted(() => {
  const credited = (signature: string) =>
    [...state.trades.values()].some((trade) => trade.signature === signature);
  const verified = (address: string) => state.wallets.some((wallet) => wallet.address === address);
  const blank = (requestId: string, profileId: string, kind: 'buy' | 'sell'): Trade => ({
    request_id: requestId,
    profile_id: profileId,
    kind,
    status: 'processing',
    points: 100,
    lamports: 1_000_000,
    signature: null,
    signed_transaction: null,
    blockhash: null,
    last_valid_block_height: null,
    payer_address: null,
    destination_address: null,
    expires_at: null,
    error: null,
    created_at: new Date().toISOString(),
  });
  return {
    fetchPointTrade: vi.fn(async (requestId: string) => {
      const trade = state.trades.get(requestId);
      return trade ? { ...trade } : null;
    }),
    fetchPaymentWallet: vi.fn(async () => ({ ...state.paymentWallet })),
    fetchVerifiedWalletAddress: vi.fn(async () => state.embedded),
    fetchPointBalance: vi.fn(async () => state.balance),
    fetchPointBalances: vi.fn(async () => ({ balance: state.balance, locked: 0, sellable: state.balance })),
    listVerifiedWallets: vi.fn(async () =>
      state.wallets.map((wallet) => ({ ...wallet, wallet_client: null, verified_at: '' })),
    ),
    isSignatureCredited: vi.fn(async (signature: string) => credited(signature)),
    createPointBuyOrder: vi.fn(async (profileId: string, requestId: string, payer: string, expiresAt: string) => {
      if (state.trades.has(requestId)) return;
      if (!verified(payer)) throw new Error('wallet is not verified for this account');
      state.trades.set(requestId, {
        ...blank(requestId, profileId, 'buy'),
        status: 'awaiting_payment',
        payer_address: payer,
        expires_at: expiresAt,
      });
    }),
    creditPointBuyOrder: vi.fn(async (_profileId: string, requestId: string, signature: string, payer: string) => {
      const trade = state.trades.get(requestId);
      if (!trade) throw new Error('purchase order was not found');
      if (trade.status === 'confirmed') {
        if (trade.signature === signature) return state.balance;
        throw new Error('purchase order was already paid');
      }
      if (trade.payer_address !== payer) throw new Error('payment came from another wallet');
      if (credited(signature)) throw new Error('transaction was already credited');
      trade.status = 'confirmed';
      trade.signature = signature;
      state.balance += trade.points;
      return state.balance;
    }),
    completePointBuy: vi.fn(),
    beginPointSellTo: vi.fn(
      async (profileId: string, requestId: string, points: number, _lamports: number, destination: string) => {
        const existing = state.trades.get(requestId);
        if (existing) {
          return { ok: existing.status !== 'refunded', balance: state.balance, status: existing.status, reason: existing.error };
        }
        if (!verified(destination)) throw new Error('wallet is not verified for this account');
        if (state.balance < points) return { ok: false, balance: state.balance, status: 'rejected', reason: 'insufficient_points' };
        state.balance -= points;
        state.trades.set(requestId, { ...blank(requestId, profileId, 'sell'), destination_address: destination });
        return { ok: true, balance: state.balance, status: 'processing', reason: null };
      },
    ),
    beginPointSell: vi.fn(async (_profileId: string, requestId: string) => {
      const existing = state.trades.get(requestId) as Trade;
      return { ok: existing.status !== 'refunded', balance: state.balance, status: existing.status, reason: existing.error };
    }),
    markPointSellBroadcast: vi.fn(
      async (
        requestId: string,
        input: { signature: string; signedTransaction: string; blockhash: string; lastValidBlockHeight: number },
      ) => {
        const trade = state.trades.get(requestId) as Trade;
        if (trade.signature && trade.signature !== input.signature) throw new Error('sale is not available for broadcast');
        Object.assign(trade, {
          status: 'broadcasting',
          signature: input.signature,
          signed_transaction: input.signedTransaction,
          blockhash: input.blockhash,
          last_valid_block_height: input.lastValidBlockHeight,
        });
      },
    ),
    completePointSell: vi.fn(async (requestId: string) => {
      (state.trades.get(requestId) as Trade).status = 'confirmed';
      return state.balance;
    }),
    refundPointSell: vi.fn(async (requestId: string, reason: string) => {
      const trade = state.trades.get(requestId) as Trade;
      if (trade.status === 'processing' || trade.status === 'broadcasting') {
        state.balance += trade.points;
        trade.status = 'refunded';
        trade.error = reason;
      }
      return state.balance;
    }),
  };
});

vi.mock('../../src/db', () => db);

const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const TREASURY = Keypair.generate();
const TREASURY_ADDRESS = TREASURY.publicKey.toBase58();
const EMBEDDED = Keypair.generate().publicKey.toBase58();
const EXTERNAL = Keypair.generate().publicKey.toBase58();
const STRANGER = Keypair.generate().publicKey.toBase58();
const REQUEST = '11111111-1111-4111-8111-111111111111';
const REQUEST_2 = '22222222-2222-4222-8222-222222222222';
const SIGNATURE = '5'.repeat(88);
const OTHER_SIGNATURE = '4'.repeat(88);

function transferTx(source: string, destination: string, lamports: number, err: unknown = null) {
  return {
    meta: { err },
    transaction: {
      message: {
        instructions: [
          { program: 'system', parsed: { type: 'transfer', info: { source, destination, lamports } } },
        ],
      },
    },
  };
}

/** The recipient of the transfer the treasury signed for a sale. */
function signedRecipient(requestId: string): string {
  const trade = state.trades.get(requestId) as Trade;
  const transaction = Transaction.from(Buffer.from(trade.signed_transaction as string, 'base64'));
  const decoded = SystemInstruction.decodeTransfer(transaction.instructions[0]!);
  expect(decoded.fromPubkey.toBase58()).toBe(TREASURY_ADDRESS);
  return decoded.toPubkey.toBase58();
}

function payWith(kind: 'embedded' | 'external', chosen = false) {
  state.paymentWallet = { address: kind === 'embedded' ? EMBEDDED : EXTERNAL, kind, chosen, problem: null };
}

async function loadPoints() {
  return import('../../src/points');
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of [...Object.values(rpc), ...Object.values(db)]) mock.mockClear();
  state.trades.clear();
  state.balance = 200;
  state.embedded = EMBEDDED;
  state.wallets = [
    { address: EMBEDDED, kind: 'embedded' },
    { address: EXTERNAL, kind: 'external' },
  ];
  payWith('external', true);
  Object.assign(process.env, {
    SOLANA_RPC_URL: 'https://rpc.example.test',
    TREASURY_PUBLIC_KEY: TREASURY_ADDRESS,
    TREASURY_PRIVATE_KEY: JSON.stringify(Array.from(TREASURY.secretKey)),
    SELL_POINTS_COST: '100',
    SELL_SOL_PAYOUT: '0.001',
  });
  rpc.getGenesisHash.mockResolvedValue(MAINNET);
  rpc.getBalance.mockResolvedValue(1_000_000_000);
  rpc.getLatestBlockhash.mockResolvedValue({
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 1_000,
  });
  rpc.getSignatureStatuses.mockResolvedValue({ value: [null] });
  rpc.getBlockHeight.mockResolvedValue(900);
  rpc.sendRawTransaction.mockResolvedValue('sent');
  rpc.confirmTransaction.mockResolvedValue({ value: { err: null } });
  rpc.getSignaturesForAddress.mockResolvedValue([]);
});

describe('buying points with the payment wallet', () => {
  it('makes an order for the external wallet and credits only its transfer', async () => {
    const { createPointBuyOrder, creditConfirmedPointPurchase } = await loadPoints();

    const order = await createPointBuyOrder('profile-1', REQUEST);
    expect(order).toMatchObject({
      requestId: REQUEST,
      status: 'awaiting_payment',
      points: 100,
      lamports: 1_000_000,
      treasuryAddress: TREASURY_ADDRESS,
      network: 'mainnet-beta',
      payer: { address: EXTERNAL, kind: 'external' },
    });
    expect(Date.parse(order.expiresAt)).toBeGreaterThan(Date.now());

    rpc.getParsedTransaction.mockResolvedValue(transferTx(EXTERNAL, TREASURY_ADDRESS, 1_000_000));
    await expect(creditConfirmedPointPurchase('profile-1', REQUEST, SIGNATURE)).resolves.toBe(300);
    expect(db.creditPointBuyOrder).toHaveBeenCalledWith('profile-1', REQUEST, SIGNATURE, EXTERNAL);
    // The order path never falls back to the embedded wallet's legacy credit.
    expect(db.completePointBuy).not.toHaveBeenCalled();
  });

  it('refuses a transfer from the embedded wallet for an order made for the external one', async () => {
    const { createPointBuyOrder, creditConfirmedPointPurchase } = await loadPoints();
    await createPointBuyOrder('profile-1', REQUEST);
    rpc.getParsedTransaction.mockResolvedValue(transferTx(EMBEDDED, TREASURY_ADDRESS, 1_000_000));

    await expect(creditConfirmedPointPurchase('profile-1', REQUEST, SIGNATURE)).rejects.toThrow(
      /does not match this point purchase/,
    );
    expect(db.creditPointBuyOrder).not.toHaveBeenCalled();
    expect(state.balance).toBe(200);
  });

  it.each([
    ['the wrong amount', transferTx(EXTERNAL, TREASURY_ADDRESS, 999_999), /does not match/],
    ['another destination', transferTx(EXTERNAL, STRANGER, 1_000_000), /does not match/],
    ['a stranger as payer', transferTx(STRANGER, TREASURY_ADDRESS, 1_000_000), /does not match/],
    ['a failed transaction', transferTx(EXTERNAL, TREASURY_ADDRESS, 1_000_000, { InstructionError: [0, {}] }), /failed/],
    ['an unconfirmed transaction', null, /not confirmed yet/],
  ])('refuses %s', async (_name, transaction, message) => {
    const { createPointBuyOrder, creditConfirmedPointPurchase } = await loadPoints();
    await createPointBuyOrder('profile-1', REQUEST);
    rpc.getParsedTransaction.mockResolvedValue(transaction);

    await expect(creditConfirmedPointPurchase('profile-1', REQUEST, SIGNATURE)).rejects.toThrow(message);
    expect(state.balance).toBe(200);
  });

  it('keeps an order’s payer when the player switches payment wallets afterwards', async () => {
    const { createPointBuyOrder } = await loadPoints();
    await createPointBuyOrder('profile-1', REQUEST);
    payWith('embedded', true);

    const again = await createPointBuyOrder('profile-1', REQUEST);
    expect(again.payer).toEqual({ address: EXTERNAL, kind: 'external' });
    expect(db.createPointBuyOrder).toHaveBeenCalledTimes(1);
  });

  it('makes no order while the chosen payment wallet is unavailable, and never falls back', async () => {
    state.paymentWallet = { address: EXTERNAL, kind: null, chosen: true, problem: 'payment_wallet_unavailable' };
    const { createPointBuyOrder, PaymentWalletError } = await loadPoints();

    const attempt = createPointBuyOrder('profile-1', REQUEST);
    await expect(attempt).rejects.toBeInstanceOf(PaymentWalletError);
    await expect(attempt).rejects.toMatchObject({ reason: 'payment_wallet_unavailable' });
    expect(db.createPointBuyOrder).not.toHaveBeenCalled();
  });

  it('credits a retried report once, and never lets one payment credit two orders', async () => {
    const { createPointBuyOrder, creditConfirmedPointPurchase } = await loadPoints();
    await createPointBuyOrder('profile-1', REQUEST);
    await createPointBuyOrder('profile-1', REQUEST_2);
    rpc.getParsedTransaction.mockResolvedValue(transferTx(EXTERNAL, TREASURY_ADDRESS, 1_000_000));

    await creditConfirmedPointPurchase('profile-1', REQUEST, SIGNATURE);
    await expect(creditConfirmedPointPurchase('profile-1', REQUEST, SIGNATURE)).resolves.toBe(300);
    await expect(creditConfirmedPointPurchase('profile-1', REQUEST_2, SIGNATURE)).rejects.toThrow(
      /already credited/,
    );
    expect(state.balance).toBe(300);
  });

  it('refuses to credit another account’s order', async () => {
    const { createPointBuyOrder, creditConfirmedPointPurchase } = await loadPoints();
    await createPointBuyOrder('profile-1', REQUEST);

    await expect(creditConfirmedPointPurchase('profile-2', REQUEST, SIGNATURE)).rejects.toThrow(/conflicts/);
  });
});

describe('reconciling a payment the app never reported', () => {
  it('finds the payment among the payer’s transactions and credits it once', async () => {
    const { createPointBuyOrder, reconcilePointPurchase } = await loadPoints();
    await createPointBuyOrder('profile-1', REQUEST);
    const now = Math.floor(Date.now() / 1000);
    rpc.getSignaturesForAddress.mockResolvedValue([
      { signature: OTHER_SIGNATURE, blockTime: now, err: null },
      { signature: SIGNATURE, blockTime: now, err: null },
    ]);
    rpc.getParsedTransaction.mockImplementation(async (signature: string) =>
      signature === SIGNATURE
        ? transferTx(EXTERNAL, TREASURY_ADDRESS, 1_000_000)
        : transferTx(EXTERNAL, STRANGER, 5_000),
    );

    await expect(reconcilePointPurchase('profile-1', REQUEST)).resolves.toEqual({
      status: 'confirmed',
      balance: 300,
      signature: SIGNATURE,
    });
    expect(rpc.getSignaturesForAddress.mock.calls[0]?.[0]).toEqual(new PublicKey(EXTERNAL));

    await expect(reconcilePointPurchase('profile-1', REQUEST)).resolves.toMatchObject({
      status: 'confirmed',
      balance: 300,
    });
    expect(state.balance).toBe(300);
  });

  it('leaves an unpaid order awaiting payment, and ignores transactions older than it', async () => {
    const { createPointBuyOrder, reconcilePointPurchase } = await loadPoints();
    await createPointBuyOrder('profile-1', REQUEST);
    rpc.getSignaturesForAddress.mockResolvedValue([
      { signature: SIGNATURE, blockTime: Math.floor(Date.now() / 1000) - 86_400, err: null },
    ]);
    rpc.getParsedTransaction.mockResolvedValue(transferTx(EXTERNAL, TREASURY_ADDRESS, 1_000_000));

    await expect(reconcilePointPurchase('profile-1', REQUEST)).resolves.toMatchObject({
      status: 'awaiting_payment',
      balance: 200,
    });
    expect(rpc.getParsedTransaction).not.toHaveBeenCalled();
  });

  it('skips a transfer that already credited another order', async () => {
    const { createPointBuyOrder, creditConfirmedPointPurchase, reconcilePointPurchase } = await loadPoints();
    await createPointBuyOrder('profile-1', REQUEST);
    await createPointBuyOrder('profile-1', REQUEST_2);
    rpc.getParsedTransaction.mockResolvedValue(transferTx(EXTERNAL, TREASURY_ADDRESS, 1_000_000));
    await creditConfirmedPointPurchase('profile-1', REQUEST, SIGNATURE);
    rpc.getSignaturesForAddress.mockResolvedValue([
      { signature: SIGNATURE, blockTime: Math.floor(Date.now() / 1000), err: null },
    ]);

    await expect(reconcilePointPurchase('profile-1', REQUEST_2)).resolves.toMatchObject({
      status: 'awaiting_payment',
      balance: 300,
    });
  });
});

describe('selling points to the payment wallet', () => {
  it('pays the external payment wallet with a transfer the treasury signs', async () => {
    const { sellPoints } = await loadPoints();

    await expect(sellPoints('profile-1', REQUEST)).resolves.toMatchObject({
      status: 'confirmed',
      balance: 100,
      destination: EXTERNAL,
    });
    expect(signedRecipient(REQUEST)).toBe(EXTERNAL);
    expect(db.beginPointSellTo).toHaveBeenCalledWith('profile-1', REQUEST, 100, 1_000_000, EXTERNAL);
  });

  it('after a timeout, a retry pays the same address and never signs a second transfer', async () => {
    const { sellPoints } = await loadPoints();
    rpc.confirmTransaction.mockRejectedValueOnce(new Error('block height exceeded… or a timeout'));

    const first = await sellPoints('profile-1', REQUEST);
    expect(first).toMatchObject({ status: 'pending', destination: EXTERNAL });
    const firstSignature = state.trades.get(REQUEST)?.signature;

    // The player switches wallets while the payout is in flight.
    payWith('embedded', true);
    rpc.getSignatureStatuses.mockResolvedValue({ value: [{ confirmationStatus: 'confirmed', err: null }] });
    const retry = await sellPoints('profile-1', REQUEST);

    expect(retry).toMatchObject({ status: 'confirmed', destination: EXTERNAL, signature: firstSignature });
    expect(db.markPointSellBroadcast).toHaveBeenCalledTimes(1);
    expect(signedRecipient(REQUEST)).toBe(EXTERNAL);
    expect(state.balance).toBe(100);
  });

  it('refunds a payout whose blockhash expired unconfirmed, and only then', async () => {
    const { sellPoints } = await loadPoints();
    rpc.confirmTransaction.mockRejectedValueOnce(new Error('timeout'));
    await sellPoints('profile-1', REQUEST);
    expect(state.balance).toBe(100);

    rpc.getBlockHeight.mockResolvedValue(1_001);
    await expect(sellPoints('profile-1', REQUEST)).resolves.toMatchObject({ status: 'refunded', balance: 200 });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('refunds a payout that failed on chain', async () => {
    const { sellPoints } = await loadPoints();
    rpc.confirmTransaction.mockRejectedValueOnce(new Error('timeout'));
    await sellPoints('profile-1', REQUEST);
    rpc.getSignatureStatuses.mockResolvedValue({ value: [{ err: { InstructionError: [0, {}] } }] });

    await expect(sellPoints('profile-1', REQUEST)).resolves.toMatchObject({ status: 'refunded', balance: 200 });
  });

  it('refunds before signing anything when the treasury cannot cover the payout', async () => {
    rpc.getBalance.mockResolvedValue(0);
    const { sellPoints } = await loadPoints();

    await expect(sellPoints('profile-1', REQUEST)).resolves.toMatchObject({ status: 'refunded', balance: 200 });
    expect(db.markPointSellBroadcast).not.toHaveBeenCalled();
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('reserves nothing while the chosen payment wallet is unavailable', async () => {
    state.paymentWallet = { address: EXTERNAL, kind: null, chosen: true, problem: 'payment_wallet_unavailable' };
    const { sellPoints, PaymentWalletError } = await loadPoints();

    await expect(sellPoints('profile-1', REQUEST)).rejects.toBeInstanceOf(PaymentWalletError);
    expect(db.beginPointSellTo).not.toHaveBeenCalled();
    expect(state.balance).toBe(200);
  });

  it('pays a sale reserved before 0018 to the embedded wallet it was always for', async () => {
    state.trades.set(REQUEST, {
      request_id: REQUEST,
      profile_id: 'profile-1',
      kind: 'sell',
      status: 'processing',
      points: 100,
      lamports: 1_000_000,
      signature: null,
      signed_transaction: null,
      blockhash: null,
      last_valid_block_height: null,
      payer_address: null,
      destination_address: null,
      expires_at: null,
      error: null,
      created_at: new Date().toISOString(),
    });
    state.balance = 100;
    const { sellPoints } = await loadPoints();

    await expect(sellPoints('profile-1', REQUEST)).resolves.toMatchObject({
      status: 'confirmed',
      destination: EMBEDDED,
    });
    expect(signedRecipient(REQUEST)).toBe(EMBEDDED);
  });

  it('pays a wallet-only player’s own wallet with no embedded wallet anywhere', async () => {
    state.embedded = '';
    state.wallets = [{ address: EXTERNAL, kind: 'external' }];
    payWith('external');
    db.fetchVerifiedWalletAddress.mockRejectedValue(new Error('verified Solana wallet: not available'));
    const { sellPoints } = await loadPoints();

    await expect(sellPoints('profile-1', REQUEST)).resolves.toMatchObject({
      status: 'confirmed',
      destination: EXTERNAL,
    });
    expect(signedRecipient(REQUEST)).toBe(EXTERNAL);
  });
});

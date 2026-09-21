/**
 * Treasury configuration and on-chain purchase verification.
 *
 * `treasury()` throws "Treasury wallet is not configured on the server" when
 * SOLANA_RPC_URL is missing — which is exactly what an EC2 box gets if the
 * variable never made it into .env, and it surfaces to the player as a dead
 * points screen. These pin every configuration branch, plus the transfer
 * matching that stops someone crediting themselves from another wallet.
 */
import { Keypair } from '@solana/web3.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getParsedTransaction: vi.fn(),
  fetchPointBalance: vi.fn(),
  fetchVerifiedWalletAddress: vi.fn(),
  completePointBuy: vi.fn(),
}));

// Only the RPC connection is faked; Keypair/PublicKey stay real so the
// key-matching branch is genuinely exercised.
vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    Connection: class {
      getParsedTransaction = mocks.getParsedTransaction;
    },
  };
});

vi.mock('../../src/db', () => ({
  fetchPointBalance: mocks.fetchPointBalance,
  fetchVerifiedWalletAddress: mocks.fetchVerifiedWalletAddress,
  completePointBuy: mocks.completePointBuy,
  beginPointSell: vi.fn(),
  completePointSell: vi.fn(),
  fetchPointTrade: vi.fn(),
  markPointSellBroadcast: vi.fn(),
  refundPointSell: vi.fn(),
}));

const TREASURY = Keypair.generate();
const PLAYER_WALLET = Keypair.generate().publicKey.toBase58();
const TREASURY_ADDRESS = TREASURY.publicKey.toBase58();
const SECRET_JSON = JSON.stringify(Array.from(TREASURY.secretKey));

const GOOD_ENV = {
  SOLANA_RPC_URL: 'https://rpc.example.test',
  TREASURY_PUBLIC_KEY: TREASURY_ADDRESS,
  TREASURY_PRIVATE_KEY: SECRET_JSON,
  SELL_POINTS_COST: '100',
  SELL_SOL_PAYOUT: '0.001',
};

const ENV_KEYS = Object.keys(GOOD_ENV);

function setEnv(overrides: Record<string, string | undefined> = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries({ ...GOOD_ENV, ...overrides })) {
    if (value !== undefined) process.env[key] = value;
  }
}

async function loadPoints() {
  return import('../../src/points');
}

/** A parsed system transfer as getParsedTransaction returns it. */
function transferTx(
  source: string,
  destination: string,
  lamports: number,
  extra: { err?: unknown } = {},
) {
  return {
    meta: { err: extra.err ?? null },
    transaction: {
      message: {
        instructions: [
          { program: 'system', parsed: { type: 'transfer', info: { source, destination, lamports } } },
        ],
      },
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.fetchPointBalance.mockResolvedValue(250);
  mocks.fetchVerifiedWalletAddress.mockResolvedValue(PLAYER_WALLET);
  mocks.completePointBuy.mockResolvedValue(350);
  setEnv();
});

describe('treasury configuration', () => {
  it('serves a quote when fully configured', async () => {
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).resolves.toEqual({
      balance: 250,
      points: 100,
      lamports: 1_000_000,
      sol: '0.001',
      treasuryAddress: TREASURY_ADDRESS,
    });
  });

  it('refuses to run with SOLANA_RPC_URL missing', async () => {
    // The live EC2 failure: .env was copied without this key.
    setEnv({ SOLANA_RPC_URL: undefined });
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).rejects.toThrow(
      /Treasury wallet is not configured on the server/,
    );
  });

  it('refuses to run with TREASURY_PUBLIC_KEY missing', async () => {
    setEnv({ TREASURY_PUBLIC_KEY: undefined });
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).rejects.toThrow(/not configured/);
  });

  it('refuses to run with TREASURY_PRIVATE_KEY missing', async () => {
    setEnv({ TREASURY_PRIVATE_KEY: undefined });
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).rejects.toThrow(/not configured/);
  });

  it('rejects a private key that is not JSON', async () => {
    setEnv({ TREASURY_PRIVATE_KEY: 'not-json' });
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).rejects.toThrow(/must be a JSON byte array/);
  });

  it('rejects a private key of the wrong length', async () => {
    setEnv({ TREASURY_PRIVATE_KEY: JSON.stringify([1, 2, 3]) });
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).rejects.toThrow(/exactly 64 bytes/);
  });

  it('rejects a private key holding out-of-range bytes', async () => {
    setEnv({ TREASURY_PRIVATE_KEY: JSON.stringify(new Array(64).fill(999)) });
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).rejects.toThrow(/exactly 64 bytes/);
  });

  it('rejects a private key that does not match the declared public key', async () => {
    // Catches a half-rotated treasury: right format, wrong wallet.
    setEnv({ TREASURY_PUBLIC_KEY: Keypair.generate().publicKey.toBase58() });
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).rejects.toThrow(
      /does not match TREASURY_PUBLIC_KEY/,
    );
  });

  it('rejects a points cost that disagrees with the supported quote', async () => {
    setEnv({ SELL_POINTS_COST: '250' });
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).rejects.toThrow(/rate does not match/);
  });

  it('rejects a SOL payout that disagrees with the supported quote', async () => {
    setEnv({ SELL_SOL_PAYOUT: '0.05' });
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).rejects.toThrow(/rate does not match/);
  });

  it('rejects an unparseable SOL payout', async () => {
    setEnv({ SELL_SOL_PAYOUT: 'half a sol' });
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).rejects.toThrow(/rate does not match/);
  });

  it('accepts the payout written with trailing zeros', async () => {
    setEnv({ SELL_SOL_PAYOUT: '0.001000' });
    const { getPointQuote } = await loadPoints();

    await expect(getPointQuote('profile-1')).resolves.toMatchObject({ lamports: 1_000_000 });
  });

  it('caches the runtime so repeated quotes do not rebuild the keypair', async () => {
    const { getPointQuote } = await loadPoints();

    await getPointQuote('profile-1');
    // Clearing env after the first call must not break the cached runtime.
    setEnv({ SOLANA_RPC_URL: undefined });

    await expect(getPointQuote('profile-1')).resolves.toMatchObject({
      treasuryAddress: TREASURY_ADDRESS,
    });
  });
});

describe('creditConfirmedPointPurchase', () => {
  it('credits a matching transfer from the verified wallet', async () => {
    mocks.getParsedTransaction.mockResolvedValue(
      transferTx(PLAYER_WALLET, TREASURY_ADDRESS, 1_000_000),
    );
    const { creditConfirmedPointPurchase } = await loadPoints();

    await expect(
      creditConfirmedPointPurchase('profile-1', 'request-1', 'signature-1'),
    ).resolves.toBe(350);
    expect(mocks.completePointBuy).toHaveBeenCalledWith(
      'profile-1',
      'request-1',
      'signature-1',
      100,
      1_000_000,
    );
  });

  it('refuses an unconfirmed transaction', async () => {
    mocks.getParsedTransaction.mockResolvedValue(null);
    const { creditConfirmedPointPurchase } = await loadPoints();

    await expect(
      creditConfirmedPointPurchase('profile-1', 'request-1', 'signature-1'),
    ).rejects.toThrow(/not confirmed yet/);
    expect(mocks.completePointBuy).not.toHaveBeenCalled();
  });

  it('refuses a transaction that failed on chain', async () => {
    mocks.getParsedTransaction.mockResolvedValue(
      transferTx(PLAYER_WALLET, TREASURY_ADDRESS, 1_000_000, { err: { InstructionError: [0, {}] } }),
    );
    const { creditConfirmedPointPurchase } = await loadPoints();

    await expect(
      creditConfirmedPointPurchase('profile-1', 'request-1', 'signature-1'),
    ).rejects.toThrow(/Solana transaction failed/);
  });

  it('refuses a transfer sent from somebody else’s wallet', async () => {
    const stranger = Keypair.generate().publicKey.toBase58();
    mocks.getParsedTransaction.mockResolvedValue(
      transferTx(stranger, TREASURY_ADDRESS, 1_000_000),
    );
    const { creditConfirmedPointPurchase } = await loadPoints();

    await expect(
      creditConfirmedPointPurchase('profile-1', 'request-1', 'signature-1'),
    ).rejects.toThrow(/does not match this point purchase/);
    expect(mocks.completePointBuy).not.toHaveBeenCalled();
  });

  it('refuses a transfer sent to the wrong destination', async () => {
    const elsewhere = Keypair.generate().publicKey.toBase58();
    mocks.getParsedTransaction.mockResolvedValue(
      transferTx(PLAYER_WALLET, elsewhere, 1_000_000),
    );
    const { creditConfirmedPointPurchase } = await loadPoints();

    await expect(
      creditConfirmedPointPurchase('profile-1', 'request-1', 'signature-1'),
    ).rejects.toThrow(/does not match/);
  });

  it('refuses an underpaid transfer', async () => {
    mocks.getParsedTransaction.mockResolvedValue(
      transferTx(PLAYER_WALLET, TREASURY_ADDRESS, 999_999),
    );
    const { creditConfirmedPointPurchase } = await loadPoints();

    await expect(
      creditConfirmedPointPurchase('profile-1', 'request-1', 'signature-1'),
    ).rejects.toThrow(/does not match/);
  });

  it('ignores non-system instructions when looking for the transfer', async () => {
    mocks.getParsedTransaction.mockResolvedValue({
      meta: { err: null },
      transaction: {
        message: {
          instructions: [
            { program: 'spl-token', parsed: { type: 'transfer', info: {} } },
            { programId: 'someProgram', accounts: [], data: 'deadbeef' },
            {
              program: 'system',
              parsed: {
                type: 'transfer',
                info: { source: PLAYER_WALLET, destination: TREASURY_ADDRESS, lamports: 1_000_000 },
              },
            },
          ],
        },
      },
    });
    const { creditConfirmedPointPurchase } = await loadPoints();

    await expect(
      creditConfirmedPointPurchase('profile-1', 'request-1', 'signature-1'),
    ).resolves.toBe(350);
  });

  it('refuses a system instruction that is not a transfer', async () => {
    mocks.getParsedTransaction.mockResolvedValue({
      meta: { err: null },
      transaction: {
        message: {
          instructions: [
            { program: 'system', parsed: { type: 'createAccount', info: { lamports: 1_000_000 } } },
          ],
        },
      },
    });
    const { creditConfirmedPointPurchase } = await loadPoints();

    await expect(
      creditConfirmedPointPurchase('profile-1', 'request-1', 'signature-1'),
    ).rejects.toThrow(/does not match/);
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import {
  formatLamports,
  isRentError,
  parseSolToLamports,
  shortAddress,
  solanaConfig,
  transferShortfall,
  depositNeeded,
  maxWithdrawal,
} from '../solana';

describe('Solana wallet helpers', () => {
  it('parses SOL without floating-point rounding', () => {
    expect(parseSolToLamports('1')).toBe(1_000_000_000n);
    expect(parseSolToLamports('0.000000001')).toBe(1n);
    expect(parseSolToLamports('12.345678901')).toBe(12_345_678_901n);
  });

  it('rejects zero, negative, exponential and over-precision amounts', () => {
    for (const value of ['0', '-1', '1e-3', '0.0000000001', '1.', '.5', 'abc']) {
      expect(parseSolToLamports(value)).toBeNull();
    }
  });

  it('shortens addresses without changing short values', () => {
    expect(shortAddress('1234567890abcdef', 4)).toBe('1234…cdef');
    expect(shortAddress('short', 4)).toBe('short');
  });
});

describe('transferShortfall', () => {
  const rentExemptMinimum = 650_240;

  it('passes a transfer that leaves at least the rent-exempt minimum', () => {
    expect(transferShortfall({ balance: 6_980_000, lamports: 1_000_000, rentExemptMinimum })).toBeNull();
  });

  it('allows emptying the wallet exactly', () => {
    expect(transferShortfall({ balance: 1_005_000, lamports: 1_000_000, rentExemptMinimum })).toBeNull();
  });

  it('flags a transfer that would leave dust below the minimum', () => {
    expect(transferShortfall({ balance: 1_500_000, lamports: 1_000_000, rentExemptMinimum })).toEqual({
      kind: 'sender-rent',
      maxLamports: 844_760,
      emptyLamports: 1_495_000,
    });
  });

  it('flags an amount above the balance', () => {
    expect(transferShortfall({ balance: 500_000, lamports: 1_000_000, rentExemptMinimum })).toEqual({
      kind: 'balance',
      maxLamports: 495_000,
    });
  });

  it('flags an under-funded first transfer to a new address', () => {
    expect(
      transferShortfall({ balance: 5_000_000, lamports: 500_000, rentExemptMinimum, recipientBalance: 0 }),
    ).toEqual({ kind: 'recipient-rent', minLamports: rentExemptMinimum });
    expect(
      transferShortfall({ balance: 5_000_000, lamports: 500_000, rentExemptMinimum, recipientBalance: 1 }),
    ).toBeNull();
  });

  it('recognises the RPC rent error', () => {
    expect(isRentError('Transaction results in an account (0) with insufficient funds for rent')).toBe(true);
    expect(isRentError('{"InsufficientFundsForRent":{"account_index":0}}')).toBe(true);
    expect(isRentError('Blockhash not found')).toBe(false);
  });

  it('formats lamports without trailing zeros', () => {
    expect(formatLamports(650_240)).toBe('0.00065024');
    expect(formatLamports(1_000_000_000)).toBe('1');
  });
});

// BUG-009: the app's RPC URL was the server's private one (API key and all),
// so every APK shipped the server's key. The app now reads a variable of its
// own, meant for a separate, restricted key, and never the old name.
describe('solanaConfig', () => {
  const KEYS = ['EXPO_PUBLIC_SOLANA_APP_RPC_URL', 'EXPO_PUBLIC_SOLANA_RPC_URL', 'EXPO_PUBLIC_SOLANA_CLUSTER'] as const;
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('uses the app-only RPC variable when it is set', () => {
    process.env.EXPO_PUBLIC_SOLANA_CLUSTER = 'mainnet-beta';
    process.env.EXPO_PUBLIC_SOLANA_APP_RPC_URL = 'https://rpc.example.test/app-restricted';
    expect(solanaConfig().rpcUrl).toBe('https://rpc.example.test/app-restricted');
  });

  it('never reads the old shared variable, and falls back to the public endpoint', () => {
    process.env.EXPO_PUBLIC_SOLANA_CLUSTER = 'mainnet-beta';
    delete process.env.EXPO_PUBLIC_SOLANA_APP_RPC_URL;
    process.env.EXPO_PUBLIC_SOLANA_RPC_URL = 'https://rpc.example.test/?api-key=server-secret';
    expect(solanaConfig().rpcUrl).toBe('https://api.mainnet-beta.solana.com');
  });
});

/** The game wallet's deposit and withdrawal limits, shown on the wallet screen. */
describe('deposit and withdrawal limits', () => {
  // Mainnet's figures on 2026-10-11 for a plain system account (read live by the app).
  const rentExemptMinimum = 650_240;
  const feeLamports = 5_000;

  it('a deposit must cover the price, the fee and the rent reserve', () => {
    expect(depositNeeded({ priceLamports: 1_000_000, rentExemptMinimum, feeLamports, balance: null })).toEqual({
      minimumDeposit: 1_655_240,
      topUp: null,
    });
  });

  it('names only what is still missing', () => {
    expect(depositNeeded({ priceLamports: 1_000_000, rentExemptMinimum, feeLamports, balance: 1_000_000 }).topUp).toBe(655_240);
    expect(depositNeeded({ priceLamports: 1_000_000, rentExemptMinimum, feeLamports, balance: 2_000_000 }).topUp).toBe(0);
  });

  it('a withdrawal leaves the rent reserve behind and pays its fee', () => {
    expect(maxWithdrawal({ balance: 10_000_000, rentExemptMinimum, feeLamports })).toBe(9_344_760);
  });

  it('never empties the wallet, and never goes negative', () => {
    expect(maxWithdrawal({ balance: 655_240, rentExemptMinimum, feeLamports })).toBe(0);
    expect(maxWithdrawal({ balance: 100, rentExemptMinimum, feeLamports })).toBe(0);
  });
});

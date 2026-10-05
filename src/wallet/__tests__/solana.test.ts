import { describe, expect, it } from 'vitest';

import { formatLamports, isRentError, parseSolToLamports, shortAddress, transferShortfall } from '../solana';

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

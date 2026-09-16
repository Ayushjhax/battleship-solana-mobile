import { describe, expect, it } from 'vitest';

import { parseSolToLamports, shortAddress } from '../solana';

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

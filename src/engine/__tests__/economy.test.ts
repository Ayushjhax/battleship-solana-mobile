/**
 * The platform fee's arithmetic.
 *
 * The real pot is fixed at 100 points by the wager stake, but the rule must
 * also hold for the odd totals the design calls out — a 1-point gross pays
 * the winner 1 and records no fee. These cases are the shared source the
 * client preview and the SQL settlement (0025) both implement; the pglite
 * suite pins the SQL to this file.
 */
import { describe, expect, it } from 'vitest';

import {
  PLATFORM_FEE_PERCENT,
  WAGER_STAKE,
  platformFee,
  wagerBreakdown,
  wagerPot,
  winnerPayout,
} from '../economy';

describe('platform fee', () => {
  it('takes 5% with floor rounding and preserves the gross', () => {
    // The design's worked example.
    expect(wagerBreakdown(200)).toEqual({ gross: 200, fee: 10, payout: 190 });
    // The real 100-point pot.
    expect(wagerBreakdown(100)).toEqual({ gross: 100, fee: 5, payout: 95 });
    // A 1-point gross: the winner keeps the point, the fee floors to zero.
    expect(wagerBreakdown(1)).toEqual({ gross: 1, fee: 0, payout: 1 });
    // Odd totals round in the platform's disfavour, never the winner's.
    expect(wagerBreakdown(99)).toEqual({ gross: 99, fee: 4, payout: 95 });
    expect(wagerBreakdown(7)).toEqual({ gross: 7, fee: 0, payout: 7 });
    expect(wagerBreakdown(20)).toEqual({ gross: 20, fee: 1, payout: 19 });
    expect(wagerBreakdown(0)).toEqual({ gross: 0, fee: 0, payout: 0 });
  });

  it('keeps gross = fee + payout for every integer in a wide range', () => {
    for (let gross = 0; gross <= 1_000; gross++) {
      const { fee, payout } = wagerBreakdown(gross);
      expect(fee + payout).toBe(gross);
      expect(payout).toBeGreaterThanOrEqual(gross - Math.ceil(gross / 20));
    }
  });

  it('rejects inputs that are not non-negative safe integers', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => platformFee(bad)).toThrow();
    }
  });

  it('uses one canonical stake and pot', () => {
    expect(WAGER_STAKE).toBe(50);
    expect(PLATFORM_FEE_PERCENT).toBe(5);
    expect(wagerPot()).toBe(100);
    expect(wagerPot(WAGER_STAKE)).toBe(100);
    expect(winnerPayout(wagerPot())).toBe(95);
  });
});

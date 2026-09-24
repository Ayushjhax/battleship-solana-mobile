/**
 * The wager economy's shared arithmetic — the one place the stake, the
 * platform fee and the winner's payout are defined.
 *
 * The gross award is the pooled pot: both captains stake WAGER_STAKE and the
 * winner takes the whole pot, which is why gross = stake * 2 and not a single
 * captain's stake. The platform keeps PLATFORM_FEE_PERCENT of that gross.
 *
 * Rounding is exact and documented: fee = floor(gross * 5 / 100) and
 * payout = gross - fee, so `gross === fee + payout` always holds and no
 * fractional point ever exists. For a 100-point pot that is fee 5 / payout 95;
 * for a 1-point pot it is fee 0 / payout 1.
 *
 * Pure engine code: no React, no network, no clock. The client previews with
 * these functions and the SQL settlement (0025_platform_fee.sql) implements
 * the same rule; tests pin the two together.
 */

/** One captain's stake. Mirrored by reserve_point_wager's SQL check. */
export const WAGER_STAKE = 50;

/** The platform's share of a completed online human-vs-human pot. */
export const PLATFORM_FEE_PERCENT = 5;

/**
 * The platform's cut of a gross award, in whole points.
 *
 * Integer-only: `Math.floor` on an already-integer product. The bound keeps
 * the multiplication inside Number.MAX_SAFE_INTEGER so an absurd input can
 * never round silently.
 */
export function platformFee(grossAward: number): number {
  if (!Number.isSafeInteger(grossAward) || grossAward < 0) {
    throw new Error(`platformFee needs a non-negative safe integer, got ${String(grossAward)}`);
  }
  const scaled = grossAward * PLATFORM_FEE_PERCENT;
  if (!Number.isSafeInteger(scaled)) {
    throw new Error(`platformFee(${grossAward}) overflows safe integer arithmetic`);
  }
  return Math.floor(scaled / 100);
}

/** What the winner receives after the platform fee. */
export function winnerPayout(grossAward: number): number {
  return grossAward - platformFee(grossAward);
}

export interface WagerBreakdown {
  /** The pooled pot the winner would otherwise take in full. */
  readonly gross: number;
  /** The platform's cut, held in the platform fee account. */
  readonly fee: number;
  /** What the winner's balance is credited. */
  readonly payout: number;
}

/**
 * The full breakdown, with the invariant asserted rather than assumed. The
 * check is cheap and this function is called on money paths, so a future
 * edit that breaks `gross = fee + payout` fails loudly instead of quietly
 * losing a point.
 */
export function wagerBreakdown(grossAward: number): WagerBreakdown {
  const fee = platformFee(grossAward);
  const payout = grossAward - fee;
  if (fee + payout !== grossAward) {
    throw new Error(`wager breakdown does not balance for gross ${grossAward}`);
  }
  return { gross: grossAward, fee, payout };
}

/** The pot both captains' stakes make, from the canonical stake. */
export function wagerPot(stake: number = WAGER_STAKE): number {
  if (!Number.isSafeInteger(stake) || stake < 0) {
    throw new Error(`wagerPot needs a non-negative safe integer, got ${String(stake)}`);
  }
  return stake * 2;
}

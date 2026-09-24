/**
 * The three displayed currencies, described once.
 *
 * Every balance chip and every explanation sheet reads from here, so a
 * currency can never be described two different ways on two screens. The copy
 * is checked against the code and the product docs, not inferred from the
 * icon colour:
 *
 *   - Captain's points — public.point_accounts.balance (0010) and
 *     server/src/points.ts: a 100-point welcome award, buy/sell at 100 points
 *     per 0.001 SOL, and a 50-point stake whose winner takes the 100-point
 *     pot.
 *   - Coins — profiles.coins and src/engine/ranks.ts REWARD (+50 win / +10
 *     loss), plus the Port City collectors and raid/war/voyage rewards
 *     (docs/port-city/part-01 §1-§2).
 *   - Gems — profiles.gems and docs/port-city/part-01 §2.6-§2.7: Admiralty
 *     grants, rank back-pay, wars, puzzles, voyages and seasons; spent on
 *     dock workers, speed-ups and cosmetics.
 *
 * Steel is a fourth Port City resource and deliberately has no entry: the
 * product asked for explanations on the three balances above, and inventing
 * copy for a currency nobody asked about would be worse than omitting it.
 */

export type CurrencyId = 'points' | 'coins' | 'gems';

export interface CurrencyInfo {
  readonly id: CurrencyId;
  /** The CurrencyChip kind this describes. */
  readonly chip: 'points' | 'coins' | 'gems';
  /** The full name, used in headings and accessibility labels. */
  readonly name: string;
  /** A one-line "what it is" for the sheet body. */
  readonly what: string;
  /** Verified ways to obtain it. Never a guess, never a cash value. */
  readonly earned: readonly string[];
  /** Verified things it pays for. */
  readonly used: readonly string[];
}

export const CURRENCIES: Readonly<Record<CurrencyId, CurrencyInfo>> = {
  points: {
    id: 'points',
    chip: 'points',
    name: "Captain's points",
    what: 'Your match account. Wager matches stake it, and the Points desk trades it with SOL.',
    earned: [
      'A 100-point welcome award when your account is first set up',
      'Buying 100 points for 0.001 SOL at the Points desk',
      'Winning a wagered match — the 100-point pot (95 on an online human match after the 5% fee)',
    ],
    used: [
      'The 50-point stake in a wagered match',
      'Selling 100 points for 0.001 SOL at the Points desk',
    ],
  },
  coins: {
    id: 'coins',
    chip: 'coins',
    name: 'Coins',
    what: 'Port City money. Matches and the city’s collectors pay it; building and trade spend it.',
    earned: [
      '50 for a win and 10 for a loss in matches and offline games',
      'City collectors, such as the Fish Market',
      'Raids, wars, voyages, puzzles and contracts',
    ],
    used: [
      'Building and upgrading Port City structures',
      'Research and fleet donations',
      'Cosmetics in the shop',
    ],
  },
  gems: {
    id: 'gems',
    chip: 'gems',
    name: 'Gems',
    what: 'Port City premium currency, for the jobs you would rather not wait out.',
    earned: [
      'Completing Admiralty levels',
      'Rank back-pay for ranks you have already reached',
      'Wars, puzzles, voyages and season rewards',
    ],
    used: [
      'Hiring dock workers',
      'Finishing construction early',
      'Cosmetics and research rushes',
    ],
  },
} as const;

export const CURRENCY_IDS: readonly CurrencyId[] = ['points', 'coins', 'gems'];

/** The info for a chip kind, or null for chips with no verified definition. */
export function currencyInfoFor(chip: string): CurrencyInfo | null {
  return chip === 'points' || chip === 'coins' || chip === 'gems' ? CURRENCIES[chip] : null;
}

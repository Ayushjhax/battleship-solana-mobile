/**
 * The Captain's Log — part-04 §2, tested by §5.6 and §5.7.
 *
 * "A season is 28 days. 30 pages. Ink (XP) per page: 600."
 *
 * §5.7 is unusual and worth calling out: "Ink pacing test: a simulated active
 * player finishes 30 pages between day 18 and 24; a casual player lands
 * between page 10 and 18. **This test locks the pacing target, so if someone
 * changes a reward it fails loudly.**" So the ink table below is not just
 * numbers — it is a contract with a test, and `simulate()` exists so that test
 * can be written against the real arithmetic rather than a paraphrase.
 */

/** §2 — "A season is 28 days. 30 pages. Ink (XP) per page: 600." */
export const SEASON_DAYS = 28;
export const SEASON_PAGES = 30;
export const INK_PER_PAGE = 600;

/** §2's ink table, verbatim. */
export const INK = {
  playedMatch: 20,
  /** "+40 MORE" on top of the played-match ink. */
  winBonus: 40,
  dailyEasy: 60,
  dailyMedium: 120,
  dailyHard: 250,
  /** "a weekly x4". */
  weeklyMultiplier: 4,
  raidWithStar: 30,
  successfulDefence: 30,
  dailyPuzzle: 50,
} as const;

/** §2 — the premium track's "season ink bonus of +10%". */
export const PREMIUM_INK_BONUS = 0.1;

/** §2 — "Premium track (500 gems, or real money once IAP exists)". */
export const PREMIUM_GEMS = 500;

export function inkForMatch(won: boolean): number {
  return INK.playedMatch + (won ? INK.winBonus : 0);
}

export function inkForContract(tier: 'easy' | 'medium' | 'hard', scope: 'daily' | 'weekly'): number {
  const base =
    tier === 'easy' ? INK.dailyEasy : tier === 'medium' ? INK.dailyMedium : INK.dailyHard;
  return scope === 'weekly' ? base * INK.weeklyMultiplier : base;
}

/** The premium bonus, applied to an ink award. Floors, never rounds up. */
export function withPremium(ink: number, premium: boolean): number {
  return premium ? Math.floor(ink * (1 + PREMIUM_INK_BONUS)) : ink;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export function pageFor(ink: number): number {
  return Math.max(0, Math.min(SEASON_PAGES, Math.floor(Math.max(0, ink) / INK_PER_PAGE)));
}

export function inkIntoPage(ink: number): { page: number; into: number; needed: number } {
  const page = pageFor(ink);
  return {
    page,
    into: Math.max(0, ink) - page * INK_PER_PAGE,
    needed: INK_PER_PAGE,
  };
}

/** Which pages are earned but not yet claimed. Pages are 1-based on screen. */
export function claimablePages(ink: number, claimed: readonly number[]): number[] {
  const earned = pageFor(ink);
  const already = new Set(claimed);
  const out: number[] = [];
  for (let page = 1; page <= earned; page++) {
    if (!already.has(page)) out.push(page);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rewards (§2)
// ---------------------------------------------------------------------------

export interface PageReward {
  readonly page: number;
  readonly coins: number;
  readonly steel: number;
  readonly gems: number;
  /** §2 — "a cosmetic at pages 10, 20 and 30". */
  readonly cosmetic: boolean;
}

/** §2 — "Free track: coins, steel, gems (5-20), a cosmetic at 10, 20 and 30." */
export function freeReward(page: number): PageReward {
  const tier = Math.ceil(page / 10); // 1, 2 or 3
  return {
    page,
    coins: 200 * tier,
    steel: 300 * tier,
    // Gems on every third page, 5 to 20 across the season.
    gems: page % 3 === 0 ? Math.min(20, 5 * tier) : 0,
    cosmetic: page === 10 || page === 20 || page === 30,
  };
}

/** §2 — the premium track is "roughly 3x the resources" plus a cosmetic set. */
export const PREMIUM_MULTIPLIER = 3;

export function premiumReward(page: number): PageReward {
  const free = freeReward(page);
  return {
    page,
    coins: free.coins * PREMIUM_MULTIPLIER,
    steel: free.steel * PREMIUM_MULTIPLIER,
    gems: free.gems * PREMIUM_MULTIPLIER,
    // A cosmetic set: one every five pages rather than three a season.
    cosmetic: page % 5 === 0,
  };
}

/**
 * What a claim actually pays. §2 — "Buying the premium track retroactively
 * unlocks every page already earned", so a premium player claiming page 3
 * gets BOTH tracks' rewards for it, whenever they bought.
 */
export function rewardForPage(page: number, premium: boolean): PageReward {
  const free = freeReward(page);
  if (!premium) return free;
  const extra = premiumReward(page);
  return {
    page,
    coins: free.coins + extra.coins,
    steel: free.steel + extra.steel,
    gems: free.gems + extra.gems,
    cosmetic: free.cosmetic || extra.cosmetic,
  };
}

export function totalFor(pages: readonly number[], premium: boolean) {
  return pages.reduce(
    (sum, page) => {
      const reward = rewardForPage(page, premium);
      return {
        coins: sum.coins + reward.coins,
        steel: sum.steel + reward.steel,
        gems: sum.gems + reward.gems,
      };
    },
    { coins: 0, steel: 0, gems: 0 },
  );
}

// ---------------------------------------------------------------------------
// Pacing (§2, §5.7)
// ---------------------------------------------------------------------------

export interface PlayerShape {
  readonly matchesPerDay: number;
  readonly winRate: number;
  /** How many of the day's dailies they finish, 0-1. */
  readonly dailyCompletion: number;
  /** How many of the week's weeklies, 0-1. */
  readonly weeklyCompletion: number;
  readonly premium: boolean;
}

/** §2's two reference players, so the pacing test names them rather than numbers. */
export const ACTIVE_PLAYER: PlayerShape = {
  matchesPerDay: 5,
  winRate: 0.5,
  dailyCompletion: 1,
  weeklyCompletion: 0.8,
  premium: false,
};

export const CASUAL_PLAYER: PlayerShape = {
  matchesPerDay: 2,
  winRate: 0.5,
  dailyCompletion: 0.4,
  weeklyCompletion: 0.2,
  premium: false,
};

/** Ink earned in one day by a player of this shape. */
export function inkPerDay(shape: PlayerShape): number {
  const matches =
    shape.matchesPerDay * INK.playedMatch + shape.matchesPerDay * shape.winRate * INK.winBonus;

  // Three dailies: the catalogue's tiers are mixed, so the average of the
  // three tiers is the honest estimate rather than assuming all-hard.
  const averageDaily = (INK.dailyEasy + INK.dailyMedium + INK.dailyHard) / 3;
  const dailies = 3 * shape.dailyCompletion * averageDaily;

  // Three weeklies, spread over seven days.
  const weeklies = (3 * shape.weeklyCompletion * averageDaily * INK.weeklyMultiplier) / 7;

  return withPremium(Math.round(matches + dailies + weeklies), shape.premium);
}

/** The day a player of this shape finishes all 30 pages, or null. */
export function daysToFinish(shape: PlayerShape): number | null {
  const perDay = inkPerDay(shape);
  if (perDay <= 0) return null;
  const days = Math.ceil((SEASON_PAGES * INK_PER_PAGE) / perDay);
  return days <= SEASON_DAYS ? days : null;
}

/** The page a player of this shape reaches by the end of the season. */
export function pageAtSeasonEnd(shape: PlayerShape): number {
  return pageFor(inkPerDay(shape) * SEASON_DAYS);
}

/** The whole simulation, for §5.7's pacing test. */
export function simulate(shape: PlayerShape): {
  inkPerDay: number;
  totalInk: number;
  finishesOnDay: number | null;
  finalPage: number;
} {
  const perDay = inkPerDay(shape);
  return {
    inkPerDay: perDay,
    totalInk: perDay * SEASON_DAYS,
    finishesOnDay: daysToFinish(shape),
    finalPage: pageAtSeasonEnd(shape),
  };
}

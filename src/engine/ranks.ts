/**
 * Rank ladder and match rewards — docs/brief.md 3.5. Cumulative thresholds;
 * losing still moves the bar a little.
 */

export interface Rank {
  readonly name: string;
  /** Cumulative points required to hold this rank. */
  readonly points: number;
}

export const RANKS: readonly Rank[] = [
  { name: 'Seaman Recruit', points: 0 },
  { name: 'Seaman Apprentice', points: 100 },
  { name: 'Petty Officer Second Class', points: 400 },
  { name: 'Chief Ship Petty Officer', points: 1000 },
  { name: 'Captain', points: 3000 },
  { name: 'Vice-admiral', points: 10000 },
] as const;

export const REWARD = {
  win: { points: 25, coins: 50 },
  loss: { points: 5, coins: 10 },
} as const;

export function rankFor(points: number): Rank {
  let current = RANKS[0] as Rank;
  for (const rank of RANKS) {
    if (points >= rank.points) current = rank;
  }
  return current;
}

export interface RankProgress {
  readonly rank: Rank;
  readonly next: Rank | null;
  /** Points into the current band, for the "139/300" readout. */
  readonly current: number;
  /** Size of the current band; equals `current` at the top rank. */
  readonly total: number;
}

/** "10/100 Seaman Recruit", "139/300 Seaman Apprentice" — IMG_9754. */
export function rankProgress(points: number): RankProgress {
  const rank = rankFor(points);
  const index = RANKS.indexOf(rank);
  const next = RANKS[index + 1] ?? null;
  const current = points - rank.points;
  const total = next ? next.points - rank.points : Math.max(current, 1);
  return { rank, next, current, total };
}

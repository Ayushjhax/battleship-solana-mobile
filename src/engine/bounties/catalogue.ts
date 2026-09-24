/**
 * The contract catalogue — part-04 §1.
 *
 * "Each contract is `{ id, tier, title, metric, target, scope, requires? }`"
 * and §1 asks for "at least 30, data-driven". This is that data.
 *
 * `metric` is the only field with behaviour behind it, and it is evaluated
 * ONLY on the server (§1, §3: "Progress is never accepted from the client").
 * `./metrics.ts` is the evaluator; this file is a table.
 *
 * PURITY: like every `src/engine` module — no React, no I/O, no `Date.now()`.
 */

export type ContractTier = 'easy' | 'medium' | 'hard';
export type ContractScope = 'daily' | 'weekly';

/**
 * Every metric the evaluator understands. Adding one here without adding it
 * to `METRIC_EVALUATORS` is a TypeScript error, which is the point: a
 * contract with a metric nobody evaluates would simply never progress, and
 * the player would have no way to tell.
 */
export type ContractMetric =
  // --- battle ---
  | 'matches_won'
  | 'online_won'
  | 'battleships_sunk'
  | 'torpedo_sinks'
  | 'atomic_double'
  | 'submarine_sinks'
  | 'aa_downs'
  | 'gun_double'
  | 'mine_stops'
  | 'win_with_4_afloat'
  | 'run_of_5'
  | 'win_no_arsenal'
  | 'beat_hard_ai'
  | 'radar_then_hit'
  // --- city ---
  | 'steel_collected'
  | 'upgrades_finished'
  | 'admiralty_level'
  | 'scrapyard_collected'
  // --- raids (gated) ---
  | 'raid_stars'
  | 'raid_steel'
  | 'defended'
  | 'three_starred';

export interface Contract {
  readonly id: string;
  readonly tier: ContractTier;
  readonly title: string;
  readonly metric: ContractMetric;
  readonly target: number;
  readonly scope: ContractScope;
  /** §4 — "Never drawn — `requires` is checked at issue time." */
  readonly requires?: string;
}

/** §1's reward table, by tier. Weeklies pay "roughly 4x a daily". */
export interface Reward {
  readonly coins: number;
  readonly steel: number;
  readonly ink: number;
  readonly gems: number;
}

export const DAILY_REWARDS: Readonly<Record<ContractTier, Reward>> = {
  easy: { coins: 150, steel: 200, ink: 60, gems: 0 },
  medium: { coins: 350, steel: 500, ink: 120, gems: 0 },
  // §1 — "hard 700 / 1,200 / 250 plus 5-15 gems". The midpoint, so the number
  // is deterministic: a random reward cannot be tested and reads as a bug
  // when two players compare notes.
  hard: { coins: 700, steel: 1_200, ink: 250, gems: 10 },
};

/** §1 — "Weeklies pay roughly 4x a daily." */
export const WEEKLY_MULTIPLIER = 4;

export function rewardFor(tier: ContractTier, scope: ContractScope): Reward {
  const base = DAILY_REWARDS[tier];
  if (scope === 'daily') return base;
  return {
    coins: base.coins * WEEKLY_MULTIPLIER,
    steel: base.steel * WEEKLY_MULTIPLIER,
    ink: base.ink * WEEKLY_MULTIPLIER,
    gems: base.gems * WEEKLY_MULTIPLIER,
  };
}

// ---------------------------------------------------------------------------
// The catalogue (§1 — "at least 30")
// ---------------------------------------------------------------------------

const c = (
  id: string,
  tier: ContractTier,
  title: string,
  metric: ContractMetric,
  target: number,
  scope: ContractScope = 'daily',
  requires?: string,
): Contract => ({ id, tier, title, metric, target, scope, ...(requires ? { requires } : {}) });

export const CONTRACTS: readonly Contract[] = [
  // ---- battle, daily ------------------------------------------------------
  c('win-1', 'easy', 'Win a battle', 'matches_won', 1),
  c('win-3', 'medium', 'Win three battles', 'matches_won', 3),
  c('win-online-1', 'easy', 'Win one at sea', 'online_won', 1),
  c('win-online-3', 'hard', 'Win three at sea', 'online_won', 3),
  c('battleship-1', 'easy', 'Sink a battleship', 'battleships_sunk', 1),
  c('battleship-3', 'medium', 'Sink three battleships', 'battleships_sunk', 3),
  c('torpedo-1', 'medium', 'Sink a ship with a torpedo', 'torpedo_sinks', 1),
  c('atomic-double', 'hard', 'Two ships with one atomic bomber', 'atomic_double', 1),
  c('submarine-2', 'medium', 'Sink two ships with the submarine', 'submarine_sinks', 2),
  c('aa-3', 'medium', 'Shoot down three aircraft', 'aa_downs', 3),
  c('gun-double', 'hard', 'Down two planes with one gun', 'gun_double', 1),
  c('mine-2', 'easy', 'Stop two enemy turns with mines', 'mine_stops', 2),
  c('afloat-4', 'medium', 'Win with four ships afloat', 'win_with_4_afloat', 1),
  c('run-of-5', 'hard', 'Five hits in one turn', 'run_of_5', 1),
  c('no-arsenal', 'medium', 'Win without buying arsenal', 'win_no_arsenal', 1),
  c('beat-hard', 'hard', 'Beat the Hard captain', 'beat_hard_ai', 1),
  c('radar-hit', 'medium', 'Radar, then hit inside it', 'radar_then_hit', 1),

  // ---- city, daily --------------------------------------------------------
  c('steel-500', 'easy', 'Collect 500 steel', 'steel_collected', 500),
  c('steel-2000', 'medium', 'Collect 2,000 steel', 'steel_collected', 2_000),
  c('upgrade-1', 'easy', 'Finish an upgrade', 'upgrades_finished', 1),
  c('upgrade-3', 'hard', 'Finish three upgrades', 'upgrades_finished', 3),
  c('scrapyard-2', 'easy', 'Empty the Scrapyard twice', 'scrapyard_collected', 2),

  // ---- raids, daily (gated on the flag — §4) ------------------------------
  c('stars-3', 'easy', 'Take three stars', 'raid_stars', 3, 'daily', 'portCity.raids'),
  c('stars-9', 'medium', 'Take nine stars', 'raid_stars', 9, 'daily', 'portCity.raids'),
  c('raid-steel-1000', 'medium', 'Take 1,000 steel by force', 'raid_steel', 1_000, 'daily', 'portCity.raids'),
  c('defend-1', 'medium', 'Drive off a raider', 'defended', 1, 'daily', 'portCity.raids'),
  c('three-star-1', 'hard', 'Three-star a harbour', 'three_starred', 1, 'daily', 'portCity.raids'),

  // ---- weeklies -----------------------------------------------------------
  c('w-win-15', 'medium', 'Win fifteen battles', 'matches_won', 15, 'weekly'),
  c('w-online-10', 'hard', 'Win ten at sea', 'online_won', 10, 'weekly'),
  c('w-battleship-10', 'medium', 'Sink ten battleships', 'battleships_sunk', 10, 'weekly'),
  c('w-steel-15000', 'easy', 'Collect 15,000 steel', 'steel_collected', 15_000, 'weekly'),
  c('w-upgrade-7', 'medium', 'Finish seven upgrades', 'upgrades_finished', 7, 'weekly'),
  c('w-admiralty', 'hard', 'Reach Admiralty 5', 'admiralty_level', 5, 'weekly'),
  c('w-aa-15', 'medium', 'Down fifteen aircraft', 'aa_downs', 15, 'weekly'),
  c('w-stars-40', 'hard', 'Take forty stars', 'raid_stars', 40, 'weekly', 'portCity.raids'),
  c('w-defend-5', 'medium', 'Drive off five raiders', 'defended', 5, 'weekly', 'portCity.raids'),
];

export function contractById(id: string): Contract | null {
  return CONTRACTS.find((contract) => contract.id === id) ?? null;
}

/**
 * §4 — "A raid contract is drawn for a player whose raids flag is off: never
 * drawn — `requires` is checked at ISSUE time." Not filtered at render time,
 * which would leave a slot showing nothing.
 */
export function eligible(
  scope: ContractScope,
  flags: ReadonlySet<string>,
): readonly Contract[] {
  return CONTRACTS.filter(
    (contract) => contract.scope === scope && (!contract.requires || flags.has(contract.requires)),
  );
}

/** §1 — "The Harbour Master's Office level adds a slot: L1 -> 3, L2 -> 4, L3 -> 5." */
export function dailySlots(harbourOfficeLevel: number): number {
  return Math.max(3, Math.min(3 + Math.max(0, harbourOfficeLevel - 1), 5));
}

/** §1 — "3 weekly", and the office does not add weekly slots. */
export const WEEKLY_SLOTS = 3;

/**
 * Loot, renown and shields — part-06 §7. Pure, so the whole settlement can be
 * reasoned about and tested without a database, and the SQL only has to apply
 * numbers this module produced.
 */
import type { RaidScore } from './types';

/** NUMBERS.md > Raids. Vault protection by the DEFENDER's Admiralty level. */
export const VAULT_PROTECTION: readonly { coins: number; steel: number }[] = [
  { coins: 0, steel: 0 },
  { coins: 500, steel: 1_000 },
  { coins: 800, steel: 1_600 },
  { coins: 1_200, steel: 2_500 },
  { coins: 2_500, steel: 5_000 },
  { coins: 6_000, steel: 12_000 },
  { coins: 12_000, steel: 25_000 },
  { coins: 25_000, steel: 50_000 },
  { coins: 50_000, steel: 100_000 },
];

/** NUMBERS.md > Raids. The most ONE raid can take. */
export const LOOT_CAP: readonly { coins: number; steel: number }[] = [
  { coins: 0, steel: 0 },
  { coins: 100, steel: 200 },
  { coins: 150, steel: 300 },
  { coins: 250, steel: 500 },
  { coins: 450, steel: 900 },
  { coins: 850, steel: 1_700 },
  { coins: 1_600, steel: 3_200 },
  { coins: 2_800, steel: 5_600 },
  { coins: 4_500, steel: 9_000 },
];

export const WALLET_LOOT_RATE = 0.1;
/** Uncollected production and the scrap pile are far more exposed. */
export const STORE_LOOT_RATE = 0.5;

/** Steel the HOUSE pays the attacker, by stars. Never taken from the defender. */
export const STAR_BONUS: readonly number[] = [0, 40, 120, 300];

/** A pirate cove pays 70% of a normal pool, and no renown at all (§5). */
export const COVE_LOOT_RATE = 0.7;

function band<T>(table: readonly T[], level: number): T {
  return table[Math.max(0, Math.min(level, table.length - 1))] as T;
}

export interface DefenderWealth {
  readonly coins: number;
  readonly steel: number;
  readonly storedCoins: number;
  readonly storedSteel: number;
  readonly scrapPile: number;
  readonly admiraltyLevel: number;
}

export interface LootPool {
  readonly coins: number;
  readonly steel: number;
}

/**
 * The pool, computed from the defender AT RAID START (§7.2): 10% of the wallet
 * above the vault, plus 50% of everything sitting in collectors and the scrap
 * pile, capped by the defender's Admiralty level.
 */
export function lootPool(wealth: DefenderWealth): LootPool {
  const vault = band(VAULT_PROTECTION, wealth.admiraltyLevel);
  const cap = band(LOOT_CAP, wealth.admiraltyLevel);

  const walletCoins = Math.max(0, wealth.coins - vault.coins) * WALLET_LOOT_RATE;
  const walletSteel = Math.max(0, wealth.steel - vault.steel) * WALLET_LOOT_RATE;
  const storeCoins = wealth.storedCoins * STORE_LOOT_RATE;
  const storeSteel = (wealth.storedSteel + wealth.scrapPile) * STORE_LOOT_RATE;

  return {
    coins: Math.min(cap.coins, Math.floor(walletCoins + storeCoins)),
    steel: Math.min(cap.steel, Math.floor(walletSteel + storeSteel)),
  };
}

export interface LootOutcome {
  /** What the DEFENDER loses. Never more than the pool. */
  readonly takenCoins: number;
  readonly takenSteel: number;
  /** What the ATTACKER gains: the taken part plus the house's star bonus. */
  readonly earnedCoins: number;
  readonly earnedSteel: number;
  readonly starBonusSteel: number;
}

/**
 * §7.2 — the attacker earns `pool x destruction` plus a star bonus PAID BY THE
 * HOUSE, so the defender never loses more than the pool. A cove pays 70% and
 * costs nobody anything.
 */
export function lootEarned(
  pool: LootPool,
  score: Pick<RaidScore, 'destruction' | 'stars'>,
  options: { readonly cove?: boolean } = {},
): LootOutcome {
  const rate = options.cove ? COVE_LOOT_RATE : 1;
  const takenCoins = options.cove ? 0 : Math.floor(pool.coins * score.destruction);
  const takenSteel = options.cove ? 0 : Math.floor(pool.steel * score.destruction);
  const starBonusSteel = STAR_BONUS[score.stars] ?? 0;

  return {
    takenCoins,
    takenSteel,
    earnedCoins: Math.floor(pool.coins * score.destruction * rate),
    earnedSteel: Math.floor(pool.steel * score.destruction * rate) + starBonusSteel,
    starBonusSteel,
  };
}

export interface RenownDelta {
  readonly attacker: number;
  readonly defender: number;
}

/**
 * §7.3 — symmetric, bigger for punching up, negative for a 0-star raid, and it
 * floors at 0 (applied by the caller, which knows the current values).
 *
 * NEVER touches rank points: renown is a separate ladder that can fall, and
 * rank points only ever go up.
 */
export function renownDelta(attacker: number, defender: number, stars: number): RenownDelta {
  const diff = defender - attacker;
  const win = Math.max(5, Math.min(40, Math.round(20 + diff / 12)));
  const lose = Math.max(4, Math.min(30, Math.round(14 - diff / 15)));

  if (stars > 0) {
    const gain = Math.max(1, Math.round((win * stars) / 3));
    return { attacker: gain, defender: -gain };
  }
  return { attacker: -lose, defender: lose };
}

/** The renown a target card advertises: "+X for 3 stars / -Y for 0" (§5). */
export function renownOffer(attacker: number, defender: number): { best: number; worst: number } {
  return {
    best: renownDelta(attacker, defender, 3).attacker,
    worst: renownDelta(attacker, defender, 0).attacker,
  };
}

/** §7.4 — the defender's shield, in hours, by the destruction they took. */
export function shieldHours(destruction: number): number {
  if (destruction >= 1) return 14;
  if (destruction >= 0.7) return 10;
  if (destruction >= 0.4) return 6;
  return 0;
}

/** §5 — a search costs 10 x the searcher's Admiralty level, in coins. */
export function searchCost(admiraltyLevel: number): number {
  return 10 * Math.max(1, admiraltyLevel);
}

/**
 * §5 — the renown window: +/-200, widened by 100 every SECOND search in the
 * same session, uncapped after 8.
 */
export function renownWindow(searchesThisSession: number): number | null {
  if (searchesThisSession >= 8) return null; // uncapped
  return 200 + Math.floor(searchesThisSession / 2) * 100;
}

// ---------------------------------------------------------------------------
// Applying the settlement (§7.2, §7.3)
//
// These two live here, not in SQL, for one reason: the ordering rules ("stores
// first, then the wallet"; "renown floors at 0") are game rules, and a game
// rule in a plpgsql function is a rule nobody can unit-test.
// ---------------------------------------------------------------------------

/** Where the defender's losses actually come from. Sums to the amount taken. */
export interface LossAllocation {
  readonly fromStoredCoins: number;
  readonly fromCoins: number;
  readonly fromStoredSteel: number;
  readonly fromScrap: number;
  readonly fromSteel: number;
  readonly takenCoins: number;
  readonly takenSteel: number;
}

/**
 * §7.2 — "taken from collectors and the scrap pile first, then the wallet".
 * Never takes more than exists, so a defender can always be settled even if
 * they spent everything between the pool being computed and the raid ending.
 */
export function allocateLoss(
  wealth: Pick<DefenderWealth, 'coins' | 'steel' | 'storedCoins' | 'storedSteel' | 'scrapPile'>,
  loot: Pick<LootOutcome, 'takenCoins' | 'takenSteel'>,
): LossAllocation {
  const drain = (want: number, available: number) => Math.max(0, Math.min(want, available));

  const fromStoredCoins = drain(loot.takenCoins, wealth.storedCoins);
  const fromCoins = drain(loot.takenCoins - fromStoredCoins, wealth.coins);

  const fromStoredSteel = drain(loot.takenSteel, wealth.storedSteel);
  const fromScrap = drain(loot.takenSteel - fromStoredSteel, wealth.scrapPile);
  const fromSteel = drain(loot.takenSteel - fromStoredSteel - fromScrap, wealth.steel);

  return {
    fromStoredCoins,
    fromCoins,
    fromStoredSteel,
    fromScrap,
    fromSteel,
    takenCoins: fromStoredCoins + fromCoins,
    takenSteel: fromStoredSteel + fromScrap + fromSteel,
  };
}

export interface RenownSide {
  readonly before: number;
  readonly after: number;
  /** The delta ACTUALLY applied, after the floor — this is what the row stores. */
  readonly delta: number;
}

export interface RenownSettlement {
  readonly attacker: RenownSide;
  readonly defender: RenownSide;
}

/**
 * §7.3 — floors at 0. The floor is asymmetric on purpose: a defender at 3
 * renown who should lose 20 loses only 3, and the attacker still gains their
 * full amount. Renown is a ladder, not a conserved currency.
 *
 * A pirate cove moves nothing at all (§5) — there is nobody on the other side.
 */
export function settleRenown(
  attacker: number,
  defender: number,
  stars: number,
  options: { readonly cove?: boolean } = {},
): RenownSettlement {
  if (options.cove) {
    return {
      attacker: { before: attacker, after: attacker, delta: 0 },
      defender: { before: defender, after: defender, delta: 0 },
    };
  }

  const raw = renownDelta(attacker, defender, stars);
  const attackerAfter = Math.max(0, attacker + raw.attacker);
  const defenderAfter = Math.max(0, defender + raw.defender);

  return {
    attacker: { before: attacker, after: attackerAfter, delta: attackerAfter - attacker },
    defender: { before: defender, after: defenderAfter, delta: defenderAfter - defender },
  };
}

// ---------------------------------------------------------------------------
// Pirate coves (§5)
//
// "Server-generated PvE harbours ... defences sized to the searcher's renown
// ... their loot is paid by the house (70% of a normal pool) and they give no
// renown. They are what makes the feature work on a day when nobody is
// online, which today is most days."
//
// NUMBERS.md gives the 70% and nothing else, so two numbers are invented here
// and recorded in DECISIONS.md (D22):
//
//   coveLevelFor   which Admiralty band a cove imitates, from renown
//   COVE_POOL_FRACTION  what fraction of the per-raid CAP counts as "a normal
//                       pool". It is 0.6, not 1.0, on purpose: the cap is the
//                       most a raid can EVER take, so treating it as typical
//                       would make coves richer than real players and nobody
//                       would ever raid a person again. 0.6 x 0.7 = 42% of the
//                       cap at full destruction — always available, never the
//                       best thing available.
// ---------------------------------------------------------------------------

export const COVE_POOL_FRACTION = 0.6;

/** Renown -> the Admiralty level a cove pretends to be. */
export function coveLevelFor(renown: number): number {
  const level = 3 + Math.floor(Math.max(0, renown) / 300);
  return Math.max(3, Math.min(level, LOOT_CAP.length - 1));
}

/** The pool a cove offers. Paid entirely by the house — nobody loses it. */
export function covePool(renown: number): LootPool {
  const cap = band(LOOT_CAP, coveLevelFor(renown));
  return {
    coins: Math.floor(cap.coins * COVE_POOL_FRACTION),
    steel: Math.floor(cap.steel * COVE_POOL_FRACTION),
  };
}

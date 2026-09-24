/**
 * What a raid pays, by context — part-08 §4 and §5, tested by §7.6.
 *
 * Part 6 built one kind of raid: a real one, against a stranger, that takes
 * loot, moves renown, shields the defender and locks the target. Part 8 adds
 * two more that use the SAME engine and the same screen but settle to
 * nothing:
 *
 *   §4 war       "War raids take no loot and move no renown."
 *   §5 friendly  "No loot, no renown, no shield, no lock, unlimited, and it
 *                 always shows the full result."
 *
 * The temptation is to scatter `if (friendly)` through the settlement. That is
 * how a friendly raid ends up shielding somebody, or appearing in their
 * defence log, six months from now. So there is one table, here, and the
 * settlement reads it.
 */
import type { LayoutContext } from './types';

export interface RaidPolicy {
  /** Does the attacker take coins and steel, and the defender lose them? */
  readonly loot: boolean;
  /** Does the renown ladder move? */
  readonly renown: boolean;
  /** Does the defender get a shield afterwards? */
  readonly shield: boolean;
  /** Does taking the card lock the defender for six minutes? */
  readonly lock: boolean;
  /** Does it cost coins to find the target? */
  readonly searchCost: boolean;
  /** §5 — "they never appear in the defence log". */
  readonly defenceLog: boolean;
  /** §5 — a friendly raid "always shows the full result". */
  readonly alwaysReveal: boolean;
  /** §4 — a war raid is one of two; §5 — a friendly raid is unlimited. */
  readonly limited: boolean;
}

const REAL: RaidPolicy = {
  loot: true,
  renown: true,
  shield: true,
  lock: true,
  searchCost: true,
  defenceLog: true,
  alwaysReveal: false,
  limited: true,
};

/** §4 — a war raid scores stars and nothing else. */
const WAR: RaidPolicy = {
  loot: false,
  renown: false,
  shield: false,
  lock: false,
  searchCost: false,
  // A war raid belongs in the WAR log, not the defence log: the defender
  // agreed to it when they opted in, and mixing the two would make the
  // defence log's "revenge" button offer revenge on a teammate.
  defenceLog: false,
  alwaysReveal: true,
  limited: true,
};

/** §5 — a friendly raid settles to nothing at all. */
const FRIENDLY: RaidPolicy = {
  loot: false,
  renown: false,
  shield: false,
  lock: false,
  searchCost: false,
  defenceLog: false,
  alwaysReveal: true,
  limited: false,
};

/**
 * There is no policy for `'ranked'`, because a ranked match is not a raid.
 * Asking for one is a bug, and it returns the most restrictive answer rather
 * than the most generous: nothing pays.
 */
const NONE: RaidPolicy = {
  loot: false,
  renown: false,
  shield: false,
  lock: false,
  searchCost: false,
  defenceLog: false,
  alwaysReveal: false,
  limited: true,
};

export function raidPolicy(context: LayoutContext): RaidPolicy {
  switch (context) {
    case 'raid':
      return REAL;
    case 'war':
      return WAR;
    case 'friendly':
      return FRIENDLY;
    case 'ranked':
      return NONE;
    default: {
      const never: never = context;
      void never;
      return NONE;
    }
  }
}

/** §5 — a friendly raid is against a FLEETMATE, and only a fleetmate. */
export interface FriendlyCheck {
  readonly ok: boolean;
  readonly reason: string | null;
}

export function canRaidFriendly(
  attackerFleetId: string | null,
  defenderFleetId: string | null,
  attackerId: string,
  defenderId: string,
): FriendlyCheck {
  if (attackerId === defenderId) {
    return { ok: false, reason: 'You know where your own mines are.' };
  }
  if (!attackerFleetId || attackerFleetId !== defenderFleetId) {
    return { ok: false, reason: 'Practice runs are for fleetmates.' };
  }
  return { ok: true, reason: null };
}

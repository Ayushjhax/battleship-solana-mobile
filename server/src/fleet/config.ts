/**
 * Fleet and war tuning, server-side — part-08 §4.
 *
 * WHY THIS EXISTS. A war is 22 hours of prep and 24 hours of battle. Those are
 * the right numbers for players and impossible numbers for a person testing by
 * hand: §7's manual QA asks for "a 5v5 war across two devices with the clock
 * shortened by config", and without this there is no config to shorten.
 *
 * Same shape as `server/src/raid/config.ts` and the same rule: a missing,
 * empty or unparseable value falls back to the engine default, so a typo
 * cannot hand every war a zero-second prep day.
 *
 * The values are SNAPSHOTTED into the war row at pairing time (`prep_ends_at`,
 * `battle_ends_at` are timestamps, not durations), so changing them mid-war
 * cannot move a war that is already running — exactly as `raid.shells` cannot
 * change a raid in progress.
 */
import { BATTLE_MS, PREP_MS, SEARCH_GIVE_UP_MS } from '@engine/fleets';

import { envMs } from '../env';

export interface WarConfig {
  /** §4 — "Preparation day: 22 hours." */
  readonly prepMs: number;
  /** §4 — "Battle day: 24 hours." */
  readonly battleMs: number;
  /** §4 — matchmaking "gives up after 30 minutes". */
  readonly searchGiveUpMs: number;
}

export function warConfig(): WarConfig {
  return {
    prepMs: envMs('WAR_PREP_MS', PREP_MS),
    battleMs: envMs('WAR_BATTLE_MS', BATTLE_MS),
    searchGiveUpMs: envMs('WAR_SEARCH_GIVE_UP_MS', SEARCH_GIVE_UP_MS),
  };
}

/**
 * The two timestamps a pairing writes. The engine's `warSchedule()` does this
 * from its own constants; this is the same function with the config's.
 */
export function warSchedule(pairedAt: number): { prepEndsAt: number; battleEndsAt: number } {
  const config = warConfig();
  const prepEndsAt = pairedAt + config.prepMs;
  return { prepEndsAt, battleEndsAt: prepEndsAt + config.battleMs };
}

/**
 * §2 — the Fleet Hall level gates sticker unlocks and reinforcement capacity.
 * Read from the city, with a safe floor: a player with no Fleet Hall has no
 * fleet features, which is the correct answer and not an error.
 */
export function fleetHallLevelFrom(citySnapshot: unknown): number {
  const buildings = (citySnapshot as { buildings?: Record<string, { level?: number }> } | null)
    ?.buildings;
  return buildings?.fleet_hall?.level ?? 0;
}

export function admiraltyLevelFrom(citySnapshot: unknown): number {
  const buildings = (citySnapshot as { buildings?: Record<string, { level?: number }> } | null)
    ?.buildings;
  return buildings?.admiralty?.level ?? 0;
}

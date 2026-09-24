/**
 * Raid tuning, server-side — part-06 §2.
 *
 * The 30-shell budget is CALIBRATED, not guessed: docs/port-city/reference/out/
 * raid.md is 20,000 simulated raids behind it. So the number does not change
 * here. What this module adds is the ability to change it WITHOUT a client
 * release, because the instruction for this part was explicit: "do not change
 * the budget, but do make it server-configurable as raid.shells".
 *
 * Config lands as environment variables, the same mechanism as features.ts.
 * A missing, empty or unparseable value falls back to the engine default, so a
 * typo can never silently hand every raider 0 shells.
 */
import { RAID_DEFAULTS, type RaidConfig } from '@engine/raid';

/** `raid.shells` -> `RAID_SHELLS`. */
export function envNameFor(key: string): string {
  return key.replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function positiveInt(key: string, fallback: number): number {
  const raw = process.env[envNameFor(key)];
  if (raw === undefined) return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function nonNegativeInt(key: string, fallback: number): number {
  const raw = process.env[envNameFor(key)];
  if (raw === undefined) return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return fallback;
  return n;
}

/**
 * The config a raid is opened with. It is snapshotted INTO the raid at open
 * time and stored in raid_log, so changing `RAID_SHELLS` mid-raid cannot
 * change a raid that is already running, and a replay of an old raid uses the
 * budget that raid actually had.
 */
export function raidConfig(): RaidConfig {
  return {
    shells: positiveInt('raid.shells', RAID_DEFAULTS.shells),
    minePenalty: nonNegativeInt('raid.minePenalty', RAID_DEFAULTS.minePenalty),
    timeLimitMs: positiveInt('raid.timeLimitMs', RAID_DEFAULTS.timeLimitMs),
  };
}

/** §5, §10 — the operational limits, also overridable without a release. */
export interface RaidLimits {
  readonly lockMinutes: number;
  readonly repeatHours: number;
  readonly disconnectGraceMs: number;
  readonly clockGraceMs: number;
  readonly actionsPerSecond: number;
  readonly maxRejects: number;
  readonly searchCandidates: number;
}

export function raidLimits(): RaidLimits {
  return {
    lockMinutes: positiveInt('raid.lockMinutes', 6),
    repeatHours: positiveInt('raid.repeatHours', 24),
    // §6 — "the attacker disconnects for more than 60 s".
    disconnectGraceMs: positiveInt('raid.disconnectGraceMs', 60_000),
    // §10 — "a raid cannot last beyond its clock + 10 s grace".
    clockGraceMs: nonNegativeInt('raid.clockGraceMs', 10_000),
    actionsPerSecond: positiveInt('raid.actionsPerSecond', 4),
    // §10 — "five rejected raid actions from one session ends the raid".
    maxRejects: positiveInt('raid.maxRejects', 5),
    searchCandidates: positiveInt('raid.searchCandidates', 20),
  };
}

/**
 * Stamped into raid_log. §8: "if engineVersion no longer matches, fall back to
 * the stored per-action results ... and mark the replay 'as recorded'".
 *
 * It is the raid rules' version, not the app's: it changes when a change to
 * src/engine would make an old action list resolve differently.
 */
export const RAID_ENGINE_VERSION = '1';

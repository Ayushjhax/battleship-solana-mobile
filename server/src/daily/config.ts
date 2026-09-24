/**
 * Tuning for the Gazette, the puzzle and voyages — part-09.
 *
 * Same mechanism as `server/src/raid/config.ts`: environment variables, an
 * engine default as the fallback, and a typo can never silently change a
 * number. Nothing here is a new number; every default is the engine constant.
 *
 * `puzzle.par` is the one that matters. Part 9's plan §0.1 found that §2's par
 * of 52 was measured on the reference's **20-cell** fleet and this game ships
 * **18**. Par stays at 52 because the instruction says so, but it is
 * configurable so it can be corrected from the measurement in
 * `scripts/puzzle-calibration.ts` without a client release.
 */
import { ADMIRALS_ROUND, PUZZLE_PAR } from '@engine/puzzle';
import { SKIRMISH_GRACE_MS } from '@engine/voyages';

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

export interface PuzzleConfig {
  readonly par: number;
  readonly admiralsRound: number;
  readonly leaderboardSize: number;
}

export function puzzleConfig(): PuzzleConfig {
  return {
    par: positiveInt('puzzle.par', PUZZLE_PAR),
    admiralsRound: positiveInt('puzzle.admiralsRound', ADMIRALS_ROUND),
    leaderboardSize: positiveInt('puzzle.leaderboardSize', 100),
  };
}

export interface VoyageConfig {
  /** §3 — "or ignore it for 24 h -> half cargo." */
  readonly skirmishGraceMs: number;
}

export function voyageConfig(): VoyageConfig {
  return {
    skirmishGraceMs: positiveInt('voyage.skirmishGraceMs', SKIRMISH_GRACE_MS),
  };
}

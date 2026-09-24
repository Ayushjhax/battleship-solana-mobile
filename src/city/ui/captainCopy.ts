/**
 * Typed error code -> the Captain's voice — part-02 §5.
 *
 * "Disabled reasons, in the Captain's voice, never an error code." The map is
 * TOTAL over every code Part 1 can produce, and __tests__/captainCopy.test.ts
 * proves it, so no raw code can ever reach a player.
 */
import { CITY_CATALOGUE, type BuildingId } from '@engine/city';

import type { CityApiErrorCode } from '../types';

export interface CopyContext {
  /** Seconds until the first dock worker frees up, for the no-worker line. */
  readonly nextWorkerFreeIn?: number;
  /** Admiralty level the plot is waiting for. */
  readonly requiredAdmiralty?: number;
  readonly shortSteel?: number;
  readonly shortCoins?: number;
  readonly shortGems?: number;
  readonly buildingId?: BuildingId;
}

function minutes(seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 0) return 'shortly';
  if (seconds < 60) return `${seconds} seconds`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  const h = Math.round(m / 60);
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/**
 * Every code, in the Captain's voice. Exhaustive by construction: the Record
 * key type is the full union, so adding a code to Part 1 without adding a line
 * here fails the build.
 */
export function captainLineFor(code: CityApiErrorCode, context: CopyContext = {}): string {
  const lines: Record<CityApiErrorCode, () => string> = {
    'no-free-worker': () =>
      `Both dock workers are busy. One finishes in ${minutes(context.nextWorkerFreeIn)}.`,
    'needs-admiralty': () =>
      `Upgrade the Admiralty to ${context.requiredAdmiralty ?? 'the next level'} first.`,
    'max-level': () => 'There is nothing left to add to it.',
    'not-enough-steel': () =>
      context.shortSteel ? `${context.shortSteel} steel short.` : 'Not enough steel for that.',
    'not-enough-coins': () =>
      context.shortCoins ? `${context.shortCoins} coins short.` : 'Not enough coins for that.',
    'not-enough-gems': () =>
      context.shortGems ? `${context.shortGems} gems short.` : 'Not enough gems for that.',
    'already-upgrading': () => 'That one is already on the drawing board.',
    'not-upgrading': () => 'Nothing is being built there.',
    'nothing-to-collect': () => 'Nothing to collect there yet.',
    'unknown-building': () => 'No such plot on my charts.',
    'rate-limited': () => 'One at a time, captain.',
    'version-conflict': () => 'The harbour master just updated the books. Try again.',
    'feature-off': () => 'The port is closed for the season.',
    'no-profile': () => 'I cannot find your papers. Try signing in again.',
    internal: () => 'The harbour master dropped his pen. Try that again.',
    offline: () => 'No signal — the harbour master is out.',
    unauthenticated: () => 'Your papers are out of date. Sign in again.',
  };
  return lines[code]();
}

/** One line of flavour per building, shown at the top of its sheet (§5). */
export const BUILDING_FLAVOUR: Readonly<Record<BuildingId, string>> = {
  admiralty: 'Nothing gets built in this port without their stamp.',
  scrapyard: 'Every wreck you make comes home here.',
  fish_market: 'Coins while you sleep. Modest, and it never stops.',
  foundry: 'Steel by the hour. The city is built out of it.',
  shipyard: 'They will repaint your fleet however you like it.',
  stationery: 'Inks, papers and a pen that suits your hand.',
  harbour_office: 'Contracts on the board, and a log of everything you have done.',
  naval_academy: 'New tricks for the arsenal, taught slowly and expensively.',
  coastal_command: 'They decide how well your harbour is defended.',
  armory: 'What you carry when you go raiding.',
  fleet_hall: 'Where captains drink together and plan wars.',
  newsstand: 'The Gazette, and a puzzle to go with your morning.',
  trade_docks: 'Send a ship out, get something better back.',
  officers_club: 'Captains worth having are found in rooms like this.',
  lighthouse: 'It shows you seas you have not sailed yet.',
};

/** The building's effect in its own units, for the Now -> Next row (§5). */
export function effectLabel(id: BuildingId, level: number): string {
  const spec = CITY_CATALOGUE[id];
  if (level <= 0) return '—';
  const value = spec.levels[level - 1]?.value;
  if (value === undefined) return `level ${level}`;

  switch (id) {
    case 'fish_market':
      return `${value} coins/h`;
    case 'foundry':
      return `${value} steel/h`;
    case 'scrapyard':
      return `salvage +${value}%`;
    case 'coastal_command':
      return `harbour fuel ${value}`;
    case 'armory':
      return `raid fuel ${value}`;
    case 'fleet_hall':
      return `reinforcement fuel ${value}`;
    default:
      return `tier ${value}`;
  }
}

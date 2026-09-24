/**
 * Assembling the Gazette's day — part-09 §1.
 *
 * "Where the stories come from: the player's own last 24 hours (matches,
 *  raids, defences, city milestones, contracts) plus a small global feed."
 *
 * One SQL read (`gazette_day_records`) returns the raw records; the DERIVING
 * happens in `summariseDay()` in the engine, which is where it is tested. This
 * module is only the mapping between the two, and it is deliberately dull.
 *
 * WHAT IS NOT WIRED, and why — see part-09-report.md §4:
 *   - `difficulty` and `shipsAfloat` per match. `public.matches` (0002) stores
 *     neither: the offline difficulty is not persisted, and ships-afloat is a
 *     property of the final state rather than of the row. So `beat-hard` and
 *     `untouched-win` cannot currently fire from real data. The templates and
 *     their tests exist; the columns do not. Adding them is a migration on the
 *     match settlement path, which is Part 2's territory, not Part 9's.
 *   - `rankedUp`, `admiraltyUp`, `buildingFinished`, `researchFinished`,
 *     `logPage`, `inkEarned` and the war result are events rather than state,
 *     and nothing records "this happened today". They read as null/zero.
 *
 * Those fields are honest nulls, not stubs: `summariseDay` treats them exactly
 * as a day on which they did not happen, and the quiet-day template means the
 * paper is never empty because of them.
 */
import { emptyRecords, type DayMatch, type DayRecords } from '@engine/gazette';
import type { MatchEvent } from '@engine/types';

import { db } from '../db';

type LooseRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(): LooseRpc {
  const client = db();
  return client.rpc.bind(client) as unknown as LooseRpc;
}

const DAY_MS = 24 * 3_600_000;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : fallback;

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function toMatches(raw: unknown): DayMatch[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const row = asRecord(entry);
    const events = Array.isArray(row.events) ? (row.events as MatchEvent[]) : [];
    return {
      won: row.won === true,
      online: row.online === true,
      difficulty: null,
      shipsAfloat: num(row.shipsAfloat),
      events,
    };
  });
}

/** Maps one `gazette_day_records` row onto the engine's `DayRecords`. */
export function toDayRecords(raw: unknown, fallbackName = ''): DayRecords {
  const row = asRecord(raw);
  const base = emptyRecords(str(row.name) ?? fallbackName);

  const city = asRecord(row.city);
  const contracts = asRecord(row.contracts);
  const fleet = asRecord(row.fleet);
  const puzzle = asRecord(row.puzzle);
  const voyages = asRecord(row.voyages);
  const global = asRecord(row.global);

  return {
    ...base,
    matches: toMatches(row.matches),
    raids: Array.isArray(row.raids)
      ? row.raids.map((entry) => {
          const raid = asRecord(entry);
          return {
            stars: num(raid.stars),
            steel: num(raid.steel),
            defenderName: str(raid.defenderName),
          };
        })
      : [],
    defences: Array.isArray(row.defences)
      ? row.defences.map((entry) => {
          const defence = asRecord(entry);
          return {
            destruction: num(defence.destruction),
            raiderName: str(defence.raiderName) ?? '',
            steelLost: num(defence.steelLost),
          };
        })
      : [],
    city: {
      upgradesFinished: num(city.upgradesFinished),
      admiraltyLevel: num(city.admiraltyLevel),
      admiraltyUp: city.admiraltyUp === true,
      steelCollected: num(city.steelCollected),
      scrapCollected: num(city.scrapCollected),
      buildingFinished: str(city.buildingFinished),
      researchFinished: str(city.researchFinished),
    },
    contracts: {
      claimed: num(contracts.claimed),
      weeklyClaimed: num(contracts.weeklyClaimed),
      inkEarned: num(contracts.inkEarned),
      logPage: num(contracts.logPage),
    },
    rankedUp: str(row.rankedUp),
    fleet: {
      name: str(fleet.name),
      donationsGiven: num(fleet.donationsGiven),
      warResult: (['won', 'lost', 'draw'] as const).find((r) => r === fleet.warResult) ?? null,
      warOpponent: str(fleet.warOpponent),
      warStars: num(fleet.warStars),
    },
    puzzle: {
      shots: typeof puzzle.shots === 'number' ? puzzle.shots : null,
      beatPar: puzzle.beatPar === true,
      streak: num(puzzle.streak),
    },
    voyages: {
      returned: num(voyages.returned),
      coins: num(voyages.coins),
      pirateWins: num(voyages.pirateWins),
    },
    global: {
      topCaptain: str(global.topCaptain),
      biggestRaidBy: str(global.biggestRaidBy),
      biggestRaidSteel: num(global.biggestRaidSteel),
      fleetWarWinner: str(global.fleetWarWinner),
    },
  };
}

/**
 * The player's last 24 hours.
 *
 * A failure here returns an EMPTY day rather than throwing. §5.5's rule is
 * "never an empty page", and a paper with the quiet-day headline is a far
 * better answer to a slow query than a 503 on a screen whose whole job is to
 * be pleasant.
 */
export async function dayRecordsFor(userId: string, now: number): Promise<DayRecords> {
  try {
    const { data, error } = await rpc()('gazette_day_records', {
      p_user_id: userId,
      p_since: new Date(now - DAY_MS).toISOString(),
    });
    if (error) throw new Error(error.message);
    return toDayRecords(data);
  } catch {
    return emptyRecords('');
  }
}

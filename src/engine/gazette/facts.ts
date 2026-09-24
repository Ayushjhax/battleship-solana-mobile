/**
 * Turning a day's raw records into a `DaySummary` — part-09 §1.
 *
 * "Where the stories come from: the player's own last 24 hours (matches,
 *  raids, defences, city milestones, contracts) plus a small global feed."
 *
 * REUSE, NOT A FORK. The match-level readings (`bestAtomicRun`,
 * `longestHitRun`, `bestSameGunDowns`) are Part 4's, imported from
 * `../bounties/metrics`. The engine's event vocabulary has moved twice
 * already; a second copy of these loops would be a second thing to forget.
 *
 * This module is pure and takes plain records, so the server builds a summary
 * from SQL rows and the tests build one from literals, with no difference in
 * the code under test.
 */
import { bestAtomicRun, bestSameGunDowns, longestHitRun } from '../bounties/metrics';
import type { MatchEvent } from '../types';
import type { DaySummary } from './templates';

/** One match the player finished in the window. */
export interface DayMatch {
  readonly won: boolean;
  readonly online: boolean;
  readonly difficulty: 'easy' | 'normal' | 'hard' | null;
  readonly shipsAfloat: number;
  readonly events: readonly MatchEvent[];
}

/** One raid the player ran, or one run against them. */
export interface DayRaid {
  readonly stars: number;
  readonly steel: number;
  readonly defenderName: string | null;
}

export interface DayDefence {
  readonly destruction: number;
  readonly raiderName: string;
  readonly steelLost: number;
}

/** Everything outside the match log, as the database already holds it. */
export interface DayRecords {
  readonly name: string;
  readonly matches: readonly DayMatch[];
  readonly raids: readonly DayRaid[];
  readonly defences: readonly DayDefence[];
  readonly city: {
    readonly upgradesFinished: number;
    readonly admiraltyLevel: number;
    readonly admiraltyUp: boolean;
    readonly steelCollected: number;
    readonly scrapCollected: number;
    readonly buildingFinished: string | null;
    readonly researchFinished: string | null;
  };
  readonly contracts: {
    readonly claimed: number;
    readonly weeklyClaimed: number;
    readonly inkEarned: number;
    readonly logPage: number;
  };
  readonly rankedUp: string | null;
  readonly fleet: {
    readonly name: string | null;
    readonly donationsGiven: number;
    readonly warResult: 'won' | 'lost' | 'draw' | null;
    readonly warOpponent: string | null;
    readonly warStars: number;
  };
  readonly puzzle: {
    readonly shots: number | null;
    readonly beatPar: boolean;
    readonly streak: number;
  };
  readonly voyages: {
    readonly returned: number;
    readonly coins: number;
    readonly pirateWins: number;
  };
  /** §1 — "plus a small global feed". */
  readonly global: {
    readonly topCaptain: string | null;
    readonly biggestRaidBy: string | null;
    readonly biggestRaidSteel: number;
    readonly fleetWarWinner: string | null;
  };
}

/** A-J, the display row the brief uses. Coord rows are 0..9. */
export function rowLetter(row: number): string {
  return String.fromCharCode(65 + Math.max(0, Math.min(9, Math.trunc(row))));
}

/** Where the best atomic strike of the day landed, for §1's headline. */
function bestAtomicAt(matches: readonly DayMatch[]): { kills: number; row: string | null } {
  let kills = 0;
  let row: string | null = null;

  for (const match of matches) {
    const run = bestAtomicRun(match.events);
    if (run <= kills) continue;
    kills = run;

    // The drop that opened the winning run: the last atomic drop before the
    // sinks. Reading it back out keeps the row honest rather than guessed.
    let candidate: string | null = null;
    let armed = false;
    let current = 0;
    for (const event of match.events) {
      if (event.type === 'BOMB_DROPPED') {
        armed = (event as { kind?: string }).kind === 'atomicBomber';
        current = 0;
        if (armed) {
          const at = (event as { at?: { r: number; c: number } }).at;
          candidate = at ? rowLetter(at.r) : null;
        }
        continue;
      }
      if (!armed) continue;
      if (event.type === 'SUNK') {
        current++;
        if (current === run) {
          row = candidate;
          break;
        }
      }
    }
  }
  return { kills, row };
}

function countSunk(events: readonly MatchEvent[]): number {
  return events.filter((event) => event.type === 'SUNK').length;
}

function countSunkOfClass(events: readonly MatchEvent[], shipClass: string): number {
  return events.filter(
    (event) => event.type === 'SUNK' && (event as { shipClass?: string }).shipClass === shipClass,
  ).length;
}

/** The longest run of wins inside the day, in the order they were played. */
function bestWinStreak(matches: readonly DayMatch[]): number {
  let best = 0;
  let run = 0;
  for (const match of matches) {
    if (match.won) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

const max = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), 0);
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/**
 * The day, as the templates see it.
 *
 * Every field is derived; nothing is passed through from a client. That is
 * the same rule Part 4's metrics keep, and for the same reason — a headline is
 * a small reward, and a reward a client can claim is a reward a client will
 * claim.
 */
export function summariseDay(records: DayRecords): DaySummary {
  const { matches } = records;
  const won = matches.filter((m) => m.won);
  const atomic = bestAtomicAt(matches);
  const bestRaid = records.raids.reduce<DayRaid | null>(
    (best, raid) => (best === null || raid.stars > best.stars ? raid : best),
    null,
  );
  const worstDefence = records.defences.reduce<DayDefence | null>(
    (worst, d) => (worst === null || d.steelLost > worst.steelLost ? d : worst),
    null,
  );
  // §1's "Harbour holds" wants the defence that HELD, i.e. the lowest
  // destruction, not the one that hurt most.
  const bestHold = records.defences.reduce<DayDefence | null>(
    (best, d) => (best === null || d.destruction < best.destruction ? d : best),
    null,
  );
  const held = bestHold && bestHold.destruction < 0.5 ? bestHold : null;

  return {
    name: records.name,

    matchesPlayed: matches.length,
    matchesWon: won.length,
    onlineWon: won.filter((m) => m.online).length,
    bestWinStreak: bestWinStreak(matches),
    shipsSunk: sum(matches.map((m) => countSunk(m.events))),
    battleshipsSunk: sum(matches.map((m) => countSunkOfClass(m.events, 'battleship'))),
    planesDownedByOneGun: max(matches.map((m) => bestSameGunDowns(m.events))),
    atomicMultiKill: atomic.kills,
    atomicRow: atomic.row,
    longestHitRun: max(matches.map((m) => longestHitRun(m.events))),
    wonWithShipsAfloat: max(won.map((m) => m.shipsAfloat)),
    rankedUp: records.rankedUp,
    beatHardAi: won.some((m) => !m.online && m.difficulty === 'hard'),

    raidsRun: records.raids.length,
    raidStars: sum(records.raids.map((r) => r.stars)),
    bestRaidStars: bestRaid?.stars ?? 0,
    bestRaidTarget: bestRaid?.defenderName ?? null,
    raidSteel: sum(records.raids.map((r) => r.steel)),
    defendedAt: held ? held.destruction : null,
    defendedAgainst: held ? held.raiderName : null,
    raidedBy: worstDefence?.raiderName ?? null,
    raidedForSteel: worstDefence?.steelLost ?? 0,

    upgradesFinished: records.city.upgradesFinished,
    admiraltyLevel: records.city.admiraltyLevel,
    admiraltyUp: records.city.admiraltyUp,
    steelCollected: records.city.steelCollected,
    scrapCollected: records.city.scrapCollected,
    buildingFinished: records.city.buildingFinished,
    researchFinished: records.city.researchFinished,

    contractsClaimed: records.contracts.claimed,
    weeklyClaimed: records.contracts.weeklyClaimed,
    inkEarned: records.contracts.inkEarned,
    logPage: records.contracts.logPage,

    fleetName: records.fleet.name,
    donationsGiven: records.fleet.donationsGiven,
    warResult: records.fleet.warResult,
    warOpponent: records.fleet.warOpponent,
    warStars: records.fleet.warStars,

    puzzleShots: records.puzzle.shots,
    puzzleBeatPar: records.puzzle.beatPar,
    puzzleStreak: records.puzzle.streak,

    voyagesReturned: records.voyages.returned,
    voyageCoins: records.voyages.coins,
    pirateWins: records.voyages.pirateWins,

    topCaptain: records.global.topCaptain,
    biggestRaidBy: records.global.biggestRaidBy,
    biggestRaidSteel: records.global.biggestRaidSteel,
    fleetWarWinner: records.global.fleetWarWinner,
  };
}

/** An empty day, for a player the server has no records for. */
export function emptyRecords(name: string): DayRecords {
  return {
    name,
    matches: [],
    raids: [],
    defences: [],
    city: {
      upgradesFinished: 0,
      admiraltyLevel: 0,
      admiraltyUp: false,
      steelCollected: 0,
      scrapCollected: 0,
      buildingFinished: null,
      researchFinished: null,
    },
    contracts: { claimed: 0, weeklyClaimed: 0, inkEarned: 0, logPage: 0 },
    rankedUp: null,
    fleet: { name: null, donationsGiven: 0, warResult: null, warOpponent: null, warStars: 0 },
    puzzle: { shots: null, beatPar: false, streak: 0 },
    voyages: { returned: 0, coins: 0, pirateWins: 0 },
    global: { topCaptain: null, biggestRaidBy: null, biggestRaidSteel: 0, fleetWarWinner: null },
  };
}

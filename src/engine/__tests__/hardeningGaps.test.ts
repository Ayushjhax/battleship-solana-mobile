/**
 * Hardening pass §2 — the coverage gaps in the Port City pure-rules modules.
 *
 * These are the reads and edge branches that existed but were never exercised:
 * `summariseDay` (the Gazette's only source of facts, previously covered only
 * by the server suite), the puzzle's resume/finish/hitCount path, the two
 * defensive switch defaults, and the voyage route table.
 *
 * The dead private `bestSingleUse` in `bounties/metrics.ts` was deleted rather
 * than tested: no module imports it and it is not exported, so no test could
 * call it. See the hardening report.
 */
import { describe, expect, it } from 'vitest';
import { cellsOf } from '../board';
import { earnsFlag, flagProgress, raidPolicy, wallOrder, canRaidFriendly, type LayoutContext } from '../fleets';
import {
  emptyRecords,
  quietDay,
  rowLetter,
  summariseDay,
  type DayRecords,
} from '../gazette';
import { finish, fire, hitCount, puzzleLayout, resumeRun } from '../puzzle';
import type { CellState, MatchEvent, ShipClass } from '../types';

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

const hit = (r: number, c: number): MatchEvent => ({ type: 'HIT', playerId: 'a', at: { r, c } });
const miss = (r: number, c: number): MatchEvent => ({ type: 'MISS', playerId: 'a', at: { r, c } });
const mine = (r: number, c: number): MatchEvent => ({
  type: 'MINE_TRIGGERED',
  playerId: 'a',
  at: { r, c },
});
const sunk = (shipClass: ShipClass): MatchEvent => ({
  type: 'SUNK',
  playerId: 'a',
  shipId: `${shipClass}-1`,
  shipClass,
  cells: [],
});
const atomicDrop = (r: number, c: number): MatchEvent => ({
  type: 'BOMB_DROPPED',
  playerId: 'a',
  kind: 'atomicBomber',
  at: { r, c },
  index: 0,
  total: 1,
  resolves: true,
});
const plainDrop = (r: number, c: number): MatchEvent => ({
  type: 'BOMB_DROPPED',
  playerId: 'a',
  kind: 'bomber',
  at: { r, c },
  index: 0,
  total: 1,
  resolves: true,
});
const downed = (r: number, c: number): MatchEvent => ({
  type: 'AIRCRAFT_DOWNED',
  playerId: 'a',
  kind: 'torpedoBomber',
  gunAt: { r, c },
});

// ---------------------------------------------------------------------------
// gazette/facts.ts
// ---------------------------------------------------------------------------

describe('summariseDay — the Gazette’s facts from raw records', () => {
  it('an empty day is exactly quietDay, field for field', () => {
    expect(summariseDay(emptyRecords('Hallie'))).toEqual(quietDay('Hallie'));
  });

  it('derives every battle reading from the event logs', () => {
    const records: DayRecords = {
      ...emptyRecords('Hallie'),
      matches: [
        { won: true, online: true, difficulty: null, shipsAfloat: 5, events: [hit(0, 0), hit(0, 1), miss(2, 2)] },
        {
          won: true,
          online: false,
          difficulty: 'hard',
          shipsAfloat: 3,
          events: [
            atomicDrop(4, 4),
            sunk('battleship'),
            sunk('destroyer'),
            downed(1, 1),
            downed(1, 1),
          ],
        },
        { won: false, online: true, difficulty: null, shipsAfloat: 0, events: [hit(3, 3)] },
        { won: true, online: true, difficulty: null, shipsAfloat: 6, events: [plainDrop(5, 5), sunk('boat')] },
        { won: true, online: false, difficulty: null, shipsAfloat: 2, events: [atomicDrop(7, 7), sunk('boat'), hit(8, 8)] },
      ],
      raids: [
        { stars: 1, steel: 10, defenderName: 'coast' },
        { stars: 3, steel: 50, defenderName: 'kraken' },
      ],
      defences: [
        { destruction: 0.3, raiderName: 'held-off', steelLost: 5 },
        { destruction: 0.8, raiderName: 'overrun', steelLost: 40 },
      ],
    };

    const day = summariseDay(records);
    expect(day.matchesPlayed).toBe(5);
    expect(day.matchesWon).toBe(4);
    expect(day.onlineWon).toBe(2);
    expect(day.bestWinStreak).toBe(2); // W W L W W
    expect(day.shipsSunk).toBe(4);
    expect(day.battleshipsSunk).toBe(1);
    expect(day.planesDownedByOneGun).toBe(2);
    expect(day.atomicMultiKill).toBe(2);
    expect(day.atomicRow).toBe('E'); // the (4,4) drop, read back from the log
    expect(day.longestHitRun).toBe(2); // m1's HIT HIT, closed by its MISS
    expect(day.wonWithShipsAfloat).toBe(6);
    expect(day.beatHardAi).toBe(true);
    expect(day.raidsRun).toBe(2);
    expect(day.raidStars).toBe(4);
    expect(day.bestRaidStars).toBe(3);
    expect(day.bestRaidTarget).toBe('kraken');
    expect(day.raidSteel).toBe(60);
    // "Harbour holds" is the LOWEST destruction; the worst hit is separate.
    expect(day.defendedAt).toBe(0.3);
    expect(day.defendedAgainst).toBe('held-off');
    expect(day.raidedBy).toBe('overrun');
    expect(day.raidedForSteel).toBe(40);
  });

  it('passes the city, contract, fleet, puzzle, voyage and global records through', () => {
    const records: DayRecords = {
      ...emptyRecords('Hallie'),
      city: {
        upgradesFinished: 2,
        admiraltyLevel: 6,
        admiraltyUp: true,
        steelCollected: 900,
        scrapCollected: 300,
        buildingFinished: 'foundry',
        researchFinished: null,
      },
      contracts: { claimed: 3, weeklyClaimed: 1, inkEarned: 420, logPage: 4 },
      rankedUp: 'Commodore',
      fleet: { name: 'Saltmarsh', donationsGiven: 7, warResult: 'won', warOpponent: 'Gull Reach', warStars: 9 },
      puzzle: { shots: 48, beatPar: true, streak: 3 },
      voyages: { returned: 2, coins: 700, pirateWins: 1 },
      global: { topCaptain: 'Khyh', biggestRaidBy: 'Nyx', biggestRaidSteel: 900, fleetWarWinner: 'Saltmarsh' },
    };
    const day = summariseDay(records);
    expect(day).toMatchObject({
      admiraltyLevel: 6,
      admiraltyUp: true,
      steelCollected: 900,
      buildingFinished: 'foundry',
      rankedUp: 'Commodore',
      fleetName: 'Saltmarsh',
      warResult: 'won',
      puzzleShots: 48,
      puzzleBeatPar: true,
      voyagesReturned: 2,
      topCaptain: 'Khyh',
      fleetWarWinner: 'Saltmarsh',
    });
  });

  it('rowLetter clamps to A–J for anything out of range', () => {
    expect(rowLetter(-3)).toBe('A');
    expect(rowLetter(0)).toBe('A');
    expect(rowLetter(3.7)).toBe('D');
    expect(rowLetter(9)).toBe('J');
    expect(rowLetter(42)).toBe('J');
  });

  it('ignores mines and non-atomic bombs when reading the hit run', () => {
    const records: DayRecords = {
      ...emptyRecords('X'),
      matches: [
        {
          won: false,
          online: true,
          difficulty: null,
          shipsAfloat: 1,
          events: [hit(0, 0), hit(0, 1), mine(0, 2), hit(0, 3)],
        },
      ],
    };
    // The mine closes the run at 2; the later hit opens a new run of 1.
    expect(summariseDay(records).longestHitRun).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// fleets/raidPolicy.ts and fleets/flagHall.ts — the defensive defaults
// ---------------------------------------------------------------------------

describe('the fleet policy switches refuse an out-of-vocabulary context', () => {
  it('raidPolicy falls back to the most restrictive answer, never the most generous', () => {
    const none = raidPolicy('nonsense' as LayoutContext);
    expect(none).toMatchObject({ loot: false, renown: false, shield: false, alwaysReveal: false });
    // And the real contexts still read as documented.
    expect(raidPolicy('raid')).toMatchObject({ loot: true, searchCost: true, limited: true });
    expect(raidPolicy('friendly')).toMatchObject({ loot: false, alwaysReveal: true, limited: false });
    expect(raidPolicy('war')).toMatchObject({ loot: false, defenceLog: false, limited: true });
  });

  it('earnsFlag gives nothing to an out-of-vocabulary context', () => {
    expect(earnsFlag('nonsense' as LayoutContext, { won: true, stars: 3 })).toBe(false);
    expect(earnsFlag('ranked', { won: true })).toBe(true);
    expect(earnsFlag('ranked', { won: false })).toBe(false);
    expect(earnsFlag('raid', { won: true, stars: 0 })).toBe(false);
    expect(earnsFlag('raid', { won: false, stars: 1 })).toBe(true);
    expect(earnsFlag('war', { won: true, stars: 3 })).toBe(false);
  });

  it('flagProgress counts each country once and wallOrder is chronological', () => {
    expect(flagProgress(['in', 'IN', 'us'], 250)).toEqual({ earned: 2, total: 250, label: '2 / 250' });
    const ordered = wallOrder([
      { countryCode: 'US', firstAt: 30 },
      { countryCode: 'IN', firstAt: 10 },
    ]);
    expect(ordered.map((f) => f.countryCode)).toEqual(['IN', 'US']);
  });

  it('canRaidFriendly refuses yourself and strangers, allows a fleetmate', () => {
    expect(canRaidFriendly('f1', 'f1', 'me', 'you').ok).toBe(true);
    expect(canRaidFriendly('f1', 'f2', 'me', 'you')).toMatchObject({ ok: false });
    expect(canRaidFriendly(null, null, 'me', 'you')).toMatchObject({ ok: false });
    expect(canRaidFriendly('f1', 'f1', 'me', 'me')).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------
// puzzle/puzzle.ts — resume, finish, hitCount
// ---------------------------------------------------------------------------

describe('a puzzle run resumed from the database', () => {
  const DATE = '2026-04-11';

  it('derives each ship’s hits from the marks, and finished from the fleet', () => {
    const ships = puzzleLayout(DATE);
    const all: Record<string, CellState> = {};
    for (const cell of cellsOf(ships[0]!)) all[`${cell.r},${cell.c}`] = 'hit';
    // One miss must not be mistaken for a hit.
    all['9,9'] = 'miss';

    const partial = resumeRun(DATE, all, 12, 1_000, null);
    expect(partial.finished).toBe(false);
    expect(partial.ships[0]?.hits).toHaveLength(ships[0]!.len);
    expect(partial.ships[1]?.hits).toHaveLength(0);
    expect(partial.shots).toBe(12);
    expect(partial.startedAt).toBe(1_000);

    const complete: Record<string, CellState> = {};
    for (const ship of ships) for (const cell of cellsOf(ship)) complete[`${cell.r},${cell.c}`] = 'sunk';
    const done = resumeRun(DATE, complete, 55, 1_000, 2_000);
    expect(done.finished).toBe(true);
    expect(done.finishedAt).toBe(2_000);
    expect(done.ships.every((s) => s.hits.length === s.len)).toBe(true);
  });

  it('hitCount is exactly the red cells, never a miss or a reveal', () => {
    expect(
      hitCount({ '0,0': 'hit', '1,1': 'sunk', '2,2': 'miss', '3,3': 'revealed' }),
    ).toBe(2);
    expect(hitCount({})).toBe(0);
  });

  it('finish stamps the clock once, and only on a finished run', () => {
    const date = '2026-04-12';
    const fresh = resumeRun(date, {}, 1, 10, null);
    expect(finish(fresh, 99)).toBe(fresh); // not finished: untouched

    const finished = { ...fresh, finished: true };
    const stamped = finish(finished, 99);
    expect(stamped.finishedAt).toBe(99);
    expect(finish(stamped, 123)).toBe(stamped); // already stamped: untouched
  });

  it('a finished run refuses another shot', () => {
    const run = { ...resumeRun('2026-04-13', {}, 3, 0, 5), finished: true };
    const step = fire(run, { r: 0, c: 0 });
    expect(step.error).toBe('already-finished');
    expect(step.events).toEqual([]);
  });
});

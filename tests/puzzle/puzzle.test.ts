/**
 * The daily puzzle — part-09 §5.1, §5.3 and §5.4.
 *
 *   5.1 "The same date produces the same board for two different callers; a
 *        different date produces a different board. **The layout never appears
 *        in any response payload.**"
 *   5.3 "Par, under-par and Admiral's-round boundaries; the streak counter,
 *        including a missed day resetting it."
 *   5.4 "The emoji grid is 10 x 10 and matches the marks."
 *
 * §5.1's second sentence is the one that matters. It gets the same treatment
 * Part 6 gave the raid: the view is serialised and grepped for a ship cell the
 * solver has not hit, after every shot of a full solve.
 */
import { describe, expect, it } from 'vitest';

import { coordKey } from '@engine/board';
import { FLEET_CELL_COUNT, FLEET_SHIP_COUNT, isSunk } from '@engine/fleet';
import {
  ADMIRALS_ROUND,
  EMOJI,
  PAR_GEMS,
  PUZZLE_PAR,
  PUZZLE_REWARD,
  STREAK_BONUSES,
  advanceStreak,
  beatPar,
  emojiGrid,
  finish,
  fire,
  grade,
  gridCounts,
  puzzleDate,
  puzzleLayout,
  puzzleNumber,
  rewardFor,
  seedForDate,
  shareText,
  startRun,
  puzzleView,
  type PuzzleRun,
} from '@engine/puzzle';
import type { Coord, Marks, Ship } from '@engine/types';

const shipCells = (ship: Ship): Coord[] =>
  Array.from({ length: ship.len }, (_, i) =>
    ship.orientation === 'h'
      ? { r: ship.origin.r, c: ship.origin.c + i }
      : { r: ship.origin.r + i, c: ship.origin.c },
  );

/** Solves a day completely, calling `onStep` after every shot. */
function solve(date: string, onStep?: (run: PuzzleRun) => void): PuzzleRun {
  let run = startRun(date, 1_000);
  const targets = run.ships.flatMap(shipCells);

  for (const at of targets) {
    if (run.finished) break;
    if (run.marks[coordKey(at)] !== undefined) continue;
    run = fire(run, at).run;
    onStep?.(run);
  }
  return finish(run, 2_000);
}

// ===========================================================================
// §5.1 — ONE BOARD A DAY, THE SAME FOR EVERYONE
// ===========================================================================

describe('the daily board', () => {
  it('is identical for two callers on the same date', () => {
    // Two "clients" that share nothing but the date string.
    expect(puzzleLayout('2026-04-11')).toEqual(puzzleLayout('2026-04-11'));
  });

  it('differs from day to day — consecutive days are not near-identical', () => {
    const a = puzzleLayout('2026-04-11');
    const b = puzzleLayout('2026-04-12');
    expect(a).not.toEqual(b);

    const cellsA = new Set(a.flatMap(shipCells).map(coordKey));
    const cellsB = b.flatMap(shipCells).map(coordKey);
    const shared = cellsB.filter((k) => cellsA.has(k)).length;
    // 18 cells of 100 overlapping entirely by chance is vanishingly unlikely;
    // a seed that failed to mix would score 18.
    expect(shared).toBeLessThan(FLEET_CELL_COUNT);
  });

  it('is a legal standard fleet — the engine placer, so no-touch by construction', () => {
    const ships = puzzleLayout('2026-04-11');
    expect(ships).toHaveLength(FLEET_SHIP_COUNT);
    expect(ships.flatMap(shipCells)).toHaveLength(FLEET_CELL_COUNT);

    const occupied = new Set(ships.flatMap(shipCells).map(coordKey));
    expect(occupied.size).toBe(FLEET_CELL_COUNT); // no overlap

    for (const ship of ships) {
      const own = new Set(shipCells(ship).map(coordKey));
      for (const cell of shipCells(ship)) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const k = coordKey({ r: cell.r + dr, c: cell.c + dc });
            if (own.has(k)) continue;
            expect(occupied.has(k), `${ship.id} touches ${k}`).toBe(false);
          }
        }
      }
    }
  });

  it('seeds every date in a decade distinctly', () => {
    const seeds = new Set<number>();
    let day = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 3_650; i++) {
      seeds.add(seedForDate(new Date(day).toISOString().slice(0, 10)));
      day += 86_400_000;
    }
    expect(seeds.size).toBe(3_650);
  });

  it('numbers editions from the epoch', () => {
    expect(puzzleNumber('2026-01-01')).toBe(1);
    expect(puzzleNumber('2026-01-02')).toBe(2);
    expect(puzzleNumber('2026-04-11')).toBe(101);
  });

  it('keys days by UTC, not by local time', () => {
    // 23:30 UTC on the 11th is already the 12th in Sydney. The puzzle is the
    // 11th's for both, or the board is not "the same for every player".
    expect(puzzleDate(Date.parse('2026-04-11T23:30:00Z'))).toBe('2026-04-11');
    expect(puzzleDate(Date.parse('2026-04-12T00:30:00Z'))).toBe('2026-04-12');
  });
});

// ===========================================================================
// §5.1 — "THE LAYOUT NEVER APPEARS IN ANY RESPONSE PAYLOAD"
// ===========================================================================

describe('the layout never leaves the server', () => {
  it('PuzzleView has no ships and no layout field', () => {
    const run = startRun('2026-04-11', 0);
    const view = puzzleView(run);
    expect(Object.keys(view).sort()).toEqual(
      ['date', 'finished', 'marks', 'number', 'par', 'shipsRemaining', 'shots'].sort(),
    );
    expect('ships' in view).toBe(false);
    expect('layout' in view).toBe(false);
  });

  it('no un-hit ship cell appears in a serialised view, at any point in a solve', () => {
    const date = '2026-04-11';
    const layout = puzzleLayout(date);

    solve(date, (run) => {
      const wire = JSON.stringify(puzzleView(run));

      for (const ship of layout) {
        for (const cell of shipCells(ship)) {
          const k = coordKey(cell);
          const known = run.marks[k];
          if (known === 'hit' || known === 'sunk') continue;
          // Not yet found. Its key must not be anywhere in the payload.
          expect(wire.includes(`"${k}"`), `leaked ${k} for ${ship.id}`).toBe(false);
        }
      }
      // And no ship id, ever.
      for (const ship of layout) expect(wire.includes(ship.id)).toBe(false);
    });
  });

  it('shipsRemaining is a count, and a count is not a location', () => {
    const run = startRun('2026-04-11', 0);
    expect(puzzleView(run).shipsRemaining).toBe(FLEET_SHIP_COUNT);
    expect(JSON.stringify(puzzleView(run))).not.toContain('origin');
  });

  it('a fuzz over 200 days never leaks', () => {
    let day = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 200; i++) {
      const date = new Date(day).toISOString().slice(0, 10);
      day += 86_400_000;

      let run = startRun(date, 0);
      // Fire a diagonal — a handful of shots, some hits, most misses.
      for (let n = 0; n < 10; n++) run = fire(run, { r: n, c: n }).run;

      const wire = JSON.stringify(puzzleView(run));
      for (const ship of puzzleLayout(date)) {
        for (const cell of shipCells(ship)) {
          const k = coordKey(cell);
          const mark = run.marks[k];
          if (mark === 'hit' || mark === 'sunk') continue;
          expect(wire.includes(`"${k}"`), `${date} leaked ${k}`).toBe(false);
        }
      }
    }
  });
});

// ===========================================================================
// Firing
// ===========================================================================

describe('firing', () => {
  it('counts a shot, and an auto-revealed halo cell is free', () => {
    const date = '2026-04-11';
    const run = solve(date);
    expect(run.finished).toBe(true);
    // Every ship cell had to be fired at, but the sunk halos came free — so a
    // complete solve is never 100 shots.
    expect(run.shots).toBeGreaterThanOrEqual(FLEET_CELL_COUNT);
    expect(run.shots).toBeLessThan(100);
    expect(Object.keys(run.marks).length).toBeGreaterThan(run.shots);
  });

  it('refuses a cell already resolved, and an out-of-bounds cell', () => {
    let run = startRun('2026-04-11', 0);
    run = fire(run, { r: 0, c: 0 }).run;
    expect(fire(run, { r: 0, c: 0 }).error).toBe('illegal-cell');
    expect(fire(run, { r: 10, c: 0 }).error).toBe('illegal-cell');
    expect(fire(run, { r: -1, c: 0 }).error).toBe('illegal-cell');
  });

  it('refuses a shot after the board is finished — §5.2’s rule, in the engine', () => {
    const run = solve('2026-04-11');
    const step = fire(run, { r: 0, c: 0 });
    expect(step.error).toBe('already-finished');
    expect(step.run.shots).toBe(run.shots); // and nothing moved
  });

  it('a rejected shot does not count', () => {
    let run = startRun('2026-04-11', 0);
    run = fire(run, { r: 0, c: 0 }).run;
    const before = run.shots;
    expect(fire(run, { r: 0, c: 0 }).run.shots).toBe(before);
  });

  it('finishes exactly when the last ship sinks', () => {
    let seen = false;
    const run = solve('2026-04-11', (step) => {
      const allSunk = step.ships.every(isSunk);
      expect(step.finished).toBe(allSunk);
      if (allSunk) seen = true;
    });
    expect(seen).toBe(true);
    expect(run.finishedAt).toBe(2_000);
  });

  it('is resumable: marks and shot count survive being carried across a gap', () => {
    // §2 — "one resumable attempt a day". The run is plain data, so a row
    // read back from Postgres is the same object.
    let run = startRun('2026-04-11', 0);
    for (const at of [{ r: 1, c: 1 }, { r: 2, c: 2 }, { r: 3, c: 3 }]) run = fire(run, at).run;

    const rehydrated: PuzzleRun = JSON.parse(
      JSON.stringify({ ...run, ships: run.ships }),
    ) as PuzzleRun;
    expect(rehydrated.shots).toBe(run.shots);
    expect(rehydrated.marks).toEqual(run.marks);
    expect(fire(rehydrated, { r: 1, c: 1 }).error).toBe('illegal-cell');
  });
});

// ===========================================================================
// §5.3 — PAR, GRADES AND STREAKS
// ===========================================================================

describe('par and the grade boundaries', () => {
  it('is §2’s numbers', () => {
    expect(PUZZLE_PAR).toBe(52);
    expect(ADMIRALS_ROUND).toBe(46);
    expect(PUZZLE_REWARD).toEqual({ coins: 200, steel: 200, ink: 50 });
    expect(PAR_GEMS).toBe(10);
  });

  it('grades exactly on the boundary, not near it', () => {
    expect(grade(45)).toBe('admirals-round');
    expect(grade(46)).toBe('under-par'); // "under 46", so 46 itself is not
    expect(grade(51)).toBe('under-par');
    expect(grade(52)).toBe('par'); // par is par, not under
    expect(grade(53)).toBe('over-par');
  });

  it('beating par is strict', () => {
    expect(beatPar(51)).toBe(true);
    expect(beatPar(52)).toBe(false);
    expect(beatPar(53)).toBe(false);
  });

  it('respects a server-configured par rather than the constant', () => {
    // §0.1 of the plan: par is configurable because it was measured on a
    // 20-cell fleet and this game has 18.
    expect(grade(48, 46, 40)).toBe('over-par');
    expect(beatPar(48, 50)).toBe(true);
  });
});

describe('rewards', () => {
  it('a finish pays §2’s base', () => {
    const reward = rewardFor(60, 1);
    expect(reward).toMatchObject({ coins: 200, steel: 200, ink: 50, gems: 0 });
  });

  it('beating par adds 10 gems; matching it does not', () => {
    expect(rewardFor(51, 1).gems).toBe(10);
    expect(rewardFor(52, 1).gems).toBe(0);
  });

  it('pays each streak milestone once, on the day it is reached', () => {
    for (const bonus of STREAK_BONUSES) {
      const on = rewardFor(60, bonus.days);
      expect(on.milestone).toBe(bonus.days);
      expect(on.coins).toBe(PUZZLE_REWARD.coins + bonus.coins);
      expect(on.steel).toBe(PUZZLE_REWARD.steel + bonus.steel);

      const after = rewardFor(60, bonus.days + 1);
      expect(after.milestone).toBeNull();
      expect(after.coins).toBe(PUZZLE_REWARD.coins);
    }
  });

  it('stacks a milestone with the par bonus', () => {
    expect(rewardFor(40, 7).gems).toBe(PAR_GEMS + 5);
  });
});

describe('the streak', () => {
  it('starts at 1 on a first solve', () => {
    expect(advanceStreak(null, 0, '2026-04-11')).toBe(1);
  });

  it('grows by one after a solve yesterday', () => {
    expect(advanceStreak('2026-04-10', 4, '2026-04-11')).toBe(5);
  });

  it('A MISSED DAY RESETS IT — to 1, because today counts', () => {
    expect(advanceStreak('2026-04-09', 9, '2026-04-11')).toBe(1);
    expect(advanceStreak('2026-03-01', 30, '2026-04-11')).toBe(1);
  });

  it('is unchanged by re-reading the same day', () => {
    expect(advanceStreak('2026-04-11', 6, '2026-04-11')).toBe(6);
  });

  it('crosses a month and a year boundary', () => {
    expect(advanceStreak('2026-02-28', 3, '2026-03-01')).toBe(4);
    expect(advanceStreak('2026-12-31', 12, '2027-01-01')).toBe(13);
  });

  it('crosses a leap day', () => {
    expect(advanceStreak('2028-02-28', 1, '2028-02-29')).toBe(2);
    expect(advanceStreak('2028-02-29', 2, '2028-03-01')).toBe(3);
  });

  it('a 30-day run reaches the 30 milestone exactly once', () => {
    let streak = 0;
    let last: string | null = null;
    const milestones: number[] = [];
    let day = Date.parse('2026-04-01T00:00:00Z');

    for (let i = 0; i < 40; i++) {
      const today = new Date(day).toISOString().slice(0, 10);
      streak = advanceStreak(last, streak, today);
      const reward = rewardFor(60, streak);
      if (reward.milestone) milestones.push(reward.milestone);
      last = today;
      day += 86_400_000;
    }
    expect(milestones).toEqual([3, 7, 30]);
  });
});

// ===========================================================================
// §5.4 — THE EMOJI GRID
// ===========================================================================

describe('the emoji grid', () => {
  it('is exactly 10 rows of 10', () => {
    const run = solve('2026-04-11');
    const rows = emojiGrid(run.marks).split('\n');
    expect(rows).toHaveLength(10);
    for (const row of rows) expect([...row]).toHaveLength(10);
  });

  it('is 10 x 10 on an untouched board too — all blanks', () => {
    const grid = emojiGrid({});
    expect(grid.split('\n')).toHaveLength(10);
    expect(gridCounts({})).toEqual({ hit: 0, miss: 0, blank: 100 });
  });

  it('MATCHES THE MARKS, cell for cell', () => {
    const run = solve('2026-04-11');
    const rows = emojiGrid(run.marks).split('\n');

    for (let r = 0; r < 10; r++) {
      const cells = [...rows[r]!];
      for (let c = 0; c < 10; c++) {
        const mark = run.marks[coordKey({ r, c })];
        // §2's legend is about what the SOLVER did, not what the board holds:
        // "\u2b1c never fired". An auto-revealed halo cell was never fired at,
        // so it is blank — see the `revealed` case below.
        const expected =
          mark === 'hit' || mark === 'sunk'
            ? EMOJI.hit
            : mark === undefined || mark === 'revealed'
              ? EMOJI.blank
              : EMOJI.miss;
        expect(cells[c], `r${r}c${c} was ${String(mark)}`).toBe(expected);
      }
    }
  });

  it('shows every hit — a full solve has exactly the fleet’s cells in red', () => {
    const run = solve('2026-04-11');
    expect(gridCounts(run.marks).hit).toBe(FLEET_CELL_COUNT);
  });

  it('counts always total 100', () => {
    for (const date of ['2026-04-11', '2026-07-02', '2026-11-30']) {
      const counts = gridCounts(solve(date).marks);
      expect(counts.hit + counts.miss + counts.blank).toBe(100);
    }
  });

  it('folds sunk into hit, and shows a revealed halo cell as NEVER FIRED', () => {
    // Two different foldings, and the reason differs for each.
    //
    // sunk -> hit: a sunk cell was hit; the distinction is about the ship, not
    // the shot.
    //
    // revealed -> blank: §2's legend reads "\u2b1c never fired", and the solver
    // did not fire at a halo cell — the no-touch rule opened it for free.
    // Painting halos blue would both overstate the shot count and trace a
    // one-cell outline around every sunk hull.
    const marks: Marks = {
      [coordKey({ r: 0, c: 0 })]: 'hit',
      [coordKey({ r: 0, c: 1 })]: 'sunk',
      [coordKey({ r: 1, c: 0 })]: 'miss',
      [coordKey({ r: 1, c: 1 })]: 'revealed',
    } as Marks;
    const rows = emojiGrid(marks).split('\n');
    expect([...rows[0]!].slice(0, 2)).toEqual([EMOJI.hit, EMOJI.hit]);
    expect([...rows[1]!].slice(0, 2)).toEqual([EMOJI.miss, EMOJI.blank]);
  });

  it('\u26a0 a COMPLETED grid is the day\u2019s layout, in shareable form', () => {
    // This is not a bug in the code — it is §2's format working as specified,
    // and it is pinned here so it cannot be discovered by surprise.
    //
    // Every player gets the SAME board on a given day. A finished grid marks
    // 🟥 on exactly the 18 ship cells, so the first player to share hands the
    // layout to everyone who has not solved yet. They can then finish in 18
    // shots — against an Admiral's round of 46 — which is the dominant
    // strategy and directly undercuts §2's "that also makes the leaderboard
    // trustworthy".
    //
    // Recorded in DECISIONS.md as D32 with the options. The server stores the
    // hit count alongside the shot count so a policy can be applied later
    // without a migration; no policy is applied here, because choosing one is
    // not mine to do.
    const date = '2026-04-11';
    const run = solve(date);
    const red = new Set<string>();
    const rows = emojiGrid(run.marks).split('\n');
    for (let r = 0; r < 10; r++) {
      const cells = [...rows[r]!];
      for (let c = 0; c < 10; c++) if (cells[c] === EMOJI.hit) red.add(coordKey({ r, c }));
    }

    const actual = new Set(puzzleLayout(date).flatMap(shipCells).map(coordKey));
    expect(red).toEqual(actual); // the grid IS the layout
  });

  it('the share text carries the edition, the score and the grid', () => {
    const run = solve('2026-04-11');
    const text = shareText('2026-04-11', run.shots, run.marks);
    expect(text).toContain(`#${puzzleNumber('2026-04-11')}`);
    expect(text).toContain(`${run.shots} shots`);
    expect(text).toContain(`par ${PUZZLE_PAR}`);
    expect(text.endsWith(emojiGrid(run.marks))).toBe(true);
  });

  it('the share text leaks nothing about un-hit cells', () => {
    let run = startRun('2026-04-11', 0);
    run = fire(run, { r: 0, c: 0 }).run;
    const text = shareText('2026-04-11', run.shots, run.marks);
    // 99 of the 100 squares are blank or the one shot; the grid cannot say
    // where anything is because a blank is a blank.
    expect(gridCounts(run.marks).blank).toBeGreaterThanOrEqual(90);
    expect(text).not.toContain('origin');
  });
});

/**
 * The puzzle SQL, against a real Postgres — part-09 §4, §5.2.
 *
 *   5.2 "Puzzle resume: kill the session mid-solve, resume, shots and marks
 *        intact; **a second attempt on the same day is refused**."
 *
 * These are the things a fake cannot prove: that `where finished_at is null`
 * really stops a finished run, that two concurrent settles pay once, and that
 * `puzzle.layout` is unreachable from an end-user JWT.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { coordKey } from '@engine/board';
import { FLEET_CELL_COUNT } from '@engine/fleet';
import {
  PUZZLE_PAR,
  fire,
  hitCount,
  puzzleLayout,
  puzzleView,
  resumeRun,
  startRun,
} from '@engine/puzzle';
import type { Coord, Marks, Ship } from '@engine/types';

import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const DATE = '2026-04-11';

let t: TestDb;

const shipCells = (ship: Ship): Coord[] =>
  Array.from({ length: ship.len }, (_, i) =>
    ship.orientation === 'h'
      ? { r: ship.origin.r, c: ship.origin.c + i }
      : { r: ship.origin.r + i, c: ship.origin.c },
  );

const ensure = (date = DATE) =>
  t.one<{ puzzle_ensure: number }>(`select public.puzzle_ensure($1, $2, $3) as puzzle_ensure`, [
    date,
    JSON.stringify(puzzleLayout(date)),
    PUZZLE_PAR,
  ]);

const open = (userId: string, date = DATE) =>
  t.one<{ puzzle_run_open: Record<string, unknown> }>(
    `select public.puzzle_run_open($1, $2) as puzzle_run_open`,
    [userId, date],
  );

const fireSql = (
  userId: string,
  marks: Marks,
  shots: number,
  hits: number,
  finished: boolean,
  date = DATE,
) =>
  t.one<{ puzzle_run_fire: Record<string, unknown> }>(
    `select public.puzzle_run_fire($1, $2, $3, $4, $5, $6) as puzzle_run_fire`,
    [userId, date, JSON.stringify(marks), shots, hits, finished],
  );

const settle = (userId: string, streak: number, date = DATE) =>
  t.one<{ puzzle_settle: Record<string, unknown> }>(
    `select public.puzzle_settle($1, $2, $3, 200, 200, 10, 50, null) as puzzle_settle`,
    [userId, date, streak],
  );

const profileOf = (id: string) =>
  t.one<{ coins: number; steel: number; gems: number }>(
    `select coins, steel, gems from public.profiles where id = $1`,
    [id],
  );

beforeAll(async () => {
  // Two passes: every migration must be re-runnable.
  t = await startTestDb(2);
}, 120_000);

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.query(`delete from public.economy_ledger`);
  await t.query(`delete from public.puzzle_run`);
  await t.query(`delete from public.puzzle`);
  await t.query(`delete from public.profiles where id in ($1, $2)`, [A, B]);
  await t.query(`delete from auth.users where id in ($1, $2)`, [A, B]);
  await seedProfile(t, A, { coins: 0, steel: 0, gems: 0 });
  await seedProfile(t, B, { coins: 0, steel: 0, gems: 0 });
});

// ===========================================================================
// One board a day, for everyone
// ===========================================================================

describe('the day board', () => {
  it('is created once and shared', async () => {
    const first = await ensure();
    const second = await ensure();
    expect(first.puzzle_ensure).toBe(PUZZLE_PAR);
    expect(second.puzzle_ensure).toBe(PUZZLE_PAR);

    const rows = await t.query(`select count(*)::int as n from public.puzzle where date = $1`, [DATE]);
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it('a second ensure with a DIFFERENT layout does not replace the first', async () => {
    await ensure();
    await t.query(`select public.puzzle_ensure($1, $2, $3)`, [DATE, JSON.stringify([]), 99]);

    const row = await t.one<{ layout: unknown[]; par: number }>(
      `select layout, par from public.puzzle where date = $1`,
      [DATE],
    );
    expect(row.layout).toHaveLength(8);
    expect(row.par).toBe(PUZZLE_PAR); // and the par with it
  });

  it('two players on the same day get the same board', async () => {
    await ensure();
    const stored = await t.one<{ layout: Ship[] }>(
      `select layout from public.puzzle where date = $1`,
      [DATE],
    );
    // Both runs resume against the same stored layout.
    await open(A);
    await open(B);
    expect(stored.layout.map((s) => s.id)).toEqual(puzzleLayout(DATE).map((s) => s.id));
  });
});

// ===========================================================================
// §5.2 — RESUME, AND A SECOND ATTEMPT REFUSED
// ===========================================================================

describe('resume', () => {
  it('KILL THE SESSION MID-SOLVE: shots and marks come back intact', async () => {
    await ensure();
    await open(A);

    // Fire three shots, each one its own round trip, as the API does.
    let run = startRun(DATE, 0);
    for (const at of [{ r: 0, c: 0 }, { r: 3, c: 4 }, { r: 7, c: 2 }]) {
      run = fire(run, at).run;
      await fireSql(A, run.marks, run.shots, hitCount(run.marks), run.finished);
    }

    // ---- the app dies here. Nothing in memory survives. ----

    const resumed = (await open(A)).puzzle_run_open;
    expect(resumed.shots).toBe(3);
    expect(resumed.finished).toBe(false);
    // Content, not key order: Postgres `jsonb` normalises key order, so a
    // key-order assertion here would be testing Postgres rather than resume.
    expect(resumed.marks).toEqual(run.marks);

    // And the rebuilt run behaves as though nothing happened: the three cells
    // are still spent.
    const rebuilt = resumeRun(DATE, resumed.marks as Marks, resumed.shots as number, 0, null);
    expect(fire(rebuilt, { r: 0, c: 0 }).error).toBe('illegal-cell');
    expect(fire(rebuilt, { r: 1, c: 1 }).error).toBeUndefined();
  });

  it('resumes a run that already found ships, with hits intact', async () => {
    await ensure();
    await open(A);

    const layout = puzzleLayout(DATE);
    const target = shipCells(layout[0]!)[0]!;
    let run = startRun(DATE, 0);
    run = fire(run, target).run;
    await fireSql(A, run.marks, run.shots, hitCount(run.marks), run.finished);

    const resumed = (await open(A)).puzzle_run_open;
    const rebuilt = resumeRun(DATE, resumed.marks as Marks, resumed.shots as number, 0, null);
    expect(rebuilt.ships[0]!.hits.length).toBeGreaterThan(0);
    expect(resumed.hits).toBe(1);
  });

  it('opening twice never creates a second run', async () => {
    await ensure();
    await open(A);
    await open(A);
    const rows = await t.query(`select count(*)::int as n from public.puzzle_run where user_id = $1`, [A]);
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it('two players have separate runs on the same board', async () => {
    await ensure();
    await open(A);
    await open(B);
    await fireSql(A, { [coordKey({ r: 0, c: 0 })]: 'miss' } as Marks, 1, 0, false);

    expect((await open(A)).puzzle_run_open.shots).toBe(1);
    expect((await open(B)).puzzle_run_open.shots).toBe(0);
  });
});

describe('A SECOND ATTEMPT ON THE SAME DAY IS REFUSED', () => {
  /** Plays a whole board and writes every step, as the API would. */
  async function solveFully(userId: string, date = DATE): Promise<number> {
    await ensure(date);
    await open(userId, date);

    let run = startRun(date, 0);
    for (const cell of run.ships.flatMap(shipCells)) {
      if (run.finished) break;
      if (run.marks[coordKey(cell)] !== undefined) continue;
      run = fire(run, cell).run;
      await fireSql(userId, run.marks, run.shots, hitCount(run.marks), run.finished, date);
    }
    return run.shots;
  }

  it('a finished run accepts no more shots', async () => {
    const shots = await solveFully(A);

    const refused = (
      await fireSql(A, { [coordKey({ r: 9, c: 9 })]: 'miss' } as Marks, shots + 1, 0, false)
    ).puzzle_run_fire;

    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('already-finished');

    // And the row did not move.
    const after = (await open(A)).puzzle_run_open;
    expect(after.shots).toBe(shots);
    expect(after.finished).toBe(true);
  });

  it('...and the marks are unchanged by the refused shot', async () => {
    await solveFully(A);
    const before = (await open(A)).puzzle_run_open.marks;
    await fireSql(A, {} as Marks, 0, 0, false);
    expect((await open(A)).puzzle_run_open.marks).toEqual(before);
  });

  it('re-opening a finished run returns it finished, not fresh', async () => {
    const shots = await solveFully(A);
    const reopened = (await open(A)).puzzle_run_open;
    expect(reopened.finished).toBe(true);
    expect(reopened.shots).toBe(shots);
  });

  it('a NEW DAY gives a fresh run', async () => {
    await solveFully(A, '2026-04-11');
    await ensure('2026-04-12');
    const tomorrow = (await open(A, '2026-04-12')).puzzle_run_open;
    expect(tomorrow.shots).toBe(0);
    expect(tomorrow.finished).toBe(false);
  });
});

// ===========================================================================
// The settlement pays once
// ===========================================================================

describe('settlement', () => {
  async function finish(userId: string, date = DATE): Promise<void> {
    await ensure(date);
    await open(userId, date);
    let run = startRun(date, 0);
    for (const cell of run.ships.flatMap(shipCells)) {
      if (run.finished) break;
      if (run.marks[coordKey(cell)] !== undefined) continue;
      run = fire(run, cell).run;
      await fireSql(userId, run.marks, run.shots, hitCount(run.marks), run.finished, date);
    }
  }

  it('pays the reward once', async () => {
    await finish(A);
    const first = (await settle(A, 1)).puzzle_settle;
    expect(first.paid).toBe(true);

    const after = await profileOf(A);
    expect(after.coins).toBe(200);
    expect(after.steel).toBe(200);
    expect(after.gems).toBe(10);
  });

  it('RUNNING IT TWICE PAYS EXACTLY ONCE', async () => {
    await finish(A);
    await settle(A, 1);
    const second = (await settle(A, 1)).puzzle_settle;

    expect(second.paid).toBe(false);
    expect(second.reason).toBe('already-settled-or-unfinished');

    const after = await profileOf(A);
    expect(after.coins).toBe(200); // not 400
    expect(after.gems).toBe(10);

    const ledger = await t.query(
      `select count(*)::int as n from public.economy_ledger where user_id = $1 and reason = 'puzzle'`,
      [A],
    );
    expect((ledger[0] as { n: number }).n).toBe(1);
  });

  it('refuses to settle an UNFINISHED run', async () => {
    await ensure();
    await open(A);
    await fireSql(A, { [coordKey({ r: 0, c: 0 })]: 'miss' } as Marks, 1, 0, false);

    const result = (await settle(A, 1)).puzzle_settle;
    expect(result.paid).toBe(false);
    expect((await profileOf(A)).coins).toBe(0);
  });

  it('records the streak so it survives a restart', async () => {
    await finish(A);
    await settle(A, 5);
    const row = await t.one<{ streak: number }>(
      `select streak from public.puzzle_run where user_id = $1 and date = $2`,
      [A, DATE],
    );
    expect(row.streak).toBe(5);
  });

  it('a streak of 0 is stored as 1 — today always counts', async () => {
    await finish(A);
    await settle(A, 0);
    const row = await t.one<{ streak: number }>(
      `select streak from public.puzzle_run where user_id = $1 and date = $2`,
      [A, DATE],
    );
    expect(row.streak).toBe(1);
  });

  it('puzzle_last_solved finds yesterday, not today', async () => {
    await finish(A, '2026-04-10');
    await settle(A, 3, '2026-04-10');
    await finish(A, '2026-04-11');

    const row = await t.one<{ puzzle_last_solved: { date: string; streak: number } | null }>(
      `select public.puzzle_last_solved($1, $2) as puzzle_last_solved`,
      [A, '2026-04-11'],
    );
    expect(row.puzzle_last_solved?.date).toBe('2026-04-10');
    expect(row.puzzle_last_solved?.streak).toBe(3);
  });

  it('returns null for a player who has never solved one', async () => {
    const row = await t.one<{ puzzle_last_solved: unknown }>(
      `select public.puzzle_last_solved($1, $2) as puzzle_last_solved`,
      [B, DATE],
    );
    expect(row.puzzle_last_solved).toBeNull();
  });
});

// ===========================================================================
// The leaderboard (§2)
// ===========================================================================

describe('the per-day leaderboard', () => {
  async function record(userId: string, shots: number, seconds: number): Promise<void> {
    await ensure();
    await t.query(
      `insert into public.puzzle_run (user_id, date, shots, hits, started_at, finished_at, streak)
       values ($1, $2, $3, 18, now() - ($4 || ' seconds')::interval, now(), 1)
       on conflict (user_id, date) do update
         set shots = excluded.shots, finished_at = excluded.finished_at,
             started_at = excluded.started_at`,
      [userId, DATE, shots, String(seconds)],
    );
  }

  it('ranks by shots, then by time taken', async () => {
    await record(A, 50, 600);
    await record(B, 50, 120); // same shots, faster

    const rows = await t.query<{ place: number; shots: number }>(
      `select place, shots from public.puzzle_leaderboard($1, 100)`,
      [DATE],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.place).toBe(1);
    // B was quicker on the same score.
    const names = await t.query<{ place: number; name: string }>(
      `select place, name from public.puzzle_leaderboard($1, 100)`,
      [DATE],
    );
    expect(names[0]!.place).toBe(1);
  });

  it('puts a lower shot count first regardless of time', async () => {
    await record(A, 44, 3_000);
    await record(B, 60, 10);
    const rows = await t.query<{ shots: number }>(
      `select shots from public.puzzle_leaderboard($1, 100)`,
      [DATE],
    );
    expect(rows.map((r) => r.shots)).toEqual([44, 60]);
  });

  it('EXPOSES NO USER ID — the same rule the match ladder keeps', async () => {
    await record(A, 44, 100);
    const rows = await t.query<Record<string, unknown>>(
      `select * from public.puzzle_leaderboard($1, 100)`,
      [DATE],
    );
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ['avatar_id', 'name', 'place', 'seconds', 'shots'].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain(A);
  });

  it('leaves unfinished runs out', async () => {
    await ensure();
    await open(A);
    const rows = await t.query(`select * from public.puzzle_leaderboard($1, 100)`, [DATE]);
    expect(rows).toHaveLength(0);
  });

  it('finds the caller by position', async () => {
    await record(A, 60, 100);
    await record(B, 44, 100);

    const mine = await t.one<{ my_puzzle_place: { place: number; shots: number } }>(
      `select public.my_puzzle_place($1, $2) as my_puzzle_place`,
      [A, DATE],
    );
    expect(mine.my_puzzle_place.place).toBe(2);
    expect(mine.my_puzzle_place.shots).toBe(60);
  });

  it('caps the page at 100 however much is asked for', async () => {
    await record(A, 44, 100);
    const rows = await t.query(`select * from public.puzzle_leaderboard($1, 5000)`, [DATE]);
    expect(rows.length).toBeLessThanOrEqual(100);
  });
});

// ===========================================================================
// §5.1 — the layout never leaves, at the SQL boundary too
// ===========================================================================

describe('the layout is unreachable from a client', () => {
  it('an end-user JWT cannot select public.puzzle at all', async () => {
    await ensure();
    await expect(
      t.asUser(A, () => t.query(`select layout from public.puzzle where date = $1`, [DATE])),
    ).rejects.toThrow();
  });

  it('nor puzzle_run, not even their own', async () => {
    await ensure();
    await open(A);
    await expect(
      t.asUser(A, () => t.query(`select * from public.puzzle_run where user_id = $1`, [A])),
    ).rejects.toThrow();
  });

  it('puzzle_ensure returns a par, never a layout', async () => {
    const row = await ensure();
    expect(typeof row.puzzle_ensure).toBe('number');
  });

  it('puzzle_run_open returns marks and counts, and nothing shaped like a ship', async () => {
    await ensure();
    await open(A);
    const payload = JSON.stringify((await open(A)).puzzle_run_open);
    expect(payload).not.toContain('origin');
    expect(payload).not.toContain('orientation');
    for (const ship of puzzleLayout(DATE)) expect(payload).not.toContain(ship.id);
  });

  it('a partly-solved run leaks no un-hit cell through the SQL path', async () => {
    await ensure();
    await open(A);

    const layout = puzzleLayout(DATE);
    let run = startRun(DATE, 0);
    for (let n = 0; n < 10; n++) run = fire(run, { r: n, c: n }).run;
    await fireSql(A, run.marks, run.shots, hitCount(run.marks), run.finished);

    const stored = (await open(A)).puzzle_run_open;
    const wire = JSON.stringify({
      ...stored,
      view: puzzleView(resumeRun(DATE, stored.marks as Marks, stored.shots as number, 0, null)),
    });

    for (const ship of layout) {
      for (const cell of shipCells(ship)) {
        const key = coordKey(cell);
        const mark = run.marks[key];
        if (mark === 'hit' || mark === 'sunk') continue;
        expect(wire.includes(`"${key}"`), `leaked ${key}`).toBe(false);
      }
    }
  });

  it('a FINISHED run holds exactly the fleet in hits — which is D32, recorded', async () => {
    await ensure();
    await open(A);
    let run = startRun(DATE, 0);
    for (const cell of run.ships.flatMap(shipCells)) {
      if (run.finished) break;
      if (run.marks[coordKey(cell)] !== undefined) continue;
      run = fire(run, cell).run;
      await fireSql(A, run.marks, run.shots, hitCount(run.marks), run.finished);
    }

    const stored = (await open(A)).puzzle_run_open;
    expect(stored.hits).toBe(FLEET_CELL_COUNT);
    // The `hits` column is the signal D32 says a later policy would need. It
    // is recorded; no policy is applied.
  });
});

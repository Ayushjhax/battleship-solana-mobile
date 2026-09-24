/**
 * PUZZLE SECRECY SWEEP — the real `/puzzle` HTTP routes over PGlite.
 *
 * The engine's `PuzzleView` has no field that could hold a layout; the SQL
 * boundary is covered in `tests/integration/puzzle-db.test.ts`. What those do
 * not cover is the CROSS-CUTTING claim: no response from GET /puzzle,
 * POST /puzzle/fire or GET /puzzle/leaderboard may ever contain the day's
 * ship positions — not as a field, not as a coordinate the solver has not
 * legitimately shot at, and not as a ship id.
 *
 * This drives a full solve through the HTTP routes, asserting after EVERY
 * response. A negative control proves the checker can fail.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { cellsOf, coordKey } from '@engine/board';
import { PUZZLE_PAR, puzzleDate, puzzleLayout } from '@engine/puzzle';
import type { Marks, Ship } from '@engine/types';

vi.mock('../../src/auth', () => ({
  verifyAccessToken: vi.fn(async (token: string) => ({
    ok: true as const,
    token: { userId: token, isAnonymous: false },
  })),
}));

import { app } from '../../src/index';
import { setDailyRepo, type DailyRepo, type FireParams, type SettleParams } from '../../src/daily/service';
import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A = '11111111-1111-4111-8111-111111111111';
const DATE = puzzleDate(Date.now());
const key = (c: { r: number; c: number }) => coordKey(c);
const forms = (c: { r: number; c: number }): [string, string] => [`"${key(c)}"`, JSON.stringify(c)];

let t: TestDb;

// ---------------------------------------------------------------------------
// The production SQL, behind the repo seam.
// ---------------------------------------------------------------------------

function pgliteRepo(db: TestDb): DailyRepo {
  const one = async <T>(sql: string, params: unknown[]): Promise<T> => {
    const rows = await db.query<Record<string, T>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  };
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const num = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  const refuse = () => Promise.reject(new Error('this sweep does not exercise voyages'));

  return {
    gazetteGetOrCreate: refuse,
    gazetteMarkRead: refuse,

    async puzzleEnsure(date, layout, par) {
      return num(await one(`select public.puzzle_ensure($1, $2, $3) as r`, [date, JSON.stringify(layout), par]), par);
    },
    async puzzleLayout(date) {
      const value = await one(`select public.puzzle_layout_internal($1) as r`, [date]);
      return Array.isArray(value) ? value : null;
    },
    async puzzleRunOpen(userId, date) {
      const row = record(await one(`select public.puzzle_run_open($1, $2) as r`, [userId, date]));
      return {
        marks: (row.marks ?? {}) as Marks,
        shots: num(row.shots),
        hits: num(row.hits),
        finished: row.finished === true,
        finishedAt: typeof row.finishedAt === 'string' ? row.finishedAt : null,
        streak: num(row.streak),
        startedAt: typeof row.startedAt === 'string' ? row.startedAt : new Date().toISOString(),
      };
    },
    async puzzleRunFire(p: FireParams) {
      const row = record(
        await one(`select public.puzzle_run_fire($1, $2, $3, $4, $5, $6) as r`, [
          p.userId, p.date, JSON.stringify(p.marks), p.shots, p.hits, p.finished,
        ]),
      );
      if (row.ok !== true) return { ok: false as const, reason: String(row.reason ?? 'refused') };
      return { ok: true as const, marks: (row.marks ?? {}) as Marks, shots: num(row.shots), finished: row.finished === true };
    },
    async puzzleSettle(p: SettleParams) {
      const row = record(
        await one(`select public.puzzle_settle($1, $2, $3, $4, $5, $6, $7, $8) as r`, [
          p.userId, p.date, p.streak, p.coins, p.steel, p.gems, p.ink, p.season,
        ]),
      );
      return {
        paid: row.paid === true,
        streak: typeof row.streak === 'number' ? row.streak : undefined,
        reason: typeof row.reason === 'string' ? row.reason : undefined,
      };
    },
    async puzzleLastSolved(userId, before) {
      const row = await one(`select public.puzzle_last_solved($1, $2) as r`, [userId, before]);
      const value = record(row);
      return typeof value.date === 'string' ? { date: value.date, streak: num(value.streak) } : null;
    },
    async puzzleLeaderboard(date, limit) {
      const rows = await db.query<Record<string, unknown>>(`select * from public.puzzle_leaderboard($1, $2)`, [date, limit]);
      return rows.map((row) => ({
        place: num(row.place),
        name: String(row.name ?? ''),
        avatarId: num(row.avatar_id),
        shots: num(row.shots),
        seconds: num(row.seconds),
      }));
    },
    async myPuzzlePlace(userId, date) {
      const row = record(await one(`select public.my_puzzle_place($1, $2) as r`, [userId, date]));
      return row.place === undefined ? null : { place: num(row.place), shots: num(row.shots), seconds: num(row.seconds) };
    },

    voyageSend: refuse,
    voyageList: refuse,
    voyageCollect: refuse,
    skirmishBoard: refuse,
    skirmishRecord: refuse,
    skirmishExpire: refuse,
  };
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/** Every shape the layout can take: the field names, the ship ids, the cells. */
function sweepPuzzleResponse(payload: unknown, layout: readonly Ship[], fired: ReadonlySet<string>, where: string): void {
  const json = JSON.stringify(payload);
  for (const forbidden of ['"layout"', '"ships"', '"origin"', '"orientation"', '"arsenal"']) {
    if (json.includes(forbidden)) throw new Error(`${where}: a layout-shaped field (${forbidden}) reached the wire`);
  }
  for (const ship of layout) {
    if (json.includes(`"${ship.id}"`)) throw new Error(`${where}: leaked ship id ${ship.id}`);
    for (const cell of cellsOf(ship)) {
      if (fired.has(key(cell))) continue;
      for (const form of forms(cell)) {
        if (json.includes(form)) throw new Error(`${where}: leaked un-fired ship cell ${key(cell)} via ${form}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  t = await startTestDb(1);
  await app.ready();
}, 180_000);

afterAll(async () => {
  await t?.close();
  await app.close();
});

beforeEach(async () => {
  process.env.PORT_CITY_GAZETTE = '1';
  setDailyRepo(pgliteRepo(t));
  await t.query(`delete from public.economy_ledger`);
  await t.query(`delete from public.puzzle_run`);
  await t.query(`delete from public.puzzle`);
  await t.query(`delete from public.profiles where id = $1`, [A]);
  await t.query(`delete from auth.users where id = $1`, [A]);
  await seedProfile(t, A, { coins: 0, steel: 0, gems: 0 });
});

afterEach(() => {
  delete process.env.PORT_CITY_GAZETTE;
});

const fire = (cell: { r: number; c: number }) =>
  app.inject({
    method: 'POST',
    url: '/puzzle/fire',
    headers: { authorization: `Bearer ${A}`, 'content-type': 'application/json' },
    payload: { cell },
  });

const get = (url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${A}` } });

describe('puzzle secrecy sweep', () => {
  it('never reveals an un-fired ship cell, a layout field or a ship id on any route', async () => {
    const layout = puzzleLayout(DATE);
    expect(layout).toHaveLength(8);
    const secretCells = layout.flatMap((ship) => cellsOf(ship));
    expect(secretCells).toHaveLength(18);

    const fired = new Set<string>();

    // 1. Opening the day's board: a view and a streak, never the board.
    const opened = await get('/puzzle');
    expect(opened.statusCode).toBe(200);
    const openedJson = opened.json();
    expect(Object.keys(openedJson.view).sort()).toEqual(
      ['date', 'finished', 'marks', 'number', 'par', 'shipsRemaining', 'shots'].sort(),
    );
    expect(openedJson.view.par).toBe(PUZZLE_PAR);
    expect(openedJson.view.marks).toEqual({});
    sweepPuzzleResponse(openedJson, layout, fired, 'GET /puzzle');

    // 2. A full solve, swept after every shot.
    let finished = false;
    for (const ship of layout) {
      for (const cell of cellsOf(ship)) {
        if (fired.has(key(cell))) continue;
        const response = await fire(cell);
        expect(response.statusCode, `fire ${key(cell)}`).toBe(200);
        const json = response.json();
        fired.add(key(cell));

        // The view's marks never name a ship cell the solver has not fired
        // at; anything else must be a rules-driven auto-reveal.
        const marks = json.view.marks as Marks;
        for (const [marked, mark] of Object.entries(marks)) {
          const isShipCell = secretCells.some((secret) => key(secret) === marked);
          if (isShipCell) {
            expect(fired.has(marked), `ship cell ${marked} marked without being fired at`).toBe(true);
          } else {
            expect(mark, `non-ship mark ${marked} must be an auto-reveal`).toBe('revealed');
          }
        }
        sweepPuzzleResponse(json, layout, fired, `fire ${key(cell)}`);
        if (json.view.finished) finished = true;
      }
    }
    expect(finished, 'the solve must finish').toBe(true);

    // 3. A second shot on the same day is refused — and the refusal carries
    //    nothing either.
    const refused = await fire(secretCells[0]!);
    expect(refused.statusCode).toBe(409);
    sweepPuzzleResponse(refused.json(), layout, fired, 'refused second attempt');

    // 4. The leaderboard: names and shot counts, never a cell.
    const board = await get('/puzzle/leaderboard');
    expect(board.statusCode).toBe(200);
    expect(Array.isArray(board.json().leaders)).toBe(true);
    sweepPuzzleResponse(board.json(), layout, fired, 'GET /puzzle/leaderboard');

    // Non-vacuity: before the first shot the checker really did have cells to
    // find; and the solver really did uncover every cell of the fleet.
    const nothingFiredYet = new Set<string>();
    expect(() => sweepPuzzleResponse({ view: { marks: {} } }, layout, nothingFiredYet, 'control')).not.toThrow();
    expect(fired.size).toBe(18);
  }, 120_000);

  it('NEGATIVE CONTROL: the sweep fails on a tampered payload', () => {
    const layout = puzzleLayout(DATE);
    const hidden = cellsOf(layout[0]!)[0]!;
    const fired = new Set<string>();
    expect(() => sweepPuzzleResponse({ view: { marks: { [key(hidden)]: 'miss' } } }, layout, fired, 'tampered')).toThrow(
      /leaked un-fired ship cell/,
    );
    expect(() => sweepPuzzleResponse({ layout }, layout, fired, 'tampered')).toThrow(/layout-shaped/);
    const afterFired = new Set([key(hidden)]);
    expect(() => sweepPuzzleResponse({ marks: { [key(hidden)]: 'hit' } }, layout, afterFired, 'tampered')).not.toThrow();
  });
});

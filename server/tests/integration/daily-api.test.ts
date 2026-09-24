/**
 * The Gazette, puzzle and voyage service end to end — part-09 §1, §2, §3.
 *
 * The real rules (`src/engine/{puzzle,gazette,voyages}`) over the real SQL
 * (PGlite running 0021), with only the repo seam swapped so the service talks
 * to the test database instead of Supabase. Nothing about the rules, the
 * transactions or the replay is faked.
 *
 * The assertion this file exists for: **no response from any of these
 * functions may contain the puzzle layout or the skirmish layout.** The
 * engine-level tests prove `PuzzleView` has no field for one; this proves the
 * service never puts one anywhere else either.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { coordKey } from '@engine/board';
import { emptyRecords, type DayRecords } from '@engine/gazette';
import { PUZZLE_PAR, puzzleLayout } from '@engine/puzzle';
import { createRng } from '@engine/rng';
import type { Coord, Marks, Ship } from '@engine/types';
import {
  SKIRMISH_SIZE,
  key,
  pirateMove,
  shoot,
  startSkirmish,
  type Cell,
  type SkirmishLog,
  type SkirmishShip,
  type VoyageReward,
} from '@engine/voyages';

import { type DailyRepo } from '../../src/daily/repo';
import {
  collectVoyage,
  firePuzzle,
  gazette,
  listVoyages,
  openPuzzle,
  puzzleLeaderboard,
  sendVoyage,
  setDailyRepo,
  submitSkirmish,
  sweepSkirmishes,
} from '../../src/daily/service';
import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
/** 2026-04-11T12:00:00Z — a fixed UTC noon, so the day key never wobbles. */
const NOW = Date.parse('2026-04-11T12:00:00Z');
const DATE = '2026-04-11';
const HOUR = 3_600_000;

let t: TestDb;

const shipCells = (ship: Ship): Coord[] =>
  Array.from({ length: ship.len }, (_, i) =>
    ship.orientation === 'h'
      ? { r: ship.origin.r, c: ship.origin.c + i }
      : { r: ship.origin.r + i, c: ship.origin.c },
  );

// ---------------------------------------------------------------------------
// The production SQL, against the test database.
// ---------------------------------------------------------------------------

function pgliteRepo(db: TestDb): DailyRepo {
  const one = async <T>(sql: string, params: unknown[]): Promise<T> => {
    const rows = await db.query<Record<string, T>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  };

  return {
    async gazetteGetOrCreate(userId, date, edition) {
      return one(`select public.gazette_get_or_create($1, $2, $3) as r`, [
        userId,
        date,
        JSON.stringify(edition),
      ]);
    },
    async gazetteMarkRead(userId, date) {
      await db.query(`select public.gazette_mark_read($1, $2)`, [userId, date]);
    },

    async puzzleEnsure(date, layout, par) {
      return one(`select public.puzzle_ensure($1, $2, $3) as r`, [date, JSON.stringify(layout), par]);
    },
    async puzzleLayout(date) {
      return one(`select public.puzzle_layout_internal($1) as r`, [date]);
    },
    async puzzleRunOpen(userId, date) {
      return one(`select public.puzzle_run_open($1, $2) as r`, [userId, date]);
    },
    async puzzleRunFire(p) {
      return one(`select public.puzzle_run_fire($1, $2, $3, $4, $5, $6) as r`, [
        p.userId,
        p.date,
        JSON.stringify(p.marks),
        p.shots,
        p.hits,
        p.finished,
      ]);
    },
    async puzzleSettle(p) {
      return one(`select public.puzzle_settle($1, $2, $3, $4, $5, $6, $7, $8) as r`, [
        p.userId,
        p.date,
        p.streak,
        p.coins,
        p.steel,
        p.gems,
        p.ink,
        p.season,
      ]);
    },
    async puzzleLastSolved(userId, before) {
      return one(`select public.puzzle_last_solved($1, $2) as r`, [userId, before]);
    },
    async puzzleLeaderboard(date, limit) {
      const rows = await db.query<{
        place: number;
        name: string;
        avatar_id: number;
        shots: number;
        seconds: number;
      }>(`select * from public.puzzle_leaderboard($1, $2)`, [date, limit]);
      return rows.map((row) => ({
        place: row.place,
        name: row.name,
        avatarId: row.avatar_id,
        shots: row.shots,
        seconds: row.seconds,
      }));
    },
    async myPuzzlePlace(userId, date) {
      return one(`select public.my_puzzle_place($1, $2) as r`, [userId, date]);
    },

    async voyageSend(p) {
      return one(`select public.voyage_send($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r`, [
        p.id,
        p.userId,
        p.route,
        p.slot,
        p.slots,
        new Date(p.returnsAt).toISOString(),
        JSON.stringify(p.reward),
        p.pirate,
        p.seed,
        JSON.stringify(p.layout),
      ]);
    },
    async voyageList(userId) {
      const rows = await db.query<{
        id: string;
        route: string;
        slot: number;
        sent_at: string;
        returns_at: string;
        reward: VoyageReward;
        pirate: boolean;
        state: string;
      }>(`select * from public.voyage_list($1)`, [userId]);
      return rows.map((row) => ({
        id: row.id,
        route: row.route,
        slot: row.slot,
        sentAt: Date.parse(row.sent_at),
        returnsAt: Date.parse(row.returns_at),
        reward: row.reward,
        pirate: row.pirate,
        state: row.state,
      }));
    },
    async voyageCollect(p) {
      const raw = await one<Record<string, unknown>>(
        `select public.voyage_collect($1, $2, $3, $4, $5, $6) as r`,
        [p.id, p.userId, p.coins, p.steel, p.gems, p.result],
      );
      return {
        paid: raw.paid === true,
        reason: typeof raw.reason === 'string' ? raw.reason : undefined,
        coins: Number(raw.coins ?? 0),
        steel: Number(raw.steel ?? 0),
        gems: Number(raw.gems ?? 0),
      };
    },
    async skirmishBoard(voyageId) {
      const raw = await one<{ seed: number; layout: SkirmishShip[]; settledAt: string | null } | null>(
        `select public.skirmish_internal($1) as r`,
        [voyageId],
      );
      return raw ? { seed: raw.seed, layout: raw.layout, settledAt: raw.settledAt } : null;
    },
    async skirmishRecord(voyageId, log, result) {
      return one(`select public.skirmish_record($1, $2, $3) as r`, [
        voyageId,
        log === null ? null : JSON.stringify(log),
        result,
      ]);
    },
    async skirmishExpire(before) {
      return one(`select public.skirmish_expire($1) as r`, [new Date(before).toISOString()]);
    },
  };
}

const on = () => {
  process.env.PORT_CITY_GAZETTE = '1';
  process.env.PORT_CITY_VOYAGES = '1';
};
const off = () => {
  delete process.env.PORT_CITY_GAZETTE;
  delete process.env.PORT_CITY_VOYAGES;
};

const profileOf = (id: string) =>
  t.one<{ coins: number; steel: number; gems: number }>(
    `select coins, steel, gems from public.profiles where id = $1`,
    [id],
  );

beforeAll(async () => {
  t = await startTestDb(2);
  setDailyRepo(pgliteRepo(t));
}, 120_000);

afterAll(async () => {
  off();
  await t.close();
});

beforeEach(async () => {
  on();
  await t.query(`delete from public.economy_ledger`);
  await t.query(`delete from public.skirmish`);
  await t.query(`delete from public.voyage`);
  await t.query(`delete from public.gazette`);
  await t.query(`delete from public.puzzle_run`);
  await t.query(`delete from public.puzzle`);
  await t.query(`delete from public.profiles where id in ($1, $2)`, [A, B]);
  await t.query(`delete from auth.users where id in ($1, $2)`, [A, B]);
  await seedProfile(t, A, { coins: 0, steel: 0, gems: 0 });
  await seedProfile(t, B, { coins: 0, steel: 0, gems: 0 });
  await t.query(`update public.profiles set name = 'Hallie' where id = $1`, [A]);
});

afterEach(off);

// ===========================================================================
// The Gazette
// ===========================================================================

describe('GET /gazette', () => {
  const quiet = (): DayRecords => emptyRecords('Hallie');

  it('generates once and caches for the day', async () => {
    const first = await gazette(A, quiet(), NOW);
    const second = await gazette(A, quiet(), NOW);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.edition).toEqual(first.value.edition);

    const rows = await t.query<{ n: number }>(
      `select count(*)::int as n from public.gazette where user_id = $1`,
      [A],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('keeps the FIRST edition even if the day changes underneath it', async () => {
    const first = await gazette(A, quiet(), NOW);
    // The same player, later in the day, having now won three matches.
    const busy: DayRecords = { ...quiet(), rankedUp: 'Commodore' };
    const second = await gazette(A, busy, NOW + 6 * HOUR);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // §5.5 — "the edition is stable for the whole day".
    expect(second.value.edition.headline.templateId).toBe('quiet');
  });

  it('a quiet day is never an empty page', async () => {
    const result = await gazette(A, quiet(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.edition.headline.text).toBe('Quiet week on the water');
    expect(result.value.edition.masthead).toBe('THE PORT GAZETTE');
  });

  it('a new day is a new edition', async () => {
    await gazette(A, quiet(), NOW);
    await gazette(A, quiet(), NOW + 24 * HOUR);
    const rows = await t.query<{ n: number }>(
      `select count(*)::int as n from public.gazette where user_id = $1`,
      [A],
    );
    expect(rows[0]!.n).toBe(2);
  });

  it('two players get their own papers', async () => {
    await gazette(A, quiet(), NOW);
    await gazette(B, emptyRecords('Perrin'), NOW);
    const rows = await t.query<{ n: number }>(`select count(*)::int as n from public.gazette`);
    expect(rows[0]!.n).toBe(2);
  });

  it('is dark behind the flag', async () => {
    off();
    const result = await gazette(A, quiet(), NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('feature-off');
  });
});

// ===========================================================================
// The puzzle
// ===========================================================================

describe('GET /puzzle and POST /puzzle/fire', () => {
  it('opens a fresh board with par and no marks', async () => {
    const result = await openPuzzle(A, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.view.par).toBe(PUZZLE_PAR);
    expect(result.value.view.shots).toBe(0);
    expect(result.value.view.marks).toEqual({});
    expect(result.value.view.date).toBe(DATE);
  });

  it('resolves one cell per call and counts the shot', async () => {
    await openPuzzle(A, NOW);
    const result = await firePuzzle(A, { r: 0, c: 0 }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.view.shots).toBe(1);
    expect(Object.keys(result.value.view.marks).length).toBeGreaterThan(0);
  });

  it('REFUSES A CELL ALREADY FIRED AT', async () => {
    await openPuzzle(A, NOW);
    await firePuzzle(A, { r: 0, c: 0 }, NOW);
    const again = await firePuzzle(A, { r: 0, c: 0 }, NOW);
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.error).toBe('illegal-cell');
  });

  it('resumes across a "restart" — the service holds nothing in memory', async () => {
    await openPuzzle(A, NOW);
    await firePuzzle(A, { r: 2, c: 2 }, NOW);
    await firePuzzle(A, { r: 4, c: 4 }, NOW);

    const reopened = await openPuzzle(A, NOW + HOUR);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value.view.shots).toBe(2);
  });

  it('pays on the shot that finishes the board, once', async () => {
    await openPuzzle(A, NOW);
    const cells = puzzleLayout(DATE).flatMap(shipCells);

    let finished = false;
    let rewarded = 0;
    for (const at of cells) {
      const step = await firePuzzle(A, at, NOW);
      if (!step.ok) continue;
      if (step.value.reward) rewarded++;
      if (step.value.view.finished) {
        finished = true;
        break;
      }
    }

    expect(finished).toBe(true);
    expect(rewarded).toBe(1);

    const after = await profileOf(A);
    expect(after.coins).toBe(200);
    expect(after.steel).toBe(200);
  });

  it('A SECOND ATTEMPT ON THE SAME DAY IS REFUSED', async () => {
    await openPuzzle(A, NOW);
    for (const at of puzzleLayout(DATE).flatMap(shipCells)) {
      const step = await firePuzzle(A, at, NOW);
      if (step.ok && step.value.view.finished) break;
    }

    const after = await firePuzzle(A, { r: 9, c: 9 }, NOW);
    expect(after.ok).toBe(false);
    expect(after.ok === false && after.error).toBe('already-finished');
  });

  it('is dark behind the flag', async () => {
    off();
    expect((await openPuzzle(A, NOW)).ok).toBe(false);
    expect((await firePuzzle(A, { r: 0, c: 0 }, NOW)).ok).toBe(false);
  });
});

describe('THE LAYOUT NEVER LEAVES THE SERVICE', () => {
  it('no response during a whole solve contains an un-hit ship cell', async () => {
    const layout = puzzleLayout(DATE);
    await openPuzzle(A, NOW);

    for (const at of layout.flatMap(shipCells)) {
      const step = await firePuzzle(A, at, NOW);
      if (!step.ok) continue;

      const wire = JSON.stringify(step.value);
      const marks = step.value.view.marks as Marks;

      for (const ship of layout) {
        for (const cell of shipCells(ship)) {
          const k = coordKey(cell);
          const mark = marks[k];
          if (mark === 'hit' || mark === 'sunk') continue;
          expect(wire.includes(`"${k}"`), `leaked ${k}`).toBe(false);
        }
        expect(wire.includes(ship.id), `leaked ship id ${ship.id}`).toBe(false);
      }
      if (step.value.view.finished) break;
    }
  });

  it('the open response carries no ship-shaped field', async () => {
    const result = await openPuzzle(A, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const wire = JSON.stringify(result.value);
    expect(wire).not.toContain('origin');
    expect(wire).not.toContain('orientation');
    // `shipsRemaining` is a COUNT and is allowed; a `ships` array is not. A
    // substring check would reject the count, so check the key itself.
    expect(wire).not.toMatch(/"ships"\s*:/);
    expect(wire).not.toMatch(/"layout"\s*:/);
    expect(result.value.view.shipsRemaining).toBe(8);
  });
});

describe('GET /puzzle/leaderboard', () => {
  it('returns the board and the caller’s place', async () => {
    await t.query(
      `insert into public.puzzle (date, layout, par) values ($1, '[]'::jsonb, 52)
         on conflict do nothing`,
      [DATE],
    );
    await t.query(
      `insert into public.puzzle_run (user_id, date, shots, started_at, finished_at, streak)
       values ($1, $2, 44, now() - interval '5 minutes', now(), 1)`,
      [A, DATE],
    );

    const result = await puzzleLeaderboard(A, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leaders[0]?.shots).toBe(44);
    expect(result.value.me?.place).toBe(1);
  });

  it('exposes no user id', async () => {
    await t.query(
      `insert into public.puzzle (date, layout, par) values ($1, '[]'::jsonb, 52)
         on conflict do nothing`,
      [DATE],
    );
    await t.query(
      `insert into public.puzzle_run (user_id, date, shots, started_at, finished_at, streak)
       values ($1, $2, 44, now(), now(), 1)`,
      [A, DATE],
    );
    const result = await puzzleLeaderboard(A, NOW);
    expect(JSON.stringify(result)).not.toContain(A);
  });
});

// ===========================================================================
// Voyages
// ===========================================================================

async function docks(userId: string, level: number): Promise<void> {
  await t.query(
    `insert into public.city (user_id, state)
     values ($1, jsonb_build_object('buildings', jsonb_build_object('trade_docks', jsonb_build_object('level', $2::int))))
       on conflict (user_id) do update set state = excluded.state`,
    [userId, level],
  );
}

describe('POST /voyage/send', () => {
  it('sends, and the response reveals NOTHING about the cargo', async () => {
    await docks(A, 3);
    const result = await sendVoyage(A, 'saltmarsh', 0, 3, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // §3 — "revealed on return". A client that knew which voyage would be
    // attacked would simply never open that one.
    expect(result.value.pirate).toBe(false);
    expect(JSON.stringify(result.value)).not.toContain('coins');
    expect(JSON.stringify(result.value)).not.toContain('steel');
  });

  it('stores a reward that collect then pays unchanged', async () => {
    const sent = await sendVoyage(A, 'coral-bay', 0, 1, NOW);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const stored = await t.one<{ reward: VoyageReward }>(
      `select reward from public.voyage where id = $1`,
      [sent.value.id],
    );

    const back = NOW + 2 * HOUR;
    const collected = await collectVoyage(A, sent.value.id, back);
    expect(collected.ok).toBe(true);
    if (!collected.ok) return;
    expect(collected.value.coins).toBe(stored.reward.coins);
    expect(collected.value.steel).toBe(stored.reward.steel);
  });

  it('refuses an unknown route', async () => {
    const result = await sendVoyage(A, 'atlantis', 0, 3, NOW);
    expect(result.ok === false && result.error).toBe('unknown-route');
  });

  it('refuses a slot the docks do not have', async () => {
    const result = await sendVoyage(A, 'saltmarsh', 2, 1, NOW);
    expect(result.ok === false && result.error).toBe('no-slot');
  });

  it('a level-0 dock sends nothing', async () => {
    const result = await sendVoyage(A, 'saltmarsh', 0, 0, NOW);
    expect(result.ok === false && result.error).toBe('no-slot');
  });

  it('hides the reward while the ship is still out', async () => {
    await sendVoyage(A, 'far-isles', 0, 3, NOW);
    const listed = await listVoyages(A, NOW + HOUR);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    expect(listed.value.voyages[0]!.back).toBe(false);
    expect(listed.value.voyages[0]!.reward).toBeNull();
    expect(listed.value.voyages[0]!.pirate).toBeNull();
  });

  it('...and reveals it on return', async () => {
    const sent = await sendVoyage(A, 'coral-bay', 0, 1, NOW);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const listed = await listVoyages(A, NOW + 2 * HOUR);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.voyages[0]!.back).toBe(true);
    expect(listed.value.voyages[0]!.reward).not.toBeNull();
  });

  it('is dark behind the flag', async () => {
    off();
    expect((await sendVoyage(A, 'saltmarsh', 0, 3, NOW)).ok).toBe(false);
  });
});

describe('POST /voyage/collect', () => {
  it('refuses before the voyage is back', async () => {
    const sent = await sendVoyage(A, 'far-isles', 0, 3, NOW);
    if (!sent.ok) throw new Error('send failed');
    const result = await collectVoyage(A, sent.value.id, NOW + HOUR);
    expect(result.ok === false && result.error).toBe('not-back-yet');
  });

  it('refuses a double collect', async () => {
    const sent = await sendVoyage(A, 'coral-bay', 0, 1, NOW);
    if (!sent.ok) throw new Error('send failed');
    const back = NOW + 2 * HOUR;

    expect((await collectVoyage(A, sent.value.id, back)).ok).toBe(true);
    const second = await collectVoyage(A, sent.value.id, back);
    expect(second.ok).toBe(false);
  });

  it('refuses another player’s voyage', async () => {
    const sent = await sendVoyage(A, 'coral-bay', 0, 1, NOW);
    if (!sent.ok) throw new Error('send failed');
    const result = await collectVoyage(B, sent.value.id, NOW + 2 * HOUR);
    expect(result.ok === false && result.error).toBe('not-found');
  });
});

// ===========================================================================
// The skirmish, through the service
// ===========================================================================

/** Plays the board the SERVER stored, and returns the log to submit. */
function playAgainst(seed: number): SkirmishLog {
  let state = startSkirmish(seed)!;
  const pirateRng = createRng(seed ^ 0x5bf0_3a9d);
  const shots: Cell[] = [];

  outer: for (let r = 0; r < SKIRMISH_SIZE; r++) {
    for (let c = 0; c < SKIRMISH_SIZE; c++) {
      if (state.over) break outer;
      const at = { r, c };
      if (state.playerMarks[key(at)] !== undefined) continue;
      shots.push(at);
      state = shoot(state, { side: 'player', at }).state;
      while (!state.over && state.turn === 'pirate') {
        const move = pirateMove(state.pirateMarks, pirateRng);
        if (!move) break;
        state = shoot(state, { side: 'pirate', at: move }).state;
      }
    }
  }
  return { seed, shots, claimedWinner: state.winner ?? 'pirate' };
}

/** Sends voyages until one rolls a pirate, and returns it with its seed. */
async function pirateVoyage(): Promise<{ id: string; seed: number; reward: VoyageReward }> {
  for (let attempt = 0; attempt < 200; attempt++) {
    await t.query(`delete from public.voyage where user_id = $1`, [A]);
    const sent = await sendVoyage(A, 'far-isles', 0, 3, NOW);
    if (!sent.ok) continue;

    const row = await t.one<{ pirate: boolean; reward: VoyageReward }>(
      `select pirate, reward from public.voyage where id = $1`,
      [sent.value.id],
    );
    if (!row.pirate) continue;

    const board = await t.one<{ r: { seed: number } }>(
      `select public.skirmish_internal($1) as r`,
      [sent.value.id],
    );
    return { id: sent.value.id, seed: board.r.seed, reward: row.reward };
  }
  throw new Error('no voyage rolled a pirate in 200 tries');
}

describe('POST /voyage/skirmish', () => {
  const back = () => NOW + 13 * HOUR;

  it('ACCEPTS an honest log and pays accordingly', async () => {
    const voyage = await pirateVoyage();
    const log = playAgainst(voyage.seed);

    const result = await submitSkirmish(A, voyage.id, log, back());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.verified).toBe(true);
    expect(result.value.result).toBe(log.claimedWinner === 'player' ? 'won' : 'lost');
  });

  it('A FORGED LOG IS REJECTED AND PAYS HALF', async () => {
    const voyage = await pirateVoyage();
    const honest = playAgainst(voyage.seed);
    // Claim the opposite of what happened.
    const forged: SkirmishLog = {
      ...honest,
      claimedWinner: honest.claimedWinner === 'player' ? 'pirate' : 'player',
    };

    const result = await submitSkirmish(A, voyage.id, forged, back());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.verified).toBe(false);
    expect(result.value.result).toBe('unverified');
    expect(result.value.coins).toBe(Math.floor(voyage.reward.coins * 0.5));
    expect(result.value.steel).toBe(Math.floor(voyage.reward.steel * 0.5));
  });

  it('...and half is not zero: the player still gets something', async () => {
    const voyage = await pirateVoyage();
    const nonsense: SkirmishLog = { seed: 1, shots: [], claimedWinner: 'player' };

    const result = await submitSkirmish(A, voyage.id, nonsense, back());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    expect(result.value.coins + result.value.steel).toBeGreaterThan(0);
  });

  it('IGNORES THE CLIENT’S SEED and uses the stored one', async () => {
    const voyage = await pirateVoyage();
    const honest = playAgainst(voyage.seed);

    // A client claiming a different board it "played". The server replays
    // against its own seed, so this is exactly as good as the honest log.
    const result = await submitSkirmish(A, voyage.id, { ...honest, seed: 999_999 }, back());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verified).toBe(true);
  });

  it('refuses a second submission', async () => {
    const voyage = await pirateVoyage();
    await submitSkirmish(A, voyage.id, playAgainst(voyage.seed), back());
    const again = await submitSkirmish(A, voyage.id, playAgainst(voyage.seed), back());
    expect(again.ok).toBe(false);
  });

  it('refuses a submission before the voyage is back', async () => {
    const voyage = await pirateVoyage();
    const result = await submitSkirmish(A, voyage.id, playAgainst(voyage.seed), NOW + HOUR);
    expect(result.ok === false && result.error).toBe('not-back-yet');
  });

  it('a collect INSIDE the grace period sends the player to the skirmish', async () => {
    const voyage = await pirateVoyage();
    const result = await collectVoyage(A, voyage.id, back());
    expect(result.ok === false && result.error).toBe('under-attack');
  });

  it('a collect AFTER 24 h settles as ignored, at half', async () => {
    const voyage = await pirateVoyage();
    const late = NOW + 12 * HOUR + 25 * HOUR;

    const result = await collectVoyage(A, voyage.id, late);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.result).toBe('ignored');
    expect(result.value.coins).toBe(Math.floor(voyage.reward.coins * 0.5));
  });

  it('the sweep is idempotent', async () => {
    await pirateVoyage();
    const first = await sweepSkirmishes(NOW + 12 * HOUR + 25 * HOUR);
    const second = await sweepSkirmishes(NOW + 12 * HOUR + 25 * HOUR);
    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('the skirmish layout is never in a response', async () => {
    const voyage = await pirateVoyage();
    const result = await submitSkirmish(A, voyage.id, playAgainst(voyage.seed), back());
    const wire = JSON.stringify(result);
    expect(wire).not.toContain('horizontal');
    expect(wire).not.toContain('cutter');
    expect(wire).not.toContain('skiff');
  });

  it('is dark behind the flag', async () => {
    const voyage = await pirateVoyage();
    off();
    expect((await submitSkirmish(A, voyage.id, playAgainst(voyage.seed), back())).ok).toBe(false);
  });
});

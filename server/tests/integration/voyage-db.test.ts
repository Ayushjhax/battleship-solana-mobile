/**
 * Trade voyages against a real Postgres — part-09 §4, §5.6.
 *
 *   5.6 "Voyages: **rewards are rolled at send time and cannot change**; a
 *        voyage cannot be collected early; slots are enforced; **a pirate
 *        skirmish log that does not replay is rejected and pays half**."
 *
 * The last clause is the one the whole design rests on. A skirmish runs on the
 * client for speed, so the ONLY thing standing between a player and a 25%
 * bonus on every voyage is that the server replays the log. This file proves
 * both directions: an honest log is accepted and paid in full, and a forged
 * one is refused and paid half — because a false rejection would quietly halve
 * every honest player's cargo and no test would notice.
 */
import { randomUUID } from 'node:crypto';

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createRng } from '@engine/rng';
import {
  LOSS_SHARE,
  ROUTE_TABLE,
  SKIRMISH_SIZE,
  WIN_BONUS,
  key,
  payout,
  pirateMove,
  placeSkirmish,
  replaySkirmish,
  rollReward,
  routeById,
  shoot,
  startSkirmish,
  voyageSlots,
  type Cell,
  type SkirmishLog,
  type VoyageReward,
} from '@engine/voyages';

import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const HOUR = 3_600_000;

let t: TestDb;

const iso = (ms: number) => new Date(ms).toISOString();

interface SendOptions {
  readonly id?: string;
  readonly route?: string;
  readonly slot?: number;
  readonly slots?: number;
  readonly returnsAt?: number;
  readonly reward?: VoyageReward;
  readonly pirate?: boolean;
  readonly seed?: number;
}

const REWARD: VoyageReward = { coins: 400, steel: 0, gems: 10, cosmetic: null, pirate: false };

async function send(userId: string, options: SendOptions = {}) {
  const id = options.id ?? randomUUID();
  const seed = options.seed ?? 7;
  const pirate = options.pirate ?? false;
  const layout = pirate ? (placeSkirmish(createRng(seed)) ?? []) : [];

  const row = await t.one<{ voyage_send: Record<string, unknown> }>(
    `select public.voyage_send($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as voyage_send`,
    [
      id,
      userId,
      options.route ?? 'saltmarsh',
      options.slot ?? 0,
      options.slots ?? 3,
      iso(options.returnsAt ?? Date.now() + 4 * HOUR),
      JSON.stringify({ ...REWARD, pirate, ...(options.reward ?? {}) }),
      pirate,
      seed,
      JSON.stringify(layout),
    ],
  );
  return { id, result: row.voyage_send };
}

const collect = (
  id: string,
  userId: string,
  amount: { coins: number; steel: number; gems: number },
  result = 'none',
) =>
  t.one<{ voyage_collect: Record<string, unknown> }>(
    `select public.voyage_collect($1, $2, $3, $4, $5, $6) as voyage_collect`,
    [id, userId, amount.coins, amount.steel, amount.gems, result],
  );

const profileOf = (id: string) =>
  t.one<{ coins: number; steel: number; gems: number }>(
    `select coins, steel, gems from public.profiles where id = $1`,
    [id],
  );

const voyageRow = (id: string) =>
  t.one<{ reward: VoyageReward; state: string; pirate: boolean; settled_at: string | null }>(
    `select reward, state, pirate, settled_at from public.voyage where id = $1`,
    [id],
  );

beforeAll(async () => {
  t = await startTestDb(2);
}, 120_000);

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.query(`delete from public.economy_ledger`);
  await t.query(`delete from public.skirmish`);
  await t.query(`delete from public.voyage`);
  await t.query(`delete from public.profiles where id in ($1, $2)`, [A, B]);
  await t.query(`delete from auth.users where id in ($1, $2)`, [A, B]);
  await seedProfile(t, A, { coins: 0, steel: 0, gems: 0 });
  await seedProfile(t, B, { coins: 0, steel: 0, gems: 0 });
});

// ===========================================================================
// §5.6 — REWARDS ARE ROLLED AT SEND TIME AND CANNOT CHANGE
// ===========================================================================

describe('the reward is rolled at send', () => {
  it('is stored on the row the moment the voyage leaves', async () => {
    const { id } = await send(A);
    const row = await voyageRow(id);
    expect(row.reward.coins).toBe(400);
    expect(row.reward.gems).toBe(10);
  });

  it('COLLECT PAYS THE STORED REWARD, NOT A NEW ROLL', async () => {
    const { id } = await send(A, { returnsAt: Date.now() - HOUR });
    const stored = (await voyageRow(id)).reward;

    const paid = (await collect(id, A, stored)).voyage_collect;
    expect(paid.paid).toBe(true);
    expect(paid.coins).toBe(stored.coins);
    expect(paid.gems).toBe(stored.gems);

    const after = await profileOf(A);
    expect(after.coins).toBe(stored.coins);
    expect(after.gems).toBe(stored.gems);
  });

  it('the roll is deterministic for a given rng — a reinstall changes nothing', async () => {
    // §3's parenthesis: "so the player cannot reroll by reinstalling". The
    // roll happens once, server-side, from a seed the client never sees.
    const route = routeById('far-isles')!;
    const first = rollReward(route, 3, createRng(99));
    const second = rollReward(route, 3, createRng(99));
    expect(first).toEqual(second);
  });

  it('a route pays coins OR steel, never both', async () => {
    for (const route of ROUTE_TABLE) {
      for (let seed = 0; seed < 40; seed++) {
        const reward = rollReward(route, 2, createRng(seed));
        expect(reward.coins === 0 || reward.steel === 0).toBe(true);
      }
    }
  });

  it('scales with Trade Docks level', async () => {
    const route = routeById('iron-point')!;
    const low = rollReward(route, 1, createRng(4));
    const high = rollReward(route, 3, createRng(4));
    expect(high.coins + high.steel).toBeGreaterThan(low.coins + low.steel);
  });

  it('nothing in the collect path writes the reward column', async () => {
    const { id } = await send(A, { returnsAt: Date.now() - HOUR });
    const before = (await voyageRow(id)).reward;
    await collect(id, A, before);
    expect((await voyageRow(id)).reward).toEqual(before);
  });
});

// ===========================================================================
// §5.6 — A VOYAGE CANNOT BE COLLECTED EARLY
// ===========================================================================

describe('a voyage cannot be collected early', () => {
  it('refuses a collect before it is back', async () => {
    const { id } = await send(A, { returnsAt: Date.now() + 2 * HOUR });
    const result = (await collect(id, A, REWARD)).voyage_collect;

    expect(result.paid).toBe(false);
    expect(result.reason).toBe('not-back-yet');
    expect((await profileOf(A)).coins).toBe(0);
  });

  it('allows it the moment it is back', async () => {
    const { id } = await send(A, { returnsAt: Date.now() - 1_000 });
    expect((await collect(id, A, REWARD)).voyage_collect.paid).toBe(true);
  });

  it('refuses a collect by SOMEBODY ELSE', async () => {
    const { id } = await send(A, { returnsAt: Date.now() - HOUR });
    const result = (await collect(id, B, REWARD)).voyage_collect;

    expect(result.paid).toBe(false);
    expect(result.reason).toBe('not-found');
    expect((await profileOf(B)).coins).toBe(0);
    expect((await profileOf(A)).coins).toBe(0);
  });

  it('PAYS EXACTLY ONCE however many times collect is called', async () => {
    const { id } = await send(A, { returnsAt: Date.now() - HOUR });

    const first = (await collect(id, A, REWARD)).voyage_collect;
    const second = (await collect(id, A, REWARD)).voyage_collect;
    const third = (await collect(id, A, REWARD)).voyage_collect;

    expect(first.paid).toBe(true);
    expect(second.paid).toBe(false);
    expect(second.reason).toBe('already-collected');
    expect(third.paid).toBe(false);

    expect((await profileOf(A)).coins).toBe(400);

    const ledger = await t.query<{ n: number }>(
      `select count(*)::int as n from public.economy_ledger where reason = 'voyage' and ref = $1`,
      [id],
    );
    expect(ledger[0]!.n).toBe(1);
  });

  it('the ledger unique index is an INDEPENDENT backstop', async () => {
    // Even if the claim were defeated, a second ledger row is impossible.
    const { id } = await send(A, { returnsAt: Date.now() - HOUR });
    await collect(id, A, REWARD);

    await expect(
      t.query(
        `insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
         values ($1, 'voyage', $2, 400, 0, 10)`,
        [A, id],
      ),
    ).rejects.toThrow();
  });

  it('marks settled_at, so the state machine has its marker', async () => {
    const { id } = await send(A, { returnsAt: Date.now() - HOUR });
    await collect(id, A, REWARD);
    const row = await voyageRow(id);
    expect(row.state).toBe('collected');
    expect(row.settled_at).not.toBeNull();
  });
});

// ===========================================================================
// §5.6 — SLOTS ARE ENFORCED
// ===========================================================================

describe('slots are enforced', () => {
  it('is Trade Docks level, 1 / 2 / 3', () => {
    expect(voyageSlots(0)).toBe(0);
    expect(voyageSlots(1)).toBe(1);
    expect(voyageSlots(2)).toBe(2);
    expect(voyageSlots(3)).toBe(3);
    expect(voyageSlots(9)).toBe(3); // and no more, whatever the level says
  });

  it('refuses a slot beyond the docks level', async () => {
    const result = (await send(A, { slot: 2, slots: 1 })).result;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-slot');
  });

  it('refuses a fourth live voyage on three slots', async () => {
    await send(A, { slot: 0, slots: 3 });
    await send(A, { slot: 1, slots: 3 });
    await send(A, { slot: 2, slots: 3 });

    const fourth = (await send(A, { slot: 0, slots: 3 })).result;
    expect(fourth.ok).toBe(false);

    const rows = await t.query<{ n: number }>(
      `select count(*)::int as n from public.voyage where user_id = $1`,
      [A],
    );
    expect(rows[0]!.n).toBe(3);
  });

  it('REFUSES A DOUBLE-SEND ON THE SAME SLOT — the unique index, not the count', async () => {
    await send(A, { slot: 1, slots: 3 });
    const again = (await send(A, { slot: 1, slots: 3 })).result;

    expect(again.ok).toBe(false);
    expect(again.reason).toBe('slot-busy');
  });

  it('frees the slot once the voyage is collected', async () => {
    const { id } = await send(A, { slot: 0, slots: 1, returnsAt: Date.now() - HOUR });
    expect((await send(A, { slot: 0, slots: 1 })).result.ok).toBe(false);

    await collect(id, A, REWARD);
    expect((await send(A, { slot: 0, slots: 1 })).result.ok).toBe(true);
  });

  it('one player’s slots do not affect another’s', async () => {
    await send(A, { slot: 0, slots: 1 });
    expect((await send(B, { slot: 0, slots: 1 })).result.ok).toBe(true);
  });

  it('a level-0 dock sends nothing', async () => {
    const result = (await send(A, { slot: 0, slots: 0 })).result;
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// §5.6 — A LOG THAT DOES NOT REPLAY IS REJECTED AND PAYS HALF
// ===========================================================================

/** An honest client's log: a row-major scan, so the pirate really does fire. */
function honestLog(seed: number): SkirmishLog {
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

/** Finds a seed whose honest play ends the way the test needs. */
function seedWhere(winner: 'player' | 'pirate'): number {
  for (let seed = 1; seed < 200; seed++) if (honestLog(seed).claimedWinner === winner) return seed;
  throw new Error(`no seed produces a ${winner} win`);
}

describe('the server replay decides what a skirmish pays', () => {
  const back = () => Date.now() - 25 * HOUR;

  async function sendPirate(seed: number) {
    const { id } = await send(A, { pirate: true, seed, returnsAt: back() });
    return id;
  }

  it('an HONEST WINNING log is accepted and pays full plus 25%', async () => {
    const seed = seedWhere('player');
    const id = await sendPirate(seed);

    const board = await t.one<{ skirmish_internal: { seed: number } }>(
      `select public.skirmish_internal($1) as skirmish_internal`,
      [id],
    );
    const verdict = replaySkirmish({ ...honestLog(seed), seed: board.skirmish_internal.seed });
    expect(verdict.ok).toBe(true);

    const amount = payout(REWARD, 'won');
    await t.query(`select public.skirmish_record($1, $2, 'won')`, [id, JSON.stringify(honestLog(seed))]);
    const paid = (await collect(id, A, amount, 'won')).voyage_collect;

    expect(paid.paid).toBe(true);
    expect(paid.coins).toBe(Math.floor(400 * (1 + WIN_BONUS)));
    expect((await profileOf(A)).coins).toBe(500);
  });

  it('an HONEST LOSING log is accepted and pays half', async () => {
    const seed = seedWhere('pirate');
    const id = await sendPirate(seed);

    const verdict = replaySkirmish(honestLog(seed));
    expect(verdict.ok).toBe(true);

    const amount = payout(REWARD, 'lost');
    await t.query(`select public.skirmish_record($1, $2, 'lost')`, [id, JSON.stringify(honestLog(seed))]);
    await collect(id, A, amount, 'lost');

    expect((await profileOf(A)).coins).toBe(400 * LOSS_SHARE);
  });

  it('A LOG THAT DOES NOT REPLAY IS REJECTED AND PAYS HALF', async () => {
    const seed = seedWhere('pirate');
    const id = await sendPirate(seed);

    // The forgery: claim a win on a game that was lost.
    const forged: SkirmishLog = { ...honestLog(seed), claimedWinner: 'player' };
    const verdict = replaySkirmish(forged);
    expect(verdict.ok).toBe(false); // REJECTED

    // ...and it pays half, not full, and not zero.
    const amount = payout(REWARD, 'unverified');
    expect(amount.coins).toBe(200);

    await t.query(`select public.skirmish_record($1, $2, 'unverified')`, [id, JSON.stringify(forged)]);
    const paid = (await collect(id, A, amount, 'unverified')).voyage_collect;

    expect(paid.paid).toBe(true);
    expect(paid.coins).toBe(200); // half, not 500
    expect((await profileOf(A)).coins).toBe(200);

    const row = await t.one<{ result: string }>(
      `select result from public.skirmish where voyage_id = $1`,
      [id],
    );
    expect(row.result).toBe('unverified'); // the rejection is visible in the data
  });

  it('a TRUNCATED log is rejected — an unfinished game is not a win', async () => {
    const seed = seedWhere('player');
    const log = honestLog(seed);
    const verdict = replaySkirmish({ ...log, shots: log.shots.slice(0, 2) });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe('unfinished');
  });

  it('a log replayed against ANOTHER voyage’s seed is rejected', async () => {
    // The client's seed in the body is ignored; only the stored one counts.
    const a = seedWhere('player');
    const id = await sendPirate(a);
    const board = await t.one<{ skirmish_internal: { seed: number } }>(
      `select public.skirmish_internal($1) as skirmish_internal`,
      [id],
    );
    const foreign = honestLog(a + 1);
    expect(replaySkirmish({ ...foreign, seed: board.skirmish_internal.seed }).ok).toBe(false);
  });

  it('the layout lives on the server before the client has seen anything', async () => {
    const id = await sendPirate(seedWhere('player'));
    const board = await t.one<{ skirmish_internal: { layout: unknown[] } }>(
      `select public.skirmish_internal($1) as skirmish_internal`,
      [id],
    );
    expect(board.skirmish_internal.layout).toHaveLength(4);
  });

  it('a non-pirate voyage has no skirmish row at all', async () => {
    const { id } = await send(A, { pirate: false });
    const rows = await t.query(`select * from public.skirmish where voyage_id = $1`, [id]);
    expect(rows).toHaveLength(0);
  });

  it('records a verdict once; a second submission is refused', async () => {
    const id = await sendPirate(seedWhere('player'));
    await t.query(`select public.skirmish_record($1, '[]'::jsonb, 'won')`, [id]);
    await collect(id, A, payout(REWARD, 'won'), 'won');

    const again = await t.one<{ skirmish_record: Record<string, unknown> }>(
      `select public.skirmish_record($1, '[]'::jsonb, 'won') as skirmish_record`,
      [id],
    );
    expect(again.skirmish_record.ok).toBe(false);
    expect(again.skirmish_record.reason).toBe('already-settled');
  });

  it('IGNORING it for 24 h settles as half, and the sweep is idempotent', async () => {
    const id = await sendPirate(seedWhere('player'));

    const first = await t.one<{ skirmish_expire: number }>(
      `select public.skirmish_expire($1) as skirmish_expire`,
      [iso(Date.now() - 24 * HOUR)],
    );
    expect(first.skirmish_expire).toBe(1);

    // Running it again changes nothing — the row already carries a verdict.
    const second = await t.one<{ skirmish_expire: number }>(
      `select public.skirmish_expire($1) as skirmish_expire`,
      [iso(Date.now() - 24 * HOUR)],
    );
    expect(second.skirmish_expire).toBe(0);

    const row = await t.one<{ result: string }>(
      `select result from public.skirmish where voyage_id = $1`,
      [id],
    );
    expect(row.result).toBe('ignored');
    expect(payout(REWARD, 'ignored').coins).toBe(200);
  });

  it('does not expire a skirmish that is still inside its 24 hours', async () => {
    await send(A, { pirate: true, seed: 3, returnsAt: Date.now() - HOUR });
    const swept = await t.one<{ skirmish_expire: number }>(
      `select public.skirmish_expire($1) as skirmish_expire`,
      [iso(Date.now() - 24 * HOUR)],
    );
    expect(swept.skirmish_expire).toBe(0);
  });
});

// ===========================================================================
// The tables are unreachable from a client
// ===========================================================================

describe('secrecy at the SQL boundary', () => {
  it('an end-user JWT cannot read the skirmish layout', async () => {
    await send(A, { pirate: true, seed: 5 });
    await expect(
      t.asUser(A, () => t.query(`select layout from public.skirmish`)),
    ).rejects.toThrow();
  });

  it('nor the voyage rewards, not even their own', async () => {
    await send(A);
    await expect(
      t.asUser(A, () => t.query(`select reward from public.voyage where user_id = $1`, [A])),
    ).rejects.toThrow();
  });

  it('voyage_list returns the reward — which the SERVICE hides until return', async () => {
    // The SQL is a data seam, not the boundary. §3's "revealed on return" is
    // enforced in server/src/daily/service.ts's `toPublic`, which nulls the
    // reward and the pirate flag while the ship is still out; that is what the
    // route actually sends.
    const { id } = await send(A, { pirate: true, seed: 5, returnsAt: Date.now() + HOUR });
    const rows = await t.query<{ id: string; reward: VoyageReward }>(
      `select id, reward from public.voyage_list($1)`,
      [A],
    );
    expect(rows.find((r) => r.id === id)?.reward).toBeDefined();
  });
});

/**
 * The raid SQL, against a real Postgres — part-06 §9, §11.
 *
 * These are the scenarios a fake cannot prove: the once-only settlement, the
 * lock that two attackers race for, the clamped drains, and the fact that
 * rank_points is never touched.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { newCity } from '@engine/city';
import { generateDefaultHarbour } from '@engine/raid';

import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A = '11111111-1111-4111-8111-111111111111'; // attacker
const D = '22222222-2222-4222-8222-222222222222'; // defender
const C = '33333333-3333-4333-8333-333333333333'; // a third party
const NOW = 1_700_000_000_000;

let t: TestDb;
let raidSeq = 0;

const raidId = () => `aaaaaaaa-0000-4000-8000-${String(++raidSeq).padStart(12, '0')}`;

const context = {
  admiraltyLevel: 5,
  coastalCommandLevel: 5,
  unlocks: ['sonar_net', 'decoy', 'minesweeper'],
};

/** Puts a city row in place with the levels and stores a test needs. */
async function seedCity(
  userId: string,
  patch: {
    admiralty?: number;
    fishMarket?: number;
    foundry?: number;
    scrap?: number;
  } = {},
): Promise<void> {
  const state = newCity(NOW) as unknown as Record<string, unknown>;
  const buildings = state.buildings as Record<string, Record<string, unknown>>;
  buildings.admiralty = { ...buildings.admiralty, level: patch.admiralty ?? 5 };
  buildings.fish_market = { ...buildings.fish_market, level: 3, stored: patch.fishMarket ?? 0 };
  buildings.foundry = { ...buildings.foundry, level: 3, stored: patch.foundry ?? 0 };
  state.scrapPile = patch.scrap ?? 0;

  await t.query(
    `insert into public.city (user_id, state) values ($1, $2)
       on conflict (user_id) do update set state = excluded.state, version = public.city.version + 1`,
    [userId, JSON.stringify(state)],
  );
}

async function seedHarbour(userId: string, seed = 1): Promise<void> {
  const layout = generateDefaultHarbour(seed, context);
  await t.query(`select public.harbour_save($1, $2, $3)`, [userId, JSON.stringify(layout), 20]);
}

const profileOf = (id: string) =>
  t.one<{ coins: number; steel: number; rank_points: number }>(
    `select coins, steel, rank_points from public.profiles where id = $1`,
    [id],
  );

beforeAll(async () => {
  // Two passes: every migration must be re-runnable.
  t = await startTestDb(2);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  await t.query(`delete from public.raid_lock`);
  await t.query(`delete from public.raid_log`);
  await t.query(`delete from public.raid`);
  await t.query(`delete from public.shield`);
  await t.query(`delete from public.renown`);
  await t.query(`delete from public.harbour`);
  await t.query(`delete from public.city`);
  await t.query(`delete from public.economy_ledger`);
  await t.query(`delete from public.profiles where id = any($1)`, [[A, D, C]]);
  await t.query(`delete from auth.users where id = any($1)`, [[A, D, C]]);
  await seedProfile(t, A, { coins: 5_000, steel: 5_000, rankPoints: 1_200 });
  await seedProfile(t, D, { coins: 5_000, steel: 5_000, rankPoints: 900 });
  await seedProfile(t, C, { coins: 5_000, steel: 5_000, rankPoints: 400 });
});

// ===========================================================================
// The migration
// ===========================================================================

describe('the migration', () => {
  it('applied twice and left the six §9 tables', async () => {
    const rows = await t.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name in ('harbour','raid','raid_log','raid_lock','shield','renown')
        order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'harbour',
      'raid',
      'raid_lock',
      'raid_log',
      'renown',
      'shield',
    ]);
  });

  it('grants a client JWT no access to the harbour at all', async () => {
    await t.asUser(D, async () => {
      await expect(t.query(`select * from public.harbour`)).rejects.toThrow(/permission denied/i);
    });
  });

  it('the SQL never mentions a match-reward column (the hard rule, structurally)', async () => {
    // A runtime test proves this raid did not move rank points. This one proves
    // no FUTURE edit can, without deleting the test: it reads the migration.
    const sql = readFileSync(
      fileURLToPath(new URL('../../../supabase/migrations/0016_harbour_raids.sql', import.meta.url)),
      'utf8',
    );
    // Strip comments: the header explains the rule, which is not a violation.
    const code = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

    for (const column of ['rank_points', 'battles_played', 'battles_won']) {
      expect(code.includes(column), `0016 writes ${column}`).toBe(false);
    }
  });

  it('built the search indexes §9 asks for', async () => {
    const rows = await t.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public'
         and indexname in ('renown_value_idx','shield_until_idx','raid_lock_expiry_idx',
                           'city_admiralty_idx','raid_repeat_idx')
       order by indexname`,
    );
    expect(rows).toHaveLength(5);
  });
});

// ===========================================================================
// The harbour (§3, §10)
// ===========================================================================

describe('harbour_save', () => {
  it('stores a layout and marks it valid', async () => {
    await seedHarbour(D);
    const row = await t.one<{ fuel_used: number; valid: boolean }>(
      `select fuel_used, valid from public.harbour where user_id = $1`,
      [D],
    );
    expect(row.valid).toBe(true);
    expect(row.fuel_used).toBe(20);
  });

  it('replaces the layout in place rather than adding a row', async () => {
    await seedHarbour(D, 1);
    await seedHarbour(D, 2);
    const rows = await t.query(`select 1 from public.harbour where user_id = $1`, [D]);
    expect(rows).toHaveLength(1);
  });
});

// ===========================================================================
// The search (§5, §11)
// ===========================================================================

describe('raid_search', () => {
  const search = (userId: string, renown: number, window: number | null = 200) =>
    t.query<{ user_id: string; renown: number }>(
      `select * from public.raid_search($1, $2, $3, 3, 24, 20)`,
      [userId, renown, window],
    );

  beforeEach(async () => {
    await seedCity(D, { admiralty: 5 });
    await seedHarbour(D);
    await t.query(`insert into public.renown (user_id, value, best) values ($1, 800, 800)`, [D]);
  });

  it('finds an eligible defender', async () => {
    const rows = await search(A, 800);
    expect(rows.map((r) => r.user_id)).toContain(D);
  });

  it('never returns you', async () => {
    await seedCity(A, { admiralty: 5 });
    await seedHarbour(A, 9);
    await t.query(`insert into public.renown (user_id, value, best) values ($1, 800, 800)`, [A]);
    const rows = await search(A, 800);
    expect(rows.map((r) => r.user_id)).not.toContain(A);
  });

  it('never returns a shielded player', async () => {
    await t.query(`insert into public.shield (user_id, until) values ($1, now() + interval '6 hours')`, [D]);
    expect((await search(A, 800)).map((r) => r.user_id)).not.toContain(D);
  });

  it('DOES return them once the shield has expired', async () => {
    await t.query(`insert into public.shield (user_id, until) values ($1, now() - interval '1 hour')`, [D]);
    expect((await search(A, 800)).map((r) => r.user_id)).toContain(D);
  });

  it('never returns a locked player', async () => {
    await t.query(
      `insert into public.raid_lock (defender_id, raid_id, attacker_id, expires_at)
       values ($1, $2, $3, now() + interval '6 minutes')`,
      [D, raidId(), C],
    );
    expect((await search(A, 800)).map((r) => r.user_id)).not.toContain(D);
  });

  it('never returns an Admiralty-2 player', async () => {
    await seedCity(D, { admiralty: 2 });
    expect((await search(A, 800)).map((r) => r.user_id)).not.toContain(D);
  });

  it('never returns someone without a harbour', async () => {
    await t.query(`delete from public.harbour where user_id = $1`, [D]);
    expect((await search(A, 800)).map((r) => r.user_id)).not.toContain(D);
  });

  it('never returns a bot', async () => {
    await t.query(`update public.profiles set is_bot = true where id = $1`, [D]);
    expect((await search(A, 800)).map((r) => r.user_id)).not.toContain(D);
  });

  it('never returns someone you raided in the last 24 h', async () => {
    await t.query(
      `insert into public.raid (id, attacker_id, defender_id, started_at, ended_at)
       values ($1, $2, $3, now() - interval '2 hours', now())`,
      [raidId(), A, D],
    );
    expect((await search(A, 800)).map((r) => r.user_id)).not.toContain(D);
  });

  it('DOES return someone you raided 25 h ago', async () => {
    await t.query(
      `insert into public.raid (id, attacker_id, defender_id, started_at, ended_at)
       values ($1, $2, $3, now() - interval '25 hours', now())`,
      [raidId(), A, D],
    );
    expect((await search(A, 800)).map((r) => r.user_id)).toContain(D);
  });

  it('respects the renown window, and finds them once it widens', async () => {
    expect((await search(A, 1_500, 200)).map((r) => r.user_id)).not.toContain(D);
    expect((await search(A, 1_500, 800)).map((r) => r.user_id)).toContain(D);
  });

  it('a null window is uncapped', async () => {
    expect((await search(A, 99_999, null)).map((r) => r.user_id)).toContain(D);
  });

  it('orders by renown distance, so the closest match comes first', async () => {
    await seedCity(C, { admiralty: 5 });
    await seedHarbour(C, 7);
    await t.query(`insert into public.renown (user_id, value, best) values ($1, 1000, 1000)`, [C]);
    const rows = await search(A, 850, null);
    expect(rows[0]?.user_id).toBe(D); // 800 is closer to 850 than 1000
  });
});

// ===========================================================================
// The lock (§11 Concurrency)
// ===========================================================================

describe('raid_open', () => {
  const open = (attacker: string, defender: string | null, id: string, cost = 0, requestId?: string) =>
    t.one<{ raid_open: string }>(
      `select public.raid_open($1, $2, $3, $4, $5, 6, false, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                               '1', $6, '{}'::jsonb) as raid_open`,
      [id, attacker, defender, defender ? null : 1234, cost, requestId ?? null],
    );

  beforeEach(async () => {
    await seedCity(D);
    await seedHarbour(D);
  });

  it('two attackers cannot lock the same defender', async () => {
    expect((await open(A, D, raidId())).raid_open).toBe('ok');
    expect((await open(C, D, raidId())).raid_open).toBe('target-locked');

    const locks = await t.query(`select 1 from public.raid_lock where defender_id = $1`, [D]);
    expect(locks).toHaveLength(1);
  });

  it('a second attacker gets in once the lock has expired', async () => {
    await open(A, D, raidId());
    await t.query(`update public.raid_lock set expires_at = now() - interval '1 minute'`);
    await t.query(`update public.raid set ended_at = now() where attacker_id = $1`, [A]);
    expect((await open(C, D, raidId())).raid_open).toBe('ok');
  });

  it('one attacker cannot run two raids at once', async () => {
    expect((await open(A, D, raidId())).raid_open).toBe('ok');
    expect((await open(A, null, raidId())).raid_open).toBe('raid-in-progress');
  });

  it('charges the search cost and writes a ledger row', async () => {
    const before = await profileOf(A);
    expect((await open(A, D, raidId(), 50)).raid_open).toBe('ok');
    expect((await profileOf(A)).coins).toBe(before.coins - 50);

    const ledger = await t.one<{ d_coins: number; reason: string }>(
      `select d_coins, reason from public.economy_ledger where user_id = $1 order by at desc limit 1`,
      [A],
    );
    expect(ledger).toMatchObject({ d_coins: -50, reason: 'raid_search' });
  });

  it('refuses when the attacker cannot afford the search, and releases the lock', async () => {
    await t.query(`update public.profiles set coins = 10 where id = $1`, [A]);
    expect((await open(A, D, raidId(), 50)).raid_open).toBe('insufficient-coins');
    expect(await t.query(`select 1 from public.raid_lock`)).toHaveLength(0);
    expect((await profileOf(A)).coins).toBe(10);
  });

  it('charges once even when the caller retries with the same requestId', async () => {
    const request = '99999999-9999-4999-8999-999999999999';
    const before = await profileOf(A);

    expect((await open(A, D, raidId(), 50, request)).raid_open).toBe('ok');
    expect((await open(A, D, raidId(), 50, request)).raid_open).toBe('replay');

    expect((await profileOf(A)).coins).toBe(before.coins - 50);
    const charges = await t.query(
      `select 1 from public.economy_ledger where user_id = $1 and reason = 'raid_search'`,
      [A],
    );
    expect(charges).toHaveLength(1);
  });

  it('drops the attacker own shield only when asked', async () => {
    await t.query(`insert into public.shield (user_id, until) values ($1, now() + interval '5 hours')`, [A]);
    await t.one(
      `select public.raid_open($1,$2,$3,null,0,6,true,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'1',null,null)`,
      [raidId(), A, D],
    );
    expect(await t.query(`select 1 from public.shield where user_id = $1`, [A])).toHaveLength(0);
  });

  it('snapshots the layout into raid_log at OPEN, not at settle', async () => {
    const id = raidId();
    await t.one(
      `select public.raid_open($1,$2,$3,null,0,6,false,$4::jsonb,'{}'::jsonb,'{}'::jsonb,'1',null,null)`,
      [id, A, D, JSON.stringify({ ships: ['snapshot'], arsenal: [] })],
    );
    const log = await t.one<{ layout: { ships: string[] } }>(
      `select layout from public.raid_log where raid_id = $1`,
      [id],
    );
    expect(log.layout.ships).toEqual(['snapshot']);
  });
});

// ===========================================================================
// Settlement (§7, §11)
// ===========================================================================

describe('settle_raid', () => {
  const settle = (
    id: string,
    over: Partial<{
      stars: number;
      destruction: number;
      earnedCoins: number;
      earnedSteel: number;
      drain: unknown[];
      walletCoins: number;
      walletSteel: number;
      renownAttacker: number;
      renownDefender: number;
      shieldHours: number;
    }> = {},
  ) =>
    t.one<{ settle_raid: { applied: boolean; takenCoins: number; takenSteel: number; reason?: string } }>(
      `select public.settle_raid($1, $2::smallint, $3, 0, 'cleared', $4, $5, $6::jsonb, $7, $8,
                                 $9, $10, $11, '[]'::jsonb, '[]'::jsonb) as settle_raid`,
      [
        id,
        over.stars ?? 3,
        over.destruction ?? 1,
        over.earnedCoins ?? 0,
        over.earnedSteel ?? 0,
        JSON.stringify(over.drain ?? []),
        over.walletCoins ?? 0,
        over.walletSteel ?? 0,
        over.renownAttacker ?? 0,
        over.renownDefender ?? 0,
        over.shieldHours ?? 0,
      ],
    );

  async function openRaid(defender: string | null = D): Promise<string> {
    const id = raidId();
    await t.one(
      `select public.raid_open($1,$2,$3,$4,0,6,false,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'1',null,null)`,
      [id, A, defender, defender ? null : 4242],
    );
    return id;
  }

  beforeEach(async () => {
    await seedCity(D, { fishMarket: 400, foundry: 800, scrap: 200 });
    await seedHarbour(D);
  });

  it('credits the attacker and closes the raid', async () => {
    const id = await openRaid();
    const before = await profileOf(A);

    const out = await settle(id, { earnedCoins: 120, earnedSteel: 340 });
    expect(out.settle_raid.applied).toBe(true);

    const after = await profileOf(A);
    expect(after.coins).toBe(before.coins + 120);
    expect(after.steel).toBe(before.steel + 340);

    const row = await t.one<{ ended_at: string | null; stars: number }>(
      `select ended_at, stars from public.raid where id = $1`,
      [id],
    );
    expect(row.ended_at).not.toBeNull();
    expect(row.stars).toBe(3);
  });

  it('settling twice credits once', async () => {
    const id = await openRaid();
    const before = await profileOf(A);

    expect((await settle(id, { earnedCoins: 100 })).settle_raid.applied).toBe(true);
    const second = await settle(id, { earnedCoins: 100 });
    expect(second.settle_raid.applied).toBe(false);
    expect(second.settle_raid.reason).toBe('already-settled');

    expect((await profileOf(A)).coins).toBe(before.coins + 100);
  });

  it('never touches rank points — for either side', async () => {
    const id = await openRaid();
    const a = await profileOf(A);
    const d = await profileOf(D);

    await settle(id, {
      earnedCoins: 200,
      earnedSteel: 500,
      drain: [{ building: 'fish_market', resource: 'coins', amount: 100 }],
      walletSteel: 50,
      renownAttacker: 900,
      renownDefender: 700,
      shieldHours: 14,
    });

    expect((await profileOf(A)).rank_points).toBe(a.rank_points);
    expect((await profileOf(D)).rank_points).toBe(d.rank_points);
  });

  it('drains the named stores and reports exactly what it took', async () => {
    const id = await openRaid();
    const out = await settle(id, {
      drain: [
        { building: 'fish_market', resource: 'coins', amount: 150 },
        { building: 'foundry', resource: 'steel', amount: 300 },
        { building: 'scrap', resource: 'steel', amount: 100 },
      ],
    });
    expect(out.settle_raid.takenCoins).toBe(150);
    expect(out.settle_raid.takenSteel).toBe(400);

    const city = await t.one<{ state: Record<string, never> }>(
      `select state from public.city where user_id = $1`,
      [D],
    );
    const state = city.state as unknown as {
      scrapPile: number;
      buildings: Record<string, { stored: number }>;
    };
    expect(state.buildings.fish_market!.stored).toBe(250);
    expect(state.buildings.foundry!.stored).toBe(500);
    expect(state.scrapPile).toBe(100);
  });

  it('clamps a drain to what is actually there — the defender collected mid-raid', async () => {
    const id = await openRaid();
    await seedCity(D, { fishMarket: 10, foundry: 0, scrap: 0 }); // they collected

    const out = await settle(id, {
      drain: [
        { building: 'fish_market', resource: 'coins', amount: 400 },
        { building: 'foundry', resource: 'steel', amount: 800 },
      ],
    });
    expect(out.settle_raid.takenCoins).toBe(10);
    expect(out.settle_raid.takenSteel).toBe(0);
  });

  it('takes the wallet part and never drives a balance negative', async () => {
    const id = await openRaid();
    await t.query(`update public.profiles set coins = 30, steel = 0 where id = $1`, [D]);

    const out = await settle(id, { walletCoins: 500, walletSteel: 500 });
    expect(out.settle_raid.takenCoins).toBe(30);
    expect(out.settle_raid.takenSteel).toBe(0);

    const after = await profileOf(D);
    expect(after.coins).toBe(0);
    expect(after.steel).toBe(0);
  });

  it('writes a ledger row for BOTH sides', async () => {
    const id = await openRaid();
    await settle(id, {
      earnedCoins: 90,
      earnedSteel: 140,
      drain: [{ building: 'fish_market', resource: 'coins', amount: 90 }],
    });

    const attacker = await t.query<{ reason: string }>(
      `select reason from public.economy_ledger where user_id = $1 and reason = 'raid_loot'`,
      [A],
    );
    const defender = await t.query<{ reason: string; d_coins: number }>(
      `select reason, d_coins from public.economy_ledger where user_id = $1 and reason = 'raid_looted'`,
      [D],
    );
    expect(attacker).toHaveLength(1);
    expect(defender).toHaveLength(1);
    expect(defender[0]!.d_coins).toBe(-90);
  });

  it('moves renown into its own table, and keeps the best', async () => {
    const id = await openRaid();
    await t.query(`insert into public.renown (user_id, value, best) values ($1, 900, 950)`, [A]);

    await settle(id, { renownAttacker: 930, renownDefender: 770 });

    const a = await t.one<{ value: number; best: number }>(
      `select value, best from public.renown where user_id = $1`,
      [A],
    );
    expect(a.value).toBe(930);
    expect(a.best).toBe(950); // the earlier best stands
    expect((await t.one<{ value: number }>(`select value from public.renown where user_id = $1`, [D])).value)
      .toBe(770);
  });

  it('renown can fall, unlike rank points', async () => {
    const id = await openRaid();
    await t.query(`insert into public.renown (user_id, value, best) values ($1, 900, 900)`, [A]);
    await settle(id, { stars: 0, destruction: 0, renownAttacker: 880, renownDefender: 920 });
    expect((await t.one<{ value: number }>(`select value from public.renown where user_id=$1`, [A])).value)
      .toBe(880);
  });

  it('shields the defender and releases the lock', async () => {
    const id = await openRaid();
    await settle(id, { shieldHours: 14 });

    const shield = await t.one<{ hours: number }>(
      `select extract(epoch from (until - now())) / 3600 as hours from public.shield where user_id = $1`,
      [D],
    );
    expect(Number(shield.hours)).toBeGreaterThan(13.9);
    expect(await t.query(`select 1 from public.raid_lock where raid_id = $1`, [id])).toHaveLength(0);
  });

  it('a zero-hour shield leaves the defender unshielded', async () => {
    const id = await openRaid();
    await settle(id, { shieldHours: 0 });
    expect(await t.query(`select 1 from public.shield where user_id = $1`, [D])).toHaveLength(0);
  });

  it('a cove settles with no defender, no loss and no renown for anyone', async () => {
    const id = await openRaid(null);
    const before = await profileOf(D);

    const out = await settle(id, { earnedCoins: 200, earnedSteel: 400 });
    expect(out.settle_raid.applied).toBe(true);
    expect(out.settle_raid.takenCoins).toBe(0);

    const after = await profileOf(D);
    expect(after.coins).toBe(before.coins); // an uninvolved player is untouched
    expect(await t.query(`select 1 from public.shield`)).toHaveLength(0);
  });

  it('refuses a raid that does not exist', async () => {
    const out = await settle('deadbeef-0000-4000-8000-000000000000');
    expect(out.settle_raid.applied).toBe(false);
    expect(out.settle_raid.reason).toBe('no-such-raid');
  });

  it('stores the replay actions on the log row', async () => {
    const id = await openRaid();
    await t.one(
      `select public.settle_raid($1, 1::smallint, 0.5, 4, 'retreat', 0, 0, '[]'::jsonb, 0, 0, 0, 0, 0,
                                 $2::jsonb, $3::jsonb)`,
      [
        id,
        JSON.stringify([{ kind: 'fire', at: { r: 0, c: 0 } }]),
        JSON.stringify([{ shellDelta: 0 }]),
      ],
    );
    const log = await t.one<{ actions: unknown[]; engine_version: string }>(
      `select actions, engine_version from public.raid_log where raid_id = $1`,
      [id],
    );
    expect(log.actions).toHaveLength(1);
    expect(log.engine_version).toBe('1');
  });
});

// ===========================================================================
// Housekeeping
// ===========================================================================

describe('raid_sweep_expired', () => {
  it('clears expired locks and shields, and leaves live ones', async () => {
    await seedCity(D);
    await t.query(
      `insert into public.raid_lock (defender_id, raid_id, attacker_id, expires_at)
       values ($1, $2, $3, now() - interval '1 minute')`,
      [D, raidId(), A],
    );
    await t.query(
      `insert into public.raid_lock (defender_id, raid_id, attacker_id, expires_at)
       values ($1, $2, $3, now() + interval '5 minutes')`,
      [C, raidId(), A],
    );
    await t.query(`insert into public.shield (user_id, until) values ($1, now() - interval '1 hour')`, [D]);

    await t.query(`select public.raid_sweep_expired()`);

    expect(await t.query(`select 1 from public.raid_lock`)).toHaveLength(1);
    expect(await t.query(`select 1 from public.shield`)).toHaveLength(0);
  });
});

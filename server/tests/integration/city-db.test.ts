/**
 * The city's SQL, against a real Postgres — part-01 §8.2.
 *
 * These are the scenarios a fake client cannot prove: atomicity, the
 * optimistic version check, two writers racing, the RLS guard, and the
 * migration's re-runnability.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import {
  CITY_CATALOGUE,
  OFFLINE_REWARD_CAP,
  newCity,
  salvageBonusPercent,
} from '@engine/city';
import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const MATCH = 'aaaaaaaa-1111-4111-8111-111111111111';
const NOW = 1_700_000_000_000;

let t: TestDb;

beforeAll(async () => {
  // Two passes: every migration must be re-runnable (§8.2.16).
  t = await startTestDb(2);
  await seedProfile(t, A, { coins: 1_000, steel: 1_000, gems: 500 });
  await seedProfile(t, B, { coins: 1_000, steel: 1_000, gems: 500 });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('the migration', () => {
  it('applied twice without error and left one city table', async () => {
    const rows = await t.query<{ count: string }>(
      `select count(*) from information_schema.tables
        where table_schema = 'public' and table_name in ('city','economy_ledger','city_request_log')`,
    );
    expect(Number(rows[0]?.count)).toBe(3);
  });

  it('added profiles.steel with a zero default', async () => {
    const row = await t.one<{ column_default: string | null; is_nullable: string }>(
      `select column_default, is_nullable from information_schema.columns
        where table_schema='public' and table_name='profiles' and column_name='steel'`,
    );
    expect(row.is_nullable).toBe('NO');
    expect(row.column_default).toContain('0');
  });
});

describe('the score guard (§9.2)', () => {
  // This guard is the single highest-consequence line in Part 1: if `steel`
  // is not in guard_profile_update()'s list, it ships client-writable and
  // nothing else in the suite notices. So the test first PROVES the client
  // session really can write — otherwise a rejection could just be RLS
  // matching zero rows, and the test would pass for the wrong reason.
  it('is reached at all: a client can write its own name', async () => {
    await t.asUser(A, () => t.query(`update public.profiles set name = 'Nelson' where id = $1`, [A]));
    const row = await t.one<{ name: string }>(`select name from public.profiles where id = $1`, [A]);
    expect(row.name).toBe('Nelson');
  });

  it('rejects a client-JWT write to steel, exactly like coins', async () => {
    await expect(
      t.asUser(A, () => t.query(`update public.profiles set steel = steel + 1 where id = $1`, [A])),
    ).rejects.toThrow(/written by the match server only/);

    // And the same write from the server (no JWT claim) still goes through.
    await t.query(`update public.profiles set steel = steel + 1 where id = $1`, [A]);
    const row = await t.one<{ steel: number }>(`select steel from public.profiles where id = $1`, [A]);
    expect(row.steel).toBe(1_001);
  });

  it('rejects coins too, so the new column matches the old behaviour', async () => {
    await expect(
      t.asUser(A, () => t.query(`update public.profiles set coins = coins + 1 where id = $1`, [A])),
    ).rejects.toThrow(/written by the match server only/);
  });

  it('gives end users no way into the city tables at all', async () => {
    for (const table of ['city', 'economy_ledger', 'city_request_log']) {
      const grants = await t.query(
        `select 1 from information_schema.role_table_grants
          where table_schema='public' and table_name=$1 and grantee in ('anon','authenticated')`,
        [table],
      );
      expect(grants, `${table} is reachable by a client`).toHaveLength(0);
    }
  });
});

describe('city_default_state', () => {
  it('matches newCity() from the engine, so the two cannot drift', async () => {
    const row = await t.one<{ state: Record<string, unknown> }>(
      `select public.city_default_state($1) as state`,
      [NOW],
    );
    const fromSql = row.state;
    const fromEngine = newCity(NOW, new Date(NOW).toISOString().slice(0, 10));

    expect(Object.keys(fromSql.buildings as object).sort()).toEqual(
      Object.keys(fromEngine.buildings).sort(),
    );
    expect(fromSql.workers).toBe(fromEngine.workers);
    expect(fromSql.scrapPile).toBe(fromEngine.scrapPile);
    expect(fromSql.cityVersion).toBe(fromEngine.cityVersion);
    expect(fromSql.offlineRewardsToday).toEqual(fromEngine.offlineRewardsToday);
    expect((fromSql.buildings as Record<string, { level: number }>).admiralty.level).toBe(1);
    expect((fromSql.buildings as Record<string, { level: number }>).scrapyard.level).toBe(1);
    expect((fromSql.buildings as Record<string, { level: number }>).fish_market.level).toBe(0);
  });
});

describe('the Scrapyard bonus in SQL', () => {
  it('equals CITY_CATALOGUE.scrapyard, level for level (§8.2.23)', async () => {
    // Drive credit_salvage at each level with a base of 100 so the credited
    // amount IS the multiplier, then compare against the TS catalogue.
    for (let level = 1; level <= CITY_CATALOGUE.scrapyard.levels.length; level++) {
      await t.query(
        `update public.city
            set state = jsonb_set(state, '{buildings,scrapyard,level}', to_jsonb($2::int)),
                version = version + 1
          where user_id = $1`,
        [B, level],
      );
      await t.query(`update public.city set state = jsonb_set(state, '{scrapPile}', '0') where user_id = $1`, [B]);

      const row = await t.one<{ credit_salvage: number }>(
        `select public.credit_salvage($1, 100, 'pin', false, 0, $2)`,
        [B, NOW],
      );
      expect(row.credit_salvage, `scrapyard L${level}`).toBe(100 + salvageBonusPercent(level));
    }
  });
});

describe('salvage at settlement (§8.2.20)', () => {
  const C = '33333333-3333-4333-8333-333333333333';
  const D = '44444444-4444-4444-8444-444444444444';

  beforeAll(async () => {
    await seedProfile(t, C);
    await seedProfile(t, D);
    await t.query(
      `insert into public.matches (id, mode, player_a, player_b, seed, is_bot)
       values ($1, 'advanced', $2, $3, 1, false)`,
      [MATCH, C, D],
    );
  });

  it('credits both sides in the same transaction as points and coins', async () => {
    const applied = await t.one<{ apply_match_result: { settled: boolean; salvage_a: number; salvage_b: number } }>(
      `select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10, 90, 40, $3)`,
      [MATCH, C, NOW],
    );
    // 0015: the function now reports what it credited, so assert that too.
    expect(applied.apply_match_result.settled).toBe(true);
    expect(applied.apply_match_result.salvage_a).toBe(90);
    expect(applied.apply_match_result.salvage_b).toBe(40);

    const winner = await t.one<{ rank_points: number; coins: number }>(
      `select rank_points, coins from public.profiles where id = $1`,
      [C],
    );
    expect(winner.rank_points).toBe(25);
    expect(winner.coins).toBe(50);

    // Scrapyard level 1 -> no bonus, so the base lands unchanged.
    const cityC = await t.one<{ pile: number }>(
      `select (state->>'scrapPile')::int as pile from public.city where user_id = $1`,
      [C],
    );
    const cityD = await t.one<{ pile: number }>(
      `select (state->>'scrapPile')::int as pile from public.city where user_id = $1`,
      [D],
    );
    expect(cityC.pile).toBe(90);
    expect(cityD.pile).toBe(40); // the loser is still paid for what they sank
  });

  it('a replayed settlement credits nothing a second time', async () => {
    const again = await t.one<{ apply_match_result: { settled: boolean } }>(
      `select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10, 90, 40, $3)`,
      [MATCH, C, NOW],
    );
    expect(again.apply_match_result.settled).toBe(false);

    const cityC = await t.one<{ pile: number }>(
      `select (state->>'scrapPile')::int as pile from public.city where user_id = $1`,
      [C],
    );
    expect(cityC.pile).toBe(90); // unchanged
  });
});

describe('the offline daily cap (§8.2.21)', () => {
  const E = '55555555-5555-4555-8555-555555555555';

  beforeAll(async () => {
    await seedProfile(t, E);
  });

  it('pays salvage for ten matches, then stops — but keeps paying coins', async () => {
    for (let i = 0; i < OFFLINE_REWARD_CAP; i++) {
      const row = await t.one<{ apply_offline_result: number }>(
        `select public.apply_offline_result($1, $2, 'ai', true, now(), 20, $3, $4)`,
        [`m${i}`, E, OFFLINE_REWARD_CAP, NOW],
      );
      expect(row.apply_offline_result, `match ${i}`).toBe(20);
    }

    const before = await t.one<{ coins: number }>(
      `select coins from public.profiles where id = $1`,
      [E],
    );

    const eleventh = await t.one<{ apply_offline_result: number }>(
      `select public.apply_offline_result($1, $2, 'ai', true, now(), 20, $3, $4)`,
      ['m10', E, OFFLINE_REWARD_CAP, NOW],
    );
    expect(eleventh.apply_offline_result).toBe(0); // no salvage

    const after = await t.one<{ coins: number }>(
      `select coins from public.profiles where id = $1`,
      [E],
    );
    expect(after.coins).toBe(before.coins + 50); // coins untouched by the cap

    const pile = await t.one<{ pile: number }>(
      `select (state->>'scrapPile')::int as pile from public.city where user_id = $1`,
      [E],
    );
    expect(pile.pile).toBe(20 * OFFLINE_REWARD_CAP);
  });

  it('an already-applied offline id moves nothing', async () => {
    const row = await t.one<{ apply_offline_result: number }>(
      `select public.apply_offline_result($1, $2, 'ai', true, now(), 20, $3, $4)`,
      ['m0', E, OFFLINE_REWARD_CAP, NOW],
    );
    expect(row.apply_offline_result).toBe(-1);
  });
});

describe('city_apply', () => {
  const F = '66666666-6666-4666-8666-666666666666';

  beforeAll(async () => {
    await seedProfile(F === F ? t : t, F, { coins: 100, steel: 100, gems: 100 });
    await t.query(`select public.city_load($1, $2)`, [F, NOW]);
  });

  it('refuses a stale version and leaves everything alone (§4 concurrency)', async () => {
    const before = await t.one<{ version: number }>(
      `select version from public.city where user_id = $1`,
      [F],
    );

    const stale = await t.one<{ city_apply: number | null }>(
      `select public.city_apply($1, $2, '{}'::jsonb, 1, 50, 0, 0, '[]'::jsonb, null, null)`,
      [F, before.version - 1],
    );
    expect(stale.city_apply).toBeNull();

    const coins = await t.one<{ coins: number }>(`select coins from public.profiles where id=$1`, [F]);
    expect(coins.coins).toBe(100); // the wallet did not move
  });

  it('refuses to drive a balance negative even if the rules let it through', async () => {
    const current = await t.one<{ version: number; state: unknown }>(
      `select version, state from public.city where user_id = $1`,
      [F],
    );
    await expect(
      t.query(`select public.city_apply($1, $2, $3::jsonb, 1, -10000, 0, 0, '[]'::jsonb, null, null)`, [
        F,
        current.version,
        JSON.stringify(current.state),
      ]),
    ).rejects.toThrow(/negative/);
  });

  it('keeps only the newest 50 request-log rows per user (D6)', async () => {
    for (let i = 0; i < 60; i++) {
      const row = await t.one<{ version: number; state: unknown }>(
        `select version, state from public.city where user_id = $1`,
        [F],
      );
      await t.query(
        `select public.city_apply($1, $2, $3::jsonb, 1, 0, 0, 0, '[]'::jsonb, $4::uuid, '{"n":1}'::jsonb)`,
        [F, row.version, JSON.stringify(row.state), `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`],
      );
    }
    const count = await t.one<{ count: string }>(
      `select count(*) from public.city_request_log where user_id = $1`,
      [F],
    );
    expect(Number(count.count)).toBe(50);
  });
});

describe('two collects racing (§8.2.17)', () => {
  const G = '77777777-7777-4777-8777-777777777777';

  it('credits exactly once: the loser of the version race writes nothing', async () => {
    await seedProfile(t, G);
    await t.query(`select public.city_load($1, $2)`, [G, NOW]);

    // Put 500 steel in the scrap pile to collect.
    await t.query(
      `update public.city set state = jsonb_set(state, '{scrapPile}', '500'), version = version + 1
        where user_id = $1`,
      [G],
    );

    const row = await t.one<{ version: number; state: Record<string, unknown> }>(
      `select version, state from public.city where user_id = $1`,
      [G],
    );

    // Both readers saw the SAME version — the real shape of a double tap.
    const collected = { ...row.state, scrapPile: 0 };
    const results = await Promise.all([
      t.one<{ city_apply: number | null }>(
        `select public.city_apply($1, $2, $3::jsonb, 1, 0, 500, 0,
           '[{"reason":"collect_scrap","ref":"scrapyard","dCoins":0,"dSteel":500,"dGems":0}]'::jsonb,
           null, null)`,
        [G, row.version, JSON.stringify(collected)],
      ),
      t.one<{ city_apply: number | null }>(
        `select public.city_apply($1, $2, $3::jsonb, 1, 0, 500, 0,
           '[{"reason":"collect_scrap","ref":"scrapyard","dCoins":0,"dSteel":500,"dGems":0}]'::jsonb,
           null, null)`,
        [G, row.version, JSON.stringify(collected)],
      ),
    ]);

    const winners = results.filter((r) => r.city_apply !== null);
    expect(winners).toHaveLength(1);

    const wallet = await t.one<{ steel: number }>(`select steel from public.profiles where id=$1`, [G]);
    expect(wallet.steel).toBe(500); // credited once, not twice

    const ledger = await t.query(
      `select 1 from public.economy_ledger where user_id = $1 and reason = 'collect_scrap'`,
      [G],
    );
    expect(ledger).toHaveLength(1);
  });
});

describe('ledger reconciliation (§8.2.22)', () => {
  it('replaying every ledger row lands on the stored balances', async () => {
    const users = await t.query<{ user_id: string }>(
      `select distinct user_id from public.economy_ledger`,
    );
    expect(users.length).toBeGreaterThan(0);

    for (const { user_id } of users) {
      const sums = await t.one<{ c: string; s: string; g: string }>(
        `select coalesce(sum(d_coins),0) c, coalesce(sum(d_steel),0) s, coalesce(sum(d_gems),0) g
           from public.economy_ledger where user_id = $1`,
        [user_id],
      );
      const moved = await t.one<{ steel: number }>(
        `select steel from public.profiles where id = $1`,
        [user_id],
      );

      // Salvage rows are deliberately zero-delta: salvage lands in the pile,
      // not the wallet, so the ledger records the event without a currency
      // movement. Steel in the wallet therefore equals the ledger's steel plus
      // whatever the profile was seeded with.
      const seeded = await t.one<{ seeded: number }>(
        `select case when $1 in ($2, $3) then 1000 else 0 end as seeded`,
        [user_id, A, B],
      );
      expect(moved.steel, `steel for ${user_id}`).toBe(Number(sums.s) + seeded.seeded);
    }
  });
});

// ---------------------------------------------------------------------------
// 0015 — salvage read-back and the Scrapyard's wrecks
// ---------------------------------------------------------------------------

describe('salvage read-back (0015)', () => {
  const H = '88888888-8888-4888-8888-888888888888';
  const I = '99999999-9999-4999-8999-999999999999';
  const M2 = 'bbbbbbbb-2222-4222-8222-222222222222';

  beforeAll(async () => {
    await seedProfile(t, H);
    await seedProfile(t, I);
    await t.query(
      `insert into public.matches (id, mode, player_a, player_b, seed, is_bot)
       values ($1, 'advanced', $2, $3, 2, false)`,
      [M2, H, I],
    );
  });

  it('reports what it actually credited, not what it was asked for', async () => {
    // The city row has to exist before it can be levelled up — credit_salvage
    // would otherwise create a fresh level-1 yard and the bonus would be 0.
    await t.query(`select public.city_load($1, $2)`, [H, NOW]);
    // Scrapyard level 3 gives +10%, so a base of 90 credits 99.
    await t.query(
      `update public.city set state = jsonb_set(state, '{buildings,scrapyard,level}', '3'),
              version = version + 1 where user_id = $1`,
      [H],
    );

    const row = await t.one<{ apply_match_result: { settled: boolean; salvage_a: number; salvage_b: number } }>(
      `select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10, 90, 40, $3,
              '["battleship","cruiser"]'::jsonb, '["destroyer"]'::jsonb)`,
      [M2, H, NOW],
    );

    expect(row.apply_match_result.settled).toBe(true);
    expect(row.apply_match_result.salvage_a).toBe(99); // 90 x 1.10
    expect(row.apply_match_result.salvage_b).toBe(40); // level 1, no bonus
  });

  it('records the wrecks so the Scrapyard has something to draw', async () => {
    const city = await t.one<{ wrecks: string[] }>(
      `select state->'scrapWrecks' as wrecks from public.city where user_id = $1`,
      [H],
    );
    expect(city.wrecks).toEqual(['battleship', 'cruiser']);
  });

  it('a replayed settlement reports settled=false and credits nothing', async () => {
    const before = await t.one<{ pile: number }>(
      `select (state->>'scrapPile')::int as pile from public.city where user_id = $1`,
      [H],
    );
    const again = await t.one<{ apply_match_result: { settled: boolean; salvage_a: number } }>(
      `select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10, 90, 40, $3)`,
      [M2, H, NOW],
    );
    expect(again.apply_match_result.settled).toBe(false);
    expect(again.apply_match_result.salvage_a).toBe(0);

    const after = await t.one<{ pile: number }>(
      `select (state->>'scrapPile')::int as pile from public.city where user_id = $1`,
      [H],
    );
    expect(after.pile).toBe(before.pile);
  });

  it('trims the wreck list to the level display slots (2 + level)', async () => {
    const J = 'cccccccc-3333-4333-8333-333333333333';
    await seedProfile(t, J);
    await t.query(`select public.city_load($1, $2)`, [J, NOW]);

    // Scrapyard 1 -> three slots. Credit eight wrecks and expect three kept.
    await t.query(
      `select public.credit_salvage($1, 10, 'many', false, 0, $2,
        '["battleship","cruiser","cruiser","destroyer","destroyer","destroyer","boat","boat"]'::jsonb)`,
      [J, NOW],
    );
    const city = await t.one<{ wrecks: string[] }>(
      `select state->'scrapWrecks' as wrecks from public.city where user_id = $1`,
      [J],
    );
    expect(city.wrecks).toHaveLength(3);
    expect(city.wrecks[0]).toBe('battleship');
  });

  it('gives every city row a wreck list, including ones made before 0015', async () => {
    const rows = await t.query<{ missing: number }>(
      `select count(*)::int as missing from public.city where state->'scrapWrecks' is null`,
    );
    expect(rows[0]?.missing).toBe(0);
  });
});

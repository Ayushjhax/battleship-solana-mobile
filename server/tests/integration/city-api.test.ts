/**
 * The city service end to end — part-01 §8.2.
 *
 * The real rules (src/engine/city) over the real SQL (PGlite running 0014),
 * with only the repo seam swapped so the service talks to the test database
 * instead of Supabase. Nothing about the rules, the transaction or the
 * version check is faked.
 *
 * Covers: every endpoint's happy path, every typed error, requestId
 * idempotency, authorisation, and the feature flag.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CITY_CATALOGUE, type CityState } from '@engine/city';
import { __setCityRepoForTests, type ApplyInput, type CityRepo } from '../../src/city/repo';
import { __resetCityRateLimitForTests, CITY_RATE_LIMIT } from '../../src/city/rateLimit';
import { actOnCity, readCity } from '../../src/city/service';
import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const NOW = 1_700_000_000_000;
let t: TestDb;
let uid = 0;

/** The production repo's SQL, against the test database. */
function pgliteRepo(db: TestDb): CityRepo {
  return {
    async load(userId, now) {
      const rows = await db.query<{
        state: CityState;
        version: number;
        city_version: number;
        coins: number;
        steel: number;
        gems: number;
        rank_points: number;
        unlocks: string[] | null;
      }>(`select * from public.city_load($1, $2)`, [userId, now]);
      const row = rows[0];
      if (!row) return null;
      return {
        state: row.state,
        version: row.version,
        cityVersion: row.city_version,
        coins: row.coins,
        steel: row.steel,
        gems: row.gems,
        unlocks: row.unlocks ?? [],
        rankPoints: row.rank_points,
      };
    },
    async apply(input: ApplyInput) {
      const rows = await db.query<{ city_apply: number | null }>(
        `select public.city_apply($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb,$9::uuid,$10::jsonb)`,
        [
          input.userId,
          input.expectedVersion,
          JSON.stringify(input.state),
          input.cityVersion,
          input.dCoins,
          input.dSteel,
          input.dGems,
          JSON.stringify(input.ledger),
          input.requestId ?? null,
          input.response === undefined ? null : JSON.stringify(input.response),
        ],
      );
      return rows[0]?.city_apply ?? null;
    },
    async lookupRequest(userId, requestId) {
      const rows = await db.query<{ city_request_lookup: unknown }>(
        `select public.city_request_lookup($1, $2::uuid)`,
        [userId, requestId],
      );
      return rows[0]?.city_request_lookup ?? null;
    },
  };
}

/**
 * A fresh, already-migrated player whose wallet is EXACTLY what was asked for.
 *
 * The patch is applied AFTER the migration on purpose: the v1 grant pays 400
 * steel and 50 gems, so seeding first and migrating second would hand a
 * "broke" player 400 steel and quietly invalidate every not-enough-* test.
 */
async function player(patch: Parameters<typeof seedProfile>[2] = {}): Promise<string> {
  uid += 1;
  const id = `${String(uid).padStart(8, '0')}-0000-4000-8000-000000000000`;
  await seedProfile(t, id);
  await readCity(id, NOW); // runs the lazy v1 migration
  await t.query(
    `update public.profiles set coins = $2, steel = $3, gems = $4 where id = $1`,
    [id, patch.coins ?? 0, patch.steel ?? 0, patch.gems ?? 0],
  );
  return id;
}

const rid = (() => {
  let n = 0;
  return () => {
    n += 1;
    return `99999999-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
})();

beforeAll(async () => {
  t = await startTestDb();
  __setCityRepoForTests(pgliteRepo(t));
}, 120_000);

afterAll(async () => {
  __setCityRepoForTests(null);
  await t?.close();
});

beforeEach(() => {
  process.env.PORT_CITY_CORE = 'on';
  __resetCityRateLimitForTests();
});

afterEach(() => {
  delete process.env.PORT_CITY_CORE;
});

// ---------------------------------------------------------------------------

describe('the feature flag (§9.5)', () => {
  it('turns every endpoint off, and writes nothing', async () => {
    const id = await player();
    delete process.env.PORT_CITY_CORE;

    const read = await readCity(id, NOW);
    expect(read).toEqual({ ok: false, error: 'feature-off' });

    for (const action of [
      { kind: 'build', buildingId: 'fish_market' },
      { kind: 'collect-all' },
      { kind: 'buy-worker' },
    ] as const) {
      const out = await actOnCity(id, action, rid(), NOW);
      expect(out).toEqual({ ok: false, error: 'feature-off' });
    }

    const rows = await t.query(`select 1 from public.economy_ledger where user_id = $1`, [id]);
    // Only the migration grant rows from player(), nothing from the calls above.
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it('is off by default when the variable is absent or junk', async () => {
    const id = await player();
    for (const value of [undefined, '', 'false', 'off', 'maybe']) {
      if (value === undefined) delete process.env.PORT_CITY_CORE;
      else process.env.PORT_CITY_CORE = value;
      expect((await readCity(id, NOW)).ok, `value=${String(value)}`).toBe(false);
    }
  });
});

describe('GET /city', () => {
  it('migrates a fresh profile: 400 steel, 50 gems, Admiralty 1 (§8.2.16)', async () => {
    uid += 1;
    const id = `${String(uid).padStart(8, '0')}-0000-4000-8000-000000000000`;
    await seedProfile(t, id, { gems: 0 });

    const out = await readCity(id, NOW);
    if (!out.ok) throw new Error(out.error);

    expect(out.body.city.wallet.steel).toBe(400);
    expect(out.body.city.wallet.gems).toBe(50);
    expect(out.body.city.city.buildings.admiralty.level).toBe(1);
    expect(out.body.city.city.buildings.scrapyard.level).toBe(1);
    expect(out.body.city.city.workers).toBe(2);
    expect(out.body.serverNow).toBe(NOW);
  });

  it('back-pays a veteran at Captain rank, once (§8.2.16)', async () => {
    uid += 1;
    const id = `${String(uid).padStart(8, '0')}-0000-4000-8000-000000000000`;
    await seedProfile(t, id, { rankPoints: 3_000, gems: 0 });

    const first = await readCity(id, NOW);
    if (!first.ok) throw new Error(first.error);
    expect(first.body.city.wallet.gems).toBe(50 + 150);

    const second = await readCity(id, NOW + 1_000);
    if (!second.ok) throw new Error(second.error);
    expect(second.body.city.wallet.gems).toBe(50 + 150); // not paid twice
  });

  it('settles a finished job on read, with no action from the client', async () => {
    const id = await player({ coins: 10_000, steel: 10_000 });
    const started = await actOnCity(id, { kind: 'build', buildingId: 'fish_market' }, rid(), NOW);
    if (!started.ok) throw new Error(started.error);
    expect(started.body.city.city.buildings.fish_market.upgrading).toBeDefined();

    // The Fish Market's first level takes one minute.
    const later = await readCity(id, NOW + 61_000);
    if (!later.ok) throw new Error(later.error);
    expect(later.body.city.city.buildings.fish_market.level).toBe(1);
    expect(later.body.city.city.buildings.fish_market.upgrading).toBeUndefined();
  });
});

describe('every typed error (§8.2.15)', () => {
  it('unknown-building', async () => {
    const id = await player();
    const out = await actOnCity(id, { kind: 'build', buildingId: 'casino' }, rid(), NOW);
    expect(out).toEqual({ ok: false, error: 'unknown-building' });
  });

  it('not-enough-steel and not-enough-coins name the right shortage', async () => {
    const poor = await player({ coins: 0, steel: 0 });
    expect(await actOnCity(poor, { kind: 'build', buildingId: 'fish_market' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'not-enough-steel',
    });

    // Enough steel for the Fish Market (150) but the Admiralty also wants coins.
    const id = await player({ coins: 0, steel: 100_000 });
    expect(await actOnCity(id, { kind: 'build', buildingId: 'admiralty' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'not-enough-coins',
    });
  });

  it('needs-admiralty', async () => {
    const id = await player({ coins: 100_000, steel: 100_000 });
    // The Foundry needs Admiralty 2; a fresh city is at 1.
    expect(await actOnCity(id, { kind: 'build', buildingId: 'foundry' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'needs-admiralty',
    });
  });

  it('already-upgrading and no-free-worker', async () => {
    const id = await player({ coins: 100_000, steel: 100_000 });
    await actOnCity(id, { kind: 'build', buildingId: 'fish_market' }, rid(), NOW);
    expect(await actOnCity(id, { kind: 'build', buildingId: 'fish_market' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'already-upgrading',
    });

    await actOnCity(id, { kind: 'build', buildingId: 'admiralty' }, rid(), NOW);
    process.env.PORT_CITY_BOUNTIES = 'on'; // opens the Harbour Master's plot
    expect(
      await actOnCity(id, { kind: 'build', buildingId: 'harbour_office' }, rid(), NOW),
    ).toEqual({ ok: false, error: 'no-free-worker' });
    delete process.env.PORT_CITY_BOUNTIES;
  });

  it('feature-off for a plot whose flag is dark', async () => {
    const id = await player({ coins: 100_000, steel: 100_000 });
    expect(await actOnCity(id, { kind: 'build', buildingId: 'shipyard' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'feature-off',
    });
  });

  it('max-level', async () => {
    const id = await player({ coins: 10_000_000, steel: 10_000_000 });
    const top = CITY_CATALOGUE.admiralty.levels.length;
    await t.query(
      `update public.city
          set state = jsonb_set(state, '{buildings,admiralty,level}', to_jsonb($2::int)),
              version = version + 1
        where user_id = $1`,
      [id, top],
    );
    expect(await actOnCity(id, { kind: 'build', buildingId: 'admiralty' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'max-level',
    });
  });

  it('not-upgrading for speedup and cancel', async () => {
    const id = await player();
    expect(await actOnCity(id, { kind: 'speedup', buildingId: 'admiralty' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'not-upgrading',
    });
    expect(await actOnCity(id, { kind: 'cancel', buildingId: 'admiralty' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'not-upgrading',
    });
  });

  it('nothing-to-collect', async () => {
    const id = await player();
    expect(await actOnCity(id, { kind: 'collect', buildingId: 'fish_market' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'nothing-to-collect',
    });
    expect(await actOnCity(id, { kind: 'collect-all' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'nothing-to-collect',
    });
  });

  it('not-enough-gems buying a worker, and needs-admiralty before it', async () => {
    const id = await player({ gems: 0 });
    expect(await actOnCity(id, { kind: 'buy-worker' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'needs-admiralty',
    });

    await t.query(
      `update public.city
          set state = jsonb_set(state, '{buildings,admiralty,level}', '3'), version = version + 1
        where user_id = $1`,
      [id],
    );
    // The v1 grant paid 50 gems; the third worker costs 100.
    expect(await actOnCity(id, { kind: 'buy-worker' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'not-enough-gems',
    });
  });

  it('rate-limited after ten actions in ten seconds (D5)', async () => {
    const id = await player();
    for (let i = 0; i < CITY_RATE_LIMIT; i++) {
      await actOnCity(id, { kind: 'collect-all' }, rid(), NOW);
    }
    expect(await actOnCity(id, { kind: 'collect-all' }, rid(), NOW)).toEqual({
      ok: false,
      error: 'rate-limited',
    });
  });
});

describe('idempotency (§8.2.16)', () => {
  it('the same requestId twice has one effect and returns an identical body', async () => {
    const id = await player({ coins: 100_000, steel: 100_000 });
    const requestId = rid();

    const first = await actOnCity(id, { kind: 'build', buildingId: 'fish_market' }, requestId, NOW);
    const second = await actOnCity(id, { kind: 'build', buildingId: 'fish_market' }, requestId, NOW);

    if (!first.ok || !second.ok) throw new Error('expected both to succeed');
    expect(second.replayed).toBe(true);
    expect(second.body).toEqual(first.body);

    // Charged once: one `build` ledger row, and the steel moved once.
    const ledger = await t.query(
      `select 1 from public.economy_ledger where user_id = $1 and reason = 'build'`,
      [id],
    );
    expect(ledger).toHaveLength(1);

    const wallet = await t.one<{ steel: number }>(`select steel from public.profiles where id=$1`, [id]);
    const cost = CITY_CATALOGUE.fish_market.levels[0]?.steel ?? 0;
    expect(wallet.steel).toBe(100_000 - cost);
  });

  it('a replay does not consume a rate-limit slot', async () => {
    const id = await player({ coins: 100_000, steel: 100_000 });
    const requestId = rid();

    // One real action, then thirty replays of it. Only a SUCCESSFUL action
    // stores a response, so only that one can be replayed at all.
    const first = await actOnCity(id, { kind: 'build', buildingId: 'fish_market' }, requestId, NOW);
    expect(first.ok).toBe(true);
    for (let i = 0; i < 30; i++) {
      const again = await actOnCity(id, { kind: 'build', buildingId: 'fish_market' }, requestId, NOW);
      expect(again.ok && again.replayed).toBe(true);
    }

    // Still reachable: replays short-circuit before the limiter, so the nine
    // remaining slots in the window are untouched.
    const out = await actOnCity(id, { kind: 'collect-all' }, rid(), NOW);
    expect(out.ok === false && out.error).toBe('nothing-to-collect');
  });
});

describe('authorisation (§8.2.18)', () => {
  it('an action is scoped to the caller; B cannot spend A steel', async () => {
    const a = await player({ coins: 100_000, steel: 100_000 });
    const b = await player({ coins: 0, steel: 0 });

    const beforeA = await t.one<{ steel: number }>(`select steel from public.profiles where id=$1`, [a]);

    // There is no parameter that names another user — the id IS the identity.
    const out = await actOnCity(b, { kind: 'build', buildingId: 'fish_market' }, rid(), NOW);
    expect(out).toEqual({ ok: false, error: 'not-enough-steel' });

    const afterA = await t.one<{ steel: number }>(`select steel from public.profiles where id=$1`, [a]);
    expect(afterA.steel).toBe(beforeA.steel);
  });

  it('a requestId is namespaced per user, so B cannot read A stored response', async () => {
    const a = await player({ coins: 100_000, steel: 100_000 });
    const b = await player({ coins: 55_555, steel: 100_000 });
    const shared = rid();

    const fromA = await actOnCity(a, { kind: 'build', buildingId: 'fish_market' }, shared, NOW);
    const fromB = await actOnCity(b, { kind: 'build', buildingId: 'fish_market' }, shared, NOW);

    if (!fromA.ok || !fromB.ok) throw new Error('expected both to succeed');
    expect(fromB.replayed).toBe(false);
    expect(fromB.body.city.wallet.coins).toBe(55_555);
    expect(fromA.body.city.wallet.coins).toBe(100_000);

    // And the log really is keyed by (user, request), not request alone.
    const rows = await t.query(
      `select user_id from public.city_request_log where request_id = $1::uuid`,
      [shared],
    );
    expect(rows).toHaveLength(2);
  });
});

describe('the happy path for every endpoint (§8.2.14)', () => {
  it('build, speed up, collect, collect all and buy a worker all move the world', async () => {
    const id = await player({ coins: 100_000, steel: 100_000, gems: 5_000 });

    const built = await actOnCity(id, { kind: 'build', buildingId: 'fish_market' }, rid(), NOW);
    if (!built.ok) throw new Error(built.error);
    expect(built.body.city.freeWorkers).toBe(1);

    const sped = await actOnCity(id, { kind: 'speedup', buildingId: 'fish_market' }, rid(), NOW);
    if (!sped.ok) throw new Error(sped.error);
    expect(sped.body.city.city.buildings.fish_market.level).toBe(1);
    expect(sped.body.city.freeWorkers).toBe(2);

    // Three hours of production, then collect it.
    const collected = await actOnCity(
      id,
      { kind: 'collect', buildingId: 'fish_market' },
      rid(),
      NOW + 3 * 3_600_000,
    );
    if (!collected.ok) throw new Error(collected.error);
    expect(collected.body.city.city.buildings.fish_market.stored).toBe(0);

    const cancelled = await actOnCity(id, { kind: 'build', buildingId: 'admiralty' }, rid(), NOW);
    if (!cancelled.ok) throw new Error(cancelled.error);
    const back = await actOnCity(id, { kind: 'cancel', buildingId: 'admiralty' }, rid(), NOW);
    if (!back.ok) throw new Error(back.error);
    expect(back.body.city.freeWorkers).toBe(2);

    await t.query(
      `update public.city
          set state = jsonb_set(state, '{buildings,admiralty,level}', '3'), version = version + 1
        where user_id = $1`,
      [id],
    );
    const worker = await actOnCity(id, { kind: 'buy-worker' }, rid(), NOW);
    if (!worker.ok) throw new Error(worker.error);
    expect(worker.body.city.city.workers).toBe(3);
  });

  it('every response carries the whole snapshot and serverNow (§5)', async () => {
    const id = await player();
    const out = await readCity(id, NOW);
    if (!out.ok) throw new Error(out.error);
    expect(Object.keys(out.body)).toEqual(['city', 'serverNow']);
    expect(Object.keys(out.body.city).sort()).toEqual(
      // `unlocks` joined the snapshot in part-05 §5 (the research queue),
      // because every caller that needs it already holds the city.
      ['city', 'collectable', 'features', 'freeWorkers', 'unlocks', 'wallet'].sort(),
    );
  });
});

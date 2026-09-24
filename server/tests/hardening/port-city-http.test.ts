/**
 * Adversarial pass over every Port City HTTP endpoint — hardening suite.
 *
 * Everything here goes through `fastify.inject` against the REAL route
 * registration (`src/index.ts`), the REAL services and the REAL SQL migrations
 * (PGlite via `tests/helpers/pgliteSupabase.ts`). Only two seams are mocked:
 *
 *   - `src/auth`: the bearer token IS the user id, so "no auth", "expired
 *     token" and "another user's id" can be exercised without a JWKS server.
 *   - `src/db`: returns the PGlite-backed PostgREST shim, so the production
 *     repos run unmodified.
 *
 * Every endpoint is attacked with: no auth, wrong type, missing field,
 * negative and huge numbers, unknown ids, replays and two concurrent calls.
 * The assertions are the contract: a typed JSON code, never a 500, never a
 * stack trace, and — on DB-backed paths — never a partial write.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateDefaultHarbour, type HarbourLayout } from '@engine/raid';

import { __resetCityRateLimitForTests } from '../../src/city/rateLimit';
import { __resetSessionsForTests } from '../../src/raid/session';
import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';
import { pgliteSupabase } from './pgliteSupabase';

// ---------------------------------------------------------------------------
// The two seams
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../../src/auth', () => ({
  verifyAccessToken: async (token: string) =>
    token && token !== 'expired-token'
      ? { ok: true as const, token: { userId: token, isAnonymous: false } }
      : { ok: false as const, reason: 'invalid token' },
}));

vi.mock('../../src/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db')>();
  return { ...actual, db: () => hoisted.db };
});

import { app } from '../../src/index';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const FLAGS = [
  'PORT_CITY_CORE',
  'PORT_CITY_COSMETICS',
  'PORT_CITY_BOUNTIES',
  'PORT_CITY_ACADEMY',
  'PORT_CITY_RAIDS',
  'PORT_CITY_FLEETS',
  'PORT_CITY_GAZETTE',
  'PORT_CITY_VOYAGES',
] as const;

let t: TestDb;
let seq = 0;

/** A valid v4-shaped uuid, unique per call. */
function nextId(): string {
  seq += 1;
  return `${String(seq).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

/** A valid requestId, namespaced by call so replays are explicit. */
function rid(): string {
  seq += 1;
  return `99999999-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

type InjectResponse = Awaited<ReturnType<typeof app.inject>>;

function post(url: string, userId: string | null, payload?: unknown): Promise<InjectResponse> {
  return app.inject({
    method: 'POST',
    url,
    ...(userId ? { headers: { authorization: `Bearer ${userId}` } } : {}),
    ...(payload === undefined ? {} : { payload: payload as never }),
  });
}

function get(url: string, userId: string | null): Promise<InjectResponse> {
  return app.inject({
    method: 'GET',
    url,
    ...(userId ? { headers: { authorization: `Bearer ${userId}` } } : {}),
  });
}

/**
 * The contract every adversarial call must satisfy: a 4xx/5xx that is NOT a
 * 500, carrying a typed `code` (or the auth layer's `error` string), and no
 * serialised stack.
 */
function assertTypedError(
  res: InjectResponse,
  expected: { status?: number; code?: string | string[] } = {},
): string {
  expect(res.statusCode, `expected >=400, got ${res.statusCode}: ${res.body}`).toBeGreaterThanOrEqual(400);
  expect(res.statusCode, `a 500 is never acceptable: ${res.body}`).not.toBe(500);
  expect(res.body, 'a stack trace leaked').not.toContain('stack');
  const body = res.json() as { code?: unknown; error?: unknown };
  const code = typeof body.code === 'string' ? body.code : typeof body.error === 'string' ? body.error : null;
  expect(code, `untyped error body: ${res.body}`).toBeTruthy();
  if (expected.status !== undefined) expect(res.statusCode, res.body).toBe(expected.status);
  if (expected.code !== undefined) {
    const codes = Array.isArray(expected.code) ? expected.code : [expected.code];
    expect(codes, res.body).toContain(code);
  }
  return code as string;
}

/** Seeds a profile, materialises its city row and sets the wallet exactly. */
async function player(
  patch: { coins?: number; steel?: number; gems?: number; rankPoints?: number } = {},
): Promise<string> {
  const id = nextId();
  await seedProfile(t, id, {
    coins: patch.coins ?? 100_000,
    steel: patch.steel ?? 100_000,
    gems: patch.gems ?? 10_000,
    rankPoints: patch.rankPoints ?? 0,
  });
  await t.query(`select public.city_load($1, $2)`, [id, Date.now()]);
  return id;
}

/** Sets building levels inside the stored city state (test fixture only). */
async function setLevels(id: string, levels: Record<string, number>): Promise<void> {
  let expr = 'state';
  const params: unknown[] = [id];
  for (const [building, level] of Object.entries(levels)) {
    params.push(level);
    expr = `jsonb_set(${expr}, '{buildings,${building},level}', to_jsonb($${params.length}::int))`;
  }
  await t.query(`update public.city set state = ${expr}, version = version + 1 where user_id = $1`, params);
}

/** Gives a producer an exact pile, with accrual parked at "now". */
async function withStored(id: string, building: string, stored: number): Promise<void> {
  await t.query(
    `update public.city
        set state = jsonb_set(
              jsonb_set(state, '{buildings,${building},stored}', to_jsonb($2::int)),
              '{buildings,${building},lastAccrualAt}', to_jsonb($3::bigint)),
            version = version + 1
      where user_id = $1`,
    [id, stored, Date.now()],
  );
}

const wallet = (id: string) =>
  t.one<{ coins: number; steel: number; gems: number }>(
    `select coins, steel, gems from public.profiles where id = $1`,
    [id],
  );

const ledgerCount = async (id: string, reason: string): Promise<number> =>
  (await t.query(`select 1 from public.economy_ledger where user_id = $1 and reason = $2`, [id, reason])).length;

const RAID_CONTEXT = {
  admiraltyLevel: 5,
  coastalCommandLevel: 5,
  unlocks: ['sonar_net', 'decoy', 'minesweeper'],
  lighthouseLevel: 0,
};

/** A player who can raid: Admiralty 5, Coastal 5, Armory 5, harbour saved. */
async function raidReady(
  patch: { coins?: number; admiralty?: number; coastal?: number; armory?: number } = {},
): Promise<{ id: string; layout: HarbourLayout }> {
  const id = await player({ coins: patch.coins ?? 100_000 });
  await setLevels(id, {
    admiralty: patch.admiralty ?? 5,
    coastal_command: patch.coastal ?? 5,
    armory: patch.armory ?? 5,
  });
  const layout = generateDefaultHarbour(4242, RAID_CONTEXT);
  const saved = await post('/raid/harbour', id, { layout });
  expect(saved.statusCode, saved.body).toBe(200);
  return { id, layout };
}

function playerCard(userId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'player',
    userId,
    coveSeed: null,
    name: 'Target',
    avatarId: 1,
    avatarColor: 'violet',
    countryCode: null,
    admiraltyLevel: 5,
    renown: 0,
    loot: { coins: 0, steel: 0 },
    renownOffer: { best: 1, worst: -1 },
    costCoins: 0,
    ...extra,
  };
}

function coveCard(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'cove',
    userId: null,
    coveSeed: 7,
    name: 'Pirate cove',
    avatarId: 0,
    avatarColor: 'charcoal',
    countryCode: null,
    admiraltyLevel: 3,
    renown: 0,
    loot: { coins: 0, steel: 0 },
    renownOffer: { best: 0, worst: 0 },
    costCoins: 0,
    ...extra,
  };
}

function openBody(card: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { requestId: rid(), raidId: rid(), card, kit: {}, dropShield: false, ...extra };
}

beforeAll(async () => {
  t = await startTestDb();
  hoisted.db = pgliteSupabase(t);
  await app.ready();
  await t.query(
    `insert into public.season (id, starts_at, ends_at)
     values (1, now(), now() + interval '28 days')
     on conflict (id) do nothing`,
  );
}, 120_000);

afterAll(async () => {
  await app.close();
  await t?.close();
});

beforeEach(() => {
  for (const flag of FLAGS) process.env[flag] = 'on';
  __resetCityRateLimitForTests();
  __resetSessionsForTests();
});

afterEach(() => {
  for (const flag of FLAGS) delete process.env[flag];
});

// ===========================================================================
// 1. Authentication — every protected route, no auth and a bad token
// ===========================================================================

describe('authentication', () => {
  const routes: ReadonlyArray<readonly [string, 'GET' | 'POST', unknown?]> = [
    ['/city', 'GET'],
    ['/city/research', 'GET'],
    ['/city/research/start', 'POST', { requestId: '00000000-0000-4000-8000-000000000001', item: 'sonar_net' }],
    ['/city/research/rush', 'POST', { requestId: '00000000-0000-4000-8000-000000000002' }],
    ['/city/build', 'POST', { requestId: '00000000-0000-4000-8000-000000000003', buildingId: 'fish_market' }],
    ['/city/speedup', 'POST', { requestId: '00000000-0000-4000-8000-000000000004', buildingId: 'fish_market' }],
    ['/city/cancel', 'POST', { requestId: '00000000-0000-4000-8000-000000000005', buildingId: 'fish_market' }],
    ['/city/collect', 'POST', { requestId: '00000000-0000-4000-8000-000000000006', buildingId: 'fish_market' }],
    ['/city/collect-all', 'POST', { requestId: '00000000-0000-4000-8000-000000000007' }],
    ['/city/workers/buy', 'POST', { requestId: '00000000-0000-4000-8000-000000000008' }],
    ['/raid/harbour', 'GET'],
    ['/raid/harbour', 'POST', { layout: { ships: [], arsenal: [] } }],
    ['/raid/search', 'POST', { requestId: '00000000-0000-4000-8000-000000000009' }],
    ['/raid/open', 'POST', openBody(coveCard())],
    ['/raid/action', 'POST', { kind: 'retreat', raidId: '00000000-0000-4000-8000-00000000000a' }],
    ['/raid/settle', 'POST', { raidId: '00000000-0000-4000-8000-00000000000b' }],
    ['/raid/log', 'GET'],
    ['/raid/log/read', 'POST', { raidIds: [] }],
    ['/raid/revenge', 'POST', { raidId: '00000000-0000-4000-8000-00000000000c' }],
    ['/raid/replay/00000000-0000-4000-8000-00000000000d', 'GET'],
    ['/raid/status', 'GET'],
    ['/fleet', 'GET'],
    ['/fleet/create', 'POST', { requestId: rid(), name: 'Krakens', description: '', emblemBadge: 0, emblemTint: 0, policy: 'open', minRenown: 0 }],
    ['/fleet/leave', 'POST', {}],
    ['/fleet/chat', 'GET'],
    ['/fleet/chat', 'POST', { kind: 'phrase', code: 'g1' }],
    ['/fleet/flags', 'GET'],
    ['/fleet/donations', 'GET'],
    ['/fleet/donation/request', 'POST', { requestId: rid(), item: 'bomber' }],
    ['/fleet/donation/fill', 'POST', { requestId: rid(), donationId: '00000000-0000-4000-8000-00000000000e' }],
    ['/war/start', 'POST', { requestId: rid(), size: 5 }],
    ['/war/opt-in', 'POST', { optIn: true }],
    ['/war/harbour', 'POST', { layout: { ships: [], arsenal: [] } }],
    ['/war/raid', 'POST', { raidId: rid(), targetUserId: '00000000-0000-4000-8000-00000000000f', stars: 1, destruction: 0.5 }],
    ['/war', 'GET'],
    ['/visit/00000000-0000-4000-8000-000000000010', 'GET'],
    ['/fleet/friendly/00000000-0000-4000-8000-000000000011', 'GET'],
    ['/bounties', 'GET'],
    ['/bounties/claim', 'POST', { requestId: rid(), slot: 0 }],
    ['/bounties/reroll', 'POST', { requestId: rid(), slot: 0 }],
    ['/log', 'GET'],
    ['/log/claim', 'POST', { requestId: rid(), page: 1 }],
    ['/log/premium', 'POST', { requestId: rid() }],
    ['/cosmetics', 'GET'],
    ['/cosmetics/buy', 'POST', { requestId: rid(), itemId: 'stamp-anchor' }],
    ['/cosmetics/equip', 'POST', { requestId: rid(), slot: 'victoryStamp', itemId: 'stamp-anchor' }],
    ['/gazette', 'GET'],
    ['/gazette/read', 'POST', {}],
    ['/puzzle', 'GET'],
    ['/puzzle/fire', 'POST', { cell: { r: 0, c: 0 } }],
    ['/puzzle/leaderboard', 'GET'],
    ['/voyage', 'GET'],
    ['/voyage/send', 'POST', { route: 'coral-bay', slot: 0 }],
    ['/voyage/collect', 'POST', { id: rid() }],
    ['/voyage/skirmish', 'POST', { id: rid(), log: { seed: 1, shots: [], claimedWinner: 'player' } }],
  ];

  it('rejects every protected endpoint with a typed 401 and never a stack', async () => {
    for (const [url, method, payload] of routes) {
      const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as never }) });
      expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(401);
      expect(res.json().error, `${method} ${url}: ${res.body}`).toBeTruthy();
      expect(res.body, `${method} ${url} leaked a stack`).not.toContain('stack');
    }
  });

  it('rejects a malformed/expired bearer token on every feature family', async () => {
    for (const url of ['/city', '/raid/status', '/fleet', '/bounties', '/cosmetics', '/gazette']) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer expired-token' } });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(401);
    }
  });

  it('serves /config without auth and without user data', async () => {
    const res = await get('/config', null);
    expect(res.statusCode).toBe(200);
    expect(res.json().features).toMatchObject({ 'portCity.core': true });
    expect(res.body).not.toContain('Bearer');
  });
});

// ===========================================================================
// 2. City
// ===========================================================================

describe('city', () => {
  it('maps every malformed body to a typed code, never a 500', async () => {
    const id = await player();
    const cases: Array<[string, unknown, string]> = [
      ['/city/build', {}, 'unknown-building'],
      ['/city/build', { requestId: 'not-a-uuid', buildingId: 'fish_market' }, 'unknown-building'],
      ['/city/build', { requestId: rid(), buildingId: 42 }, 'unknown-building'],
      ['/city/build', { requestId: rid(), buildingId: 'x'.repeat(10_000) }, 'unknown-building'],
      ['/city/build', { requestId: rid(), buildingId: 'casino' }, 'unknown-building'],
      ['/city/speedup', { requestId: rid(), buildingId: null }, 'unknown-building'],
      ['/city/cancel', { requestId: rid() }, 'unknown-building'],
      ['/city/collect', { requestId: rid(), buildingId: -1 }, 'unknown-building'],
      ['/city/collect-all', {}, 'unknown-building'],
      ['/city/workers/buy', { requestId: 'nope' }, 'unknown-building'],
    ];
    for (const [url, body, code] of cases) {
      assertTypedError(await post(url, id, body), { status: 409, code });
    }
  });

  it('refuses to collect an empty collector and writes nothing', async () => {
    const id = await player();
    const before = await wallet(id);

    assertTypedError(await post('/city/collect', id, { requestId: rid(), buildingId: 'fish_market' }), {
      status: 409,
      code: 'nothing-to-collect',
    });
    assertTypedError(await post('/city/collect-all', id, { requestId: rid() }), {
      status: 409,
      code: 'nothing-to-collect',
    });

    expect(await wallet(id)).toEqual(before);
    expect(await ledgerCount(id, 'collect')).toBe(0);
  });

  it('refuses to speed up a job that has already finished, and charges nothing', async () => {
    const id = await player();
    const started = await post('/city/build', id, { requestId: rid(), buildingId: 'fish_market' });
    expect(started.statusCode).toBe(200);

    // The job is over, but the client has not seen a read settle it yet.
    await t.query(
      `update public.city
          set state = jsonb_set(state, '{buildings,fish_market,upgrading,endsAt}', to_jsonb($2::bigint)),
              version = version + 1
        where user_id = $1`,
      [id, Date.now() - 1_000],
    );
    const before = await wallet(id);

    assertTypedError(await post('/city/speedup', id, { requestId: rid(), buildingId: 'fish_market' }), {
      status: 409,
      code: 'not-upgrading',
    });
    expect(await wallet(id)).toEqual(before);
    expect(await ledgerCount(id, 'speedup')).toBe(0);
  });

  it('replays a requestId with one effect and an identical body', async () => {
    const id = await player();
    const requestId = rid();

    const first = await post('/city/build', id, { requestId, buildingId: 'fish_market' });
    const second = await post('/city/build', id, { requestId, buildingId: 'fish_market' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(await ledgerCount(id, 'build')).toBe(1);
  });

  it('survives two concurrent collects with exactly one credit', async () => {
    const id = await player();
    await withStored(id, 'fish_market', 500);
    const before = await wallet(id);

    const [a, b] = await Promise.all([
      post('/city/collect-all', id, { requestId: rid() }),
      post('/city/collect-all', id, { requestId: rid() }),
    ]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const after = await wallet(id);
    expect(after.coins - before.coins).toBe(500);
    expect(await ledgerCount(id, 'collect')).toBe(1);
  });

  it('ignores a body field naming another user', async () => {
    const a = await player();
    const b = await player({ coins: 0, steel: 0 });
    const beforeB = await wallet(b);

    const res = await post('/city/build', a, {
      requestId: rid(),
      buildingId: 'fish_market',
      userId: b,
      user_id: b,
    });
    expect(res.statusCode).toBe(200);
    expect(await wallet(b)).toEqual(beforeB);
  });

  it('rejects every research body that is not a known item', async () => {
    const id = await player();
    for (const body of [
      { requestId: rid(), item: 'plasma_cannon' },
      { requestId: rid(), item: 'x'.repeat(10_000) },
      { requestId: rid(), item: 42 },
      { requestId: rid() },
      { item: 'sonar_net' },
    ]) {
      assertTypedError(await post('/city/research/start', id, body), { status: 409, code: 'unknown-item' });
    }
  });

  it('refuses research without the Academy and rushing with no job', async () => {
    const id = await player();
    assertTypedError(await post('/city/research/start', id, { requestId: rid(), item: 'sonar_net' }), {
      status: 409,
      code: 'needs-academy',
    });
    assertTypedError(await post('/city/research/rush', id, { requestId: rid() }), {
      status: 409,
      code: 'not-researching',
    });
  });

  it('refuses to rush a job that has already finished', async () => {
    const id = await player();
    await setLevels(id, { naval_academy: 1 });
    expect((await post('/city/research/start', id, { requestId: rid(), item: 'sonar_net' })).statusCode).toBe(200);

    // `research` IS the job object (`{item, startedAt, endsAt}`), not a
    // wrapper with a `job` key — research_apply writes `state.job` straight
    // into this column (0018_research.sql).
    await t.query(
      `update public.city
          set research = jsonb_set(research, '{endsAt}', to_jsonb($2::bigint)),
              version = version + 1
        where user_id = $1`,
      [id, Date.now() - 1_000],
    );
    const before = await wallet(id);

    assertTypedError(await post('/city/research/rush', id, { requestId: rid() }), {
      status: 409,
      code: 'not-researching',
    });
    expect(await wallet(id)).toEqual(before);
    expect(await ledgerCount(id, 'research_rush')).toBe(0);
  });

  it('charges one research start even when it is sent twice', async () => {
    const id = await player();
    await setLevels(id, { naval_academy: 1 });
    const before = await wallet(id);

    const first = await post('/city/research/start', id, { requestId: rid(), item: 'sonar_net' });
    const second = await post('/city/research/start', id, { requestId: rid(), item: 'sonar_net' });

    expect(first.statusCode).toBe(200);
    assertTypedError(second, { status: 409, code: 'already-researching' });
    expect(await ledgerCount(id, 'research_start')).toBe(1);
    expect(before.coins - (await wallet(id)).coins).toBe(1_000);
  });

  it('goes dark for every city and research route when the flag is off', async () => {
    const id = await player();
    delete process.env.PORT_CITY_CORE;

    assertTypedError(await get('/city', id), { status: 409, code: 'feature-off' });
    assertTypedError(await post('/city/collect-all', id, { requestId: rid() }), { status: 409, code: 'feature-off' });
    // Research is deliberately behind `portCity.academy`, not `portCity.core`
    // (see the header comment on registerCityRoutes' research() closure) — a
    // fresh player with no Academy built fails on academy level, same as the
    // "refuses research without the Academy" case above, regardless of core.
    assertTypedError(await post('/city/research/start', id, { requestId: rid(), item: 'sonar_net' }), {
      status: 409,
      code: 'needs-academy',
    });
  });
});

// ===========================================================================
// 3. Raids
// ===========================================================================

describe('raids', () => {
  it('refuses to open a raid against yourself', async () => {
    const { id } = await raidReady();
    const before = await wallet(id);

    assertTypedError(await post('/raid/open', id, openBody(playerCard(id))), { status: 404, code: 'not-found' });

    expect(await t.query(`select 1 from public.raid where attacker_id = $1`, [id])).toHaveLength(0);
    expect(await wallet(id)).toEqual(before);
  });

  it.fails(
    'refuses a forged card naming a shielded defender (known gap: open does not re-check the shield search filters)',
    async () => {
      const { id: attacker } = await raidReady();
      const { id: defender } = await raidReady();
      await t.query(
        `insert into public.shield (user_id, until, reason)
         values ($1, now() + interval '2 hours', 'raided')
         on conflict (user_id) do update set until = excluded.until`,
        [defender],
      );

      const res = await post('/raid/open', attacker, openBody(playerCard(defender)));
      assertTypedError(res, { status: 409, code: 'target-locked' });
    },
  );

  it('keeps the shield out of search even though open would accept it', async () => {
    const attacker = await player();
    await setLevels(attacker, { admiralty: 5, coastal_command: 5, armory: 5 });
    const defender = await player();
    await setLevels(defender, { admiralty: 5, coastal_command: 5, armory: 5 });
    await t.query(`delete from public.harbour`);
    expect((await post('/raid/harbour', defender, { layout: generateDefaultHarbour(9, RAID_CONTEXT) })).statusCode).toBe(200);
    await t.query(`insert into public.shield (user_id, until) values ($1, now() + interval '2 hours')`, [defender]);

    const res = await post('/raid/search', attacker, { requestId: rid() });
    expect(res.statusCode).toBe(200);
    expect(res.json().card.kind).toBe('cove');
  });

  it('refuses an over-budget harbour and keeps the last valid one defending', async () => {
    const { id, layout } = await raidReady();
    const storedBefore = await t.one<{ layout: HarbourLayout }>(
      `select layout from public.harbour where user_id = $1`,
      [id],
    );

    const overBudget = {
      ...layout,
      arsenal: [
        ...layout.arsenal,
        ...Array.from({ length: 40 }, (_, i) => ({ kind: 'mine', at: { r: 0, c: i % 10 } })),
      ],
    };
    assertTypedError(await post('/raid/harbour', id, { layout: overBudget }), { status: 409, code: 'bad-harbour' });

    const storedAfter = await t.one<{ layout: HarbourLayout }>(
      `select layout from public.harbour where user_id = $1`,
      [id],
    );
    expect(JSON.stringify(storedAfter.layout)).toBe(JSON.stringify(storedBefore.layout));
  });

  it('maps malformed harbour and search bodies to typed codes', async () => {
    const { id } = await raidReady();
    assertTypedError(await post('/raid/harbour', id, { layout: 'not-a-layout' }), { status: 409, code: 'bad-harbour' });
    assertTypedError(await post('/raid/harbour', id, {}), { status: 409, code: 'bad-harbour' });
    assertTypedError(await post('/raid/search', id, { requestId: 'nope' }), { status: 404, code: 'not-found' });
    assertTypedError(await post('/raid/search', id, { requestId: rid(), searchesThisSession: 1e9 }), {
      status: 404,
      code: 'not-found',
    });
  });

  it('refuses search below Admiralty 3', async () => {
    const id = await player();
    await setLevels(id, { admiralty: 2 });
    assertTypedError(await post('/raid/search', id, { requestId: rid() }), { status: 409, code: 'needs-admiralty' });
  });

  it('refuses a kit containing an unresearched Academy item, with no raid row', async () => {
    const { id } = await raidReady();
    const before = await wallet(id);
    const body = openBody(coveCard(), { kit: { minesweeper: 1 } });

    assertTypedError(await post('/raid/open', id, body), { status: 409, code: 'bad-kit' });

    expect(await t.query(`select 1 from public.raid where attacker_id = $1`, [id])).toHaveLength(0);
    expect(await wallet(id)).toEqual(before);
  });

  it('rejects malformed open bodies and unknown targets', async () => {
    const { id } = await raidReady();
    const cases: Array<unknown> = [
      {},
      { requestId: rid(), raidId: rid(), card: playerCard(id, { costCoins: -5 }), kit: {} },
      openBody(coveCard({ coveSeed: null, userId: id })),
      openBody(playerCard(id, { admiraltyLevel: 1e9 })),
    ];
    for (const body of cases) {
      assertTypedError(await post('/raid/open', id, body), { status: 404, code: 'not-found' });
    }

    // A profile with no row is indistinguishable from one with no harbour
    // built yet — openRaid deliberately does not tell them apart (leaking
    // "this account exists" would be the same information leak §11 already
    // refuses for raid replay), so this one answers `no-harbour`, not
    // `not-found`.
    assertTypedError(await post('/raid/open', id, openBody(playerCard(nextId()))), {
      status: 409,
      code: 'no-harbour',
    });
  });

  it('charges the search cost even when the card claims it is free', async () => {
    const { id } = await raidReady();
    const before = await wallet(id);

    const res = await post('/raid/open', id, openBody(coveCard({ costCoins: 0 })));
    expect(res.statusCode, res.body).toBe(200);
    expect(before.coins - (await wallet(id)).coins).toBe(50); // searchCost(Admiralty 5)
    expect(await ledgerCount(id, 'raid_search')).toBe(1);
  });

  it('scales a cove by the server’s renown, not the renown on the card', async () => {
    const { id } = await raidReady();
    await t.query(
      `insert into public.renown (user_id, value, best) values ($1, 300, 300)
       on conflict (user_id) do update set value = excluded.value`,
      [id],
    );

    const res = await post('/raid/open', id, openBody(coveCard({ renown: 999_999_999 })));
    expect(res.statusCode, res.body).toBe(200);

    const status = await get('/raid/status', id);
    expect(status.statusCode).toBe(200);
    expect(status.json().target.renown).toBe(300);
  });

  it('refuses a raid the attacker cannot pay for', async () => {
    const { id } = await raidReady({ coins: 0 });
    assertTypedError(await post('/raid/open', id, openBody(coveCard())), {
      status: 409,
      code: 'insufficient-coins',
    });
    expect(await t.query(`select 1 from public.raid where attacker_id = $1`, [id])).toHaveLength(0);
  });

  it('charges once when the same requestId is replayed after a restart', async () => {
    const { id } = await raidReady();
    const body = openBody(coveCard());
    const before = await wallet(id);

    expect((await post('/raid/open', id, body)).statusCode).toBe(200);
    const afterFirst = await wallet(id);

    // A process restart loses the in-memory session; the SQL log remembers.
    __resetSessionsForTests();
    const replay = await post('/raid/open', id, body);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(await wallet(id)).toEqual(afterFirst);
    expect(await ledgerCount(id, 'raid_search')).toBe(1);
    expect(before.coins - afterFirst.coins).toBe(50);
  });

  it('rejects malformed and session-less raid actions', async () => {
    const { id } = await raidReady();
    const raidId = rid();
    assertTypedError(await post('/raid/action', id, { kind: 'retreat', raidId: 'nope' }), {
      status: 404,
      code: 'not-found',
    });
    assertTypedError(await post('/raid/action', id, { kind: 'fire', raidId, at: { r: -1, c: 0 } }), {
      status: 404,
      code: 'not-found',
    });
    assertTypedError(await post('/raid/action', id, { kind: 'fire', raidId, at: { r: 0, c: 0 } }), {
      status: 409,
      code: 'no-session',
    });
    assertTypedError(await post('/raid/action', id, { kind: 'teleport', raidId }), {
      status: 404,
      code: 'not-found',
    });
  });

  it('refuses to settle or replay another captain’s raid', async () => {
    const { id: attacker } = await raidReady();
    const stranger = await player();
    const raidId = rid();
    const opened = await post('/raid/open', attacker, openBody(coveCard(), { raidId }));
    expect(opened.statusCode, opened.body).toBe(200);

    assertTypedError(await post('/raid/settle', stranger, { raidId }), { status: 409, code: 'no-session' });
    assertTypedError(await get(`/raid/replay/${raidId}`, stranger), { status: 404, code: 'not-found' });

    const settled = await post('/raid/settle', attacker, { raidId });
    expect(settled.statusCode, settled.body).toBe(200);

    const replay = await get(`/raid/replay/${raidId}`, attacker);
    expect(replay.statusCode, replay.body).toBe(200);
    assertTypedError(await get(`/raid/replay/${rid()}`, attacker), { status: 404, code: 'not-found' });
  });

  it('rejects malformed log reads and answers unknown ids with typed codes', async () => {
    const { id } = await raidReady();
    assertTypedError(
      await post('/raid/log/read', id, { raidIds: Array.from({ length: 65 }, () => rid()) }),
      { status: 404, code: 'not-found' },
    );
    const marked = await post('/raid/log/read', id, { raidIds: [rid()] });
    expect(marked.statusCode).toBe(200);
    const revenge = await post('/raid/revenge', id, { raidId: rid() });
    expect(revenge.statusCode).toBe(200);
    expect(revenge.json().free).toBe(false);
    assertTypedError(await post('/raid/revenge', id, { raidId: 'nope' }), { status: 404, code: 'not-found' });
  });

  it('serves the caller their own harbour and status, and goes dark when the flag is off', async () => {
    const { id } = await raidReady();
    expect((await get('/raid/harbour', id)).statusCode).toBe(200);
    const status = await get('/raid/status', id);
    expect(status.statusCode).toBe(200);
    expect(status.json().active).toBe(false);

    delete process.env.PORT_CITY_RAIDS;
    assertTypedError(await get('/raid/harbour', id), { status: 409, code: 'feature-off' });
    assertTypedError(await post('/raid/search', id, { requestId: rid() }), { status: 409, code: 'feature-off' });
  });
});

// ===========================================================================
// 4. Daily: Gazette, puzzle, voyages
// ===========================================================================

describe('daily', () => {
  it('maps every malformed puzzle shot to 400 illegal-cell', async () => {
    const id = await player();
    for (const body of [
      {},
      { cell: { r: 10, c: 0 } },
      { cell: { r: -1, c: 0 } },
      { cell: { r: 0, c: 9.5 } },
      { cell: { r: 1e9, c: 0 } },
      { cell: 'a1' },
    ]) {
      assertTypedError(await post('/puzzle/fire', id, body), { status: 400, code: 'illegal-cell' });
    }
  });

  it('rejects unknown voyage routes and slots, and docks that cannot hold one', async () => {
    const id = await player();
    for (const body of [
      { route: 'atlantis', slot: 0 },
      { route: 'coral-bay', slot: 7 },
      { route: 'coral-bay', slot: -1 },
      { route: 42, slot: 0 },
      { route: 'coral-bay', slot: 1e9 },
      {},
    ]) {
      assertTypedError(await post('/voyage/send', id, body), { status: 400, code: 'unknown-route' });
    }
    assertTypedError(await post('/voyage/send', id, { route: 'coral-bay', slot: 0 }), {
      status: 409,
      code: 'no-slot',
    });
  });

  it('answers unknown voyage ids with 404 and never a 500', async () => {
    const id = await player();
    assertTypedError(await post('/voyage/collect', id, { id: rid() }), { status: 404, code: 'not-found' });
    assertTypedError(await post('/voyage/collect', id, { id: 'nope' }), { status: 404, code: 'not-found' });
    assertTypedError(
      await post('/voyage/skirmish', id, { id: rid(), log: { seed: 1, shots: [], claimedWinner: 'player' } }),
      { status: 404, code: 'not-found' },
    );
    assertTypedError(await post('/voyage/skirmish', id, { id: rid(), log: 'nope' }), {
      status: 404,
      code: 'not-found',
    });
  });

  it('lets exactly one of two concurrent sends take a slot', async () => {
    const id = await player();
    await setLevels(id, { trade_docks: 3 });

    const [a, b] = await Promise.all([
      post('/voyage/send', id, { route: 'coral-bay', slot: 0 }),
      post('/voyage/send', id, { route: 'coral-bay', slot: 0 }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().code).toBe('slot-busy');
    const rows = await t.query(`select 1 from public.voyage where user_id = $1`, [id]);
    expect(rows).toHaveLength(1);
  });

  it('serves the gazette, puzzle and leaderboard without leaking a layout', async () => {
    const id = await player();
    const gazette = await get('/gazette', id);
    expect(gazette.statusCode, gazette.body).toBe(200);
    expect(gazette.json().edition).toBeTruthy();

    const puzzle = await get('/puzzle', id);
    expect(puzzle.statusCode, puzzle.body).toBe(200);

    const board = await get('/puzzle/leaderboard', id);
    expect(board.statusCode, board.body).toBe(200);

    const voyages = await get('/voyage', id);
    expect(voyages.statusCode, voyages.body).toBe(200);
  });

  it('goes dark per flag: gazette vs voyages', async () => {
    const id = await player();
    delete process.env.PORT_CITY_GAZETTE;
    assertTypedError(await get('/gazette', id), { status: 409, code: 'feature-off' });
    assertTypedError(await post('/puzzle/fire', id, { cell: { r: 0, c: 0 } }), {
      status: 409,
      code: 'feature-off',
    });

    process.env.PORT_CITY_GAZETTE = 'on';
    delete process.env.PORT_CITY_VOYAGES;
    assertTypedError(await get('/voyage', id), { status: 409, code: 'feature-off' });
    assertTypedError(await post('/voyage/send', id, { route: 'coral-bay', slot: 0 }), {
      status: 409,
      code: 'feature-off',
    });
  });
});

// ===========================================================================
// 5. Bounties and the Captain's Log
// ===========================================================================

describe('bounties', () => {
  it('rejects unknown slots and malformed bodies without writing', async () => {
    const id = await player();
    for (const body of [{ requestId: rid(), slot: 999 }, { requestId: rid(), slot: -1 }, { requestId: rid(), slot: 'x' }, {}]) {
      assertTypedError(await post('/bounties/claim', id, body), { status: 409, code: 'unknown-slot' });
    }
    expect(await ledgerCount(id, 'contract_claim')).toBe(0);
  });

  it('refuses an active contract and credits a done one exactly once', async () => {
    const id = await player();
    const board = await get('/bounties', id);
    expect(board.statusCode, board.body).toBe(200);
    const slot = board.json().contracts[0].slot as number;

    assertTypedError(await post('/bounties/claim', id, { requestId: rid(), slot }), {
      status: 409,
      code: 'not-claimable',
    });
    expect(await ledgerCount(id, 'contract_claim')).toBe(0);

    await t.query(`update public.contracts set state = 'done', progress = target where user_id = $1 and slot = $2`, [id, slot]);

    const first = await post('/bounties/claim', id, { requestId: rid(), slot });
    expect(first.statusCode, first.body).toBe(200);
    const afterFirst = await wallet(id);
    assertTypedError(await post('/bounties/claim', id, { requestId: rid(), slot }), {
      status: 409,
      code: 'not-claimable',
    });
    expect(await wallet(id)).toEqual(afterFirst);
    expect(await ledgerCount(id, 'contract_claim')).toBe(1);
  });

  it('pays a contract once when two claims race', async () => {
    const id = await player();
    const board = await get('/bounties', id);
    const slot = board.json().contracts[0].slot as number;
    await t.query(`update public.contracts set state = 'done', progress = target where user_id = $1 and slot = $2`, [id, slot]);
    const before = await wallet(id);

    const [a, b] = await Promise.all([
      post('/bounties/claim', id, { requestId: rid(), slot }),
      post('/bounties/claim', id, { requestId: rid(), slot }),
    ]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await ledgerCount(id, 'contract_claim')).toBe(1);
    const after = await wallet(id);
    expect(after.coins).toBeGreaterThanOrEqual(before.coins);
    expect(await wallet(id)).toEqual(after);
  });

  it('refuses a reroll without the gems and changes nothing', async () => {
    const id = await player({ gems: 0 });
    const board = await get('/bounties', id);
    const slot = board.json().contracts[0].slot as number;

    // The first reroll of the day is free; the second costs gems this player has not got.
    expect((await post('/bounties/reroll', id, { requestId: rid(), slot })).statusCode).toBe(200);
    const before = await wallet(id);

    assertTypedError(await post('/bounties/reroll', id, { requestId: rid(), slot }), {
      status: 409,
      code: 'not-enough-gems',
    });
    expect(await wallet(id)).toEqual(before);
  });

  it('never pays a page that was not earned', async () => {
    const id = await player();
    const log = await get('/log', id);
    expect(log.statusCode, log.body).toBe(200);
    expect(log.json().claimable).toEqual([]);

    assertTypedError(await post('/log/claim', id, { requestId: rid(), page: 30 }), {
      status: 409,
      code: 'not-claimable',
    });
    expect(await ledgerCount(id, 'season_claim')).toBe(0);
  });

  it('refuses premium without gems and charges nothing', async () => {
    const id = await player({ gems: 0 });
    const before = await wallet(id);
    assertTypedError(await post('/log/premium', id, { requestId: rid() }), {
      status: 409,
      code: 'not-enough-gems',
    });
    expect(await wallet(id)).toEqual(before);
  });

  it('goes dark when the flag is off', async () => {
    const id = await player();
    delete process.env.PORT_CITY_BOUNTIES;
    assertTypedError(await get('/bounties', id), { status: 409, code: 'feature-off' });
    assertTypedError(await post('/bounties/claim', id, { requestId: rid(), slot: 0 }), {
      status: 409,
      code: 'feature-off',
    });
  });
});

// ===========================================================================
// 6. Cosmetics
// ===========================================================================

describe('cosmetics', () => {
  it('rejects unknown items and wrong types without a ledger row', async () => {
    const id = await player();
    await setLevels(id, { shipyard: 1, stationery: 1 });
    for (const body of [{ requestId: rid(), itemId: 'no-such-item' }, { requestId: rid(), itemId: 42 }, {}]) {
      assertTypedError(await post('/cosmetics/buy', id, body), { status: 409, code: 'unknown-item' });
    }
    expect(await ledgerCount(id, 'cosmetic_buy')).toBe(0);
  });

  it('refuses a second buy and charges once', async () => {
    const id = await player({ coins: 10_000 });
    await setLevels(id, { shipyard: 1 });
    const before = await wallet(id);

    const first = await post('/cosmetics/buy', id, { requestId: rid(), itemId: 'stamp-anchor' });
    expect(first.statusCode, first.body).toBe(200);
    assertTypedError(await post('/cosmetics/buy', id, { requestId: rid(), itemId: 'stamp-anchor' }), {
      status: 409,
      code: 'already-owned',
    });

    expect(await ledgerCount(id, 'cosmetic_buy')).toBe(1);
    expect(before.coins - (await wallet(id)).coins).toBe(800);
  });

  it('refuses what the wallet and the store level cannot support', async () => {
    const poor = await player({ coins: 0, gems: 0 });
    await setLevels(poor, { shipyard: 1 });
    assertTypedError(await post('/cosmetics/buy', poor, { requestId: rid(), itemId: 'stamp-anchor' }), {
      status: 409,
      code: 'not-enough-coins',
    });
    expect(await ledgerCount(poor, 'cosmetic_buy')).toBe(0);

    const lowLevel = await player({ coins: 10_000 });
    await setLevels(lowLevel, { shipyard: 1 });
    assertTypedError(await post('/cosmetics/buy', lowLevel, { requestId: rid(), itemId: 'stamp-skull' }), {
      status: 409,
      code: 'locked-tier',
    });
  });

  it('rejects equipping anything not owned, unknown or in the wrong slot', async () => {
    const id = await player();
    await setLevels(id, { shipyard: 1 });
    assertTypedError(await post('/cosmetics/equip', id, { requestId: rid(), slot: 'victoryStamp', itemId: 'stamp-anchor' }), {
      status: 409,
      code: 'not-owned',
    });
    assertTypedError(await post('/cosmetics/equip', id, { requestId: rid(), slot: 'victoryStamp', itemId: 'nope' }), {
      status: 409,
      code: 'unknown-item',
    });
    assertTypedError(await post('/cosmetics/equip', id, { requestId: rid(), slot: 'pen', itemId: 'stamp-anchor' }), {
      status: 409,
      code: 'bad-slot',
    });
    assertTypedError(await post('/cosmetics/equip', id, { requestId: rid(), slot: 'hat', itemId: 'stamp-anchor' }), {
      status: 409,
      code: 'bad-slot',
    });
    assertTypedError(await post('/cosmetics/equip', id, {}), { status: 409, code: 'bad-slot' });

    expect((await post('/cosmetics/buy', id, { requestId: rid(), itemId: 'stamp-anchor' })).statusCode).toBe(200);
    const equipped = await post('/cosmetics/equip', id, {
      requestId: rid(),
      slot: 'victoryStamp',
      itemId: 'stamp-anchor',
    });
    expect(equipped.statusCode, equipped.body).toBe(200);
    expect(equipped.json().equipped.victoryStamp).toBe('stamp-anchor');
  });

  it('goes dark when the flag is off', async () => {
    const id = await player();
    delete process.env.PORT_CITY_COSMETICS;
    assertTypedError(await get('/cosmetics', id), { status: 409, code: 'feature-off' });
    assertTypedError(await post('/cosmetics/buy', id, { requestId: rid(), itemId: 'stamp-anchor' }), {
      status: 409,
      code: 'feature-off',
    });
  });
});

// ===========================================================================
// 7. Fleets, wars and visits
// ===========================================================================

describe('fleets', () => {
  const createBody = (overrides: Record<string, unknown> = {}) => ({
    requestId: rid(),
    name: 'Krakens',
    description: '',
    emblemBadge: 0,
    emblemTint: 0,
    policy: 'open',
    minRenown: 0,
    ...overrides,
  });

  async function withFleet(): Promise<string> {
    const id = await player();
    const res = await post('/fleet/create', id, createBody());
    expect(res.statusCode, res.body).toBe(200);
    return id;
  }

  it('refuses a fleet the wallet cannot pay for, with no row and no charge', async () => {
    const id = await player({ coins: 0 });
    const before = await wallet(id);
    assertTypedError(await post('/fleet/create', id, createBody()), { status: 409, code: 'insufficient-coins' });
    expect(await t.query(`select 1 from public.fleet`)).toHaveLength(0);
    expect(await wallet(id)).toEqual(before);
  });

  it('refuses a second fleet and a malformed name, keeping one row and one charge', async () => {
    const id = await withFleet();
    const afterFirst = await wallet(id);
    assertTypedError(await post('/fleet/create', id, createBody()), { status: 409, code: 'already-in-a-fleet' });
    assertTypedError(await post('/fleet/create', id, createBody({ name: 'ab' })), { status: 409, code: 'not-found' });
    assertTypedError(await post('/fleet/create', id, createBody({ name: 'x'.repeat(10_000) })), {
      status: 409,
      code: 'not-found',
    });
    assertTypedError(await post('/fleet/create', id, createBody({ minRenown: 1e9 })), {
      status: 409,
      code: 'not-found',
    });
    expect(await t.query(`select 1 from public.fleet`)).toHaveLength(1);
    expect(await wallet(id)).toEqual(afterFirst);
  });

  it('refuses chat from non-members and every message that is not a known phrase or sticker', async () => {
    const stranger = await player();
    assertTypedError(await post('/fleet/chat', stranger, { kind: 'phrase', code: 'g1' }), {
      status: 409,
      code: 'not-in-a-fleet',
    });

    const member = await withFleet();
    assertTypedError(await post('/fleet/chat', member, { kind: 'phrase', code: 'not-a-phrase' }), {
      status: 409,
      code: 'not-allowed',
    });
    assertTypedError(await post('/fleet/chat', member, { kind: 'sticker', code: '99' }), {
      status: 409,
      code: 'not-allowed',
    });
    assertTypedError(await post('/fleet/chat', member, { kind: 'text', code: 'hello' }), {
      status: 409,
      code: 'not-found',
    });
    assertTypedError(await post('/fleet/chat', member, { kind: 'phrase', code: 'x'.repeat(100) }), {
      status: 409,
      code: 'not-found',
    });

    expect((await post('/fleet/chat', member, { kind: 'phrase', code: 'g1' })).statusCode).toBe(200);
    assertTypedError(await post('/fleet/chat', member, { kind: 'phrase', code: 'g1' }), {
      status: 409,
      code: 'rate-limited',
    });
    const stored = await t.query<{ kind: string; code: string }>(`select kind, code from public.fleet_message`);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'phrase', code: 'g1' });
  });

  it('refuses donations from non-members and items a fleetmate cannot use', async () => {
    const stranger = await player();
    assertTypedError(await post('/fleet/donation/request', stranger, { requestId: rid(), item: 'bomber' }), {
      status: 409,
      code: 'not-in-a-fleet',
    });

    const member = await withFleet();
    await setLevels(member, { fleet_hall: 3 });
    assertTypedError(await post('/fleet/donation/request', member, { requestId: rid(), item: 'mine' }), {
      status: 409,
      code: ['on-cooldown', 'not-allowed'],
    });
    assertTypedError(await post('/fleet/donation/request', member, { requestId: rid(), item: 'no-such-weapon' }), {
      status: 409,
      code: ['on-cooldown', 'not-allowed'],
    });

    const requested = await post('/fleet/donation/request', member, { requestId: rid(), item: 'bomber' });
    expect(requested.statusCode, requested.body).toBe(200);
    assertTypedError(await post('/fleet/donation/request', member, { requestId: rid(), item: 'bomber' }), {
      status: 409,
      code: 'on-cooldown',
    });

    const donations = await get('/fleet/donations', member);
    expect(donations.statusCode).toBe(200);
    assertTypedError(
      await post('/fleet/donation/fill', member, { requestId: rid(), donationId: rid() }),
      { status: 409, code: 'not-found' },
    );
  });

  it('refuses wars to non-members and to fleets without an Admiralty 4 hall or a full roster', async () => {
    const stranger = await player();
    await setLevels(stranger, { admiralty: 4 });
    assertTypedError(await post('/war/start', stranger, { requestId: rid(), size: 5 }), {
      status: 409,
      code: 'not-in-a-fleet',
    });
    assertTypedError(await post('/war/opt-in', stranger, { optIn: true }), {
      status: 409,
      code: 'not-in-a-fleet',
    });

    const member = await withFleet();
    assertTypedError(await post('/war/start', member, { requestId: rid(), size: 5 }), {
      status: 409,
      code: 'not-allowed',
    });
    await setLevels(member, { admiralty: 4 });
    assertTypedError(await post('/war/start', member, { requestId: rid(), size: 5 }), {
      status: 409,
      code: 'not-allowed',
    });
    assertTypedError(await post('/war/start', member, { requestId: rid(), size: 7 }), {
      status: 409,
      code: 'not-found',
    });
  });

  it('answers war routes with no-war when the fleet is not fighting', async () => {
    const member = await withFleet();
    assertTypedError(await post('/war/harbour', member, { layout: { ships: [], arsenal: [] } }), {
      status: 409,
      code: 'no-war',
    });
    assertTypedError(
      await post('/war/raid', member, { raidId: rid(), targetUserId: nextId(), stars: 1, destruction: 0.5 }),
      { status: 409, code: 'no-war' },
    );
    assertTypedError(
      await post('/war/raid', member, { raidId: rid(), targetUserId: nextId(), stars: 9, destruction: 0.5 }),
      { status: 409, code: 'not-found' },
    );
    const optIn = await post('/war/opt-in', member, { optIn: true });
    expect(optIn.statusCode).toBe(200);
    expect(optIn.json().optIn).toBe(true);
  });

  it('keeps visits read-only and refuses friendly raids on strangers and yourself', async () => {
    const visitor = await withFleet();
    const target = await player();
    await withStored(target, 'fish_market', 777);

    // Every other `not-found` in the fleet module (donation/fill, war/start,
    // war/raid, below) answers 409 — the module never carves out 404 for a
    // missing row, unlike the city's and the raid's STATUS maps.
    assertTypedError(await get(`/visit/${nextId()}`, visitor), { status: 409, code: 'not-found' });
    const visit = await get(`/visit/${target}`, visitor);
    expect(visit.statusCode, visit.body).toBe(200);
    expect(visit.body).not.toContain('stored');
    expect(visit.body).not.toContain('scrapPile');

    assertTypedError(await get(`/fleet/friendly/${visitor}`, visitor), { status: 409, code: 'not-allowed' });
    assertTypedError(await get(`/fleet/friendly/${target}`, visitor), { status: 409, code: 'not-allowed' });
  });

  it('serves an empty roster and goes dark when the flag is off', async () => {
    const id = await player();
    const roster = await get('/fleet', id);
    expect(roster.statusCode).toBe(200);
    expect(roster.json().fleet).toBeNull();

    delete process.env.PORT_CITY_FLEETS;
    assertTypedError(await get('/fleet', id), { status: 409, code: 'feature-off' });
    assertTypedError(await get('/visit/' + id, id), { status: 409, code: 'feature-off' });
  });
});

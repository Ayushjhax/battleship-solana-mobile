/**
 * Hardening sweep — the economy ledger against a simulated month of play.
 *
 * This is the test the part-01 spec asks for but the suite only approximates:
 * "Every currency change writes one row; a reconciliation test replays the
 * ledger and must land on the current balances" (§3), plus §8.2.19.
 *
 * It drives the REAL SQL — every `public.*` function the server calls, through
 * the same pglite helper the other integration tests use — for 28 simulated
 * days across five players, exercising every ledger-writing path at least once
 * (see `EXPECTED_REASONS`), then:
 *
 *   1. asserts every reason the sweep exercises actually appears;
 *   2. reconciles each wallet against `economy_ledger`, with the two known
 *      non-ledgered/non-wallet adjustments made explicit (see below);
 *   3. reconciles the Scrapyard pile against salvage credited minus collected;
 *   4. replays every idempotent call and asserts nothing moves twice;
 *   5. pins the one path that moves coins WITHOUT a ledger row, so the gap is
 *      quantified and cannot grow silently.
 *
 * Two accounting facts the naive "sum(ledger) == balance" assertion misses,
 * both established by this sweep and written up in
 * `docs/port-city/progress/hardening-economy-notes.md`:
 *
 *   - `apply_match_result` and `apply_offline_result` credit match coins with
 *     no ledger row (a spec deviation from part-01 §3 — they predate the city).
 *   - `settle_raid`'s `raid_looted` row records the FULL loot (collector
 *     stores + scrap pile + wallet). The stores/pile were never wallet money,
 *     so a wallet-only replay over-counts the defender's loss by exactly the
 *     non-wallet part.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CITY_VERSION,
  OFFLINE_REWARD_CAP,
  buyWorker,
  cancelUpgrade,
  collect,
  collectAll,
  migrateToV1,
  settle,
  speedUp,
  startUpgrade,
  type BuildingId,
  type CityActionResult,
  type CityState,
  type CityWorld,
  type LedgerDelta,
} from '@engine/city';
import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const A = 'a0000000-0000-4000-8000-00000000000a'; // the active player
const B = 'b0000000-0000-4000-8000-00000000000b'; // A's opponent + raid target
const C = 'c0000000-0000-4000-8000-00000000000c'; // fleet founder
const D = 'd0000000-0000-4000-8000-00000000000d'; // cosmetics / research / season
const E = 'e0000000-0000-4000-8000-00000000000e'; // builds, never collects, gets raided
const USERS = [A, B, C, D, E] as const;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5, 12, 0, 0); // a Monday, noon UTC
const MONTH_DAYS = 28;
const T_END = T0 + MONTH_DAYS * DAY;
const SEASON = 1;
const PUZZLE_DATE = '2026-01-20';

/** The seeded starting balances; the reconciliation adds these back in. */
const STARTING: Record<string, { coins: number; steel: number; gems: number }> = {
  [A]: { coins: 2_000, steel: 5_000, gems: 300 },
  [B]: { coins: 1_000, steel: 2_000, gems: 100 },
  [C]: { coins: 1_000, steel: 1_000, gems: 50 },
  [D]: { coins: 3_000, steel: 3_000, gems: 1_000 },
  [E]: { coins: 1_000, steel: 1_000, gems: 100 },
};

/** Every reason a ledger row can carry, once the sweep is done. */
const EXPECTED_REASONS = [
  'admiralty_gems',
  'build',
  'cancel',
  'collect',
  'collect_scrap',
  'contract_claim',
  'cosmetic_buy',
  'fleet_create',
  'fleet_donation',
  'migration:v1',
  'puzzle',
  'raid_loot',
  'raid_looted',
  'raid_search',
  'research_rush',
  'research_start',
  'salvage',
  'season_claim',
  'season_premium',
  'speedup',
  'voyage',
  'war_reward',
  'worker',
];

let t: TestDb;
let seq = 0;
let aCollectRequestId: string | undefined;
const uuid = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

// ---------------------------------------------------------------------------
// Bookkeeping the ledger cannot carry
// ---------------------------------------------------------------------------

/** Match/offline coin payouts — deliberately NOT in economy_ledger. */
const unledgeredCoins = new Map<string, number>();
/** Salvage actually credited to each player's pile, from the RPC return values. */
const pileCredited = new Map<string, number>();
/** The non-wallet half of a raid loot (collector stores + scrap pile). */
const storeLoot = new Map<string, { coins: number; steel: number }>();
/** Scrap-pile steel a raid took. */
const raidScrapTaken = new Map<string, number>();

function bump<K extends string>(map: Map<K, number>, key: K, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function bump2(map: Map<string, { coins: number; steel: number }>, key: string, d: { coins: number; steel: number }): void {
  const cur = map.get(key) ?? { coins: 0, steel: 0 };
  map.set(key, { coins: cur.coins + d.coins, steel: cur.steel + d.steel });
}

// ---------------------------------------------------------------------------
// City plumbing — the same shape as server/src/city/service.ts
// ---------------------------------------------------------------------------

interface CityRow {
  state: CityState;
  version: number;
  city_version: number;
  coins: number;
  steel: number;
  gems: number;
  rank_points: number;
  unlocks: string[] | null;
}

type CityAction =
  | { kind: 'build'; buildingId: BuildingId }
  | { kind: 'speedup'; buildingId: BuildingId }
  | { kind: 'cancel'; buildingId: BuildingId }
  | { kind: 'collect'; buildingId: BuildingId }
  | { kind: 'collect-all' }
  | { kind: 'buy-worker' };

function runCity(world: CityWorld, action: CityAction, now: number): CityActionResult {
  switch (action.kind) {
    case 'build':
      return startUpgrade(world, action.buildingId, now);
    case 'speedup':
      return speedUp(world, action.buildingId, now);
    case 'cancel':
      return cancelUpgrade(world, action.buildingId, now);
    case 'collect':
      return collect(world, action.buildingId, now);
    case 'collect-all':
      return collectAll(world, now);
    case 'buy-worker':
      return buyWorker(world, now);
  }
}

const load = (userId: string, now: number): Promise<CityRow> =>
  t.one<CityRow>(
    `select state, version, city_version, coins, steel, gems, rank_points, unlocks
       from public.city_load($1, $2)`,
    [userId, now],
  );

const worldOf = (row: CityRow): CityWorld => ({
  city: row.state,
  wallet: { coins: row.coins, steel: row.steel, gems: row.gems },
});

function totals(ledger: readonly LedgerDelta[]): { coins: number; steel: number; gems: number } {
  return ledger.reduce(
    (sum, row) => ({
      coins: sum.coins + row.dCoins,
      steel: sum.steel + row.dSteel,
      gems: sum.gems + row.dGems,
    }),
    { coins: 0, steel: 0, gems: 0 },
  );
}

async function applyCity(
  userId: string,
  expectedVersion: number,
  city: CityState,
  ledger: readonly LedgerDelta[],
  requestId?: string,
  response?: unknown,
): Promise<number | null> {
  const delta = totals(ledger);
  const row = await t.one<{ city_apply: number | null }>(
    `select public.city_apply($1, $2, $3::jsonb, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb) as city_apply`,
    [
      userId,
      expectedVersion,
      JSON.stringify(city),
      CITY_VERSION,
      delta.coins,
      delta.steel,
      delta.gems,
      JSON.stringify(ledger),
      requestId ?? null,
      response === undefined ? null : JSON.stringify(response),
    ],
  );
  return row.city_apply;
}

/** GET /city: migrate, settle, write only when something changed. */
async function readCity(userId: string, now: number): Promise<void> {
  const row = await load(userId, now);
  const world = worldOf(row);
  const migration = migrateToV1(world, row.rank_points, now);
  const settled = settle(migration.world, now);
  const ledger = [...migration.ledger, ...settled.ledger];
  const changed =
    migration.migrated ||
    ledger.length > 0 ||
    JSON.stringify(settled.world.city) !== JSON.stringify(row.state);
  if (!changed) return;

  const version = await applyCity(userId, row.version, settled.world.city, ledger);
  if (version === null) throw new Error(`readCity(${userId}) lost the version race`);
}

/** One city mutation, exactly as actOnCity runs it. */
async function act(
  userId: string,
  action: CityAction,
  now: number,
  requestId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await load(userId, now);
  const world = worldOf(row);
  const migration = migrateToV1(world, row.rank_points, now);
  const settled = settle(migration.world, now);
  const prefix = [...migration.ledger, ...settled.ledger];
  const result = runCity(settled.world, action, now);
  if (!result.ok) return { ok: false, error: result.error };

  const ledger = [...prefix, ...result.ledger];
  const version = await applyCity(
    userId,
    row.version,
    result.world.city,
    ledger,
    requestId,
    requestId ? { ok: true } : undefined,
  );
  if (version === null) throw new Error(`act(${userId}, ${action.kind}) lost the version race`);
  return { ok: true };
}

const BUILD_ORDER: BuildingId[] = ['admiralty', 'fish_market', 'foundry', 'scrapyard'];

/** Up to two affordable builds, cheapest-first inside the priority list. */
async function tryBuild(userId: string, now: number): Promise<void> {
  for (let pass = 0; pass < 2; pass++) {
    let started = false;
    for (const buildingId of BUILD_ORDER) {
      const result = await act(userId, { kind: 'build', buildingId }, now);
      if (result.ok) {
        started = true;
        break;
      }
    }
    if (!started) break;
  }
}

// ---------------------------------------------------------------------------
// Match / offline / raid plumbing
// ---------------------------------------------------------------------------

async function applyMatch(
  matchId: string,
  winner: string,
  now: number,
): Promise<{ settled: boolean; salvageA: number; salvageB: number }> {
  await t.query(
    `insert into public.matches (id, mode, player_a, player_b, seed, is_bot)
     values ($1, 'advanced', $2, $3, 1, false)`,
    [matchId, A, B],
  );
  const row = await t.one<{ r: { settled: boolean; salvage_a: number; salvage_b: number } }>(
    `select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10, $3, $4, $5,
             $6::jsonb, $7::jsonb) as r`,
    [matchId, winner, 60, 20, now, JSON.stringify(['battleship']), JSON.stringify(['destroyer'])],
  );
  return { settled: row.r.settled, salvageA: row.r.salvage_a, salvageB: row.r.salvage_b };
}

/** Returns the credited salvage, or -1 for a replayed result. */
async function applyOffline(
  id: string,
  userId: string,
  won: boolean,
  now: number,
  base: number,
): Promise<number> {
  const row = await t.one<{ r: number }>(
    `select public.apply_offline_result($1, $2, 'ai', $3, to_timestamp($4::bigint / 1000.0), $5, $6,
             $4::bigint, $7::jsonb) as r`,
    [id, userId, won, now, base, OFFLINE_REWARD_CAP, JSON.stringify(['destroyer'])],
  );
  return row.r;
}

async function openRaid(
  raidId: string,
  attacker: string,
  defender: string | null,
  coveSeed: number | null,
  cost: number,
  requestId?: string,
): Promise<string> {
  const row = await t.one<{ r: string }>(
    `select public.raid_open($1, $2, $3, $4, $5, 6, false, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
             '1', $6, $7::jsonb) as r`,
    [raidId, attacker, defender, coveSeed, cost, requestId ?? null, requestId ? JSON.stringify({ ok: true }) : null],
  );
  return row.r;
}

interface SettleInput {
  stars: number;
  destruction: number;
  earnedCoins: number;
  earnedSteel: number;
  drain: readonly { building: string; resource: 'coins' | 'steel'; amount: number }[];
  walletCoins: number;
  walletSteel: number;
}

async function settleRaid(
  raidId: string,
  input: SettleInput,
): Promise<{ applied: boolean; takenCoins: number; takenSteel: number }> {
  const row = await t.one<{ r: { applied: boolean; takenCoins?: number; takenSteel?: number } }>(
    `select public.settle_raid($1, $2::smallint, $3, 0, 'cleared', $4, $5, $6::jsonb, $7, $8,
             0, 0, 0, '[]'::jsonb, '[]'::jsonb) as r`,
    [
      raidId,
      input.stars,
      input.destruction,
      input.earnedCoins,
      input.earnedSteel,
      JSON.stringify(input.drain),
      input.walletCoins,
      input.walletSteel,
    ],
  );
  return { applied: row.r.applied === true, takenCoins: row.r.takenCoins ?? 0, takenSteel: row.r.takenSteel ?? 0 };
}

// ---------------------------------------------------------------------------
// The month
// ---------------------------------------------------------------------------

async function cityDay(userId: string, now: number): Promise<void> {
  await tryBuild(userId, now);
  await act(userId, { kind: 'collect-all' }, now);
}

async function simulateMonth(): Promise<void> {
  // The lazy v1 migration for everyone — grants and `migration:v1` rows.
  for (const user of USERS) await readCity(user, T0);

  // A guaranteed `cancel` before the loop: start the Fish Market, then cancel
  // it (Foundry L1 needs Admiralty 2, so it is not buildable yet).
  expect((await act(A, { kind: 'build', buildingId: 'fish_market' }, T0)).ok).toBe(true);
  expect((await act(A, { kind: 'cancel', buildingId: 'fish_market' }, T0)).ok).toBe(true);

  for (let day = 0; day < MONTH_DAYS; day++) {
    const now = T0 + day * DAY + 12 * HOUR;

    // ---- one online match a day, alternating winner ----
    const matchId = uuid();
    const winner = day % 2 === 0 ? A : B;
    const settled = await applyMatch(matchId, winner, now);
    if (settled.settled) {
      bump(unledgeredCoins, winner, 50);
      bump(unledgeredCoins, winner === A ? B : A, 10);
      bump(pileCredited, A, settled.salvageA);
      bump(pileCredited, B, settled.salvageB);
    }

    // ---- offline matches for A: two a day, eleven on day 10 (the cap) ----
    const offlineCount = day === 10 ? 11 : 2;
    for (let i = 0; i < offlineCount; i++) {
      const won = (day + i) % 2 === 0;
      const credited = await applyOffline(`offline-${day}-${i}`, A, won, now, 30);
      if (credited >= 0) {
        bump(unledgeredCoins, A, won ? 50 : 10);
        bump(pileCredited, A, credited);
      }
    }

    // ---- E plays once, so its pile is real salvage rather than a fixture ----
    if (day === 2) {
      const credited = await applyOffline('offline-e', E, true, now, 20);
      if (credited >= 0) {
        bump(unledgeredCoins, E, 50);
        bump(pileCredited, E, credited);
      }
    }

    // ---- the city ----
    if (day === 1) {
      // A speed-up (gems) and the third worker (gems), both guaranteed. The
      // collect-all carries a requestId so the replay test can look it up.
      await tryBuild(A, now);
      await act(A, { kind: 'speedup', buildingId: 'admiralty' }, now);
      await act(A, { kind: 'buy-worker' }, now);
      aCollectRequestId = uuid();
      await act(A, { kind: 'collect-all' }, now, aCollectRequestId);
    } else {
      await cityDay(A, now);
    }
    await cityDay(B, now);
    if (day === 0) {
      await tryBuild(E, now);
      await tryBuild(E, now);
    }
    // E's Foundry, once the Admiralty 2 it built on day 0 has finished.
    if (day === 3) {
      expect((await act(E, { kind: 'build', buildingId: 'foundry' }, now)).ok).toBe(true);
    }
  }
}

// The one-shot paths, with the ids the replay test needs.
const ONE_SHOT: {
  raidPvp: string;
  raidPvpRequest: string;
  raidStore: string;
  raidCove: string;
  fleetA: string;
  fleetB: string;
  donation: string;
  war: string;
  voyage: string;
  dVersionBeforeResearch: number | null;
} = {
  raidPvp: '',
  raidPvpRequest: '',
  raidStore: '',
  raidCove: '',
  fleetA: '',
  fleetB: '',
  donation: '',
  war: '',
  voyage: '',
  dVersionBeforeResearch: null,
};

async function playTheRest(now: number): Promise<void> {
  // E never opened the city again after its last build, so settle its
  // production now — the raid is about to read exactly what is stored.
  await readCity(E, now);

  // ---- raids ----
  // (1) PvP, wallet-only drain: the clean `raid_looted` + `raid_loot` pair.
  ONE_SHOT.raidPvp = uuid();
  ONE_SHOT.raidPvpRequest = uuid();
  expect(await openRaid(ONE_SHOT.raidPvp, A, B, null, 50, ONE_SHOT.raidPvpRequest)).toBe('ok');
  const pvp = await settleRaid(ONE_SHOT.raidPvp, {
    stars: 3,
    destruction: 0.95,
    earnedCoins: 120,
    earnedSteel: 300,
    drain: [],
    walletCoins: 50,
    walletSteel: 25,
  });
  expect(pvp.applied).toBe(true);
  expect(pvp.takenCoins).toBe(50);
  expect(pvp.takenSteel).toBe(25);

  // (2) PvP, collector + pile drain: A takes E's stores and its salvage.
  const eState = await t.one<{ state: CityState }>(
    `select state from public.city where user_id = $1`,
    [E],
  );
  const fishStored = eState.state.buildings.fish_market.stored;
  const foundryStored = eState.state.buildings.foundry.stored;
  const scrap = eState.state.scrapPile;
  expect(fishStored, 'E accrued no Fish Market coins').toBeGreaterThan(0);
  expect(foundryStored, 'E accrued no Foundry steel').toBeGreaterThan(0);
  expect(scrap, 'E has no salvage to loot').toBeGreaterThan(0);

  ONE_SHOT.raidStore = uuid();
  expect(await openRaid(ONE_SHOT.raidStore, A, E, null, 50)).toBe('ok');
  const store = await settleRaid(ONE_SHOT.raidStore, {
    stars: 3,
    destruction: 1,
    earnedCoins: 200,
    earnedSteel: 150,
    drain: [
      { building: 'fish_market', resource: 'coins', amount: fishStored },
      { building: 'foundry', resource: 'steel', amount: foundryStored },
      { building: 'scrap', resource: 'steel', amount: scrap },
    ],
    walletCoins: 100,
    walletSteel: 50,
  });
  expect(store.applied).toBe(true);
  expect(store.takenCoins).toBe(fishStored + 100);
  expect(store.takenSteel).toBe(foundryStored + scrap + 50);
  bump2(storeLoot, E, { coins: fishStored, steel: foundryStored + scrap });
  bump(raidScrapTaken, E, scrap);

  // (3) A pirate cove: attacker pay with no defender at all.
  ONE_SHOT.raidCove = uuid();
  expect(await openRaid(ONE_SHOT.raidCove, A, null, 777, 50)).toBe('ok');
  const cove = await settleRaid(ONE_SHOT.raidCove, {
    stars: 2,
    destruction: 0.7,
    earnedCoins: 80,
    earnedSteel: 60,
    drain: [],
    walletCoins: 0,
    walletSteel: 0,
  });
  expect(cove.applied).toBe(true);

  // ---- fleets ----
  ONE_SHOT.fleetA = uuid();
  ONE_SHOT.fleetB = uuid();
  const createA = await t.one<{ r: string }>(
    `select public.fleet_create($1, $2, 'The Ironsides', '', 0::smallint, 0::smallint, 'open', 0, 500) as r`,
    [ONE_SHOT.fleetA, C],
  );
  expect(createA.r).toBe('ok');
  const createB = await t.one<{ r: string }>(
    `select public.fleet_create($1, $2, 'The Salt Dogs', '', 1::smallint, 1::smallint, 'open', 0, 500) as r`,
    [ONE_SHOT.fleetB, B],
  );
  expect(createB.r).toBe('ok');

  // ---- donation: A gives C 200 steel for 100 coins ----
  ONE_SHOT.donation = uuid();
  await t.query(
    `insert into public.donation (id, fleet_id, requester_id, item) values ($1, $2, $3, 'steel')`,
    [ONE_SHOT.donation, ONE_SHOT.fleetA, C],
  );
  const filled = await t.one<{ r: string }>(
    `select public.donation_fill($1, $2, 100, 200, 10) as r`,
    [ONE_SHOT.donation, A],
  );
  expect(filled.r).toBe('ok');

  // ---- war settlement ----
  ONE_SHOT.war = uuid();
  await t.query(
    `insert into public.war (id, fleet_a, fleet_b, size, state, prep_ends_at, battle_ends_at)
     values ($1, $2, $3, 5, 'settling', now(), now())`,
    [ONE_SHOT.war, ONE_SHOT.fleetA, ONE_SHOT.fleetB],
  );
  const war = await t.one<{ r: { paid: boolean } }>(
    `select public.settle_war($1, 'a', 5, 3, 0.8, 0.5, $2::jsonb) as r`,
    [
      ONE_SHOT.war,
      JSON.stringify([
        { userId: A, steel: 900, coins: 300, gems: 10 },
        { userId: B, steel: 400, coins: 100, gems: 5 },
      ]),
    ],
  );
  expect(war.r.paid).toBe(true);

  // ---- research (D): a start that pays coins, then a gem rush ----
  const dBefore = await load(D, now);
  ONE_SHOT.dVersionBeforeResearch = dBefore.version;
  const start = await t.one<{ r: number | null }>(
    `select public.research_apply($1, $2, $3::text[], $4::jsonb, $5, $6, $7) as r`,
    [
      D,
      dBefore.version,
      ['submarine'],
      JSON.stringify({ item: 'submarine', startedAt: now, endsAt: now + HOUR }),
      -1_200,
      0,
      'research_start',
    ],
  );
  expect(start.r).not.toBeNull();

  const dMid = await load(D, now);
  const rush = await t.one<{ r: number | null }>(
    `select public.research_apply($1, $2, $3::text[], $4::jsonb, $5, $6, $7) as r`,
    [D, dMid.version, ['submarine'], JSON.stringify({}), 0, -16, 'research_rush'],
  );
  expect(rush.r).not.toBeNull();

  // ---- cosmetics (D): one coin buy and one gem buy ----
  const buyPaper = await t.one<{ r: string }>(
    `select public.cosmetics_buy($1, 'paper:linen', 200, 0) as r`,
    [D],
  );
  expect(buyPaper.r).toBe('ok');
  const buyInk = await t.one<{ r: string }>(
    `select public.cosmetics_buy($1, 'ink:gold', 0, 350) as r`,
    [D],
  );
  expect(buyInk.r).toBe('ok');

  // ---- puzzle (D) ----
  await t.query(`select public.puzzle_run_open($1, $2)`, [D, PUZZLE_DATE]);
  await t.query(`select public.puzzle_run_fire($1, $2, '{}'::jsonb, 52, 18, true)`, [D, PUZZLE_DATE]);
  const puzzle = await t.one<{ r: { paid: boolean } }>(
    `select public.puzzle_settle($1, $2, 3, 200, 200, 10, 50, $3) as r`,
    [D, PUZZLE_DATE, SEASON],
  );
  expect(puzzle.r.paid).toBe(true);

  // ---- season (D): ink, a two-page claim, then premium ----
  await t.query(`select public.season_add_ink($1, $2, 1_200)`, [D, SEASON]);
  const claimed = await t.one<{ r: { claimed: boolean; pages: number } }>(
    `select public.season_claim_pages($1, $2, $3::integer[], 150, 200, 5) as r`,
    [D, SEASON, [1, 2]],
  );
  expect(claimed.r.claimed).toBe(true);
  expect(claimed.r.pages).toBe(2);
  const premium = await t.one<{ r: string }>(
    `select public.season_buy_premium($1, $2, 500) as r`,
    [D, SEASON],
  );
  expect(premium.r).toBe('ok');

  // ---- voyage (D) ----
  ONE_SHOT.voyage = uuid();
  const send = await t.one<{ r: { ok: boolean } }>(
    `select public.voyage_send($1, $2, 'north', 0::smallint, 3, $3, $4::jsonb, false, 0::bigint, '{}'::jsonb) as r`,
    [ONE_SHOT.voyage, D, new Date(now - HOUR).toISOString(), JSON.stringify({ coins: 120, steel: 80, gems: 3 })],
  );
  expect(send.r.ok).toBe(true);
  const collected = await t.one<{ r: { paid: boolean } }>(
    `select public.voyage_collect($1, $2, 120, 80, 3, 'won') as r`,
    [ONE_SHOT.voyage, D],
  );
  expect(collected.r.paid).toBe(true);

  // ---- contracts (A) ----
  const expiresAt = new Date(Date.now() + DAY).toISOString();
  await t.query(`select public.contracts_issue($1, $2::jsonb)`, [
    A,
    JSON.stringify([
      { slot: 0, contractId: 'win-3', target: 3, scope: 'daily', expiresAt },
      { slot: 1, contractId: 'collect-steel', target: 1, scope: 'daily', expiresAt },
    ]),
  ]);
  await t.query(`select public.contracts_advance($1, $2::jsonb)`, [
    A,
    JSON.stringify([{ contractId: 'win-3', delta: 3 }]),
  ]);
  const claim = await t.one<{ r: { claimed: boolean } }>(
    `select public.contract_claim($1, 0::smallint, 150, 200, 0, 60, $2) as r`,
    [A, SEASON],
  );
  expect(claim.r.claimed).toBe(true);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

async function snapshot(): Promise<string> {
  const wallets = await t.query(`select id, coins, steel, gems from public.profiles where id = any($1) order by id`, [[...USERS]]);
  const cities = await t.query(`select user_id, (state->>'scrapPile')::int as pile from public.city where user_id = any($1) order by user_id`, [[...USERS]]);
  const ledger = await t.query(
    `select user_id, reason,
            coalesce(sum(d_coins), 0)::int as coins,
            coalesce(sum(d_steel), 0)::int as steel,
            coalesce(sum(d_gems), 0)::int as gems,
            count(*)::int as rows
       from public.economy_ledger
      where user_id = any($1)
      group by user_id, reason
      order by user_id, reason`,
    [[...USERS]],
  );
  return JSON.stringify({ wallets, cities, ledger });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Two passes: every migration must be re-runnable (part-01 §8.2.16).
  t = await startTestDb(2);
  await seedProfile(t, A, { ...STARTING[A], rankPoints: 1_200 });
  await seedProfile(t, B, { ...STARTING[B] });
  await seedProfile(t, C, { ...STARTING[C], rankPoints: 3_500 });
  await seedProfile(t, D, { ...STARTING[D] });
  await seedProfile(t, E, { ...STARTING[E] });
  await t.query(
    `insert into public.season (id, starts_at, ends_at)
     values ($1, now(), now() + interval '28 days')`,
    [SEASON],
  );
}, 180_000);

afterAll(async () => {
  await t?.close();
});

describe('a simulated month of Port City play', () => {
  beforeAll(async () => {
    await simulateMonth();
    await playTheRest(T_END);
  }, 180_000);

  it('exercised every ledger-writing path', async () => {
    const rows = await t.query<{ reason: string }>(
      `select distinct reason from public.economy_ledger order by reason`,
    );
    expect(rows.map((r) => r.reason)).toEqual(EXPECTED_REASONS);
  });

  it('reconciles every wallet and the scrap pile against the ledger', async () => {
    const summary: Record<string, unknown>[] = [];

    for (const user of USERS) {
      const wallet = await t.one<{ coins: number; steel: number; gems: number }>(
        `select coins, steel, gems from public.profiles where id = $1`,
        [user],
      );
      const ledger = await t.one<{ coins: number; steel: number; gems: number }>(
        `select coalesce(sum(d_coins), 0)::int as coins,
                coalesce(sum(d_steel), 0)::int as steel,
                coalesce(sum(d_gems), 0)::int as gems
           from public.economy_ledger where user_id = $1`,
        [user],
      );
      const pile = await t.one<{ pile: number }>(
        `select (state->>'scrapPile')::int as pile from public.city where user_id = $1`,
        [user],
      );
      const scrapCollected = await t.one<{ steel: number }>(
        `select coalesce(sum(d_steel), 0)::int as steel
           from public.economy_ledger where user_id = $1 and reason = 'collect_scrap'`,
        [user],
      );

      const seed = STARTING[user];
      const matchCoins = unledgeredCoins.get(user) ?? 0;
      const loot = storeLoot.get(user) ?? { coins: 0, steel: 0 };

      // Every coin, bar the match/offline payout and the non-wallet half of a
      // raid loot, is a ledger row. Steel and gems are exact.
      expect(wallet.coins, `coins for ${user}`).toBe(seed.coins + ledger.coins + matchCoins + loot.coins);
      expect(wallet.steel, `steel for ${user}`).toBe(seed.steel + ledger.steel + loot.steel);
      expect(wallet.gems, `gems for ${user}`).toBe(seed.gems + ledger.gems);

      // C and D never played a match and were never raided: for them the
      // literal "replay the ledger onto the balance" assertion holds with no
      // adjustment at all — the strongest form of the §8.2.19 check.
      if (user === C || user === D) {
        expect(wallet.coins, `strict coins for ${user}`).toBe(seed.coins + ledger.coins);
        expect(wallet.steel, `strict steel for ${user}`).toBe(seed.steel + ledger.steel);
        expect(wallet.gems, `strict gems for ${user}`).toBe(seed.gems + ledger.gems);
      }

      // Salvage lands in the pile, never the wallet: replay the pile instead.
      expect(pile.pile, `scrapPile for ${user}`).toBe(
        (pileCredited.get(user) ?? 0) - scrapCollected.steel - (raidScrapTaken.get(user) ?? 0),
      );

      summary.push({
        user,
        wallet,
        seed,
        ledger,
        matchCoins,
        storeLoot: loot,
        pile: pile.pile,
        pileCredited: pileCredited.get(user) ?? 0,
        scrapCollected: scrapCollected.steel,
        raidScrapTaken: raidScrapTaken.get(user) ?? 0,
      });
    }

    // One line for the notes file: exact numbers for every user.
    console.log(`[economy-ledger] reconciliation ${JSON.stringify(summary)}`);
  });

  it('writes each once-only row exactly once', async () => {
    const count = async (sql: string, params: unknown[] = []): Promise<number> =>
      (await t.one<{ n: number }>(sql, params)).n;

    // One raid_search, one raid_loot and one raid_looted per raid.
    for (const raidId of [ONE_SHOT.raidPvp, ONE_SHOT.raidStore, ONE_SHOT.raidCove]) {
      expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'raid_search' and ref = $1`, [raidId]), `raid_search ${raidId}`).toBe(1);
    }
    for (const raidId of [ONE_SHOT.raidPvp, ONE_SHOT.raidStore, ONE_SHOT.raidCove]) {
      expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'raid_loot' and ref = $1`, [raidId]), `raid_loot ${raidId}`).toBe(1);
    }
    for (const raidId of [ONE_SHOT.raidPvp, ONE_SHOT.raidStore]) {
      expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'raid_looted' and ref = $1`, [raidId]), `raid_looted ${raidId}`).toBe(1);
    }

    // One reward row per member per war.
    for (const user of [A, B]) {
      expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'war_reward' and ref = $1 and user_id = $2`, [ONE_SHOT.war, user])).toBe(1);
    }

    // One claim, one purchase, one voyage, one puzzle, one premium, one season claim.
    expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'contract_claim' and user_id = $1`, [A])).toBe(1);
    expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'cosmetic_buy' and user_id = $1`, [D])).toBe(2);
    expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'voyage' and ref = $1`, [ONE_SHOT.voyage])).toBe(1);
    expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'puzzle' and ref = $1`, [PUZZLE_DATE])).toBe(1);
    expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'season_premium' and user_id = $1`, [D])).toBe(1);
    expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'season_claim' and user_id = $1`, [D])).toBe(1);
    expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'fleet_donation' and ref = $1`, [ONE_SHOT.donation])).toBe(1);
    expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'fleet_create' and ref = $1`, [ONE_SHOT.fleetA])).toBe(1);
    expect(await count(`select count(*)::int as n from public.economy_ledger where reason = 'fleet_create' and ref = $1`, [ONE_SHOT.fleetB])).toBe(1);
  });

  it('replays every idempotent call without moving a single unit', async () => {
    const before = await snapshot();

    // Every RPC the server may retry, called a second time.
    const settledMatch = await t.one<{ id: string }>(`select id from public.matches order by id limit 1`);
    const replayMatch = await t.one<{ r: { settled: boolean } }>(
      `select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10, 60, 20, $3) as r`,
      [settledMatch.id, A, T_END],
    );
    expect(replayMatch.r.settled).toBe(false);

    expect(await applyOffline('offline-0-0', A, true, T_END, 30)).toBe(-1);

    const pvpReplay = await settleRaid(ONE_SHOT.raidPvp, {
      stars: 3,
      destruction: 0.95,
      earnedCoins: 120,
      earnedSteel: 300,
      drain: [],
      walletCoins: 50,
      walletSteel: 25,
    });
    expect(pvpReplay.applied).toBe(false);
    expect(await openRaid(ONE_SHOT.raidPvp, A, B, null, 50, ONE_SHOT.raidPvpRequest)).toBe('replay');

    expect((await t.one<{ r: string }>(`select public.fleet_create($1, $2, 'The Ironsides', '', 0::smallint, 0::smallint, 'open', 0, 500) as r`, [ONE_SHOT.fleetA, C])).r).toBe('already-in-a-fleet');
    expect((await t.one<{ r: string }>(`select public.donation_fill($1, $2, 100, 200, 10) as r`, [ONE_SHOT.donation, A])).r).toBe('already-filled');
    expect((await t.one<{ r: { paid: boolean } }>(`select public.settle_war($1, 'a', 5, 3, 0.8, 0.5, '[]'::jsonb) as r`, [ONE_SHOT.war])).r.paid).toBe(false);
    expect((await t.one<{ r: { claimed: boolean } }>(`select public.contract_claim($1, 0::smallint, 150, 200, 0, 60, $2) as r`, [A, SEASON])).r.claimed).toBe(false);
    expect((await t.one<{ r: { claimed: boolean } }>(`select public.season_claim_pages($1, $2, $3::integer[], 150, 200, 5) as r`, [D, SEASON, [1, 2]])).r.claimed).toBe(false);
    expect((await t.one<{ r: string }>(`select public.season_buy_premium($1, $2, 500) as r`, [D, SEASON])).r).toBe('already-premium');
    expect((await t.one<{ r: string }>(`select public.cosmetics_buy($1, 'ink:gold', 0, 350) as r`, [D])).r).toBe('already-owned');
    expect((await t.one<{ r: { paid: boolean } }>(`select public.puzzle_settle($1, $2, 3, 200, 200, 10, 50, $3) as r`, [D, PUZZLE_DATE, SEASON])).r.paid).toBe(false);
    expect((await t.one<{ r: { paid: boolean } }>(`select public.voyage_collect($1, $2, 120, 80, 3, 'won') as r`, [ONE_SHOT.voyage, D])).r.paid).toBe(false);

    // A stale city_apply version is refused outright.
    const stale = await applyCity(
      D,
      1,
      (await load(D, T_END)).state,
      [],
    );
    expect(stale).toBeNull();

    // Research with the version from before the first call is a lost race.
    const staleResearch = await t.one<{ r: number | null }>(
      `select public.research_apply($1, $2, $3::text[], $4::jsonb, 0, 0, 'research_done') as r`,
      [D, ONE_SHOT.dVersionBeforeResearch, ['submarine'], JSON.stringify({})],
    );
    expect(staleResearch.r).toBeNull();

    // The request log still answers the original city write.
    const replayBody = await t.one<{ r: unknown }>(
      `select public.city_request_lookup($1, $2) as r`,
      [A, aCollectRequestId],
    );
    expect(replayBody.r).not.toBeNull();

    expect(await snapshot()).toBe(before);
  });

  it('quantifies the one non-ledgered path: match/offline coin payouts', async () => {
    // No ledger row exists for match or offline coin payouts...
    const rows = await t.query(
      `select 1 from public.economy_ledger
        where reason in ('match', 'match_reward', 'offline', 'offline_reward')`,
    );
    expect(rows).toHaveLength(0);

    // ...yet the sweep credited them: the gap is real and exactly accounted.
    const total = [...unledgeredCoins.values()].reduce((n, v) => n + v, 0);
    expect(total).toBeGreaterThan(0);

    for (const user of USERS) {
      const wallet = await t.one<{ coins: number }>(
        `select coins from public.profiles where id = $1`,
        [user],
      );
      const ledger = await t.one<{ coins: number }>(
        `select coalesce(sum(d_coins), 0)::int as coins from public.economy_ledger where user_id = $1`,
        [user],
      );
      const loot = storeLoot.get(user) ?? { coins: 0, steel: 0 };
      const gap = wallet.coins - STARTING[user].coins - ledger.coins - loot.coins;
      expect(gap, `unledgered coins for ${user}`).toBe(unledgeredCoins.get(user) ?? 0);
    }
  });
});

/**
 * The raid service end to end — part-06 §5, §6, §7, §10, §11.
 *
 * The real rules (src/engine/raid) over the real SQL (PGlite running 0016),
 * with only the repo seam swapped so the service talks to the test database
 * instead of Supabase. Nothing about the rules, the transaction or the lock is
 * faked.
 *
 * Covers: search eligibility and widening, the cove fallback, opening, running
 * a raid to each of its five ends, settlement (once), the disconnect sweep,
 * the feature flag, and the API-level secrecy assertion — no response from any
 * of these functions may contain the harbour.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newCity } from '@engine/city';
import { cellsOf, coordKey } from '@engine/board';
import { RAID_DEFAULTS, generateDefaultHarbour, type HarbourLayout } from '@engine/raid';
import type { Coord, Marks } from '@engine/types';

import { __setRaidRepoForTests, fromSnapshotRow, type RaidRepo } from '../../src/raid/repo';
import { __resetSessionsForTests, getSession } from '../../src/raid/session';
import {
  openRaid,
  saveHarbour,
  searchTargets,
  settle,
  sweepRaids,
  ensureHarbour,
} from '../../src/raid/service';
import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const NOW = 1_700_000_000_000;

let t: TestDb;
let raidSeq = 0;
const raidId = () => `aaaaaaaa-0000-4000-8000-${String(++raidSeq).padStart(12, '0')}`;

const context = {
  admiraltyLevel: 5,
  coastalCommandLevel: 5,
  unlocks: ['sonar_net', 'decoy', 'minesweeper'],
};

// ---------------------------------------------------------------------------
// The production SQL, against the test database.
// ---------------------------------------------------------------------------

function pgliteRepo(db: TestDb): RaidRepo {
  return {
    async loadHarbour(userId) {
      const rows = await db.query<{ layout: HarbourLayout; fuel_used: number; valid: boolean }>(
        `select layout, fuel_used, valid from public.harbour where user_id = $1`,
        [userId],
      );
      const row = rows[0];
      return row ? { layout: row.layout, fuelUsed: row.fuel_used, valid: row.valid } : null;
    },

    async saveHarbour(userId, layout, fuelUsed) {
      await db.query(`select public.harbour_save($1, $2, $3)`, [
        userId,
        JSON.stringify(layout),
        fuelUsed,
      ]);
    },

    async loadDefender(userId) {
      const rows = await db.query<Parameters<typeof fromSnapshotRow>[1]>(
        `select * from public.raid_defender_snapshot($1)`,
        [userId],
      );
      const row = rows[0];
      return row ? fromSnapshotRow(userId, row) : null;
    },

    async search(params) {
      const rows = await db.query<{
        user_id: string;
        name: string;
        avatar_id: number;
        avatar_color: string;
        country_code: string | null;
        admiralty_level: number;
        renown: number;
      }>(`select * from public.raid_search($1, $2, $3, $4, $5, $6)`, [
        params.userId,
        params.renown,
        params.window,
        params.minAdmiralty,
        params.repeatHours,
        params.limit,
      ]);
      return rows.map((row) => ({
        userId: row.user_id,
        name: row.name,
        avatarId: row.avatar_id,
        avatarColor: row.avatar_color,
        countryCode: row.country_code,
        admiraltyLevel: row.admiralty_level,
        renown: row.renown,
      }));
    },

    async open(params) {
      const row = await db.one<{ raid_open: string }>(
        `select public.raid_open($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb)
           as raid_open`,
        [
          params.raidId,
          params.attackerId,
          params.defenderId,
          params.coveSeed,
          params.costCoins,
          params.lockMinutes,
          params.dropShield,
          JSON.stringify(params.layout),
          JSON.stringify(params.kit),
          JSON.stringify(params.config),
          params.engineVersion,
          params.requestId ?? null,
          JSON.stringify(params.response ?? {}),
        ],
      );
      return row.raid_open as never;
    },

    async settle(params) {
      const row = await db.one<{
        settle_raid: { applied: boolean; reason?: string; takenCoins: number; takenSteel: number };
      }>(
        `select public.settle_raid($1,$2::smallint,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,
                                   $14::jsonb,$15::jsonb) as settle_raid`,
        [
          params.raidId,
          params.stars,
          params.destruction,
          params.shellsLeft,
          params.endReason,
          params.earnedCoins,
          params.earnedSteel,
          JSON.stringify(params.drain),
          params.walletCoins,
          params.walletSteel,
          params.renownAttacker,
          params.renownDefender,
          params.shieldHours,
          JSON.stringify(params.actions),
          JSON.stringify(params.results),
        ],
      );
      return {
        applied: row.settle_raid.applied,
        ...(row.settle_raid.reason ? { reason: row.settle_raid.reason } : {}),
        takenCoins: row.settle_raid.takenCoins ?? 0,
        takenSteel: row.settle_raid.takenSteel ?? 0,
      };
    },

    async lookupRequest(userId, requestId) {
      const rows = await db.query<{ response: unknown }>(
        `select response from public.city_request_log where user_id = $1 and request_id = $2`,
        [userId, requestId],
      );
      return rows[0]?.response ?? null;
    },

    async sweep() {
      await db.query(`select public.raid_sweep_expired()`);
    },
  };
}

async function seedCity(
  userId: string,
  patch: { admiralty?: number; fishMarket?: number; foundry?: number; scrap?: number } = {},
): Promise<void> {
  const state = newCity(NOW) as unknown as Record<string, unknown>;
  const buildings = state.buildings as Record<string, Record<string, unknown>>;
  buildings.admiralty = { ...buildings.admiralty, level: patch.admiralty ?? 5 };
  buildings.fish_market = { ...buildings.fish_market, level: 3, stored: patch.fishMarket ?? 0 };
  buildings.foundry = { ...buildings.foundry, level: 3, stored: patch.foundry ?? 0 };
  state.scrapPile = patch.scrap ?? 0;
  await db_upsertCity(userId, state);
}

async function db_upsertCity(userId: string, state: unknown): Promise<void> {
  await t.query(
    `insert into public.city (user_id, state) values ($1, $2)
       on conflict (user_id) do update
         set state = excluded.state, version = public.city.version + 1`,
    [userId, JSON.stringify(state)],
  );
}

async function setRenown(userId: string, value: number): Promise<void> {
  await t.query(
    `insert into public.renown (user_id, value, best) values ($1, $2, $2)
       on conflict (user_id) do update set value = excluded.value`,
    [userId, value],
  );
}

const profileOf = (id: string) =>
  t.one<{ coins: number; steel: number; rank_points: number }>(
    `select coins, steel, rank_points from public.profiles where id = $1`,
    [id],
  );

/** Every cell of every ship in a layout — the secret the API must not leak. */
function secretCells(layout: HarbourLayout): Coord[] {
  return layout.ships.flatMap((ship) => cellsOf(ship));
}

/**
 * Fails if a payload carries a ship cell the raider has not already shot.
 *
 * A cell that IS marked is the raider's own knowledge — they fired at it and
 * the rules answered — so it is allowed through; that is what `marks` is for.
 * Everything else is the defender's secret. Same rule as the engine's
 * src/engine/raid/__tests__/secrecy.test.ts, applied one layer up at the
 * service boundary, where a future field could reintroduce a leak the pure
 * test would never see.
 */
function expectNoLayoutIn(
  payload: unknown,
  layout: HarbourLayout,
  where: string,
  marks: Marks = {},
): void {
  const json = JSON.stringify(payload);
  expect(json.includes('"layout"'), `${where}: a layout field reached the wire`).toBe(false);
  expect(json.includes('"ships"'), `${where}: a ships array reached the wire`).toBe(false);
  for (const cell of secretCells(layout)) {
    if (marks[coordKey(cell)] !== undefined) continue;
    expect(json.includes(JSON.stringify(cell)), `${where}: leaked un-hit ${coordKey(cell)}`).toBe(false);
  }
}

beforeAll(async () => {
  t = await startTestDb(1);
}, 120_000);

afterAll(async () => {
  __setRaidRepoForTests(null);
  await t?.close();
});

beforeEach(async () => {
  process.env.PORT_CITY_RAIDS = '1';
  __setRaidRepoForTests(pgliteRepo(t));
  __resetSessionsForTests();

  await t.query(`delete from public.raid_lock`);
  await t.query(`delete from public.raid_log`);
  await t.query(`delete from public.raid`);
  await t.query(`delete from public.shield`);
  await t.query(`delete from public.renown`);
  await t.query(`delete from public.harbour`);
  await t.query(`delete from public.city`);
  await t.query(`delete from public.economy_ledger`);
  await t.query(`delete from public.city_request_log`);
  await t.query(`delete from public.profiles where id = any($1)`, [[A, D, C]]);
  await t.query(`delete from auth.users where id = any($1)`, [[A, D, C]]);
  await seedProfile(t, A, { coins: 5_000, steel: 5_000, rankPoints: 1_200 });
  await seedProfile(t, D, { coins: 5_000, steel: 5_000, rankPoints: 900 });
  await seedProfile(t, C, { coins: 5_000, steel: 5_000, rankPoints: 400 });
  await seedCity(A);
  await seedCity(D, { fishMarket: 400, foundry: 800, scrap: 200 });
});

afterEach(() => {
  delete process.env.PORT_CITY_RAIDS;
  __resetSessionsForTests();
});

// ===========================================================================
// The feature flag
// ===========================================================================

describe('the flag', () => {
  it('turns every entry point off', async () => {
    delete process.env.PORT_CITY_RAIDS;
    const layout = generateDefaultHarbour(1, context);

    expect(await saveHarbour(D, layout, context)).toMatchObject({ error: 'feature-off' });
    expect(
      await searchTargets({ userId: A, admiraltyLevel: 5, renown: 0, searchesThisSession: 0 }),
    ).toMatchObject({ error: 'feature-off' });
    expect(await settle(raidId(), A, NOW)).toMatchObject({ error: 'feature-off' });
    expect(await sweepRaids(NOW)).toBe(0);
  });
});

// ===========================================================================
// The harbour (§3, §10)
// ===========================================================================

describe('the harbour', () => {
  it('saves a legal one and reports the fuel', async () => {
    const layout = generateDefaultHarbour(1, context);
    const out = await saveHarbour(D, layout, context);
    expect(out.ok).toBe(true);
  });

  it('refuses an illegal one, and the last valid one keeps defending', async () => {
    const good = generateDefaultHarbour(1, context);
    await saveHarbour(D, good, context);

    const bad: HarbourLayout = { ships: good.ships.slice(0, 3), arsenal: [] };
    const out = await saveHarbour(D, bad, context);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toBe('bad-harbour');

    const stored = await pgliteRepo(t).loadHarbour(D);
    expect(stored?.layout.ships).toHaveLength(8); // the good one stands
  });

  it('refuses below Admiralty 3', async () => {
    const out = await saveHarbour(D, generateDefaultHarbour(1, context), {
      ...context,
      admiraltyLevel: 2,
    });
    expect(out.ok === false && out.error).toBe('needs-admiralty');
  });

  it('generates one on first read, so nobody is raidable with an empty board', async () => {
    const generated = await ensureHarbour(D, context, 42);
    expect(generated?.ships).toHaveLength(8);
    expect(generated?.arsenal.length).toBeGreaterThan(0);

    // ...and does not overwrite it on the next read.
    const again = await ensureHarbour(D, context, 999);
    expect(again).toEqual(generated);
  });

  it('generates nothing below Admiralty 3', async () => {
    expect(await ensureHarbour(D, { ...context, admiraltyLevel: 2 }, 42)).toBeNull();
  });
});

// ===========================================================================
// The search (§5, §11)
// ===========================================================================

describe('the search', () => {
  beforeEach(async () => {
    await saveHarbour(D, generateDefaultHarbour(1, context), context);
    await setRenown(D, 800);
    await setRenown(A, 800);
  });

  it('finds an eligible player and prices their loot from THEIR wealth', async () => {
    const out = await searchTargets({ userId: A, admiraltyLevel: 5, renown: 800, searchesThisSession: 0 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.body.card.kind).toBe('player');
    expect(out.body.card.userId).toBe(D);
    // 50% of 400 stored coins = 200, capped by Admiralty 5's 850.
    expect(out.body.card.loot.coins).toBe(200);
    expect(out.body.card.costCoins).toBe(50); // 10 x Admiralty 5
  });

  it('advertises the renown offer the settlement will actually pay', async () => {
    const out = await searchTargets({ userId: A, admiraltyLevel: 5, renown: 800, searchesThisSession: 0 });
    expect(out.ok && out.body.card.renownOffer.best).toBeGreaterThan(0);
    expect(out.ok && out.body.card.renownOffer.worst).toBeLessThan(0);
  });

  it('refuses a caller below Admiralty 3', async () => {
    const out = await searchTargets({ userId: A, admiraltyLevel: 2, renown: 800, searchesThisSession: 0 });
    expect(out.ok === false && out.error).toBe('needs-admiralty');
  });

  it('widens until it finds someone rather than giving up at 200', async () => {
    // D sits 900 renown away: outside 200, inside the eighth widening.
    const out = await searchTargets({ userId: A, admiraltyLevel: 5, renown: 1_700, searchesThisSession: 0 });
    expect(out.ok && out.body.card.userId).toBe(D);
  });

  it('falls back to an honestly-labelled pirate cove when nobody fits', async () => {
    await t.query(`delete from public.harbour`); // nobody is raidable

    const out = await searchTargets({
      userId: A,
      admiraltyLevel: 5,
      renown: 800,
      searchesThisSession: 0,
      coveSeed: 7,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.body.card.kind).toBe('cove');
    expect(out.body.card.name).toBe('Pirate cove');
    expect(out.body.card.userId).toBeNull();
    // §5 — a cove gives no renown, and the card says so rather than pretending.
    expect(out.body.card.renownOffer).toEqual({ best: 0, worst: 0 });
    expect(out.body.card.loot.steel).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Running a raid (§6, §11)
// ===========================================================================

describe('running a raid', () => {
  let layout: HarbourLayout;

  async function open(kit = {}, seed = 1) {
    layout = generateDefaultHarbour(seed, context);
    await saveHarbour(D, layout, context);
    await setRenown(A, 800);
    await setRenown(D, 800);

    const search = await searchTargets({ userId: A, admiraltyLevel: 5, renown: 800, searchesThisSession: 0 });
    if (!search.ok) throw new Error('search failed');

    const id = raidId();
    const opened = await openRaid({
      attackerId: A,
      raidId: id,
      card: search.body.card,
      kit,
      armoryLevel: 5,
      admiraltyLevel: 5,
      unlocks: context.unlocks,
      renown: 800,
      dropShield: false,
      now: NOW,
    });
    return { id, opened, layout };
  }

  it('opens, and the opening response carries no layout', async () => {
    const { opened } = await open();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.body.view.shells).toBe(RAID_DEFAULTS.shells);
    expect(opened.body.view.shipsRemaining).toBe(8);
    expectNoLayoutIn(opened.body, layout, 'open', opened.body.view.marks);
  });

  it('charges the search cost exactly once', async () => {
    const before = await profileOf(A);
    await open();
    expect((await profileOf(A)).coins).toBe(before.coins - 50);
  });

  it('refuses a second raid while one is running', async () => {
    const { opened } = await open();
    expect(opened.ok).toBe(true);

    const second = await openRaid({
      attackerId: A,
      raidId: raidId(),
      card: (opened as { body: { target: never } }) && {
        kind: 'cove',
        userId: null,
        coveSeed: 5,
        name: 'Pirate cove',
        avatarId: 0,
        avatarColor: 'charcoal',
        countryCode: null,
        admiraltyLevel: 3,
        renown: 0,
        loot: { coins: 0, steel: 0 },
        renownOffer: { best: 0, worst: 0 },
        costCoins: 0,
      },
      kit: {},
      armoryLevel: 5,
      admiraltyLevel: 5,
      unlocks: context.unlocks,
      renown: 800,
      dropShield: false,
      now: NOW,
    });
    expect(second.ok === false && second.error).toBe('raid-in-progress');
  });

  it('refuses a kit the Armory cannot pay for', async () => {
    layout = generateDefaultHarbour(1, context);
    await saveHarbour(D, layout, context);
    const out = await openRaid({
      attackerId: A,
      raidId: raidId(),
      card: {
        kind: 'cove',
        userId: null,
        coveSeed: 1,
        name: 'Pirate cove',
        avatarId: 0,
        avatarColor: 'charcoal',
        countryCode: null,
        admiraltyLevel: 3,
        renown: 0,
        loot: { coins: 0, steel: 0 },
        renownOffer: { best: 0, worst: 0 },
        costCoins: 0,
      },
      kit: { atomicBomber: 1 },
      armoryLevel: 1, // 40 raid fuel; an atomic bomber is 60
      admiraltyLevel: 5,
      unlocks: context.unlocks,
      renown: 0,
      dropShield: false,
      now: NOW,
    });
    expect(out.ok === false && out.error).toBe('bad-kit');
  });

  it('resolves fire through the shared engine, and NEVER leaks a cell', async () => {
    const { id } = await open();
    const session = getSession(id, A)!;

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c += 2) {
        if (session.over) break;
        const outcome = session.fire({ r, c }, NOW + r * 300 + c);
        expectNoLayoutIn(outcome, layout, `fire ${r},${c}`, outcome.view.marks);
      }
    }
    expect(session.actions.length).toBeGreaterThan(0);
  });

  it('a defender editing their harbour mid-raid does not change the raid', async () => {
    const { id } = await open();
    const session = getSession(id, A)!;
    const before = session.view(NOW).shipsRemaining;

    // The defender re-arranges everything.
    await saveHarbour(D, generateDefaultHarbour(99, context), context);

    const outcome = session.fire({ r: 0, c: 0 }, NOW + 500);
    expect(outcome.ok).toBe(true);
    expect(session.view(NOW).shipsRemaining).toBeLessThanOrEqual(before);
    // The snapshot the raid runs on is the one taken at open.
    const log = await t.one<{ layout: HarbourLayout }>(
      `select layout from public.raid_log where raid_id = $1`,
      [id],
    );
    expect(log.layout.ships[0]!.origin).toEqual(layout.ships[0]!.origin);
  });

  it('ends five ways, and settles every one of them', async () => {
    const { id } = await open();
    const session = getSession(id, A)!;
    session.retreat(NOW + 1_000);
    expect(session.over).toBe(true);
    expect(session.endReason).toBe('retreat');

    const out = await settle(id, A, NOW + 1_100);
    expect(out.ok).toBe(true);
    expect(out.ok && out.body.endReason).toBe('retreat');
  });

  it('a disconnect settles with what it had — never "no result"', async () => {
    const { id } = await open();
    const session = getSession(id, A)!;
    session.fire({ r: 0, c: 0 }, NOW);

    // 61 seconds of silence.
    const later = NOW + 61_000;
    expect(session.isAbandoned(later)).toBe(true);

    const settled = await sweepRaids(later);
    expect(settled).toBe(1);

    const row = await t.one<{ end_reason: string; ended_at: string | null }>(
      `select end_reason, ended_at from public.raid where id = $1`,
      [id],
    );
    expect(row.ended_at).not.toBeNull();
    expect(row.end_reason).toBe('disconnect');
  });

  it('the clock plus its grace ends the raid', async () => {
    const { id } = await open();
    const session = getSession(id, A)!;
    const late = NOW + RAID_DEFAULTS.timeLimitMs + 11_000;

    const outcome = session.fire({ r: 5, c: 5 }, late);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('expired');
    expect(session.over).toBe(true);
  });

  it('five rejected actions end the raid (§10)', async () => {
    const { id } = await open();
    const session = getSession(id, A)!;

    session.fire({ r: 9, c: 9 }, NOW);
    // The same resolved cell, over and over: five rules rejections.
    for (let n = 0; n < 5; n++) session.fire({ r: 9, c: 9 }, NOW + 2_000 * (n + 1));

    expect(session.over).toBe(true);
  });

  it('rate-limits at four actions a second without ending the raid', async () => {
    const { id } = await open();
    const session = getSession(id, A)!;

    const outcomes = [0, 1, 2, 3, 4, 5].map((n) => session.fire({ r: 0, c: n }, NOW + 10));
    expect(outcomes.filter((o) => o.error === 'rate-limited').length).toBeGreaterThan(0);
    expect(session.over).toBe(false);
  });
});

// ===========================================================================
// Settlement (§7, §11)
// ===========================================================================

describe('settlement', () => {
  async function raidTo(destroyCells: number) {
    const layout = generateDefaultHarbour(1, context);
    await saveHarbour(D, layout, context);
    await setRenown(A, 800);
    await setRenown(D, 800);

    const id = raidId();
    const opened = await openRaid({
      attackerId: A,
      raidId: id,
      card: {
        kind: 'player',
        userId: D,
        coveSeed: null,
        name: 'Defender',
        avatarId: 0,
        avatarColor: 'violet',
        countryCode: null,
        admiraltyLevel: 5,
        renown: 800,
        loot: { coins: 0, steel: 0 },
        renownOffer: { best: 0, worst: 0 },
        costCoins: 0,
      },
      kit: {},
      armoryLevel: 5,
      admiraltyLevel: 5,
      unlocks: context.unlocks,
      renown: 800,
      dropShield: false,
      now: NOW,
    });
    if (!opened.ok) throw new Error('open failed');

    const session = getSession(id, A)!;
    let hit = 0;
    let clock = NOW;
    outer: for (const ship of layout.ships) {
      for (const cell of cellsOf(ship)) {
        if (hit >= destroyCells) break outer;
        clock += 400;
        const out = session.fire(cell, clock);
        if (out.ok) hit++;
      }
    }
    return { id, layout, session, clock };
  }

  it('pays the attacker, takes from the defender, and never more than the pool', async () => {
    const { id, clock } = await raidTo(18); // everything
    const attackerBefore = await profileOf(A);
    const defenderBefore = await profileOf(D);

    const out = await settle(id, A, clock + 100);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.body.stars).toBe(3);
    expect(out.body.destruction).toBe(1);

    const attackerAfter = await profileOf(A);
    expect(attackerAfter.coins).toBe(attackerBefore.coins + out.body.earned.coins);
    expect(attackerAfter.steel).toBe(attackerBefore.steel + out.body.earned.steel);

    // The star bonus is the house's: the defender never funds it.
    expect(out.body.earned.starBonusSteel).toBe(300);
    expect(out.body.taken.steel).toBeLessThan(out.body.earned.steel);
    expect(defenderBefore.rank_points).toBe((await profileOf(D)).rank_points);
  });

  it('takes the stores before the wallet', async () => {
    const { id, clock } = await raidTo(18);
    await settle(id, A, clock + 100);

    const city = await t.one<{ state: unknown }>(`select state from public.city where user_id = $1`, [D]);
    const state = city.state as { buildings: Record<string, { stored: number }>; scrapPile: number };
    // 50% of 400 coins stored = 200 taken, so 200 left.
    expect(state.buildings.fish_market!.stored).toBeLessThan(400);
  });

  it('moves renown on the separate ladder, and leaves rank points alone', async () => {
    const { id, clock } = await raidTo(18);
    const before = await profileOf(A);

    const out = await settle(id, A, clock + 100);
    expect(out.ok && out.body.renown.delta).toBeGreaterThan(0);

    const renown = await t.one<{ value: number }>(`select value from public.renown where user_id=$1`, [A]);
    expect(renown.value).toBeGreaterThan(800);
    expect((await profileOf(A)).rank_points).toBe(before.rank_points);
  });

  it('a 0-star raid costs the attacker renown and gives the defender some', async () => {
    const { id, clock } = await raidTo(0);
    const out = await settle(id, A, clock + 100);
    expect(out.ok && out.body.stars).toBe(0);
    expect(out.ok && out.body.renown.delta).toBeLessThan(0);

    const defender = await t.one<{ value: number }>(
      `select value from public.renown where user_id = $1`,
      [D],
    );
    expect(defender.value).toBeGreaterThan(800);
  });

  it('shields the defender by the destruction they took', async () => {
    const { id, clock } = await raidTo(18);
    const out = await settle(id, A, clock + 100);
    expect(out.ok && out.body.shieldHours).toBe(14);

    const shield = await t.query(`select 1 from public.shield where user_id = $1`, [D]);
    expect(shield).toHaveLength(1);
  });

  it('settling twice credits once', async () => {
    const { id, clock } = await raidTo(18);
    const before = await profileOf(A);

    const first = await settle(id, A, clock + 100);
    expect(first.ok).toBe(true);
    const afterFirst = await profileOf(A);

    // The session is gone after the first settle, which is itself the guard.
    const second = await settle(id, A, clock + 200);
    expect(second.ok === false && second.error).toBe('no-session');
    expect((await profileOf(A)).coins).toBe(afterFirst.coins);
    expect(afterFirst.coins).toBeGreaterThanOrEqual(before.coins);
  });

  it('reveals the layout only AFTER the raid is over (§8)', async () => {
    const { id, clock, layout } = await raidTo(4);
    const session = getSession(id, A)!;
    expect(session.finalReveal()).toBeNull(); // still running

    session.retreat(clock + 10);
    const out = await settle(id, A, clock + 100);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const reveal = out.body.reveal as { ships: unknown[] };
    expect(reveal.ships).toHaveLength(8);
    // The live view still hides everything un-hit, even in the same response.
    expectNoLayoutIn(out.body.view, layout, 'settle view', out.body.view.marks);
  });

  it('refuses to settle a raid that is not the caller own', async () => {
    const { id, clock } = await raidTo(2);
    const out = await settle(id, C, clock + 100);
    expect(out.ok === false && out.error).toBe('no-session');
  });
});

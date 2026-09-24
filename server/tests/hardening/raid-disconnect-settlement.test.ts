/**
 * Hardening — a raid whose attacker disappears mid-action.
 *
 * part-06 §6: "the attacker disconnects for more than 60 s — the raid settles
 * with what it had, never 'no result'". The existing raid suite proves the
 * sweep runs and writes an end reason; this file pins the two money
 * invariants the phrase implies:
 *
 *   1. NEVER LOST — the settlement credits exactly what the raid earned, the
 *      response and the profile agree to the coin, and the raid row records a
 *      result even when the player never fired a shot.
 *   2. NEVER DUPLICATED — a second sweep, and a direct settle after the
 *      sweep, move nothing. `settle_raid` is idempotent by design; this is
 *      the disconnect path's proof of it.
 *
 * Real rules and real SQL: src/engine/raid over PGlite running the production
 * migrations, with only the repo seam swapped (the same shape as
 * tests/integration/raid-api.test.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cellsOf } from '@engine/board';
import { generateDefaultHarbour, type HarbourLayout } from '@engine/raid';

import { __setRaidRepoForTests, fromSnapshotRow, type RaidRepo } from '../../src/raid/repo';
import { __resetSessionsForTests, getSession } from '../../src/raid/session';
import { openRaid, saveHarbour, settle, sweepRaids } from '../../src/raid/service';
import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';
const NOW = 1_700_000_000_000;
const CONTEXT = {
  admiraltyLevel: 5,
  coastalCommandLevel: 5,
  unlocks: ['sonar_net', 'decoy', 'minesweeper'],
};

let t: TestDb;
let raidSeq = 0;
const raidId = () => `bbbbbbbb-0000-4000-8000-${String(++raidSeq).padStart(12, '0')}`;

/** The production repo's SQL, against the test database (see raid-api.test.ts). */
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

type SettleParams = Parameters<RaidRepo['settle']>[0];

let settleCalls: SettleParams[] = [];
const repo = {
  set(inner: RaidRepo) {
    __setRaidRepoForTests({
      ...inner,
      async settle(params: SettleParams) {
        settleCalls.push(params);
        return inner.settle(params);
      },
    });
  },
};

async function seedCity(userId: string, stored = 400): Promise<void> {
  const state = (await import('@engine/city')).newCity(NOW) as unknown as Record<string, unknown>;
  const buildings = state.buildings as Record<string, Record<string, unknown>>;
  buildings.admiralty = { ...buildings.admiralty, level: 5 };
  buildings.fish_market = { ...buildings.fish_market, level: 3, stored };
  buildings.foundry = { ...buildings.foundry, level: 3, stored };
  await t.query(
    `insert into public.city (user_id, state) values ($1, $2)
       on conflict (user_id) do update set state = excluded.state, version = public.city.version + 1`,
    [userId, JSON.stringify(state)],
  );
}

const profileOf = (id: string) =>
  t.one<{ coins: number; steel: number; rank_points: number }>(
    `select coins, steel, rank_points from public.profiles where id = $1`,
    [id],
  );

const defenderCard = {
  kind: 'player' as const,
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
};

async function openPlayerRaid(): Promise<{ id: string; layout: HarbourLayout }> {
  const layout = generateDefaultHarbour(1, CONTEXT);
  await saveHarbour(D, layout, CONTEXT);
  await t.query(
    `insert into public.renown (user_id, value, best) values ($1, 800, 800)
       on conflict (user_id) do update set value = excluded.value`,
    [A],
  );
  await t.query(
    `insert into public.renown (user_id, value, best) values ($1, 800, 800)
       on conflict (user_id) do update set value = excluded.value`,
    [D],
  );

  const id = raidId();
  const opened = await openRaid({
    attackerId: A,
    raidId: id,
    card: defenderCard,
    kit: {},
    armoryLevel: 5,
    admiraltyLevel: 5,
    unlocks: CONTEXT.unlocks,
    renown: 800,
    dropShield: false,
    now: NOW,
  });
  if (!opened.ok) throw new Error(`open failed: ${opened.error}`);
  return { id, layout };
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
  settleCalls = [];
  repo.set(pgliteRepo(t));
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
  await t.query(`delete from public.profiles where id = any($1)`, [[A, D]]);
  await t.query(`delete from auth.users where id = any($1)`, [[A, D]]);
  await seedProfile(t, A, { coins: 5_000, steel: 5_000, rankPoints: 1_200 });
  await seedProfile(t, D, { coins: 5_000, steel: 5_000, rankPoints: 900 });
  await seedCity(A);
  await seedCity(D);
});

afterEach(() => {
  delete process.env.PORT_CITY_RAIDS;
  __resetSessionsForTests();
});

describe('a raid abandoned mid-action', () => {
  it('settles with everything it earned, exactly once, and records a result', async () => {
    const { id, layout } = await openPlayerRaid();
    const session = getSession(id, A)!;

    // Sink part of the harbour: enough that "what it had" is more than zero,
    // not enough to end the raid — a disconnect must settle a LIVE raid.
    let hits = 0;
    let clock = NOW;
    outer: for (const ship of layout.ships) {
      for (const cell of cellsOf(ship)) {
        if (hits >= 6) break outer;
        clock += 400;
        const outcome = session.fire(cell, clock);
        if (outcome.ok) hits += 1;
      }
    }
    expect(session.over).toBe(false);
    expect(hits).toBe(6);
    const attackerBefore = await profileOf(A);

    // 61 seconds of silence: the attacker is gone.
    const later = clock + 61_000;
    expect(session.isAbandoned(later)).toBe(true);

    expect(await sweepRaids(later)).toBe(1);
    expect(settleCalls).toHaveLength(1);
    const credited = settleCalls[0]!;
    expect(credited.endReason).toBe('disconnect');
    expect(credited.destruction).toBeGreaterThan(0);
    expect(credited.destruction).toBeLessThan(1);
    expect(credited.earnedCoins + credited.earnedSteel).toBeGreaterThan(0);

    // NEVER LOST: the profile moved by exactly the settlement's numbers, and
    // rank points are not this ladder's business.
    const attackerAfter = await profileOf(A);
    expect(attackerAfter.coins).toBe(attackerBefore.coins + credited.earnedCoins);
    expect(attackerAfter.steel).toBe(attackerBefore.steel + credited.earnedSteel);
    expect(attackerAfter.rank_points).toBe(attackerBefore.rank_points);
    // The defender pays out of their STORES first (§7.2), so the stores moved.
    const defenderCity = await t.one<{ state: { buildings: Record<string, { stored: number }> } }>(
      `select state from public.city where user_id = $1`,
      [D],
    );
    const storedAfter =
      (defenderCity.state.buildings.fish_market?.stored ?? 0) +
      (defenderCity.state.buildings.foundry?.stored ?? 0);
    expect(storedAfter).toBeLessThan(800);

    // The raid row says it ended, and how.
    const row = await t.one<{ end_reason: string; ended_at: string | null }>(
      `select end_reason, ended_at from public.raid where id = $1`,
      [id],
    );
    expect(row.ended_at).not.toBeNull();
    expect(row.end_reason).toBe('disconnect');

    // NEVER DUPLICATED: a second sweep finds nothing, a direct settle finds no
    // session, and the wallet does not move again.
    expect(await sweepRaids(later + 1_000)).toBe(0);
    expect(settleCalls).toHaveLength(1);
    const again = await settle(id, A, later + 2_000, 'disconnect');
    expect(again.ok === false && again.error).toBe('no-session');
    expect((await profileOf(A)).coins).toBe(attackerAfter.coins);
    expect((await profileOf(A)).steel).toBe(attackerAfter.steel);
  }, 60_000);

  it('settles a raid the attacker never acted in — a result, not nothing', async () => {
    const { id } = await openPlayerRaid();
    const session = getSession(id, A)!;
    expect(session.actions).toHaveLength(0);

    const attackerBefore = await profileOf(A);
    const later = NOW + 61_000;
    expect(session.isAbandoned(later)).toBe(true);

    expect(await sweepRaids(later)).toBe(1);
    expect(settleCalls).toHaveLength(1);
    const credited = settleCalls[0]!;
    expect(credited.endReason).toBe('disconnect');
    expect(credited.stars).toBe(0);

    // Whatever zero earns, the books must agree with it to the coin.
    const attackerAfter = await profileOf(A);
    expect(attackerAfter.coins).toBe(attackerBefore.coins + credited.earnedCoins);
    expect(attackerAfter.steel).toBe(attackerBefore.steel + credited.earnedSteel);

    const row = await t.one<{ end_reason: string; ended_at: string | null }>(
      `select end_reason, ended_at from public.raid where id = $1`,
      [id],
    );
    expect(row.ended_at).not.toBeNull();
    expect(row.end_reason).toBe('disconnect');
  }, 60_000);
});

/**
 * THE WAR SCHEDULER — part-08 §7.5, against a real Postgres.
 *
 * "Scheduler: run the transition job twice → rewards paid once; kill it
 *  mid-settlement and re-run → still once."
 *
 * This is a PGlite test and not a unit test on purpose: "paid exactly once" is
 * a TRANSACTION property. A fake repo can be made to return whatever the test
 * wants, which would prove nothing about the thing that actually protects the
 * money — the `settled_at is null` claim and the unique (war_id, user_id).
 *
 * The "kill it mid-settlement" case is the one worth reading. A worker cannot
 * literally be killed inside a plpgsql function from here, so the test does
 * the thing that is equivalent and stronger: it runs the settlement inside a
 * transaction and ROLLS BACK, which is exactly what a crashed worker leaves
 * behind, and then re-runs it for real.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { RAIDS_PER_MEMBER, memberRewards, warResult } from '@engine/fleets';

import { __setFleetRepoForTests, type FleetRepo, type WarSettlementInput } from '../../src/fleet/repo';
import { settleOneWar, warTick } from '../../src/fleet/scheduler';
import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '11111111-2222-4111-8111-111111111111';
const B1 = '22222222-1111-4222-8222-222222222222';
const B2 = '22222222-2222-4222-8222-222222222222';
const FLEET_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const FLEET_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const WAR = 'cccccccc-0000-4000-8000-000000000003';

let t: TestDb;

/** The production SQL, against the test database. Only what the scheduler uses. */
function pgliteRepo(db: TestDb): FleetRepo {
  const stub = () => {
    throw new Error('not used by the scheduler');
  };
  return {
    async advancePrep() {
      return Number((await db.one<{ war_advance_prep: number }>(`select public.war_advance_prep()`)).war_advance_prep);
    },
    async advanceBattle() {
      return Number(
        (await db.one<{ war_advance_battle: number }>(`select public.war_advance_battle()`)).war_advance_battle,
      );
    },
    async expireSearches(giveUpMs) {
      return Number(
        (
          await db.one<{ war_expire_searches: number }>(`select public.war_expire_searches($1)`, [giveUpMs])
        ).war_expire_searches,
      );
    },
    async warsAwaitingSettlement() {
      const rows = await db.query<{ id: string }>(`select id from public.war where state = 'settling'`);
      return rows.map((r) => r.id);
    },
    async settleWar(input: WarSettlementInput) {
      const row = await db.one<{ settle_war: { paid: boolean; reason?: string; members: number; skipped: number } }>(
        `select public.settle_war($1, $2, $3, $4, $5, $6, $7::jsonb) as settle_war`,
        [
          input.warId,
          input.winner,
          input.starsA,
          input.starsB,
          input.destructionA,
          input.destructionB,
          JSON.stringify(input.rewards),
        ],
      );
      return {
        paid: row.settle_war.paid,
        ...(row.settle_war.reason ? { reason: row.settle_war.reason } : {}),
        members: row.settle_war.members ?? 0,
        skipped: row.settle_war.skipped ?? 0,
      };
    },
    async loadWar(warId) {
      const rows = await db.query<Record<string, unknown>>(`select * from public.war where id = $1`, [warId]);
      if (rows.length === 0) return null;
      const { toWar } = await import('../../src/fleet/repo');
      return toWar(rows[0]!);
    },
    async warMembers(warId) {
      const rows = await db.query<Record<string, unknown>>(`select * from public.war_member where war_id = $1`, [warId]);
      const { toWarMember } = await import('../../src/fleet/repo');
      return rows.map(toWarMember);
    },
    async warRaids(warId) {
      const rows = await db.query<Record<string, unknown>>(`select * from public.war_raid where war_id = $1`, [warId]);
      const { toWarRaid } = await import('../../src/fleet/repo');
      return rows.map(toWarRaid);
    },
    loadFleet: stub as never,
    members: stub as never,
    membershipOf: stub as never,
    createFleet: stub as never,
    leaveFleet: stub as never,
    setRole: stub as never,
    removeMember: stub as never,
    postMessage: stub as never,
    recentMessages: stub as never,
    recentBy: stub as never,
    openRequests: stub as never,
    lastRequestAt: stub as never,
    createRequest: stub as never,
    fillRequest: stub as never,
    heldReinforcements: stub as never,
    consumeReinforcement: stub as never,
    recordFlag: stub as never,
    flagWall: stub as never,
    sweep: stub as never,
  };
}

const wallet = (id: string) =>
  t.one<{ steel: number; coins: number; gems: number }>(
    `select steel, coins, gems from public.profiles where id = $1`,
    [id],
  );

const rewardRows = () =>
  t.query<{ user_id: string; steel: number; gems: number }>(
    `select user_id, steel, gems from public.war_reward where war_id = $1`,
    [WAR],
  );

/** A finished 2v2 sitting in `settling`, waiting to be paid. */
async function seedWar(patch: { raids?: boolean } = {}): Promise<void> {
  await t.query(`insert into public.fleet (id, name) values ($1, 'Alpha'), ($2, 'Bravo')`, [
    FLEET_A,
    FLEET_B,
  ]);
  await t.query(
    `insert into public.war (id, fleet_a, fleet_b, size, state, prep_ends_at, battle_ends_at)
     values ($1, $2, $3, 5, 'settling', now() - interval '2 days', now() - interval '1 hour')`,
    [WAR, FLEET_A, FLEET_B],
  );
  for (const [user, fleet, used] of [
    [A1, FLEET_A, RAIDS_PER_MEMBER],
    [A2, FLEET_A, RAIDS_PER_MEMBER],
    [B1, FLEET_B, RAIDS_PER_MEMBER],
    // B2 never attacked — §4's "a member who used none gets nothing".
    [B2, FLEET_B, 0],
  ] as const) {
    await t.query(
      `insert into public.war_member (war_id, user_id, fleet_id, renown, raids_used)
       values ($1, $2, $3, 800, $4)`,
      [WAR, user, fleet, used],
    );
  }

  if (patch.raids !== false) {
    // A's two members take 3★ and 2★ off B's harbours; B takes 1★ off one of A's.
    await t.query(
      `insert into public.war_raid (war_id, raid_id, attacker_id, target_user_id, stars, destruction, finished_at)
       values
         ($1, gen_random_uuid(), $2, $4, 3, 1.0,  now() - interval '5 hours'),
         ($1, gen_random_uuid(), $3, $5, 2, 0.6,  now() - interval '4 hours'),
         ($1, gen_random_uuid(), $4, $2, 1, 0.25, now() - interval '3 hours')`,
      [WAR, A1, A2, B1, B2],
    );
  }
}

beforeAll(async () => {
  t = await startTestDb(2);
}, 120_000);

afterAll(async () => {
  __setFleetRepoForTests(null);
  await t?.close();
});

beforeEach(async () => {
  process.env.PORT_CITY_FLEETS = '1';
  __setFleetRepoForTests(pgliteRepo(t));

  await t.query(`delete from public.war_reward`);
  await t.query(`delete from public.war_raid`);
  await t.query(`delete from public.war_member`);
  await t.query(`delete from public.war`);
  await t.query(`delete from public.fleet_member`);
  await t.query(`delete from public.fleet`);
  await t.query(`delete from public.economy_ledger`);
  await t.query(`delete from public.profiles where id = any($1)`, [[A1, A2, B1, B2]]);
  await t.query(`delete from auth.users where id = any($1)`, [[A1, A2, B1, B2]]);
  for (const id of [A1, A2, B1, B2]) {
    await seedProfile(t, id, { coins: 1_000, steel: 1_000, gems: 0, rankPoints: 900 });
  }
});

// ===========================================================================
// §7.5 — THE TWO THAT MATTER
// ===========================================================================

describe('the settlement pays exactly once', () => {
  it('RUN THE JOB TWICE → rewards paid once', async () => {
    await seedWar();

    const first = await warTick();
    expect(first.settled).toBe(1);

    const afterFirst = await Promise.all([wallet(A1), wallet(A2), wallet(B1), wallet(B2)]);
    expect(afterFirst[0].steel).toBeGreaterThan(1_000);

    // Again. And again — a retry loop, or two workers, or a restart.
    const second = await warTick();
    const third = await warTick();
    expect(second.settled).toBe(0);
    expect(third.settled).toBe(0);

    const afterThird = await Promise.all([wallet(A1), wallet(A2), wallet(B1), wallet(B2)]);
    expect(afterThird).toEqual(afterFirst);

    // One reward row per member, never two.
    const rows = await rewardRows();
    expect(rows).toHaveLength(4);
  });

  it('calling settle_war DIRECTLY twice pays once and says why', async () => {
    await seedWar();
    expect(await settleOneWar(WAR)).toBe('paid');
    // The war is 'ended' now, so the scheduler will not even offer it again.
    expect(await settleOneWar(WAR)).toBe('not-due');

    // And going behind the scheduler's back, straight at the SQL: still once.
    const direct = await t.one<{ settle_war: { paid: boolean; reason: string } }>(
      `select public.settle_war($1, 'a', 5, 1, 1.6, 0.25, '[]'::jsonb) as settle_war`,
      [WAR],
    );
    expect(direct.settle_war.paid).toBe(false);
    expect(direct.settle_war.reason).toBe('already-settled');
  });

  it('KILLED MID-SETTLEMENT → the claim rolls back with the payment, and a re-run pays once', async () => {
    await seedWar();
    const before = await wallet(A1);

    // A worker that dies inside the function leaves exactly this: the whole
    // transaction gone, claim included. There is no state where the war is
    // marked settled but the wallets did not move.
    await t.db.exec('begin');
    await t.query(
      `select public.settle_war($1, 'a', 5, 1, 1.6, 0.25,
         '[{"userId":"${A1}","steel":999,"coins":0,"gems":10,"noShow":false}]'::jsonb)`,
      [WAR],
    );
    // Prove the payment really was applied inside the transaction...
    const inside = await wallet(A1);
    expect(inside.steel).toBe(before.steel + 999);
    await t.db.exec('rollback');

    // ...and that the rollback took the claim with it.
    const afterCrash = await t.one<{ state: string; settled_at: string | null }>(
      `select state, settled_at from public.war where id = $1`,
      [WAR],
    );
    expect(afterCrash.state).toBe('settling');
    expect(afterCrash.settled_at).toBeNull();
    expect((await wallet(A1)).steel).toBe(before.steel);
    expect(await rewardRows()).toHaveLength(0);

    // The next tick picks it up and pays — once.
    expect((await warTick()).settled).toBe(1);
    expect((await warTick()).settled).toBe(0);
    expect(await rewardRows()).toHaveLength(4);
  });

  it('the unique key is an independent backstop, even if the claim were wrong', async () => {
    await seedWar();
    // Settle normally.
    await warTick();
    const paid = await wallet(A1);

    // Now force the war back to 'settling' and clear the marker — i.e. pretend
    // the claim failed completely. The reward rows must STILL stop a second
    // payment, because they are the second mechanism.
    await t.query(`update public.war set state = 'settling', settled_at = null where id = $1`, [WAR]);
    const again = await warTick();
    expect(again.settled).toBe(1); // the claim let it through this time...

    // ...but the money did not move, because every insert hit the conflict.
    expect(await wallet(A1)).toEqual(paid);
    expect(await rewardRows()).toHaveLength(4);
  });

  it('two concurrent ticks pay once between them', async () => {
    await seedWar();
    const before = await wallet(A1);

    const [one, two] = await Promise.all([warTick(), warTick()]);
    expect(one.settled + two.settled).toBe(1);

    const rows = await rewardRows();
    expect(rows).toHaveLength(4);
    expect((await wallet(A1)).steel).toBeGreaterThan(before.steel);
  });
});

// ===========================================================================
// The state machine
// ===========================================================================

describe('the transitions are idempotent', () => {
  it('prep → battle fires once, when the clock says so', async () => {
    await t.query(`insert into public.fleet (id, name) values ($1, 'Alpha'), ($2, 'Bravo')`, [FLEET_A, FLEET_B]);
    await t.query(
      `insert into public.war (id, fleet_a, fleet_b, size, state, prep_ends_at, battle_ends_at)
       values ($1, $2, $3, 5, 'prep', now() + interval '1 hour', now() + interval '25 hours')`,
      [WAR, FLEET_A, FLEET_B],
    );

    // Not due yet.
    expect((await warTick()).startedBattle).toBe(0);

    await t.query(`update public.war set prep_ends_at = now() - interval '1 minute' where id = $1`, [WAR]);
    expect((await warTick()).startedBattle).toBe(1);
    expect((await warTick()).startedBattle).toBe(0);

    const row = await t.one<{ state: string }>(`select state from public.war where id = $1`, [WAR]);
    expect(row.state).toBe('battle');
  });

  it('battle → settling fires once', async () => {
    await t.query(`insert into public.fleet (id, name) values ($1, 'Alpha'), ($2, 'Bravo')`, [FLEET_A, FLEET_B]);
    await t.query(
      `insert into public.war (id, fleet_a, fleet_b, size, state, battle_ends_at)
       values ($1, $2, $3, 5, 'battle', now() - interval '1 minute')`,
      [WAR, FLEET_A, FLEET_B],
    );
    const tick = await warTick();
    expect(tick.startedSettling).toBe(1);
    // It settled in the same tick, which is correct: there is nothing to wait for.
    expect(tick.settled).toBe(1);
    expect((await warTick()).startedSettling).toBe(0);
  });

  it('a search that nobody answered is cancelled after 30 minutes', async () => {
    await t.query(`insert into public.fleet (id, name) values ($1, 'Alpha')`, [FLEET_A]);
    await t.query(
      `insert into public.war (id, fleet_a, size, state, search_started_at)
       values ($1, $2, 5, 'searching', now() - interval '31 minutes')`,
      [WAR, FLEET_A],
    );
    expect((await warTick()).cancelledSearches).toBe(1);
    expect((await warTick()).cancelledSearches).toBe(0);

    const row = await t.one<{ state: string }>(`select state from public.war where id = $1`, [WAR]);
    expect(row.state).toBe('cancelled');
  });

  it('a search still inside the window is left alone', async () => {
    await t.query(`insert into public.fleet (id, name) values ($1, 'Alpha')`, [FLEET_A]);
    await t.query(
      `insert into public.war (id, fleet_a, size, state, search_started_at)
       values ($1, $2, 5, 'searching', now() - interval '10 minutes')`,
      [WAR, FLEET_A],
    );
    expect((await warTick()).cancelledSearches).toBe(0);
  });

  it('a six-hour outage catches up on the first tick', async () => {
    // Nothing is scheduled in memory, so nothing was missed: the conditions
    // are `<= now()`, not "did it fire while I was watching".
    await t.query(`insert into public.fleet (id, name) values ($1, 'Alpha'), ($2, 'Bravo')`, [FLEET_A, FLEET_B]);
    await t.query(
      `insert into public.war (id, fleet_a, fleet_b, size, state, prep_ends_at, battle_ends_at)
       values ($1, $2, $3, 5, 'prep', now() - interval '30 hours', now() - interval '6 hours')`,
      [WAR, FLEET_A, FLEET_B],
    );
    await t.query(
      `insert into public.war_member (war_id, user_id, fleet_id, raids_used) values ($1, $2, $3, 2)`,
      [WAR, A1, FLEET_A],
    );

    const tick = await warTick();
    expect(tick.startedBattle).toBe(1);
    // prep → battle → settling → ended, all in one pass.
    expect(tick.settled).toBe(1);

    const row = await t.one<{ state: string }>(`select state from public.war where id = $1`, [WAR]);
    expect(row.state).toBe('ended');
  });
});

// ===========================================================================
// What the settlement actually paid
// ===========================================================================

describe('the payout', () => {
  it('matches what the pure rules computed', async () => {
    await seedWar();
    await warTick();

    // A beat B 5★ to 1★, so A won.
    const war = await t.one<{ winner: string; stars_a: number; stars_b: number }>(
      `select winner, stars_a, stars_b from public.war where id = $1`,
      [WAR],
    );
    expect(war.winner).toBe('a');
    expect(war.stars_a).toBe(5);
    expect(war.stars_b).toBe(1);

    const expected = memberRewards(
      [
        { warId: WAR, userId: A1, fleetId: FLEET_A, renown: 800, raidsUsed: 2 },
        { warId: WAR, userId: A2, fleetId: FLEET_A, renown: 800, raidsUsed: 2 },
      ],
      5,
      5,
      true,
    );
    const rows = await rewardRows();
    const a1 = rows.find((r) => r.user_id === A1)!;
    expect(a1.steel).toBe(expected[0]!.steel);
    expect(a1.gems).toBe(10);
  });

  it('a member who never attacked gets nothing, and is marked', async () => {
    await seedWar();
    await warTick();

    const row = await t.one<{ steel: number; coins: number; gems: number; no_show: boolean }>(
      `select steel, coins, gems, no_show from public.war_reward where war_id = $1 and user_id = $2`,
      [WAR, B2],
    );
    expect(row).toMatchObject({ steel: 0, coins: 0, gems: 0, no_show: true });
    // And their wallet did not move.
    expect((await wallet(B2)).steel).toBe(1_000);
  });

  it('writes a ledger row for every member who was actually paid', async () => {
    await seedWar();
    await warTick();
    const ledger = await t.query<{ user_id: string }>(
      `select user_id from public.economy_ledger where reason = 'war_reward' and ref = $1`,
      [WAR],
    );
    // Three paid; B2 was a no-show and gets no row.
    expect(ledger).toHaveLength(3);
  });

  it('a war nobody fought is a draw, and both sides still get the loser share', async () => {
    await seedWar({ raids: false });
    // Everybody turned up but nobody raided: raids_used is still 2 for three
    // of them, so they participated. warResult must call it a draw.
    const result = warResult([A1, A2], [], [B1, B2], []);
    expect(result.winner).toBe('draw');

    await warTick();
    const war = await t.one<{ winner: string }>(`select winner from public.war where id = $1`, [WAR]);
    expect(war.winner).toBe('draw');

    const rows = await rewardRows();
    expect(rows).toHaveLength(4);
    // Nobody gets gems for a draw.
    expect(rows.every((r) => r.gems === 0)).toBe(true);
  });
});

describe('the flag', () => {
  it('turns the whole scheduler off', async () => {
    delete process.env.PORT_CITY_FLEETS;
    await seedWar();
    const tick = await warTick();
    expect(tick.settled).toBe(0);
    expect(tick.startedBattle).toBe(0);
    expect(await rewardRows()).toHaveLength(0);
    process.env.PORT_CITY_FLEETS = '1';
  });
});

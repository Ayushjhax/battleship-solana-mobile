/**
 * The 5% platform fee against the real SQL (0025).
 *
 * The match server settles every room through `public.apply_match_result`, so
 * this drives that function exactly as the server does — real holds, real
 * ledger, real balances — and pins the fee's eligibility, arithmetic,
 * idempotency and audit trail. The pure arithmetic lives in
 * src/engine/__tests__/economy.test.ts; this file proves the SQL agrees.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A = 'a0000000-0000-4000-8000-00000000000a';
const B = 'b0000000-0000-4000-8000-00000000000b';
/** The fixed matchmaking bot from 0006. */
const BOT = 'b0000000-0000-4000-8000-000000000001';
const PLATFORM = 'platform:fee';

let t: TestDb;
let seq = 0;
const uuid = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

async function link(profileId: string, privyUserId: string): Promise<void> {
  await t.query(
    `insert into public.privy_accounts (profile_id, privy_user_id, auth_provider, privy_created_at)
     values ($1, $2, 'email', now())`,
    [profileId, privyUserId],
  );
}

async function balance(profileId: string): Promise<number> {
  const row = await t.one<{ balance: number | string }>(
    `select public.get_point_balance($1) as balance`,
    [profileId],
  );
  return Number(row.balance);
}

async function platformBalance(): Promise<number> {
  const rows = await t.query<{ balance: number | string }>(
    `select balance from public.point_accounts where privy_user_id = $1`,
    [PLATFORM],
  );
  return rows[0] ? Number(rows[0].balance) : 0;
}

interface WagerResult {
  settled: boolean;
  salvage_a: number;
  salvage_b: number;
  wager: { gross: number; fee: number; payout: number } | null;
}

/** Two holds, a wagered human match, and the settlement — as room.ts does it. */
async function settleHumanMatch(winner: string): Promise<WagerResult> {
  const matchId = uuid();
  const holdA = uuid();
  const holdB = uuid();
  const stakeA = await t.one<{ ok: boolean; hold_id: string; balance: number | string }>(
    `select ok, hold_id, balance from public.reserve_point_wager($1, $2, 50)`,
    [A, holdA],
  );
  const stakeB = await t.one<{ ok: boolean; hold_id: string; balance: number | string }>(
    `select ok, hold_id, balance from public.reserve_point_wager($1, $2, 50)`,
    [B, holdB],
  );
  expect(stakeA.ok).toBe(true);
  expect(stakeB.ok).toBe(true);

  await t.query(
    `select public.create_wagered_match($1, 'classic', $2, $3, 7, false, $4, $5)`,
    [matchId, A, B, stakeA.hold_id, stakeB.hold_id],
  );
  const row = await t.one<{ r: WagerResult }>(
    `select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as r`,
    [matchId, winner],
  );
  return row.r;
}

async function settleBotMatch(): Promise<WagerResult> {
  const matchId = uuid();
  const hold = uuid();
  const stake = await t.one<{ ok: boolean; hold_id: string }>(
    `select ok, hold_id from public.reserve_point_wager($1, $2, 50)`,
    [A, hold],
  );
  expect(stake.ok).toBe(true);
  await t.query(
    `select public.create_wagered_match($1, 'classic', $2, $3, 7, true, $4, null)`,
    [matchId, A, BOT, stake.hold_id],
  );
  const row = await t.one<{ r: WagerResult }>(
    `select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as r`,
    [matchId, A],
  );
  return row.r;
}

beforeAll(async () => {
  // Two passes: every migration must be re-runnable, 0025 included.
  t = await startTestDb(2);
  await seedProfile(t, A, { rankPoints: 1_000 });
  await seedProfile(t, B, { rankPoints: 1_000 });
  await link(A, 'privy-a');
  await link(B, 'privy-b');
  // The 100-point welcome, the same call the server makes at account setup.
  await t.query(`select public.ensure_point_account($1, 'privy-a')`, [A]);
  await t.query(`select public.ensure_point_account($1, 'privy-b')`, [B]);
}, 180_000);

afterAll(async () => {
  await t?.close();
});

describe('platform fee settlement', () => {
  it('pays a human winner 95 of the 100-point pot and records a 5-point fee', async () => {
    const before = await balance(A);
    const result = await settleHumanMatch(A);

    expect(result.settled).toBe(true);
    expect(result.wager).toEqual({ gross: 100, fee: 5, payout: 95 });
    // The stake left the balance at reserve time: 50 + the 95 net payout.
    expect(await balance(A)).toBe(before - 50 + 95);
    expect(await balance(B)).toBe(50);
    expect(await platformBalance()).toBe(5);

    const prize = await t.one<{ delta: number | string; metadata: Record<string, unknown> }>(
      `select delta, metadata from public.point_ledger
        where reason = 'wager_prize' and privy_user_id = 'privy-a'
        order by id desc limit 1`,
    );
    expect(Number(prize.delta)).toBe(95);
    expect(prize.metadata).toMatchObject({ stake: 50, gross: 100, fee: 5, payout: 95, bot_match: false });

    const fee = await t.one<{ delta: number | string; metadata: Record<string, unknown> }>(
      `select delta, metadata from public.point_ledger
        where reason = 'platform_fee' and privy_user_id = $1
        order by id desc limit 1`,
      [PLATFORM],
    );
    expect(Number(fee.delta)).toBe(5);
    expect(fee.metadata).toMatchObject({ gross: 100, fee: 5, stake: 50 });
  });

  it('does not charge the fee twice when the settlement is retried', async () => {
    const matchId = uuid();
    const holdA = uuid();
    const holdB = uuid();
    await t.query(`select public.reserve_point_wager($1, $2, 50)`, [A, holdA]);
    await t.query(`select public.reserve_point_wager($1, $2, 50)`, [B, holdB]);
    await t.query(
      `select public.create_wagered_match($1, 'classic', $2, $3, 7, false, $4, $5)`,
      [matchId, A, B, holdA, holdB],
    );

    const first = await t.one<{ r: WagerResult }>(
      `select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as r`,
      [matchId, A],
    );
    expect(first.r.settled).toBe(true);

    const balancesBefore = [await balance(A), await balance(B), await platformBalance()];
    const feeRowsBefore = await t.one<{ n: number }>(
      `select count(*)::int as n from public.point_ledger where reason = 'platform_fee'`,
    );

    const replay = await t.one<{ r: WagerResult }>(
      `select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as r`,
      [matchId, A],
    );
    expect(replay.r.settled).toBe(false);
    expect(replay.r.wager).toBeNull();
    expect([await balance(A), await balance(B), await platformBalance()]).toEqual(balancesBefore);
    expect(
      (await t.one<{ n: number }>(
        `select count(*)::int as n from public.point_ledger where reason = 'platform_fee'`,
      )).n,
    ).toBe(feeRowsBefore.n);
  });

  it('pays a bot match the full pot with no fee and no platform entry', async () => {
    const before = await balance(A);
    const feeBefore = await platformBalance();
    const result = await settleBotMatch();

    expect(result.settled).toBe(true);
    expect(result.wager).toEqual({ gross: 100, fee: 0, payout: 100 });
    // The stake left at reserve time and the full pot came back.
    expect(await balance(A)).toBe(before - 50 + 100);
    expect(await platformBalance()).toBe(feeBefore);
    const feeRows = await t.one<{ n: number }>(
      `select count(*)::int as n from public.point_ledger
        where reason = 'platform_fee' and reference_id = (
          select id::text from public.matches where is_bot and winner = $1 order by ended_at desc limit 1
        )`,
      [A],
    );
    expect(feeRows.n).toBe(0);
  });

  it('charges nothing on an unwagered human match', async () => {
    const matchId = uuid();
    await t.query(
      `insert into public.matches (id, mode, player_a, player_b, seed, is_bot)
       values ($1, 'classic', $2, $3, 7, false)`,
      [matchId, A, B],
    );
    const before = [await balance(A), await balance(B), await platformBalance()];
    const row = await t.one<{ r: WagerResult }>(
      `select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as r`,
      [matchId, A],
    );
    expect(row.r.settled).toBe(true);
    expect(row.r.wager).toBeNull();
    expect([await balance(A), await balance(B), await platformBalance()]).toEqual(before);
  });

  it('charges nothing on an offline wager — the winner takes the full pot', async () => {
    const requestId = uuid();
    await t.query(`select public.reserve_point_wager($1, $2, 50)`, [A, requestId]);
    const before = await balance(A);
    const feeBefore = await platformBalance();

    const settled = await t.one<{ balance: number | string; settled: boolean }>(
      `select balance, settled from public.settle_offline_wager($1, $2, true)`,
      [A, requestId],
    );
    expect(settled.settled).toBe(true);
    expect(await balance(A)).toBe(before + 100);
    expect(await platformBalance()).toBe(feeBefore);
  });

  it('keeps gross = fee + payout for every settled match', async () => {
    const rows = await t.query<{ metadata: { gross: number; fee: number; payout: number } }>(
      `select metadata from public.point_ledger
        where reason = 'wager_prize' and metadata ? 'payout'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.metadata.fee + row.metadata.payout).toBe(row.metadata.gross);
    }
    // The platform's own rows agree with the same gross and fee.
    const feeRows = await t.query<{ delta: number | string; metadata: { gross: number; fee: number } }>(
      `select delta, metadata from public.point_ledger where reason = 'platform_fee'`,
    );
    for (const row of feeRows) {
      expect(Number(row.delta)).toBe(row.metadata.fee);
      expect(row.metadata.fee).toBeLessThanOrEqual(row.metadata.gross);
    }
  });
});

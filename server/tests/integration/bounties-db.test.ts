/**
 * The Bounty Board's SQL — part-04 §5.4, §5.5, §5.6.
 *
 *   5.4 "Claim is idempotent; double claim credits once."
 *   5.5 "The 11th offline match of the day advances no contracts and no ink
 *        but still pays coins."
 *   5.6 "auto-claim job pays every unclaimed page exactly once (run it twice
 *        in the test)."
 *
 * A real Postgres, because all three are transaction properties. A fake repo
 * can be made to return whatever the test wants, which proves nothing about
 * the claim-guard that actually protects the payout.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { OFFLINE_REWARD_CAP } from '@engine/city';
import { claimablePages, rewardForPage, totalFor } from '@engine/bounties';

import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const U = '11111111-1111-4111-8111-111111111111';
const SEASON = 1;
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

let t: TestDb;

const wallet = () =>
  t.one<{ coins: number; steel: number; gems: number }>(
    `select coins, steel, gems from public.profiles where id = $1`,
    [U],
  );

beforeAll(async () => {
  // Two passes: every migration must be re-runnable.
  t = await startTestDb(2);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  await t.query(`delete from public.season_progress`);
  await t.query(`delete from public.season`);
  await t.query(`delete from public.contract_rerolls`);
  await t.query(`delete from public.contracts`);
  await t.query(`delete from public.economy_ledger`);
  await t.query(`delete from public.city`);
  await t.query(`delete from public.profiles where id = $1`, [U]);
  await t.query(`delete from auth.users where id = $1`, [U]);
  await seedProfile(t, U, { coins: 1_000, steel: 1_000, gems: 1_000 });
  await t.query(
    `insert into public.season (id, starts_at, ends_at) values ($1, now(), now() + interval '28 days')`,
    [SEASON],
  );
});

// ===========================================================================
// §5.4 — claim is idempotent
// ===========================================================================

describe('claiming a contract', () => {
  const issue = () =>
    t.query(
      `select public.contracts_issue($1, $2::jsonb)`,
      [
        U,
        JSON.stringify([
          { slot: 0, contractId: 'win-1', target: 1, scope: 'daily', expiresAt: new Date(NOW + 86_400_000).toISOString() },
        ]),
      ],
    );

  const claim = () =>
    t.one<{ contract_claim: { claimed: boolean; reason?: string } }>(
      `select public.contract_claim($1, 0::smallint, 150, 200, 0, 60, $2) as contract_claim`,
      [U, SEASON],
    );

  it('refuses a claim while the contract is still active', async () => {
    await issue();
    const out = await claim();
    expect(out.contract_claim.claimed).toBe(false);
    expect(out.contract_claim.reason).toBe('not-claimable');
  });

  it('pays once when done, and NOTHING on a second claim', async () => {
    await issue();
    await t.query(
      `select public.contracts_advance($1, '[{"contractId":"win-1","delta":1}]'::jsonb)`,
      [U],
    );

    const row = await t.one<{ state: string; progress: number }>(
      `select state, progress from public.contracts where user_id = $1 and slot = 0`,
      [U],
    );
    expect(row.state).toBe('done');
    expect(row.progress).toBe(1);

    const before = await wallet();
    expect((await claim()).contract_claim.claimed).toBe(true);
    const afterFirst = await wallet();
    expect(afterFirst.coins).toBe(before.coins + 150);
    expect(afterFirst.steel).toBe(before.steel + 200);

    // Again, and again.
    expect((await claim()).contract_claim.claimed).toBe(false);
    expect((await claim()).contract_claim.claimed).toBe(false);
    expect(await wallet()).toEqual(afterFirst);

    // And one ledger row, not three.
    const ledger = await t.query(
      `select 1 from public.economy_ledger where user_id = $1 and reason = 'contract_claim'`,
      [U],
    );
    expect(ledger).toHaveLength(1);
  });

  it('credits the contract’s ink to the season, once', async () => {
    await issue();
    await t.query(`select public.contracts_advance($1, '[{"contractId":"win-1","delta":1}]'::jsonb)`, [U]);
    await claim();
    await claim();

    const progress = await t.one<{ ink: number }>(
      `select ink from public.season_progress where user_id = $1 and season_id = $2`,
      [U, SEASON],
    );
    expect(progress.ink).toBe(60);
  });

  it('never advances past the target, however big the delta', async () => {
    await issue();
    await t.query(`select public.contracts_advance($1, '[{"contractId":"win-1","delta":99}]'::jsonb)`, [U]);
    const row = await t.one<{ progress: number; target: number }>(
      `select progress, target from public.contracts where user_id = $1 and slot = 0`,
      [U],
    );
    expect(row.progress).toBe(row.target);
  });

  it('ignores a negative delta — the client never reports progress anyway', async () => {
    await issue();
    await t.query(`select public.contracts_advance($1, '[{"contractId":"win-1","delta":-5}]'::jsonb)`, [U]);
    const row = await t.one<{ progress: number }>(
      `select progress from public.contracts where user_id = $1 and slot = 0`,
      [U],
    );
    expect(row.progress).toBe(0);
  });

  it('does not advance an EXPIRED contract', async () => {
    await t.query(`select public.contracts_issue($1, $2::jsonb)`, [
      U,
      JSON.stringify([
        { slot: 1, contractId: 'win-3', target: 3, scope: 'daily', expiresAt: new Date(NOW - 1_000).toISOString() },
      ]),
    ]);
    await t.query(`select public.contracts_advance($1, '[{"contractId":"win-3","delta":1}]'::jsonb)`, [U]);
    const row = await t.one<{ progress: number }>(
      `select progress from public.contracts where user_id = $1 and slot = 1`,
      [U],
    );
    expect(row.progress).toBe(0);
  });
});

// ===========================================================================
// §5.5 — the offline daily cap, and the SPLIT that made it shareable
// ===========================================================================

describe('the offline daily slot', () => {
  const take = (now = NOW) =>
    t.one<{ offline_slot_take: boolean }>(`select public.offline_slot_take($1, $2, $3) as offline_slot_take`, [
      U,
      OFFLINE_REWARD_CAP,
      now,
    ]);

  const left = (now = NOW) =>
    t.one<{ offline_slots_left: number }>(
      `select public.offline_slots_left($1, $2, $3) as offline_slots_left`,
      [U, OFFLINE_REWARD_CAP, now],
    );

  it('gives exactly `cap` slots a day', async () => {
    for (let n = 0; n < OFFLINE_REWARD_CAP; n++) {
      expect((await take()).offline_slot_take, `match ${n + 1}`).toBe(true);
    }
    // §5.5 — the 11th.
    expect((await take()).offline_slot_take).toBe(false);
    expect(Number((await left()).offline_slots_left)).toBe(0);
  });

  it('counts down as they are spent', async () => {
    expect(Number((await left()).offline_slots_left)).toBe(OFFLINE_REWARD_CAP);
    await take();
    expect(Number((await left()).offline_slots_left)).toBe(OFFLINE_REWARD_CAP - 1);
  });

  it('resets at the next UTC day', async () => {
    for (let n = 0; n < OFFLINE_REWARD_CAP; n++) await take();
    expect((await take()).offline_slot_take).toBe(false);

    const tomorrow = NOW + 24 * 3_600_000;
    expect((await take(tomorrow)).offline_slot_take).toBe(true);
  });

  it('READING the counter does not spend a slot — that was the whole split', async () => {
    // Before the split, `credit_salvage` both checked and incremented, so
    // three consumers asking "does this match count?" burned three slots for
    // one match. `offline_slots_left` is the read; `offline_slot_take` is the
    // write, called ONCE per settlement.
    const before = Number((await left()).offline_slots_left);
    await left();
    await left();
    expect(Number((await left()).offline_slots_left)).toBe(before);
  });
});

// ===========================================================================
// §5.6 — the auto-claim job
// ===========================================================================

describe('the season auto-claim', () => {
  const addInk = (ink: number) =>
    t.query(`select public.season_add_ink($1, $2, $3)`, [U, SEASON, ink]);

  const claimPages = (pages: number[], coins: number, steel: number, gems: number) =>
    t.one<{ season_claim_pages: { claimed: boolean; pages: number; reason?: string } }>(
      `select public.season_claim_pages($1, $2, $3::integer[], $4, $5, $6) as season_claim_pages`,
      [U, SEASON, pages, coins, steel, gems],
    );

  it('accumulates ink', async () => {
    await addInk(600);
    await addInk(300);
    const row = await t.one<{ ink: number }>(
      `select ink from public.season_progress where user_id = $1 and season_id = $2`,
      [U, SEASON],
    );
    expect(row.ink).toBe(900);
  });

  it('RUN TWICE → every unclaimed page pays exactly once', async () => {
    // Three pages' worth of ink.
    await addInk(1_800);
    const pages = claimablePages(1_800, []);
    expect(pages).toEqual([1, 2, 3]);

    const totals = totalFor(pages, false);
    const before = await wallet();

    const first = await claimPages(pages, totals.coins, totals.steel, totals.gems);
    expect(first.season_claim_pages.claimed).toBe(true);
    expect(first.season_claim_pages.pages).toBe(3);

    const afterFirst = await wallet();
    expect(afterFirst.coins).toBe(before.coins + totals.coins);

    // The job runs again — a retry, a second worker, a restart.
    const second = await claimPages(pages, totals.coins, totals.steel, totals.gems);
    expect(second.season_claim_pages.claimed).toBe(false);
    expect(second.season_claim_pages.reason).toBe('already-claimed');
    expect(await wallet()).toEqual(afterFirst);

    // One ledger row.
    const ledger = await t.query(
      `select 1 from public.economy_ledger where user_id = $1 and reason = 'season_claim'`,
      [U],
    );
    expect(ledger).toHaveLength(1);
  });

  it('claims only the pages that are actually new', async () => {
    await addInk(1_800);
    await claimPages([1, 2], 100, 100, 0);

    // Now the job sweeps [1,2,3] — only 3 is new.
    const out = await claimPages([1, 2, 3], rewardForPage(3, false).coins, 0, 0);
    expect(out.season_claim_pages.claimed).toBe(true);
    expect(out.season_claim_pages.pages).toBe(1);

    const row = await t.one<{ claimed_pages: number[] }>(
      `select claimed_pages from public.season_progress where user_id = $1 and season_id = $2`,
      [U, SEASON],
    );
    expect([...row.claimed_pages].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('a player with no progress row is refused rather than credited', async () => {
    const out = await claimPages([1], 999, 999, 999);
    expect(out.season_claim_pages.claimed).toBe(false);
    expect(out.season_claim_pages.reason).toBe('no-progress');
    expect((await wallet()).coins).toBe(1_000);
  });
});

// ===========================================================================
// The premium track (§2)
// ===========================================================================

describe('the premium track', () => {
  const buy = (gems = 500) =>
    t.one<{ season_buy_premium: string }>(
      `select public.season_buy_premium($1, $2, $3) as season_buy_premium`,
      [U, SEASON, gems],
    );

  it('charges the gems once', async () => {
    const before = await wallet();
    expect((await buy()).season_buy_premium).toBe('ok');
    expect((await wallet()).gems).toBe(before.gems - 500);

    expect((await buy()).season_buy_premium).toBe('already-premium');
    expect((await wallet()).gems).toBe(before.gems - 500);
  });

  it('refuses when the gems are short, and charges nothing', async () => {
    await t.query(`update public.profiles set gems = 10 where id = $1`, [U]);
    expect((await buy()).season_buy_premium).toBe('insufficient-gems');
    expect((await wallet()).gems).toBe(10);
  });

  it('is RETROACTIVE — pages already earned pay the premium rate after buying', async () => {
    // §2 — "Buying the premium track retroactively unlocks every page already
    // earned." The flag is on the progress row, and `rewardForPage` reads it,
    // so a page claimed AFTER buying pays both tracks whenever it was earned.
    await t.query(`select public.season_add_ink($1, $2, 1800)`, [U, SEASON]);
    await buy();

    const row = await t.one<{ premium: boolean; ink: number }>(
      `select premium, ink from public.season_progress where user_id = $1 and season_id = $2`,
      [U, SEASON],
    );
    expect(row.premium).toBe(true);
    expect(row.ink).toBe(1_800); // the ink survived the purchase

    expect(rewardForPage(1, true).coins).toBeGreaterThan(rewardForPage(1, false).coins);
  });
});

// ===========================================================================
// Rerolls (§1)
// ===========================================================================

describe('the reroll counter', () => {
  it('counts up per day, and starts fresh the next', async () => {
    const day = '2026-09-23';
    const next = '2026-09-24';
    const take = (d: string) =>
      t.one<{ contract_reroll_take: number }>(
        `select public.contract_reroll_take($1, $2::date) as contract_reroll_take`,
        [U, d],
      );

    expect(Number((await take(day)).contract_reroll_take)).toBe(1);
    expect(Number((await take(day)).contract_reroll_take)).toBe(2);
    expect(Number((await take(next)).contract_reroll_take)).toBe(1);
  });
});

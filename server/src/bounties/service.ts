/**
 * The Bounty Board and the Captain's Log — part-04 §3.
 *
 * "All claims are idempotent and ledgered. **Progress is never accepted from
 *  the client.**"
 *
 * That second sentence is the shape of this whole file. There is no function
 * here that takes a progress number. `recordMatch`, `recordCity` and
 * `recordRaid` take facts the SERVER already has — a match summary it built
 * from its own event log, a city delta it just applied, a raid it just
 * settled — and the pure evaluator turns those into deltas. A client has no
 * way to reach `contracts_advance`, because nothing routes to it.
 */
import {
  CONTRACTS,
  WEEKLY_SLOTS,
  claimablePages,
  contractById,
  dailySlots,
  deltasFor,
  eligible,
  inkForContract,
  inkForMatch,
  issue,
  reroll,
  rerollCost,
  rewardFor,
  rewardForPage,
  totalFor,
  utcDay,
  withPremium,
  type MetricSource,
} from '@engine/bounties';
import { OFFLINE_REWARD_CAP } from '@engine/city';

import { db } from '../db';
import { isEnabled } from '../features';

export type BountyError =
  | 'feature-off'
  | 'no-profile'
  | 'not-claimable'
  | 'not-enough-gems'
  | 'no-alternative'
  | 'unknown-slot'
  | 'internal';

export type Outcome<T> = { ok: true; body: T } | { ok: false; error: BountyError };

const fail = (error: BountyError): Outcome<never> => ({ ok: false, error });

export function bountiesEnabled(): boolean {
  return isEnabled('portCity.bounties');
}

// ---------------------------------------------------------------------------
// The data seam
// ---------------------------------------------------------------------------

type LooseRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const client = db();
  const rpc = client.rpc.bind(client) as unknown as LooseRpc;
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

export interface ContractRow {
  readonly slot: number;
  readonly contractId: string;
  readonly progress: number;
  readonly target: number;
  readonly state: 'active' | 'done' | 'claimed';
  readonly scope: 'daily' | 'weekly';
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface BountyRepo {
  contracts(userId: string): Promise<readonly ContractRow[]>;
  issueContracts(userId: string, rows: readonly unknown[]): Promise<number>;
  advance(userId: string, deltas: readonly unknown[]): Promise<number>;
  claimContract(input: {
    userId: string;
    slot: number;
    coins: number;
    steel: number;
    gems: number;
    ink: number;
    seasonId: number;
  }): Promise<boolean>;
  rerollsToday(userId: string, day: string): Promise<number>;
  takeReroll(userId: string, day: string): Promise<number>;
  seasonProgress(userId: string, seasonId: number): Promise<{ ink: number; premium: boolean; claimed: number[] } | null>;
  addInk(userId: string, seasonId: number, ink: number): Promise<number>;
  claimPages(input: {
    userId: string;
    seasonId: number;
    pages: readonly number[];
    coins: number;
    steel: number;
    gems: number;
  }): Promise<{ claimed: boolean; pages: number }>;
  buyPremium(userId: string, seasonId: number, gems: number): Promise<string>;
  takeOfflineSlot(userId: string, cap: number, now: number): Promise<boolean>;
  harbourOfficeLevel(userId: string): Promise<number>;
  currentSeason(now: number): Promise<number>;
}

const ms = (v: unknown): number => (v ? Date.parse(String(v)) : 0);

export const supabaseBountyRepo: BountyRepo = {
  async contracts(userId) {
    const client = db();
    const { data } = await (client.from('contracts' as never) as never as {
      select: (c: string) => { eq: (k: string, v: unknown) => Promise<{ data: unknown }> };
    })
      .select('*')
      .eq('user_id', userId);
    return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
      slot: Number(r.slot),
      contractId: String(r.contract_id),
      progress: Number(r.progress ?? 0),
      target: Number(r.target ?? 1),
      state: String(r.state) as ContractRow['state'],
      scope: String(r.scope) as ContractRow['scope'],
      issuedAt: ms(r.issued_at),
      expiresAt: ms(r.expires_at),
    }));
  },

  async issueContracts(userId, rows) {
    return Number(await call('contracts_issue', { p_user_id: userId, p_rows: rows }));
  },

  async advance(userId, deltas) {
    return Number(await call('contracts_advance', { p_user_id: userId, p_deltas: deltas }));
  },

  async claimContract(input) {
    const data = (await call('contract_claim', {
      p_user_id: input.userId,
      p_slot: input.slot,
      p_coins: input.coins,
      p_steel: input.steel,
      p_gems: input.gems,
      p_ink: input.ink,
      p_season: input.seasonId,
    })) as { claimed?: boolean } | null;
    return data?.claimed === true;
  },

  async rerollsToday(userId, day) {
    const client = db();
    const { data } = await (client.from('contract_rerolls' as never) as never as {
      select: (c: string) => {
        eq: (k: string, v: unknown) => { eq: (k: string, v: unknown) => { maybeSingle: () => Promise<{ data: unknown }> } };
      };
    })
      .select('used')
      .eq('user_id', userId)
      .eq('day', day)
      .maybeSingle();
    return Number((data as { used?: number } | null)?.used ?? 0);
  },

  async takeReroll(userId, day) {
    return Number(await call('contract_reroll_take', { p_user_id: userId, p_day: day }));
  },

  async seasonProgress(userId, seasonId) {
    const client = db();
    const { data } = await (client.from('season_progress' as never) as never as {
      select: (c: string) => {
        eq: (k: string, v: unknown) => { eq: (k: string, v: unknown) => { maybeSingle: () => Promise<{ data: unknown }> } };
      };
    })
      .select('*')
      .eq('user_id', userId)
      .eq('season_id', seasonId)
      .maybeSingle();
    const row = data as { ink?: number; premium?: boolean; claimed_pages?: number[] } | null;
    return row ? { ink: row.ink ?? 0, premium: row.premium === true, claimed: row.claimed_pages ?? [] } : null;
  },

  async addInk(userId, seasonId, ink) {
    return Number(await call('season_add_ink', { p_user_id: userId, p_season: seasonId, p_ink: ink }));
  },

  async claimPages(input) {
    const data = (await call('season_claim_pages', {
      p_user_id: input.userId,
      p_season: input.seasonId,
      p_pages: input.pages,
      p_coins: input.coins,
      p_steel: input.steel,
      p_gems: input.gems,
    })) as { claimed?: boolean; pages?: number } | null;
    return { claimed: data?.claimed === true, pages: data?.pages ?? 0 };
  },

  async buyPremium(userId, seasonId, gems) {
    return String(await call('season_buy_premium', { p_user_id: userId, p_season: seasonId, p_gems: gems }));
  },

  async takeOfflineSlot(userId, cap, now) {
    return (await call('offline_slot_take', { p_user_id: userId, p_cap: cap, p_now: now })) === true;
  },

  async harbourOfficeLevel(userId) {
    const rows = (await call('city_load', { p_user_id: userId, p_now: Date.now() })) as
      | { state?: { buildings?: Record<string, { level?: number }> } }[]
      | null;
    return rows?.[0]?.state?.buildings?.harbour_office?.level ?? 0;
  },

  async currentSeason(now) {
    const client = db();
    const { data } = await (client.from('season' as never) as never as {
      select: (c: string) => { limit: (n: number) => Promise<{ data: unknown }> };
    })
      .select('id')
      .limit(1);
    void now;
    return Number((data as { id?: number }[] | null)?.[0]?.id ?? 1);
  },
};

let active: BountyRepo = supabaseBountyRepo;
export function bountyRepo(): BountyRepo {
  return active;
}
export function __setBountyRepoForTests(repo: BountyRepo | null): void {
  active = repo ?? supabaseBountyRepo;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export interface BoardView {
  readonly contracts: readonly (ContractRow & {
    readonly title: string;
    readonly tier: string;
    readonly reward: ReturnType<typeof rewardFor>;
  })[];
  readonly rerollsUsed: number;
  readonly nextRerollGems: number;
  readonly serverNow: number;
}

/** Reads the board, issuing a fresh set when the old one has expired. */
export async function readBoard(
  userId: string,
  now: number,
  flags: ReadonlySet<string>,
): Promise<Outcome<BoardView>> {
  if (!bountiesEnabled()) return fail('feature-off');

  const repo = bountyRepo();
  let rows = await repo.contracts(userId);

  // §1 — reset 00:00 UTC (daily) and Monday 00:00 UTC (weekly). Anything past
  // its expiry is reissued, which is also what makes a first read work.
  const stale = rows.filter((row) => row.expiresAt <= now);
  if (stale.length > 0 || rows.length === 0) {
    const slots = dailySlots(await repo.harbourOfficeLevel(userId));
    const pool = CONTRACTS.filter((c) => !c.requires || flags.has(c.requires));
    const seed = Math.floor(now / 86_400_000);

    const daily = issue(pool, 'daily', slots, now, seed, 0);
    const weekly = issue(pool, 'weekly', WEEKLY_SLOTS, now, seed + 1, 100);

    const fresh = [...daily, ...weekly]
      .filter((row) => {
        const existing = rows.find((r) => r.slot === row.slot);
        return !existing || existing.expiresAt <= now;
      })
      .map((row) => ({ ...row, expiresAt: new Date(row.expiresAt).toISOString() }));

    if (fresh.length > 0) {
      await repo.issueContracts(userId, fresh);
      rows = await repo.contracts(userId);
    }
  }

  const day = utcDay(now);
  const used = await repo.rerollsToday(userId, day);
  const season = await repo.currentSeason(now);
  const progress = await repo.seasonProgress(userId, season);

  return {
    ok: true,
    body: {
      contracts: rows.map((row) => {
        const contract = contractById(row.contractId);
        return {
          ...row,
          title: contract?.title ?? row.contractId,
          tier: contract?.tier ?? 'easy',
          reward: rewardFor(contract?.tier ?? 'easy', row.scope),
        };
      }),
      rerollsUsed: used,
      nextRerollGems: rerollCost(used, progress?.premium ?? false).gems,
      serverNow: now,
    },
  };
}

/** §1 — "claim is a tap — never auto-claim, the stamp is the payoff". */
export async function claimContract(userId: string, slot: number, now: number): Promise<Outcome<{ claimed: boolean }>> {
  if (!bountiesEnabled()) return fail('feature-off');

  const repo = bountyRepo();
  const row = (await repo.contracts(userId)).find((r) => r.slot === slot);
  if (!row) return fail('unknown-slot');

  const contract = contractById(row.contractId);
  if (!contract) return fail('unknown-slot');

  const season = await repo.currentSeason(now);
  const progress = await repo.seasonProgress(userId, season);
  const reward = rewardFor(contract.tier, row.scope);
  const ink = withPremium(inkForContract(contract.tier, row.scope), progress?.premium ?? false);

  const claimed = await repo.claimContract({
    userId,
    slot,
    coins: reward.coins,
    steel: reward.steel,
    gems: reward.gems,
    ink,
    seasonId: season,
  });
  return claimed ? { ok: true, body: { claimed: true } } : fail('not-claimable');
}

export async function rerollContract(
  userId: string,
  slot: number,
  now: number,
  gems: number,
  flags: ReadonlySet<string>,
): Promise<Outcome<{ contractId: string; gems: number }>> {
  if (!bountiesEnabled()) return fail('feature-off');

  const repo = bountyRepo();
  const rows = await repo.contracts(userId);
  const row = rows.find((r) => r.slot === slot);
  const contract = row ? contractById(row.contractId) : null;
  if (!row || !contract) return fail('unknown-slot');

  const day = utcDay(now);
  const used = await repo.rerollsToday(userId, day);
  const season = await repo.currentSeason(now);
  const progress = await repo.seasonProgress(userId, season);

  // §1 — "never returns the same contract twice in a day". Everything this
  // slot has held today, which is the slot's own history.
  const seen = rows.filter((r) => r.slot === slot).map((r) => r.contractId);
  const pool = eligible(row.scope, flags);

  const result = reroll(
    contract,
    pool,
    seen,
    used,
    gems,
    progress?.premium ?? false,
    Math.floor(now / 1_000) + slot,
  );
  if (!result.ok) return fail(result.error === 'not-enough-gems' ? 'not-enough-gems' : 'no-alternative');

  await repo.takeReroll(userId, day);
  const drawn = contractById(result.contractId)!;
  await repo.issueContracts(userId, [
    {
      slot,
      contractId: drawn.id,
      target: drawn.target,
      scope: drawn.scope,
      expiresAt: new Date(row.expiresAt).toISOString(),
    },
  ]);

  return { ok: true, body: { contractId: drawn.id, gems: result.gems } };
}

// ---------------------------------------------------------------------------
// Progress — server-side only (§3)
// ---------------------------------------------------------------------------

/**
 * Called by the match settlement, in the same transaction that credits points,
 * coins and salvage (§1). `withinDailyCap` comes from `offline_slot_take`,
 * which is the ONE place the cap is decided (§5.5).
 */
export async function recordProgress(
  userId: string,
  source: MetricSource,
  now: number,
  withinDailyCap = true,
): Promise<number> {
  if (!bountiesEnabled()) return 0;

  const repo = bountyRepo();
  const rows = await repo.contracts(userId);
  const active = rows
    .filter((row) => row.state === 'active' && row.expiresAt > now)
    .map((row) => ({ contractId: row.contractId, metric: contractById(row.contractId)?.metric }))
    .filter((row): row is { contractId: string; metric: NonNullable<typeof row.metric> } => !!row.metric);

  const deltas = deltasFor(active, source, withinDailyCap);
  if (deltas.length === 0) return 0;
  return repo.advance(userId, deltas);
}

/** §2's ink from a played match, under the same cap. */
export async function recordMatchInk(
  userId: string,
  won: boolean,
  online: boolean,
  now: number,
  withinDailyCap = true,
): Promise<number> {
  if (!bountiesEnabled()) return 0;
  if (!online && !withinDailyCap) return 0;

  const repo = bountyRepo();
  const season = await repo.currentSeason(now);
  const progress = await repo.seasonProgress(userId, season);
  return repo.addInk(userId, season, withPremium(inkForMatch(won), progress?.premium ?? false));
}

/**
 * The one call a match settlement makes. Takes the offline slot ONCE and
 * hands the answer to both consumers — which is the whole reason
 * `offline_slot_take` was split out of `credit_salvage`.
 */
export async function settleMatchExtras(
  userId: string,
  source: MetricSource,
  input: { won: boolean; online: boolean },
  now: number,
): Promise<{ withinCap: boolean; contractsMoved: number; ink: number }> {
  if (!bountiesEnabled()) return { withinCap: true, contractsMoved: 0, ink: 0 };

  const withinCap = input.online
    ? true
    : await bountyRepo().takeOfflineSlot(userId, OFFLINE_REWARD_CAP, now);

  const contractsMoved = await recordProgress(userId, source, now, withinCap);
  const ink = await recordMatchInk(userId, input.won, input.online, now, withinCap);
  return { withinCap, contractsMoved, ink };
}

// ---------------------------------------------------------------------------
// The Log
// ---------------------------------------------------------------------------

export interface LogView {
  readonly ink: number;
  readonly premium: boolean;
  readonly claimed: readonly number[];
  readonly claimable: readonly number[];
  readonly seasonId: number;
  readonly serverNow: number;
}

export async function readLog(userId: string, now: number): Promise<Outcome<LogView>> {
  if (!bountiesEnabled()) return fail('feature-off');

  const repo = bountyRepo();
  const season = await repo.currentSeason(now);
  const progress = (await repo.seasonProgress(userId, season)) ?? {
    ink: 0,
    premium: false,
    claimed: [],
  };

  return {
    ok: true,
    body: {
      ink: progress.ink,
      premium: progress.premium,
      claimed: progress.claimed,
      claimable: claimablePages(progress.ink, progress.claimed),
      seasonId: season,
      serverNow: now,
    },
  };
}

export async function claimLogPages(
  userId: string,
  pages: readonly number[],
  now: number,
): Promise<Outcome<{ pages: number }>> {
  if (!bountiesEnabled()) return fail('feature-off');

  const repo = bountyRepo();
  const season = await repo.currentSeason(now);
  const progress = await repo.seasonProgress(userId, season);
  if (!progress) return fail('not-claimable');

  // Only pages actually EARNED. A client asking for page 30 on 0 ink gets
  // nothing, because the earned set is computed here from the server's ink.
  const earned = new Set(claimablePages(progress.ink, progress.claimed));
  const allowed = pages.filter((page) => earned.has(page));
  if (allowed.length === 0) return fail('not-claimable');

  const totals = totalFor(allowed, progress.premium);
  const result = await repo.claimPages({
    userId,
    seasonId: season,
    pages: allowed,
    coins: totals.coins,
    steel: totals.steel,
    gems: totals.gems,
  });
  return result.claimed ? { ok: true, body: { pages: result.pages } } : fail('not-claimable');
}

/** §5.6 — the auto-claim job. Idempotent: the SQL refuses a page twice. */
export async function autoClaimSeason(userId: string, now: number): Promise<number> {
  const out = await claimLogPages(userId, await allClaimable(userId, now), now);
  return out.ok ? out.body.pages : 0;
}

async function allClaimable(userId: string, now: number): Promise<number[]> {
  const log = await readLog(userId, now);
  return log.ok ? [...log.body.claimable] : [];
}

export async function buyPremium(userId: string, now: number): Promise<Outcome<{ bought: boolean }>> {
  if (!bountiesEnabled()) return fail('feature-off');
  const repo = bountyRepo();
  const season = await repo.currentSeason(now);
  const outcome = await repo.buyPremium(userId, season, 500);
  if (outcome === 'insufficient-gems') return fail('not-enough-gems');
  return { ok: true, body: { bought: outcome === 'ok' } };
}

export { rewardForPage };

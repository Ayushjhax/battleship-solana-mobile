/**
 * The Naval Academy's research endpoints — part-05 §5.
 *
 * Closes DECISIONS.md D23. Three operations, all in the same shape as the
 * city's other mutations: load under a version, run the PURE rules, write with
 * `where version = :version`, retry once on a conflict.
 *
 * §5 — "Unlocks are stored server-side ... and the server validates every
 * submitted layout against them: an item you have not researched is a
 * rejected layout, not a silent drop." That validation happens wherever a
 * layout is checked (`validateSubmission`, `validateHarbour`, `validateKit`);
 * this file is what fills the list those three read.
 */
import {
  EMPTY_RESEARCH,
  researchSpec,
  rushResearch,
  settleResearch,
  speedUpGems,
  startResearch,
  type ResearchError,
  type ResearchState,
} from '@engine/city';
import type { ArsenalKind } from '@engine/types';

import { isEnabled } from '../features';
import { db } from '../db';

export type ResearchApiError = ResearchError | 'feature-off' | 'no-profile' | 'version-conflict';

export type ResearchOutcome =
  | { readonly ok: true; readonly body: ResearchView }
  | { readonly ok: false; readonly error: ResearchApiError };

export interface ResearchView {
  readonly unlocks: readonly string[];
  readonly job: ResearchState['job'];
  readonly academyLevel: number;
  readonly serverNow: number;
}

const STATUS: Record<string, number> = {
  'feature-off': 409,
  'no-profile': 404,
  'version-conflict': 409,
};

export function statusForResearch(error: ResearchApiError): number {
  return STATUS[error] ?? 409;
}

export function academyEnabled(): boolean {
  return isEnabled('portCity.academy');
}

// ---------------------------------------------------------------------------
// The data seam (small enough to live here rather than in its own repo file)
// ---------------------------------------------------------------------------

export interface ResearchRow {
  readonly state: ResearchState;
  readonly academyLevel: number;
  readonly coins: number;
  readonly gems: number;
  readonly version: number;
}

export interface ResearchRepo {
  load(userId: string): Promise<ResearchRow | null>;
  apply(input: {
    userId: string;
    expectedVersion: number;
    state: ResearchState;
    dCoins: number;
    dGems: number;
    reason: string;
  }): Promise<boolean>;
}

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

export const supabaseResearchRepo: ResearchRepo = {
  async load(userId) {
    const rows = (await call('research_load', { p_user_id: userId })) as
      | {
          unlocks: string[] | null;
          research: ResearchState['job'] | null;
          academy_level: number;
          coins: number;
          gems: number;
        }[]
      | null;
    const row = rows?.[0];
    if (!row) return null;

    const versionRows = (await call('city_load', { p_user_id: userId, p_now: Date.now() })) as
      | { version: number }[]
      | null;

    return {
      state: { unlocks: (row.unlocks ?? []) as ArsenalKind[], job: row.research ?? null },
      academyLevel: row.academy_level,
      coins: row.coins,
      gems: row.gems,
      version: versionRows?.[0]?.version ?? 1,
    };
  },

  async apply(input) {
    const data = await call('research_apply', {
      p_user_id: input.userId,
      p_expected_version: input.expectedVersion,
      p_unlocks: input.state.unlocks,
      p_research: input.state.job,
      p_d_coins: input.dCoins,
      p_d_gems: input.dGems,
      p_reason: input.reason,
    });
    return data !== null && data !== undefined;
  },
};

let active: ResearchRepo = supabaseResearchRepo;
export function researchRepo(): ResearchRepo {
  return active;
}
export function __setResearchRepoForTests(repo: ResearchRepo | null): void {
  active = repo ?? supabaseResearchRepo;
}

// ---------------------------------------------------------------------------
// The three operations
// ---------------------------------------------------------------------------

function view(row: ResearchRow, state: ResearchState, now: number): ResearchView {
  return {
    unlocks: state.unlocks,
    job: state.job,
    academyLevel: row.academyLevel,
    serverNow: now,
  };
}

/** Reads, settling any finished job on the way out (§5's "settle on read"). */
export async function readResearch(userId: string, now: number): Promise<ResearchOutcome> {
  if (!academyEnabled()) return { ok: false, error: 'feature-off' };

  const row = await researchRepo().load(userId);
  if (!row) return { ok: false, error: 'no-profile' };

  const settled = settleResearch(row.state, now);
  if (settled !== row.state) {
    // A job finished while nobody was looking. Persist it, but do not fail the
    // read if the write races — the next read settles it again.
    await researchRepo().apply({
      userId,
      expectedVersion: row.version,
      state: settled,
      dCoins: 0,
      dGems: 0,
      reason: 'research_done',
    });
  }
  return { ok: true, body: view(row, settled, now) };
}

export async function beginResearch(
  userId: string,
  item: ArsenalKind,
  now: number,
): Promise<ResearchOutcome> {
  if (!academyEnabled()) return { ok: false, error: 'feature-off' };
  if (!researchSpec(item)) return { ok: false, error: 'unknown-item' };

  // One retry on a version conflict, exactly like every city mutation.
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await researchRepo().load(userId);
    if (!row) return { ok: false, error: 'no-profile' };

    const settled = settleResearch(row.state, now);
    const result = startResearch(settled, item, row.academyLevel, row.coins, now);
    if (!result.ok) return { ok: false, error: result.error };

    const written = await researchRepo().apply({
      userId,
      expectedVersion: row.version,
      state: result.state,
      dCoins: result.dCoins,
      dGems: result.dGems,
      reason: 'research_start',
    });
    if (written) return { ok: true, body: view(row, result.state, now) };
  }
  return { ok: false, error: 'version-conflict' };
}

export async function rushResearchNow(userId: string, now: number): Promise<ResearchOutcome> {
  if (!academyEnabled()) return { ok: false, error: 'feature-off' };

  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await researchRepo().load(userId);
    if (!row) return { ok: false, error: 'no-profile' };

    const settled = settleResearch(row.state, now);
    if (!settled.job) return { ok: false, error: 'not-researching' };

    // §5 — "the same formula as buildings". One function, one formula.
    const cost = speedUpGems(Math.max(0, Math.ceil((settled.job.endsAt - now) / 1_000)));
    const result = rushResearch(settled, cost, row.gems, now);
    if (!result.ok) return { ok: false, error: result.error };

    const written = await researchRepo().apply({
      userId,
      expectedVersion: row.version,
      state: result.state,
      dCoins: result.dCoins,
      dGems: result.dGems,
      reason: 'research_rush',
    });
    if (written) return { ok: true, body: view(row, result.state, now) };
  }
  return { ok: false, error: 'version-conflict' };
}

/**
 * The list every layout validator reads. Empty when the feature is off, which
 * is the safe direction: an unresearched item is a REJECTED layout, so "off"
 * means "the three Academy items cannot be submitted at all".
 */
export async function unlocksOf(userId: string): Promise<readonly string[]> {
  if (!academyEnabled()) return [];
  const row = await researchRepo().load(userId);
  return row ? settleResearch(row.state, Date.now()).unlocks : [];
}

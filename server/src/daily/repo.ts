/**
 * The data-access seam for the Gazette, the puzzle and voyages — part-09 §4.
 *
 * Same shape as `server/src/raid/repo.ts` and `server/src/city/repo.ts`, so
 * the integration tests drive the REAL service against a real Postgres (PGlite
 * running the real 0021) rather than a hand-written fake.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SECRECY NOTE, twice over.
 *
 * `puzzleLayout()` and `skirmishBoard()` return server-only data: the day's
 * board, and the 5x5 layout a submitted log is replayed against. They exist
 * because the service needs them to resolve a shot and to verify a log. NOTHING
 * above this file may put either into a response — the puzzle answers with
 * `puzzleView()` (which has no field that could hold a layout) and the skirmish
 * answers with a verdict.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { Marks, Ship } from '@engine/types';
import type { SkirmishShip, VoyageReward } from '@engine/voyages';

import { db } from '../db';

/**
 * A narrow, deliberately untyped seam. `src/net/database.types.ts` is
 * generated from the live schema, which is at ~0009 (DECISIONS.md D31) and so
 * knows none of 0021's functions. Delete this after regenerating against a
 * project with the migration applied.
 */
type LooseRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(): LooseRpc {
  const client = db();
  return client.rpc.bind(client) as unknown as LooseRpc;
}

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await rpc()(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Gazette
// ---------------------------------------------------------------------------

export interface GazetteRow {
  readonly edition: unknown;
  readonly fresh: boolean;
  readonly readAt: string | null;
}

export interface DailyRepo {
  // ---- gazette ----
  gazetteGetOrCreate(userId: string, date: string, edition: unknown): Promise<GazetteRow>;
  gazetteMarkRead(userId: string, date: string): Promise<void>;

  // ---- puzzle ----
  puzzleEnsure(date: string, layout: readonly Ship[], par: number): Promise<number>;
  /** SERVER ONLY. */
  puzzleLayout(date: string): Promise<readonly Ship[] | null>;
  puzzleRunOpen(userId: string, date: string): Promise<StoredRun>;
  puzzleRunFire(params: FireParams): Promise<FireResult>;
  puzzleSettle(params: SettleParams): Promise<{ paid: boolean; streak?: number; reason?: string }>;
  puzzleLastSolved(userId: string, before: string): Promise<{ date: string; streak: number } | null>;
  puzzleLeaderboard(date: string, limit: number): Promise<readonly LeaderRow[]>;
  myPuzzlePlace(
    userId: string,
    date: string,
  ): Promise<{ place: number; shots: number; seconds: number } | null>;

  // ---- voyages ----
  voyageSend(params: SendParams): Promise<{ ok: boolean; reason?: string; returnsAt?: string }>;
  voyageList(userId: string): Promise<readonly VoyageRow[]>;
  voyageCollect(params: CollectParams): Promise<CollectResult>;
  /** SERVER ONLY. */
  skirmishBoard(voyageId: string): Promise<SkirmishBoard | null>;
  skirmishRecord(voyageId: string, log: unknown, result: string): Promise<{ ok: boolean; reason?: string }>;
  skirmishExpire(before: number): Promise<number>;
}

export interface StoredRun {
  readonly marks: Marks;
  readonly shots: number;
  readonly hits: number;
  readonly finished: boolean;
  readonly finishedAt: string | null;
  readonly streak: number;
  readonly startedAt: string;
}

export interface FireParams {
  readonly userId: string;
  readonly date: string;
  readonly marks: Marks;
  readonly shots: number;
  readonly hits: number;
  readonly finished: boolean;
}

export type FireResult =
  | { readonly ok: true; readonly marks: Marks; readonly shots: number; readonly finished: boolean }
  | { readonly ok: false; readonly reason: string };

export interface SettleParams {
  readonly userId: string;
  readonly date: string;
  readonly streak: number;
  readonly coins: number;
  readonly steel: number;
  readonly gems: number;
  readonly ink: number;
  readonly season: number | null;
}

export interface LeaderRow {
  readonly place: number;
  readonly name: string;
  readonly avatarId: number;
  readonly shots: number;
  readonly seconds: number;
}

export interface SendParams {
  readonly id: string;
  readonly userId: string;
  readonly route: string;
  readonly slot: number;
  readonly slots: number;
  readonly returnsAt: number;
  readonly reward: VoyageReward;
  readonly pirate: boolean;
  readonly seed: number;
  readonly layout: readonly SkirmishShip[];
}

export interface VoyageRow {
  readonly id: string;
  readonly route: string;
  readonly slot: number;
  readonly sentAt: number;
  readonly returnsAt: number;
  readonly reward: VoyageReward;
  readonly pirate: boolean;
  readonly state: string;
}

export interface CollectParams {
  readonly id: string;
  readonly userId: string;
  readonly coins: number;
  readonly steel: number;
  readonly gems: number;
  readonly result: string;
}

export interface CollectResult {
  readonly paid: boolean;
  readonly reason?: string;
  readonly coins: number;
  readonly steel: number;
  readonly gems: number;
}

export interface SkirmishBoard {
  readonly seed: number;
  readonly layout: readonly SkirmishShip[];
  readonly settledAt: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const dailyRepo: DailyRepo = {
  // ---- gazette ----
  async gazetteGetOrCreate(userId, date, edition) {
    const row = asRecord(
      await call('gazette_get_or_create', {
        p_user_id: userId,
        p_date: date,
        p_edition: edition,
      }),
    );
    return {
      edition: row.edition ?? null,
      fresh: row.fresh === true,
      readAt: typeof row.readAt === 'string' ? row.readAt : null,
    };
  },

  async gazetteMarkRead(userId, date) {
    await call('gazette_mark_read', { p_user_id: userId, p_date: date });
  },

  // ---- puzzle ----
  async puzzleEnsure(date, layout, par) {
    const value = await call('puzzle_ensure', { p_date: date, p_layout: layout, p_par: par });
    return num(value, par);
  },

  async puzzleLayout(date) {
    const value = await call('puzzle_layout_internal', { p_date: date });
    return Array.isArray(value) ? (value as Ship[]) : null;
  },

  async puzzleRunOpen(userId, date) {
    const row = asRecord(await call('puzzle_run_open', { p_user_id: userId, p_date: date }));
    return {
      marks: (row.marks ?? {}) as Marks,
      shots: num(row.shots),
      hits: num(row.hits),
      finished: row.finished === true,
      finishedAt: typeof row.finishedAt === 'string' ? row.finishedAt : null,
      streak: num(row.streak),
      startedAt: typeof row.startedAt === 'string' ? row.startedAt : new Date().toISOString(),
    };
  },

  async puzzleRunFire(params) {
    const row = asRecord(
      await call('puzzle_run_fire', {
        p_user_id: params.userId,
        p_date: params.date,
        p_marks: params.marks,
        p_shots: params.shots,
        p_hits: params.hits,
        p_finished: params.finished,
      }),
    );
    if (row.ok !== true) return { ok: false, reason: String(row.reason ?? 'refused') };
    return {
      ok: true,
      marks: (row.marks ?? {}) as Marks,
      shots: num(row.shots),
      finished: row.finished === true,
    };
  },

  async puzzleSettle(params) {
    const row = asRecord(
      await call('puzzle_settle', {
        p_user_id: params.userId,
        p_date: params.date,
        p_streak: params.streak,
        p_coins: params.coins,
        p_steel: params.steel,
        p_gems: params.gems,
        p_ink: params.ink,
        p_season: params.season,
      }),
    );
    return {
      paid: row.paid === true,
      streak: typeof row.streak === 'number' ? row.streak : undefined,
      reason: typeof row.reason === 'string' ? row.reason : undefined,
    };
  },

  async puzzleLastSolved(userId, before) {
    const row = await call('puzzle_last_solved', { p_user_id: userId, p_before: before });
    if (!row || typeof row !== 'object') return null;
    const record = asRecord(row);
    return typeof record.date === 'string'
      ? { date: record.date, streak: num(record.streak) }
      : null;
  },

  async puzzleLeaderboard(date, limit) {
    const rows = await call('puzzle_leaderboard', { p_date: date, p_limit: limit });
    if (!Array.isArray(rows)) return [];
    return rows.map((raw) => {
      const row = asRecord(raw);
      return {
        place: num(row.place),
        name: String(row.name ?? ''),
        avatarId: num(row.avatar_id),
        shots: num(row.shots),
        seconds: num(row.seconds),
      };
    });
  },

  async myPuzzlePlace(userId, date) {
    const row = await call('my_puzzle_place', { p_user_id: userId, p_date: date });
    if (!row || typeof row !== 'object') return null;
    const record = asRecord(row);
    return { place: num(record.place), shots: num(record.shots), seconds: num(record.seconds) };
  },

  // ---- voyages ----
  async voyageSend(params) {
    const row = asRecord(
      await call('voyage_send', {
        p_id: params.id,
        p_user_id: params.userId,
        p_route: params.route,
        p_slot: params.slot,
        p_slots: params.slots,
        p_returns_at: new Date(params.returnsAt).toISOString(),
        p_reward: params.reward,
        p_pirate: params.pirate,
        p_seed: params.seed,
        p_layout: params.layout,
      }),
    );
    return {
      ok: row.ok === true,
      reason: typeof row.reason === 'string' ? row.reason : undefined,
      returnsAt: typeof row.returnsAt === 'string' ? row.returnsAt : undefined,
    };
  },

  async voyageList(userId) {
    const rows = await call('voyage_list', { p_user_id: userId });
    if (!Array.isArray(rows)) return [];
    return rows.map((raw) => {
      const row = asRecord(raw);
      return {
        id: String(row.id ?? ''),
        route: String(row.route ?? ''),
        slot: num(row.slot),
        sentAt: Date.parse(String(row.sent_at ?? '')) || 0,
        returnsAt: Date.parse(String(row.returns_at ?? '')) || 0,
        reward: (row.reward ?? {}) as VoyageReward,
        pirate: row.pirate === true,
        state: String(row.state ?? 'sailing'),
      };
    });
  },

  async voyageCollect(params) {
    const row = asRecord(
      await call('voyage_collect', {
        p_id: params.id,
        p_user_id: params.userId,
        p_coins: params.coins,
        p_steel: params.steel,
        p_gems: params.gems,
        p_result: params.result,
      }),
    );
    return {
      paid: row.paid === true,
      reason: typeof row.reason === 'string' ? row.reason : undefined,
      coins: num(row.coins),
      steel: num(row.steel),
      gems: num(row.gems),
    };
  },

  async skirmishBoard(voyageId) {
    const row = await call('skirmish_internal', { p_voyage_id: voyageId });
    if (!row || typeof row !== 'object') return null;
    const record = asRecord(row);
    return {
      seed: num(record.seed),
      layout: Array.isArray(record.layout) ? (record.layout as SkirmishShip[]) : [],
      settledAt: typeof record.settledAt === 'string' ? record.settledAt : null,
    };
  },

  async skirmishRecord(voyageId, log, result) {
    const row = asRecord(
      await call('skirmish_record', { p_voyage_id: voyageId, p_log: log, p_result: result }),
    );
    return { ok: row.ok === true, reason: typeof row.reason === 'string' ? row.reason : undefined };
  },

  async skirmishExpire(before) {
    const value = await call('skirmish_expire', { p_before: new Date(before).toISOString() });
    return num(value);
  },
};

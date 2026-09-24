/**
 * The raid's data-access seam — the same shape as server/src/city/repo.ts.
 *
 * Everything the service needs from the database is behind this interface, so
 * the tests can drive the REAL service against a real Postgres (PGlite running
 * the real 0016 migration) instead of a hand-written fake.
 *
 * SECRECY NOTE. `loadHarbour` returns the full layout, which is exactly what
 * the raid engine needs and exactly what must never be serialised to a client.
 * Nothing above this file is allowed to put a `HarbourLayout` in a response —
 * see server/src/raid/session.ts, which holds it in memory and answers only
 * with `raidView()`.
 */
import { CITY_CATALOGUE, type BuildingId } from '@engine/city';
import type { HarbourLayout, KitCounts, RaidConfig } from '@engine/raid';

import { db } from '../db';

export interface StoredHarbour {
  readonly layout: HarbourLayout;
  readonly fuelUsed: number;
  readonly valid: boolean;
}

/** Everything the settlement needs about a defender, read at raid START. */
export interface DefenderSnapshot {
  readonly userId: string;
  readonly coins: number;
  readonly steel: number;
  readonly storedCoins: number;
  readonly storedSteel: number;
  readonly scrapPile: number;
  readonly admiraltyLevel: number;
  readonly renown: number;
  /** Which building holds which store, so the drain list can name them. */
  readonly coinBuildings: readonly { id: string; stored: number }[];
  readonly steelBuildings: readonly { id: string; stored: number }[];
}

export interface TargetRow {
  readonly userId: string;
  readonly name: string;
  readonly avatarId: number;
  readonly avatarColor: string;
  readonly countryCode: string | null;
  readonly admiraltyLevel: number;
  readonly renown: number;
}

export interface SearchParams {
  readonly userId: string;
  readonly renown: number;
  /** null = uncapped, after eight searches in a session (§5). */
  readonly window: number | null;
  readonly minAdmiralty: number;
  readonly repeatHours: number;
  readonly limit: number;
}

export interface OpenParams {
  readonly raidId: string;
  readonly attackerId: string;
  readonly defenderId: string | null;
  readonly coveSeed: number | null;
  readonly costCoins: number;
  readonly lockMinutes: number;
  readonly dropShield: boolean;
  readonly layout: HarbourLayout;
  readonly kit: KitCounts;
  readonly config: RaidConfig;
  readonly engineVersion: string;
  readonly requestId?: string;
  readonly response?: unknown;
}

export type OpenResult = 'ok' | 'replay' | 'target-locked' | 'insufficient-coins' | 'raid-in-progress';

export interface DrainEntry {
  readonly building: string;
  readonly resource: 'coins' | 'steel';
  readonly amount: number;
}

export interface SettleParams {
  readonly raidId: string;
  readonly stars: number;
  readonly destruction: number;
  readonly shellsLeft: number;
  readonly endReason: string;
  readonly earnedCoins: number;
  readonly earnedSteel: number;
  readonly drain: readonly DrainEntry[];
  readonly walletCoins: number;
  readonly walletSteel: number;
  readonly renownAttacker: number;
  readonly renownDefender: number;
  readonly shieldHours: number;
  readonly actions: unknown;
  readonly results: unknown;
}

export interface SettleResult {
  readonly applied: boolean;
  readonly reason?: string;
  readonly takenCoins: number;
  readonly takenSteel: number;
}

/** part-07 §4 — one note in the defence log. */
export interface DefenceLogRow {
  readonly raidId: string;
  readonly attackerId: string | null;
  readonly attackerName: string;
  readonly avatarId: number;
  readonly avatarColor: string;
  readonly countryCode: string | null;
  readonly at: string;
  readonly stars: number;
  readonly destruction: number;
  readonly takenCoins: number;
  readonly takenSteel: number;
  readonly renownDelta: number;
  readonly read: boolean;
  readonly revengeAvailable: boolean;
}

/** part-07 §5 — everything a replay needs, as stored at open + settle. */
export interface StoredReplayRow {
  readonly raidId: string;
  readonly attackerId: string;
  readonly defenderId: string | null;
  readonly coveSeed: number | null;
  readonly endedAt: string | null;
  readonly stars: number;
  readonly destruction: number;
  readonly endReason: string | null;
  readonly layout: HarbourLayout;
  readonly kit: KitCounts;
  readonly config: RaidConfig;
  readonly actions: readonly unknown[];
  readonly results: readonly unknown[];
  readonly engineVersion: string;
}

export interface RaidRepo {
  loadHarbour(userId: string): Promise<StoredHarbour | null>;
  saveHarbour(userId: string, layout: HarbourLayout, fuelUsed: number): Promise<void>;
  loadDefender(userId: string): Promise<DefenderSnapshot | null>;
  search(params: SearchParams): Promise<readonly TargetRow[]>;
  open(params: OpenParams): Promise<OpenResult>;
  settle(params: SettleParams): Promise<SettleResult>;
  lookupRequest(userId: string, requestId: string): Promise<unknown | null>;
  sweep(): Promise<void>;
  defenceLog(userId: string, limit: number): Promise<readonly DefenceLogRow[]>;
  markLogRead(userId: string, raidIds: readonly string[]): Promise<number>;
  /** True exactly once per incoming raid — part-07 §8.6. */
  claimRevenge(userId: string, raidId: string): Promise<boolean>;
  loadReplay(raidId: string, userId: string): Promise<StoredReplayRow | null>;
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

/**
 * Same narrow seam as server/src/city/repo.ts: src/net/database.types.ts is
 * generated from the live schema and does not know 0016's functions yet.
 * Delete this after regenerating against a project with the migration applied.
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

interface HarbourRow {
  layout: HarbourLayout;
  fuel_used: number;
  valid: boolean;
}

interface SearchRow {
  user_id: string;
  name: string;
  avatar_id: number;
  avatar_color: string;
  country_code: string | null;
  admiralty_level: number;
  renown: number;
}

export const supabaseRaidRepo: RaidRepo = {
  async loadHarbour(userId) {
    const client = db();
    const { data, error } = await client
      .from('harbour' as never)
      .select('layout, fuel_used, valid')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`loadHarbour(${userId}): ${error.message}`);
    const row = data as HarbourRow | null;
    if (!row) return null;
    return { layout: row.layout, fuelUsed: row.fuel_used, valid: row.valid };
  },

  async saveHarbour(userId, layout, fuelUsed) {
    await call('harbour_save', {
      p_user_id: userId,
      p_layout: layout,
      p_fuel_used: fuelUsed,
    });
  },

  async loadDefender(userId) {
    const data = await call('raid_defender_snapshot', { p_user_id: userId });
    const row = (data as DefenderSnapshotRow[] | null)?.[0];
    return row ? fromSnapshotRow(userId, row) : null;
  },

  async search(params) {
    const data = await call('raid_search', {
      p_user_id: params.userId,
      p_renown: params.renown,
      p_window: params.window,
      p_min_admiralty: params.minAdmiralty,
      p_repeat_hours: params.repeatHours,
      p_limit: params.limit,
    });
    return ((data as SearchRow[] | null) ?? []).map((row) => ({
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
    const data = await call('raid_open', {
      p_raid_id: params.raidId,
      p_attacker_id: params.attackerId,
      p_defender_id: params.defenderId,
      p_cove_seed: params.coveSeed,
      p_cost_coins: params.costCoins,
      p_lock_minutes: params.lockMinutes,
      p_drop_shield: params.dropShield,
      p_layout: params.layout,
      p_kit: params.kit,
      p_config: params.config,
      p_engine_version: params.engineVersion,
      p_request_id: params.requestId ?? null,
      p_response: params.response ?? null,
    });
    return String(data) as OpenResult;
  },

  async settle(params) {
    const data = await call('settle_raid', {
      p_raid_id: params.raidId,
      p_stars: params.stars,
      p_destruction: params.destruction,
      p_shells_left: params.shellsLeft,
      p_end_reason: params.endReason,
      p_earned_coins: params.earnedCoins,
      p_earned_steel: params.earnedSteel,
      p_drain: params.drain,
      p_wallet_coins: params.walletCoins,
      p_wallet_steel: params.walletSteel,
      p_renown_attacker: params.renownAttacker,
      p_renown_defender: params.renownDefender,
      p_shield_hours: params.shieldHours,
      p_actions: params.actions,
      p_results: params.results,
    });
    const row = (data ?? {}) as { applied?: boolean; reason?: string; takenCoins?: number; takenSteel?: number };
    return {
      applied: row.applied === true,
      ...(row.reason ? { reason: row.reason } : {}),
      takenCoins: row.takenCoins ?? 0,
      takenSteel: row.takenSteel ?? 0,
    };
  },

  async lookupRequest(userId, requestId) {
    const data = await call('city_request_lookup', {
      p_user_id: userId,
      p_request_id: requestId,
    });
    return data ?? null;
  },

  async sweep() {
    await call('raid_sweep_expired', {});
  },

  async defenceLog(userId, limit) {
    const data = await call('raid_defence_log', { p_user_id: userId, p_limit: limit });
    return ((data as Record<string, never>[] | null) ?? []).map(toLogRow);
  },

  async markLogRead(userId, raidIds) {
    if (raidIds.length === 0) return 0;
    const data = await call('raid_log_mark_read', {
      p_user_id: userId,
      p_raid_ids: raidIds,
    });
    return Number(data ?? 0);
  },

  async claimRevenge(userId, raidId) {
    const data = await call('raid_claim_revenge', { p_user_id: userId, p_raid_id: raidId });
    return data === true;
  },

  async loadReplay(raidId, userId) {
    const data = await call('raid_replay', { p_raid_id: raidId, p_user_id: userId });
    const row = (data as Record<string, never>[] | null)?.[0];
    return row ? toReplayRow(row) : null;
  },
};

/** The SQL speaks snake_case; the service speaks camelCase. One place. */
export function toLogRow(row: Record<string, never>): DefenceLogRow {
  const r = row as unknown as Record<string, unknown>;
  return {
    raidId: String(r.raid_id),
    attackerId: r.attacker_id === null ? null : String(r.attacker_id),
    attackerName: String(r.attacker_name ?? 'A raider'),
    avatarId: Number(r.avatar_id ?? 0),
    avatarColor: String(r.avatar_color ?? 'violet'),
    countryCode: r.country_code === null || r.country_code === undefined ? null : String(r.country_code),
    at: new Date(String(r.at)).toISOString(),
    stars: Number(r.stars ?? 0),
    destruction: Number(r.destruction ?? 0),
    takenCoins: Number(r.taken_coins ?? 0),
    takenSteel: Number(r.taken_steel ?? 0),
    renownDelta: Number(r.renown_delta ?? 0),
    read: r.read === true,
    revengeAvailable: r.revenge_available === true,
  };
}

export function toReplayRow(row: Record<string, never>): StoredReplayRow {
  const r = row as unknown as Record<string, unknown>;
  return {
    raidId: String(r.raid_id),
    attackerId: String(r.attacker_id),
    defenderId: r.defender_id === null || r.defender_id === undefined ? null : String(r.defender_id),
    coveSeed: r.cove_seed === null || r.cove_seed === undefined ? null : Number(r.cove_seed),
    endedAt: r.ended_at === null || r.ended_at === undefined ? null : new Date(String(r.ended_at)).toISOString(),
    stars: Number(r.stars ?? 0),
    destruction: Number(r.destruction ?? 0),
    endReason: r.end_reason === null || r.end_reason === undefined ? null : String(r.end_reason),
    layout: r.layout as HarbourLayout,
    kit: (r.kit ?? {}) as KitCounts,
    config: r.config as RaidConfig,
    actions: (r.actions ?? []) as readonly unknown[],
    results: (r.results ?? []) as readonly unknown[],
    engineVersion: String(r.engine_version ?? 'unknown'),
  };
}

export interface DefenderSnapshotRow {
  coins: number;
  steel: number;
  scrap_pile: number;
  admiralty_level: number;
  renown: number;
  /** Every building's uncollected store, raw. The SQL does not know what a
   *  Fish Market produces, and it must not: that is catalogue knowledge, and
   *  duplicating it in plpgsql is how the two drift. */
  stores: { id: string; stored: number }[];
}

export function fromSnapshotRow(userId: string, row: DefenderSnapshotRow): DefenderSnapshot {
  const stores = (row.stores ?? []).filter((s) => s.stored > 0);
  const producing = (resource: 'coins' | 'steel') =>
    stores
      .filter((s) => CITY_CATALOGUE[s.id as BuildingId]?.produces === resource)
      .map((s) => ({ id: s.id, stored: s.stored }));

  const coinBuildings = producing('coins');
  const steelBuildings = producing('steel');
  return {
    userId,
    coins: row.coins,
    steel: row.steel,
    storedCoins: coinBuildings.reduce((n, b) => n + b.stored, 0),
    storedSteel: steelBuildings.reduce((n, b) => n + b.stored, 0),
    scrapPile: row.scrap_pile,
    admiraltyLevel: row.admiralty_level,
    renown: row.renown,
    coinBuildings,
    steelBuildings,
  };
}

// ---------------------------------------------------------------------------
// The injection hook, following server/src/auth.ts's convention.
// ---------------------------------------------------------------------------

let active: RaidRepo = supabaseRaidRepo;

export function raidRepo(): RaidRepo {
  return active;
}

export function __setRaidRepoForTests(repo: RaidRepo | null): void {
  active = repo ?? supabaseRaidRepo;
}

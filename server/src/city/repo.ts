/**
 * The city's data-access seam.
 *
 * Everything the service needs from the database is behind this interface, so
 * the route tests can drive the real service against a real Postgres (PGlite,
 * running the real 0014 migration) instead of a hand-written fake. Production
 * uses the Supabase RPC implementation below.
 *
 * The injection hook follows the existing convention in server/src/auth.ts
 * (__resetAuthCacheForTests).
 */
import { db } from '../db';
import type { CityState, LedgerDelta } from '@engine/city';

export interface LoadedCity {
  readonly state: CityState;
  readonly version: number;
  readonly cityVersion: number;
  readonly coins: number;
  readonly steel: number;
  readonly gems: number;
  readonly rankPoints: number;
  /** part-05 §5 — the researched Academy items (migration 0018). */
  readonly unlocks: readonly string[];
}

export interface ApplyInput {
  readonly userId: string;
  readonly expectedVersion: number;
  readonly state: CityState;
  readonly cityVersion: number;
  readonly dCoins: number;
  readonly dSteel: number;
  readonly dGems: number;
  readonly ledger: readonly LedgerDelta[];
  readonly requestId?: string;
  readonly response?: unknown;
}

export interface CityRepo {
  load(userId: string, now: number): Promise<LoadedCity | null>;
  /** The new version, or null on a version conflict. */
  apply(input: ApplyInput): Promise<number | null>;
  lookupRequest(userId: string, requestId: string): Promise<unknown | null>;
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

interface CityLoadRow {
  state: CityState;
  version: number;
  city_version: number;
  coins: number;
  steel: number;
  gems: number;
  rank_points: number;
  /** part-05 §5, added by migration 0018. */
  unlocks: string[] | null;
}

/**
 * src/net/database.types.ts is GENERATED from the live schema
 * (`npx supabase gen types typescript --linked`), so it does not yet know the
 * functions 0014 adds. Until it is regenerated against a project that has the
 * migration applied, the four new RPCs go through this one narrow seam rather
 * than scattering `as never` across the file. Delete it after regenerating.
 */
type LooseRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(): LooseRpc {
  const client = db();
  return client.rpc.bind(client) as unknown as LooseRpc;
}

export const supabaseCityRepo: CityRepo = {
  async load(userId, now) {
    const { data, error } = await rpc()('city_load', {
      p_user_id: userId,
      p_now: now,
    });
    if (error) throw new Error(`city_load(${userId}): ${error.message}`);
    const row = (data as CityLoadRow[] | null)?.[0];
    if (!row) return null;
    return {
      state: row.state,
      version: row.version,
      cityVersion: row.city_version,
      coins: row.coins,
      steel: row.steel,
      gems: row.gems,
      rankPoints: row.rank_points,
      unlocks: row.unlocks ?? [],
    };
  },

  async apply(input) {
    const { data, error } = await rpc()('city_apply', {
      p_user_id: input.userId,
      p_expected_version: input.expectedVersion,
      p_state: input.state,
      p_city_version: input.cityVersion,
      p_d_coins: input.dCoins,
      p_d_steel: input.dSteel,
      p_d_gems: input.dGems,
      p_ledger: input.ledger,
      p_request_id: input.requestId ?? null,
      p_response: input.response ?? null,
    });
    if (error) throw new Error(`city_apply(${input.userId}): ${error.message}`);
    return (data as number | null) ?? null;
  },

  async lookupRequest(userId, requestId) {
    const { data, error } = await rpc()('city_request_lookup', {
      p_user_id: userId,
      p_request_id: requestId,
    });
    if (error) throw new Error(`city_request_lookup(${userId}): ${error.message}`);
    return data ?? null;
  },
};

let active: CityRepo = supabaseCityRepo;

export function cityRepo(): CityRepo {
  return active;
}

/** Test-only: drive the service against a different store. */
export function __setCityRepoForTests(repo: CityRepo | null): void {
  active = repo ?? supabaseCityRepo;
}

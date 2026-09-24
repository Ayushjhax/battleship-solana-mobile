/**
 * The city service — part-01 §4.
 *
 * One shape for every mutation:
 *
 *   requestId already seen?  -> replay the stored response, apply nothing
 *   load row (+version)      -> settle -> run the PURE rules -> write with
 *                               `where version = :version`
 *   version conflict         -> re-read and retry ONCE, then `version-conflict`
 *
 * The rules are src/engine/city. Nothing in this file decides what an action
 * costs or produces; it moves state between the database and the reducer and
 * turns a typed CityError into an HTTP answer.
 *
 * Every response is the WHOLE snapshot plus serverNow (§5's no-partial-diffs
 * rule), so a client that misses a response can never end up half-updated.
 */
import {
  CITY_VERSION,
  buyWorker,
  cancelUpgrade,
  collect,
  collectAll,
  collectableAt,
  freeWorkers,
  migrateToV1,
  settle,
  speedUp,
  startUpgrade,
  type BuildingId,
  type CityActionResult,
  type CityError,
  type CityState,
  type CityTelemetryEvent,
  type CityWorld,
  type LedgerDelta,
} from '@engine/city';
import { isBuildingId } from '@engine/city';

import { cityEnabled, enabledPlotFeatures } from '../features';
import { allowCityAction } from './rateLimit';
import { cityRepo } from './repo';
import { emitCity } from './telemetry';

/** Every code the API can return, including the transport-level ones. */
export type CityApiError = CityError | 'rate-limited' | 'version-conflict' | 'no-profile';

const STATUS: Record<CityApiError, number> = {
  'feature-off': 409,
  'unknown-building': 409,
  'max-level': 409,
  'already-upgrading': 409,
  'no-free-worker': 409,
  'needs-admiralty': 409,
  'not-enough-steel': 409,
  'not-enough-coins': 409,
  'not-enough-gems': 409,
  'not-upgrading': 409,
  'nothing-to-collect': 409,
  'rate-limited': 409,
  'version-conflict': 409,
  'no-profile': 404,
};

export function statusFor(code: CityApiError): number {
  return STATUS[code] ?? 409;
}

export interface CitySnapshot {
  readonly city: CityState;
  readonly wallet: { coins: number; steel: number; gems: number };
  readonly freeWorkers: number;
  readonly collectable: { total: number; ids: readonly BuildingId[] };
  readonly features: readonly string[];
  /**
   * part-05 §5 — the Academy items this player has researched. Served with
   * the city because every caller that needs it (the harbour editor, the raid
   * kit, the placement shop) already has the city snapshot in hand, and a
   * second round trip for three strings would be silly.
   */
  readonly unlocks: readonly string[];
}

export interface CityResponse {
  readonly city: CitySnapshot;
  readonly serverNow: number;
}

export type CityOutcome =
  | { readonly ok: true; readonly body: CityResponse; readonly replayed: boolean }
  | { readonly ok: false; readonly error: CityApiError };

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function snapshot(world: CityWorld, now: number, unlocks: readonly string[] = []): CityResponse {
  return {
    city: {
      city: world.city,
      wallet: world.wallet,
      freeWorkers: freeWorkers(world.city),
      collectable: collectableAt(world, now),
      features: [...enabledPlotFeatures()],
      unlocks,
    },
    serverNow: now,
  };
}

/** Stamps the version a write produced onto the snapshot it answers with. */
function withVersion(body: CityResponse, version: number): CityResponse {
  return {
    ...body,
    city: {
      ...body.city,
      city: { ...body.city.city, version, cityVersion: CITY_VERSION },
    },
  };
}

function totals(ledger: readonly LedgerDelta[]): { coins: number; steel: number; gems: number } {
  return ledger.reduce(
    (sum, row) => ({
      coins: sum.coins + row.dCoins,
      steel: sum.steel + row.dSteel,
      gems: sum.gems + row.dGems,
    }),
    { coins: 0, steel: 0, gems: 0 },
  );
}

// ---------------------------------------------------------------------------
// GET /city — settles, migrates if needed
// ---------------------------------------------------------------------------

export async function readCity(userId: string, now: number): Promise<CityOutcome> {
  if (!cityEnabled()) return { ok: false, error: 'feature-off' };

  const loaded = await cityRepo().load(userId, now);
  if (!loaded) return { ok: false, error: 'no-profile' };

  const world: CityWorld = {
    city: loaded.state,
    wallet: { coins: loaded.coins, steel: loaded.steel, gems: loaded.gems },
  };

  // The lazy v1 migration runs first, then the clock (§2.7).
  const migration = migrateToV1(world, loaded.rankPoints, now);
  const settled = settle(migration.world, now);
  const ledger = [...migration.ledger, ...settled.ledger];

  const changed =
    migration.migrated ||
    ledger.length > 0 ||
    JSON.stringify(settled.world.city) !== JSON.stringify(loaded.state);

  if (!changed) {
    return { ok: true, body: snapshot(settled.world, now), replayed: false };
  }

  const delta = totals(ledger);
  const version = await cityRepo().apply({
    userId,
    expectedVersion: loaded.version,
    state: settled.world.city,
    cityVersion: CITY_VERSION,
    dCoins: delta.coins,
    dSteel: delta.steel,
    dGems: delta.gems,
    ledger,
  });

  // A read losing a race is not worth an error: the other writer's result is
  // just as fresh, so re-read and answer with that.
  if (version === null) {
    const again = await cityRepo().load(userId, now);
    if (!again) return { ok: false, error: 'no-profile' };
    const reWorld: CityWorld = {
      city: again.state,
      wallet: { coins: again.coins, steel: again.steel, gems: again.gems },
    };
    return { ok: true, body: snapshot(settle(reWorld, now).world, now), replayed: false };
  }

  for (const event of settled.events) emitCity(event, userId);
  return {
    ok: true,
    body: withVersion(snapshot(settled.world, now), version),
    replayed: false,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type CityAction =
  | { readonly kind: 'build'; readonly buildingId: string }
  | { readonly kind: 'speedup'; readonly buildingId: string }
  | { readonly kind: 'cancel'; readonly buildingId: string }
  | { readonly kind: 'collect'; readonly buildingId: string }
  | { readonly kind: 'collect-all' }
  | { readonly kind: 'buy-worker' };

function run(world: CityWorld, action: CityAction, now: number): CityActionResult {
  const features = enabledPlotFeatures();
  switch (action.kind) {
    case 'build':
      if (!isBuildingId(action.buildingId)) return { ok: false, error: 'unknown-building' };
      return startUpgrade(world, action.buildingId, now, features);
    case 'speedup':
      if (!isBuildingId(action.buildingId)) return { ok: false, error: 'unknown-building' };
      return speedUp(world, action.buildingId, now);
    case 'cancel':
      if (!isBuildingId(action.buildingId)) return { ok: false, error: 'unknown-building' };
      return cancelUpgrade(world, action.buildingId, now);
    case 'collect':
      if (!isBuildingId(action.buildingId)) return { ok: false, error: 'unknown-building' };
      return collect(world, action.buildingId, now);
    case 'collect-all':
      return collectAll(world, now);
    case 'buy-worker':
      return buyWorker(world, now);
  }
}

export async function actOnCity(
  userId: string,
  action: CityAction,
  requestId: string,
  now: number,
): Promise<CityOutcome> {
  if (!cityEnabled()) return { ok: false, error: 'feature-off' };

  // Idempotency first: a replay must not even count against the rate limit.
  const replay = await cityRepo().lookupRequest(userId, requestId);
  if (replay) return { ok: true, body: replay as CityResponse, replayed: true };

  if (!allowCityAction(userId, now)) return { ok: false, error: 'rate-limited' };

  for (let attempt = 0; attempt < 2; attempt++) {
    const loaded = await cityRepo().load(userId, now);
    if (!loaded) return { ok: false, error: 'no-profile' };

    const world: CityWorld = {
      city: loaded.state,
      wallet: { coins: loaded.coins, steel: loaded.steel, gems: loaded.gems },
    };

    // Migrate and settle before the action, exactly as a read would.
    const migration = migrateToV1(world, loaded.rankPoints, now);
    const settled = settle(migration.world, now);
    const prefix: LedgerDelta[] = [...migration.ledger, ...settled.ledger];
    const prefixEvents: CityTelemetryEvent[] = [...settled.events];

    const result = run(settled.world, action, now);
    if (!result.ok) return { ok: false, error: result.error };

    const ledger = [...prefix, ...result.ledger];
    const delta = totals(ledger);

    // The version the write is ABOUT to produce. city_apply always sets
    // `version = version + 1`, so this is deterministic — and computing it
    // here is what lets the stored response and the returned one be the same
    // object. Storing a body that still carried the pre-write version made a
    // replay differ from the original call, which §8.2.13 forbids.
    const nextVersion = loaded.version + 1;
    const body: CityResponse = withVersion(
      snapshot(result.world, now),
      nextVersion,
    );

    const version = await cityRepo().apply({
      userId,
      expectedVersion: loaded.version,
      state: result.world.city,
      cityVersion: CITY_VERSION,
      dCoins: delta.coins,
      dSteel: delta.steel,
      dGems: delta.gems,
      ledger,
      requestId,
      response: body,
    });

    if (version === null) continue; // someone else wrote first: retry once

    for (const event of [...prefixEvents, ...result.events]) emitCity(event, userId);
    return { ok: true, body, replayed: false };
  }

  return { ok: false, error: 'version-conflict' };
}

export { utcDay };

/**
 * The vocabulary of the Port City economy — docs/port-city/part-01-city-core.md.
 *
 * PURITY: this module imports nothing. Not from react, react-native, expo-*,
 * not from the rest of src/engine, not from anywhere else in src/. The Node
 * match server imports it directly, exactly as it does the match engine.
 * See CLAUDE.md > Engine purity.
 *
 * Time is always a `now: number` parameter (server milliseconds). Nothing here
 * reads a clock or draws a random number.
 *
 * WHERE THE MONEY LIVES. The reference implementation
 * (docs/port-city/reference/src/city.ts) keeps coins/steel/gems inside
 * CityState. This does not: part-01 §3 puts currencies on the profile "so one
 * transaction updates wallet and city together", and that is the only shape
 * that lets the server write both in a single statement. So every action here
 * takes a CityWorld — the city and the wallet — and returns a new one.
 */

export type BuildingId =
  | 'admiralty'
  | 'scrapyard'
  | 'fish_market'
  | 'foundry'
  | 'shipyard'
  | 'stationery'
  | 'harbour_office'
  | 'naval_academy'
  | 'coastal_command'
  | 'armory'
  | 'fleet_hall'
  | 'newsstand'
  | 'trade_docks'
  | 'officers_club'
  | 'lighthouse';

/** What a building is for. Only 'producer' accrues into `stored`. */
export type BuildingKind = 'core' | 'producer' | 'feature';

export type Resource = 'coins' | 'steel';

/**
 * A sunk ship's class, as a plain string. Deliberately NOT imported from
 * ../types: this module imports nothing, so the two are pinned by a test
 * instead (see __tests__/catalogue.test.ts).
 */
export type ShipClassName = 'battleship' | 'cruiser' | 'destroyer' | 'boat';

export interface LevelSpec {
  readonly steel: number;
  readonly coins: number;
  readonly minutes: number;
  readonly reqAdmiralty: number;
  /** Production per hour for producers; the effect value for everything else. */
  readonly value?: number;
}

export interface BuildingSpec {
  readonly id: BuildingId;
  readonly name: string;
  readonly kind: BuildingKind;
  readonly produces?: Resource;
  readonly capacityHours?: number;
  /** The feature flag whose plot this is, minus the `portCity.` prefix. */
  readonly feature?: string;
  /** Index 0 is the cost of reaching level 1. */
  readonly levels: readonly LevelSpec[];
}

export interface UpgradeJob {
  readonly toLevel: number;
  readonly startedAt: number;
  readonly endsAt: number;
}

export interface BuildingState {
  /** 0 = not built. */
  readonly level: number;
  readonly upgrading?: UpgradeJob;
  /** Producers only: what is waiting to be collected. */
  readonly stored: number;
  readonly lastAccrualAt: number;
  /**
   * Producers only: production earned but not yet worth a whole unit, in
   * units of (unit x milliseconds-per-hour), so always in [0, 3_600_000).
   *
   * part-01 §3 does not list this field. It is required to satisfy §2.4's
   * "advance lastAccrualAt by EXACTLY the time those whole units took": the
   * exact time is `add * 3_600_000 / rate`, which is fractional for any rate
   * that does not divide an hour evenly (26/h, 38/h, 54/h...). Rounding it
   * either way makes accrual path-dependent, and the reference implementation
   * demonstrably loses a unit over five hours at 26/h. Carrying the remainder
   * instead is exact. See DECISIONS.md D13.
   */
  readonly carry: number;
}

/** The anti-farm counter from part-01 §2.2. `day` is a UTC YYYY-MM-DD string. */
export interface OfflineRewardCounter {
  readonly day: string;
  readonly count: number;
}

/**
 * The city row. Currencies are deliberately absent — see the header.
 * `version` is the optimistic-concurrency marker the server round-trips;
 * `cityVersion` is the migration marker (0 = never migrated, 1 = v1 done).
 */
export interface CityState {
  readonly version: number;
  readonly cityVersion: number;
  readonly workers: number;
  /** Salvage waiting in the Scrapyard. Uncapped; lootable in Part 6. */
  readonly scrapPile: number;
  /**
   * Which ship classes the salvage came from, newest first, trimmed to the
   * Scrapyard's display slots. part-02 §6 draws these as wrecks; collecting
   * the pile clears them with the steel.
   */
  readonly scrapWrecks: readonly ShipClassName[];
  readonly buildings: Readonly<Record<BuildingId, BuildingState>>;
  readonly updatedAt: number;
  readonly offlineRewardsToday: OfflineRewardCounter;
}

/** The three profile currencies, moved as one unit. */
export interface Wallet {
  readonly coins: number;
  readonly steel: number;
  readonly gems: number;
}

export interface CityWorld {
  readonly city: CityState;
  readonly wallet: Wallet;
}

/**
 * Why a currency moved. One row per change in `economy_ledger`, and a
 * reconciliation test replays them onto the balances (part-01 §3).
 */
export type LedgerReason =
  | 'build'
  | 'cancel'
  | 'speedup'
  | 'collect'
  | 'collect_scrap'
  | 'worker'
  | 'salvage'
  | 'admiralty_gems'
  | 'migration:v1';

export interface LedgerDelta {
  readonly reason: LedgerReason;
  /** Building id, match id, or a grant name. */
  readonly ref: string | null;
  readonly dCoins: number;
  readonly dSteel: number;
  readonly dGems: number;
}

/** Every typed error a city action can produce — part-01 §4. */
export type CityError =
  | 'feature-off'
  | 'unknown-building'
  | 'max-level'
  | 'already-upgrading'
  | 'no-free-worker'
  | 'needs-admiralty'
  | 'not-enough-steel'
  | 'not-enough-coins'
  | 'not-enough-gems'
  | 'not-upgrading'
  | 'nothing-to-collect';

/** part-01 §7. The transport is a stub (DECISIONS D3); the shapes are real. */
export type CityTelemetryEvent =
  | { readonly type: 'city_build_started'; readonly buildingId: BuildingId; readonly toLevel: number; readonly steel: number; readonly coins: number; readonly seconds: number }
  | { readonly type: 'city_build_finished'; readonly buildingId: BuildingId; readonly level: number; readonly viaSpeedup: boolean }
  | { readonly type: 'city_speedup'; readonly buildingId: BuildingId; readonly gems: number; readonly secondsSaved: number }
  | { readonly type: 'city_cancel'; readonly buildingId: BuildingId }
  | { readonly type: 'city_collect'; readonly buildingId: BuildingId; readonly amount: number; readonly resource: Resource }
  | { readonly type: 'city_scrap_collected'; readonly amount: number }
  | { readonly type: 'city_worker_bought'; readonly index: number; readonly gems: number }
  | { readonly type: 'salvage_credited'; readonly matchId: string; readonly amount: number; readonly mode: SalvageMode }
  | { readonly type: 'offline_reward_cap_hit'; readonly day: string };

/** Which path credited salvage. 'tutorial' never reaches the rules — it pays nothing. */
export type SalvageMode = 'online' | 'ai' | 'hotseat';

/**
 * Every action returns this. On success the caller gets a whole new world plus
 * the ledger rows to write and the telemetry to emit; on failure, a typed code
 * and nothing else. There is no partial application.
 */
export type CityActionResult =
  | {
      readonly ok: true;
      readonly world: CityWorld;
      readonly ledger: readonly LedgerDelta[];
      readonly events: readonly CityTelemetryEvent[];
    }
  | { readonly ok: false; readonly error: CityError };

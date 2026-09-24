/**
 * The lazy v1 migration — part-01 §2.7.
 *
 * Triggered on the first GET /city, one transaction per user, idempotent and
 * re-runnable: `cityVersion` is the marker, so a second call is a no-op that
 * grants nothing. No past match is back-paid for salvage.
 */
import { STARTING_GRANT, rankBackPayGems } from './catalogue';
import { newCity } from './actions';
import { openWorld, sealWorld } from './settle';
import type { CityState, CityWorld, LedgerDelta } from './types';

export const CITY_VERSION = 1;

export interface MigrationResult {
  readonly world: CityWorld;
  readonly ledger: readonly LedgerDelta[];
  /** False when the city had already been migrated. */
  readonly migrated: boolean;
}

/** A city row for a profile that has never had one. Not yet migrated. */
export function emptyCityFor(now: number, day: string): CityState {
  return newCity(now, day);
}

/**
 * Applies the v1 grant to a city at `cityVersion: 0`:
 *   - 400 steel and 50 gems (NUMBERS.md > Salvage)
 *   - cumulative gem back-pay for every rank already reached (§2.7)
 *   - one ledger row per grant, reason `migration:v1`
 *   - cityVersion = 1
 */
export function migrateToV1(
  world: CityWorld,
  rankPoints: number,
  now: number,
): MigrationResult {
  if (world.city.cityVersion >= CITY_VERSION) {
    return { world, ledger: [], migrated: false };
  }

  const draft = openWorld(world);
  const ledger: LedgerDelta[] = [];

  draft.steel += STARTING_GRANT.steel;
  draft.gems += STARTING_GRANT.gems;
  ledger.push({
    reason: 'migration:v1',
    ref: 'starting-grant',
    dCoins: 0,
    dSteel: STARTING_GRANT.steel,
    dGems: STARTING_GRANT.gems,
  });

  const backPay = rankBackPayGems(rankPoints);
  if (backPay > 0) {
    draft.gems += backPay;
    ledger.push({
      reason: 'migration:v1',
      ref: 'rank-backpay',
      dCoins: 0,
      dSteel: 0,
      dGems: backPay,
    });
  }

  draft.cityVersion = CITY_VERSION;
  draft.updatedAt = now;

  return { world: sealWorld(draft), ledger, migrated: true };
}

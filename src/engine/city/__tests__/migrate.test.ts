/**
 * The lazy v1 migration — part-01 §2.7 and §8.2.16 (the pure half; the
 * database half lives in the server suite).
 */
import { describe, expect, it } from 'vitest';

import { BUILDING_IDS, CITY_VERSION, emptyCityFor, migrateToV1, settle } from '../index';
import type { CityWorld } from '../types';

const T0 = 1_700_000_000_000;
const DAY = '2023-11-14';

function fresh(coins = 0): CityWorld {
  return { city: emptyCityFor(T0, DAY), wallet: { coins, steel: 0, gems: 0 } };
}

describe('migrateToV1', () => {
  it('starts a fresh profile with the published city', () => {
    const { world, migrated } = migrateToV1(fresh(), 0, T0);

    expect(migrated).toBe(true);
    expect(world.city.cityVersion).toBe(CITY_VERSION);
    expect(world.city.buildings.admiralty.level).toBe(1);
    expect(world.city.buildings.scrapyard.level).toBe(1);
    expect(world.city.workers).toBe(2);
    expect(world.city.scrapPile).toBe(0);

    for (const id of BUILDING_IDS) {
      if (id === 'admiralty' || id === 'scrapyard') continue;
      expect(world.city.buildings[id].level, id).toBe(0);
    }
  });

  it('grants 400 steel and 50 gems, and leaves coins alone', () => {
    const { world, ledger } = migrateToV1(fresh(1_234), 0, T0);

    expect(world.wallet.steel).toBe(400);
    expect(world.wallet.gems).toBe(50);
    expect(world.wallet.coins).toBe(1_234);

    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toEqual({
      reason: 'migration:v1',
      ref: 'starting-grant',
      dCoins: 0,
      dSteel: 400,
      dGems: 50,
    });
  });

  it('back-pays a veteran: Captain gets 150 gems on top of the grant', () => {
    // 10 + 20 + 40 + 80 = 150 cumulative at 3,000 points.
    const { world, ledger } = migrateToV1(fresh(), 3_000, T0);

    expect(world.wallet.gems).toBe(50 + 150);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toEqual({
      reason: 'migration:v1',
      ref: 'rank-backpay',
      dCoins: 0,
      dSteel: 0,
      dGems: 150,
    });
  });

  it('back-pays the full ladder at Vice-admiral', () => {
    const { world } = migrateToV1(fresh(), 10_000, T0);
    expect(world.wallet.gems).toBe(50 + 300);
  });

  it('writes no back-pay row for a profile below the first rank', () => {
    const { ledger } = migrateToV1(fresh(), 99, T0);
    expect(ledger).toHaveLength(1);
  });

  it('is idempotent: a second run grants nothing and changes nothing (§8.2.16)', () => {
    const once = migrateToV1(fresh(), 3_000, T0);
    const twice = migrateToV1(once.world, 3_000, T0 + 60_000);

    expect(twice.migrated).toBe(false);
    expect(twice.ledger).toHaveLength(0);
    expect(twice.world).toEqual(once.world);
  });

  it('stays idempotent even if the rank has since gone up', () => {
    const once = migrateToV1(fresh(), 0, T0);
    const later = migrateToV1(once.world, 10_000, T0 + 86_400_000);

    expect(later.migrated).toBe(false);
    expect(later.world.wallet.gems).toBe(50);
  });

  it('no past match is back-paid for salvage (§2.7)', () => {
    const { world } = migrateToV1(fresh(), 10_000, T0);
    expect(world.city.scrapPile).toBe(0);
  });

  it('produces a city that settles without moving anything', () => {
    const { world } = migrateToV1(fresh(), 0, T0);
    const settled = settle(world, T0 + 86_400_000);

    // Nothing is built beyond the two free cores, and neither produces.
    expect(settled.world.wallet).toEqual(world.wallet);
    expect(settled.ledger).toHaveLength(0);
    expect(settled.world.city.buildings.fish_market.stored).toBe(0);
  });
});

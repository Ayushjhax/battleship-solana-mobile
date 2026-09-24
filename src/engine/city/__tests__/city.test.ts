/**
 * The city rules, ported from docs/port-city/reference/test/city.test.ts
 * (scenarios 1-11 of part-01 §8.1), plus two scenarios the reference cannot
 * cover because of how its own fixtures are shaped:
 *
 *   - settle-often == settle-once at a rate that does NOT divide an hour
 *     evenly. The reference only ever exercises 12/h and 18/h, both exact.
 *   - a pin that every catalogue cost is even, which is why the reference's
 *     floor/ceil discrepancy (DECISIONS D2) is currently unobservable.
 *
 * The random-walk uses the engine's seeded RNG rather than Math.random, so a
 * failure reproduces. src/engine may not draw from the global random source.
 */
import { describe, expect, it } from 'vitest';

import { createRng } from '../../rng';
import {
  BUILDING_IDS,
  CITY_CATALOGUE,
  buyWorker,
  cancelUpgrade,
  canStart,
  capacityOf,
  collect,
  collectAll,
  creditSalvage,
  freeWorkers,
  newCity,
  rateOf,
  salvageFor,
  settle,
  speedUp,
  speedUpGems,
  startUpgrade,
} from '../index';
import type { BuildingId, CityWorld } from '../types';

const T0 = 1_700_000_000_000;
const DAY = '2023-11-14';
const min = (n: number) => n * 60_000;
const hour = (n: number) => n * 3_600_000;

function world(coins = 0, steel = 0, gems = 0, now = T0): CityWorld {
  return { city: newCity(now, DAY), wallet: { coins, steel, gems } };
}

/** Enough of everything that affordability is never the thing under test. */
function rich(now = T0): CityWorld {
  return world(1_000_000, 1_000_000, 10_000, now);
}

/** Unwraps a successful action, failing loudly with the typed code otherwise. */
function ok(result: ReturnType<typeof startUpgrade>): CityWorld {
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result.world;
}

function err(result: ReturnType<typeof startUpgrade>): string {
  if (result.ok) throw new Error('expected a failure, got success');
  return result.error;
}

// ---------------------------------------------------------------------------

describe('starting a build', () => {
  it('needs steel, coins, a free worker and the right Admiralty level', () => {
    const w = world(0, 400);
    expect(canStart(w, 'fish_market', new Set())).toBeNull();
    // Foundry needs Admiralty 2; a fresh city is at 1.
    expect(canStart(w, 'foundry', new Set())).toBe('needs-admiralty');
    expect(canStart(world(0, 0), 'fish_market', new Set())).toBe('not-enough-steel');
  });

  it('takes the cost up front and books a worker (§8.1.1)', () => {
    const before = rich();
    const after = ok(startUpgrade(before, 'fish_market', T0));
    expect(after.wallet.steel).toBe(
      before.wallet.steel - (CITY_CATALOGUE.fish_market.levels[0]?.steel ?? 0),
    );
    expect(freeWorkers(after.city)).toBe(1);
  });

  it('refuses a third job while two workers are busy (§8.1.2)', () => {
    let w = rich();
    w = ok(startUpgrade(w, 'fish_market', T0));
    w = ok(startUpgrade(w, 'admiralty', T0));
    expect(freeWorkers(w.city)).toBe(0);
    // harbour_office level 1 needs only Admiralty 1, so the worker check is
    // the first thing it can fail on.
    expect(err(startUpgrade(w, 'harbour_office', T0, new Set(['bounties'])))).toBe(
      'no-free-worker',
    );
  });

  it('completes two jobs in endsAt order within one settle (§8.1.3)', () => {
    let w = rich();
    w = ok(startUpgrade(w, 'fish_market', T0)); // 1 min
    w = ok(startUpgrade(w, 'admiralty', T0)); // 2 min

    const half = settle(w, T0 + min(1.5)).world;
    expect(half.city.buildings.fish_market.level).toBe(1);
    expect(half.city.buildings.admiralty.level).toBe(1); // not yet

    const full = settle(w, T0 + min(3)).world;
    expect(full.city.buildings.admiralty.level).toBe(2);
    expect(freeWorkers(full.city)).toBe(2);
  });

  it('pays Admiralty gems on completion (§2.6)', () => {
    const before = rich();
    const started = ok(startUpgrade(before, 'admiralty', T0));
    const result = settle(started, T0 + min(3));
    expect(result.world.city.buildings.admiralty.level).toBe(2);
    expect(result.world.wallet.gems).toBe(before.wallet.gems + 10);
    expect(result.ledger).toContainEqual(
      expect.objectContaining({ reason: 'admiralty_gems', dGems: 10 }),
    );
  });
});

describe('cancelling', () => {
  it('hands back half, floored, and frees the worker (§8.1.4)', () => {
    const before = rich();
    const started = ok(startUpgrade(before, 'admiralty', T0));
    const cancelled = ok(cancelUpgrade(started, 'admiralty', T0 + min(1)));

    const cost = CITY_CATALOGUE.admiralty.levels[1];
    expect(cancelled.wallet.steel).toBe(
      before.wallet.steel - (cost?.steel ?? 0) + Math.floor((cost?.steel ?? 0) / 2),
    );
    expect(freeWorkers(cancelled.city)).toBe(2);
  });

  it('every catalogue cost is even, so floor and ceil cannot disagree (D2)', () => {
    // DECISIONS D2 picks floor over the reference test's ceil. Worth pinning
    // that the choice is currently unobservable: every steel and coin cost in
    // NUMBERS.md is even, so the two agree on the whole shipped catalogue.
    // The moment a future entry is odd, this fails and D2 starts to matter.
    for (const id of BUILDING_IDS) {
      for (const level of CITY_CATALOGUE[id].levels) {
        expect(level.steel % 2, `${id} steel ${level.steel}`).toBe(0);
        expect(level.coins % 2, `${id} coins ${level.coins}`).toBe(0);
      }
    }
  });

  it('refuses to cancel a building that is not being built', () => {
    expect(err(cancelUpgrade(rich(), 'admiralty', T0))).toBe('not-upgrading');
  });
});

describe('speeding up', () => {
  it('prices the table in NUMBERS.md and frees the last minute (§8.1.5)', () => {
    expect(speedUpGems(30)).toBe(0);
    expect(speedUpGems(60)).toBe(0);
    expect(speedUpGems(300)).toBe(5); // 5 min
    expect(speedUpGems(900)).toBe(8); // 15 min
    expect(speedUpGems(hour(1) / 1000)).toBe(16);
    expect(speedUpGems(hour(4) / 1000)).toBe(31);
    expect(speedUpGems(hour(12) / 1000)).toBe(54);
    expect(speedUpGems(hour(24) / 1000)).toBe(76);
    expect(speedUpGems(hour(48) / 1000)).toBe(108);
    expect(speedUpGems(hour(72) / 1000)).toBe(132);
  });

  it('is monotonic across four days (§8.1.5)', () => {
    let prev = 0;
    for (let s = 0; s < 4 * 24 * 3600; s += 137) {
      const gems = speedUpGems(s);
      expect(gems).toBeGreaterThanOrEqual(prev);
      prev = gems;
    }
  });

  it('finishes the job, charges gems and cannot be repeated', () => {
    let w = rich();
    w = { city: { ...w.city, buildings: { ...w.city.buildings, admiralty: { ...w.city.buildings.admiralty, level: 2 } } }, wallet: w.wallet };
    w = ok(startUpgrade(w, 'admiralty', T0)); // 30 min
    const gemsBefore = w.wallet.gems;

    const result = speedUp(w, 'admiralty', T0 + min(1));
    if (!result.ok) throw new Error(result.error);
    expect(result.world.city.buildings.admiralty.level).toBe(3);

    // The speed-up charges gems AND the completed level pays 15 back (§2.6),
    // so assert the charge on the ledger rather than the net balance.
    const charge = result.ledger.find((l) => l.reason === 'speedup');
    expect(charge?.dGems).toBe(-speedUpGems(29 * 60));
    expect(result.world.wallet.gems).toBe(
      gemsBefore - speedUpGems(29 * 60) + 15,
    );
    expect(err(speedUp(result.world, 'admiralty', T0 + min(1)))).toBe('not-upgrading');
  });

  it('refuses when gems are short', () => {
    let w = world(1_000_000, 1_000_000, 0);
    w = ok(startUpgrade(w, 'admiralty', T0));
    expect(err(speedUp(w, 'admiralty', T0))).toBe('not-enough-gems');
  });
});

describe('production', () => {
  it('accrues at the level rate and stops dead at the cap (§8.1.6)', () => {
    let w = rich();
    w = ok(startUpgrade(w, 'fish_market', T0));
    w = settle(w, T0 + min(1)).world;

    const rate = rateOf('fish_market', 1);
    const threeHours = settle(w, T0 + min(1) + hour(3)).world;
    expect(threeHours.city.buildings.fish_market.stored).toBe(rate * 3);

    const capped = settle(w, T0 + min(1) + hour(48)).world;
    expect(capped.city.buildings.fish_market.stored).toBe(capacityOf('fish_market', 1));
  });

  it('never loses a fraction when settled repeatedly (§8.1.7)', () => {
    let a = rich();
    a = ok(startUpgrade(a, 'fish_market', T0));
    a = settle(a, T0 + min(1)).world;
    let b: CityWorld = JSON.parse(JSON.stringify(a)) as CityWorld;

    for (let i = 1; i <= 600; i++) a = settle(a, T0 + min(1) + i * 30_000).world;
    b = settle(b, T0 + min(1) + hour(5)).world;

    expect(a.city.buildings.fish_market.stored).toBe(b.city.buildings.fish_market.stored);
  });

  it('holds that invariant at a rate that does not divide an hour (26/h)', () => {
    // Fish Market level 3 produces 26/h. 3,600,000 / 26 is not an integer, so
    // this is the case where a rounding drift in the accrual clock would show.
    let a = rich();
    a = {
      city: {
        ...a.city,
        buildings: {
          ...a.city.buildings,
          fish_market: { level: 3, stored: 0, lastAccrualAt: T0, carry: 0 },
        },
      },
      wallet: a.wallet,
    };
    expect(rateOf('fish_market', 3)).toBe(26);

    let b: CityWorld = JSON.parse(JSON.stringify(a)) as CityWorld;
    for (let i = 1; i <= 600; i++) a = settle(a, T0 + i * 30_000).world;
    b = settle(b, T0 + hour(5)).world;

    expect(a.city.buildings.fish_market.stored).toBe(b.city.buildings.fish_market.stored);
    expect(b.city.buildings.fish_market.stored).toBe(Math.floor(26 * 5));
  });

  it('splits production across an upgrade that finishes mid-window (§8.1.8)', () => {
    let w = rich();
    w = {
      city: { ...w.city, buildings: { ...w.city.buildings, admiralty: { ...w.city.buildings.admiralty, level: 2 } } },
      wallet: w.wallet,
    };
    w = ok(startUpgrade(w, 'fish_market', T0));
    w = settle(w, T0 + min(1)).world; // level 1 live

    const start = T0 + min(1);
    w = ok(startUpgrade(w, 'fish_market', start)); // level 2, 15 min, auto-collects first
    w = settle(w, start + min(15) + hour(2)).world;

    expect(w.city.buildings.fish_market.level).toBe(2);
    // 15 min at 12/h = 3, then 2 h at 18/h = 36.
    expect(w.city.buildings.fish_market.stored).toBe(3 + rateOf('fish_market', 2) * 2);
  });

  it('moves the pile into the wallet when collected', () => {
    let w = rich();
    w = ok(startUpgrade(w, 'fish_market', T0));
    const at = T0 + min(1) + hour(4);
    w = settle(w, at).world;

    const coinsBefore = w.wallet.coins;
    const collected = collect(w, 'fish_market', at);
    if (!collected.ok) throw new Error(collected.error);

    const moved = rateOf('fish_market', 1) * 4;
    expect(collected.world.wallet.coins).toBe(coinsBefore + moved);
    expect(collected.world.city.buildings.fish_market.stored).toBe(0);
    expect(err(collect(collected.world, 'fish_market', at))).toBe('nothing-to-collect');
  });

  it('a now before updatedAt is a no-op, never negative production (§6)', () => {
    let w = rich();
    w = ok(startUpgrade(w, 'fish_market', T0));
    w = settle(w, T0 + min(1) + hour(2)).world;
    const stored = w.city.buildings.fish_market.stored;

    const backwards = settle(w, T0 - hour(10)).world;
    expect(backwards.city.buildings.fish_market.stored).toBe(stored);
  });
});

describe('salvage', () => {
  it('pays five steel per cell of every ship sunk (§8.1.9)', () => {
    // The shipped fleet is 8 ships / 18 cells, not the classic 10.
    expect(salvageFor([4, 3, 3, 2, 2, 2, 1, 1], 1)).toBe(90);
    expect(salvageFor([4], 1)).toBe(20);
    expect(salvageFor([], 1)).toBe(0);
  });

  it('applies the Scrapyard bonus and floors it', () => {
    expect(salvageFor([4, 3, 3], 3)).toBe(Math.floor(50 * 1.1));
    expect(salvageFor([4, 3, 3], 6)).toBe(Math.floor(50 * 1.25));
  });

  it('lands in the pile, not the wallet, until collected (§8.1.10)', () => {
    const w = world(0, 100);
    const credited = creditSalvage(w, [4, 3], 'online', 'match-1', T0, DAY);

    expect(credited.credited).toBe(35);
    expect(credited.world.wallet.steel).toBe(100); // untouched
    expect(credited.world.city.scrapPile).toBe(35);

    const collected = collect(credited.world, 'scrapyard', T0);
    if (!collected.ok) throw new Error(collected.error);
    expect(collected.world.wallet.steel).toBe(135);
    expect(collected.world.city.scrapPile).toBe(0);
  });

  it('stops paying offline salvage after the daily cap but keeps counting', () => {
    let w = world(0, 0);
    for (let i = 0; i < 10; i++) {
      const out = creditSalvage(w, [4], 'ai', `m${i}`, T0, DAY);
      expect(out.capped).toBe(false);
      expect(out.credited).toBe(20);
      w = out.world;
    }
    expect(w.city.offlineRewardsToday.count).toBe(10);

    const eleventh = creditSalvage(w, [4], 'ai', 'm10', T0, DAY);
    expect(eleventh.capped).toBe(true);
    expect(eleventh.credited).toBe(0);
    expect(eleventh.world.city.scrapPile).toBe(w.city.scrapPile);
  });

  it('resets the offline counter on a new UTC day', () => {
    let w = world(0, 0);
    for (let i = 0; i < 10; i++) w = creditSalvage(w, [4], 'ai', `m${i}`, T0, DAY).world;

    const tomorrow = creditSalvage(w, [4], 'ai', 'next', T0 + hour(24), '2023-11-15');
    expect(tomorrow.capped).toBe(false);
    expect(tomorrow.credited).toBe(20);
    expect(tomorrow.world.city.offlineRewardsToday).toEqual({ day: '2023-11-15', count: 1 });
  });

  it('never caps an online match (DECISIONS D8)', () => {
    let w = world(0, 0);
    for (let i = 0; i < 20; i++) {
      const out = creditSalvage(w, [4], 'online', `m${i}`, T0, DAY);
      expect(out.capped).toBe(false);
      w = out.world;
    }
    expect(w.city.scrapPile).toBe(20 * 20);
  });
});

describe('dock workers', () => {
  it('buys the third at 100 gems once the Admiralty is level 3', () => {
    let w = world(0, 0, 500);
    expect(err(buyWorker(w, T0))).toBe('needs-admiralty');

    w = {
      city: { ...w.city, buildings: { ...w.city.buildings, admiralty: { ...w.city.buildings.admiralty, level: 3 } } },
      wallet: w.wallet,
    };
    const bought = ok(buyWorker(w, T0));
    expect(bought.city.workers).toBe(3);
    expect(bought.wallet.gems).toBe(400);
    expect(freeWorkers(bought.city)).toBe(3);
  });

  it('stops at four', () => {
    const w: CityWorld = {
      city: {
        ...world().city,
        workers: 4,
        buildings: { ...world().city.buildings, admiralty: { level: 8, stored: 0, lastAccrualAt: T0, carry: 0 } },
      },
      wallet: { coins: 0, steel: 0, gems: 10_000 },
    };
    expect(err(buyWorker(w, T0))).toBe('max-level');
  });
});

describe('collect all', () => {
  it('empties every collector and the pile, one ledger row each (§4)', () => {
    let w = rich();
    w = {
      city: { ...w.city, buildings: { ...w.city.buildings, admiralty: { ...w.city.buildings.admiralty, level: 2 } } },
      wallet: w.wallet,
    };
    w = ok(startUpgrade(w, 'fish_market', T0));
    w = ok(startUpgrade(w, 'foundry', T0));
    w = settle(w, T0 + min(2) + hour(3)).world;
    w = creditSalvage(w, [4], 'online', 'm', T0 + min(2) + hour(3), DAY).world;

    const result = collectAll(w, T0 + min(2) + hour(3));
    if (!result.ok) throw new Error(result.error);

    expect(result.world.city.buildings.fish_market.stored).toBe(0);
    expect(result.world.city.buildings.foundry.stored).toBe(0);
    expect(result.world.city.scrapPile).toBe(0);
    expect(result.ledger.filter((l) => l.reason === 'collect')).toHaveLength(2);
    expect(result.ledger.filter((l) => l.reason === 'collect_scrap')).toHaveLength(1);
  });

  it('refuses when there is nothing anywhere', () => {
    expect(err(collectAll(rich(), T0))).toBe('nothing-to-collect');
  });
});

describe('feature gating', () => {
  it('closes a plot whose flag is off and opens it when on', () => {
    const w = rich();
    expect(canStart(w, 'shipyard', new Set())).toBe('feature-off');
    expect(canStart(w, 'shipyard', new Set(['cosmetics']))).toBeNull();
  });
});

describe('invariants (§8.1.11)', () => {
  it('a 2,000-step random walk never breaks a floor', () => {
    const rng = createRng(20240923);
    let w = world(5_000, 5_000, 500);
    let now = T0;

    for (let i = 0; i < 2_000; i++) {
      now += rng.int(min(30));
      const id = rng.pick(BUILDING_IDS) as BuildingId;
      const roll = rng.next();

      const result =
        roll < 0.4
          ? startUpgrade(w, id, now, new Set(['cosmetics', 'bounties', 'academy', 'raids', 'fleets', 'gazette', 'voyages', 'captains', 'seas']))
          : roll < 0.55
            ? speedUp(w, id, now)
            : roll < 0.65
              ? cancelUpgrade(w, id, now)
              : roll < 0.8
                ? collect(w, id, now)
                : roll < 0.9
                  ? buyWorker(w, now)
                  : { ok: true as const, world: creditSalvage(w, [4, 2, 1], 'online', `m${i}`, now, DAY).world, ledger: [], events: [] };

      if (result.ok) w = result.world;

      expect(w.wallet.coins).toBeGreaterThanOrEqual(0);
      expect(w.wallet.steel).toBeGreaterThanOrEqual(0);
      expect(w.wallet.gems).toBeGreaterThanOrEqual(0);
      expect(freeWorkers(w.city)).toBeGreaterThanOrEqual(0);
      expect(w.city.workers).toBeLessThanOrEqual(4);
      expect(w.city.scrapPile).toBeGreaterThanOrEqual(0);
      for (const id2 of BUILDING_IDS) {
        const b = w.city.buildings[id2];
        expect(b.level).toBeLessThanOrEqual(CITY_CATALOGUE[id2].levels.length);
        expect(b.level).toBeGreaterThanOrEqual(0);
        expect(b.stored).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('does not mutate the world it was given', () => {
    const before = rich();
    const snapshot = JSON.stringify(before);
    startUpgrade(before, 'fish_market', T0);
    collectAll(before, T0);
    creditSalvage(before, [4], 'online', 'm', T0, DAY);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

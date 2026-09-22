import { describe, expect, it } from 'vitest';
import {
  CATALOGUE,
  CityState,
  buyWorker,
  cancelUpgrade,
  capacityOf,
  canStart,
  collect,
  collectScrap,
  creditSalvage,
  freeWorkers,
  lootEarned,
  lootPool,
  newCity,
  rateOf,
  renownDelta,
  salvageFor,
  settle,
  shieldHours,
  speedUp,
  speedUpGems,
  startUpgrade,
} from '../src/city.js';

const T0 = 1_700_000_000_000;
const min = (n: number) => n * 60_000;
const hour = (n: number) => n * 3_600_000;

const rich = (now = T0): CityState => {
  const s = newCity(now);
  s.steel = 1_000_000;
  s.coins = 1_000_000;
  s.gems = 10_000;
  return s;
};

describe('starting a build', () => {
  it('needs steel, coins, a free worker and the right Admiralty level', () => {
    const s = newCity(T0);
    expect(canStart(s, 'fish_market', T0)).toBeNull();
    expect(canStart(s, 'foundry', T0)).toBe('needs-admiralty');
    s.steel = 0;
    expect(canStart(s, 'fish_market', T0)).toBe('not-enough-steel');
  });

  it('takes the cost up front and books a worker', () => {
    const s = rich();
    const before = s.steel;
    expect(startUpgrade(s, 'fish_market', T0)).toBeNull();
    expect(s.steel).toBe(before - CATALOGUE.fish_market.levels[0].steel);
    expect(freeWorkers(s)).toBe(1);
  });

  it('only two jobs at once until you hire more dock workers', () => {
    const s = rich();
    startUpgrade(s, 'fish_market', T0);
    startUpgrade(s, 'admiralty', T0);
    expect(canStart(s, 'shipyard', T0)).toBe('no-free-worker');
    s.buildings.admiralty.level = 3;
    expect(buyWorker(s, T0)).toBeNull();
    expect(freeWorkers(s)).toBe(1);
  });

  it('completes on its own once the clock passes, in the right order', () => {
    const s = rich();
    startUpgrade(s, 'fish_market', T0); // 1 min
    startUpgrade(s, 'admiralty', T0); // 2 min
    settle(s, T0 + min(1.5));
    expect(s.buildings.fish_market.level).toBe(1);
    expect(s.buildings.admiralty.level).toBe(1);
    settle(s, T0 + min(3));
    expect(s.buildings.admiralty.level).toBe(2);
    expect(freeWorkers(s)).toBe(2);
  });

  it('cancelling hands back half and frees the worker', () => {
    const s = rich();
    const before = s.steel;
    startUpgrade(s, 'admiralty', T0);
    cancelUpgrade(s, 'admiralty', T0 + min(1));
    expect(s.steel).toBe(before - Math.ceil(CATALOGUE.admiralty.levels[1].steel / 2));
    expect(freeWorkers(s)).toBe(2);
  });
});

describe('speeding up', () => {
  it('the last minute is free and the price grows with the clock', () => {
    expect(speedUpGems(30)).toBe(0);
    expect(speedUpGems(60)).toBe(0);
    expect(speedUpGems(hour(1) / 1000)).toBe(16);
    expect(speedUpGems(hour(4) / 1000)).toBe(31);
    expect(speedUpGems(hour(24) / 1000)).toBe(76);
    expect(speedUpGems(hour(72) / 1000)).toBe(132);
  });

  it('is monotonic', () => {
    let prev = 0;
    for (let s = 0; s < 4 * 24 * 3600; s += 137) {
      const g = speedUpGems(s);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it('finishes the job and charges gems', () => {
    const s = rich();
    s.buildings.admiralty.level = 2; // the next Admiralty level is a 30 minute job
    startUpgrade(s, 'admiralty', T0);
    const gems = s.gems;
    expect(speedUp(s, 'admiralty', T0 + min(1))).toBeNull();
    expect(s.buildings.admiralty.level).toBe(3);
    expect(s.gems).toBeLessThan(gems);
    expect(speedUp(s, 'admiralty', T0 + min(1))).toBe('not-upgrading');
  });
});

describe('production', () => {
  it('accrues at the level rate and stops at the cap', () => {
    const s = rich();
    startUpgrade(s, 'fish_market', T0);
    settle(s, T0 + min(1));
    const rate = rateOf('fish_market', 1);
    settle(s, T0 + min(1) + hour(3));
    expect(s.buildings.fish_market.stored).toBe(rate * 3);
    settle(s, T0 + min(1) + hour(48));
    expect(s.buildings.fish_market.stored).toBe(capacityOf('fish_market', 1));
  });

  it('never loses a fraction of an hour when settled repeatedly', () => {
    const a = rich();
    startUpgrade(a, 'fish_market', T0);
    settle(a, T0 + min(1));
    const b: CityState = JSON.parse(JSON.stringify(a));
    for (let i = 1; i <= 600; i++) settle(a, T0 + min(1) + i * 30_000); // every 30s
    settle(b, T0 + min(1) + hour(5));
    expect(a.buildings.fish_market.stored).toBe(b.buildings.fish_market.stored);
  });

  it('splits production across an upgrade that finishes mid-window', () => {
    const s = rich();
    s.buildings.admiralty.level = 2;
    startUpgrade(s, 'fish_market', T0);
    settle(s, T0 + min(1)); // level 1 live
    const start = T0 + min(1);
    startUpgrade(s, 'fish_market', start); // level 2, 15 min, auto-collects first
    settle(s, start + min(15) + hour(2));
    expect(s.buildings.fish_market.level).toBe(2);
    // 15 minutes at the old level 1 rate (12/h -> 3) then two hours at level 2.
    expect(s.buildings.fish_market.stored).toBe(3 + rateOf('fish_market', 2) * 2);
  });

  it('collecting moves the pile into the wallet', () => {
    const s = rich();
    startUpgrade(s, 'fish_market', T0);
    settle(s, T0 + min(1) + hour(4));
    const coins = s.coins;
    const got = collect(s, 'fish_market', T0 + min(1) + hour(4));
    expect(got).toBe(rateOf('fish_market', 1) * 4);
    expect(s.coins).toBe(coins + got);
    expect(collect(s, 'fish_market', T0 + min(1) + hour(4))).toBe(0);
  });
});

describe('salvage', () => {
  it('pays five steel per cell of every ship you sank', () => {
    expect(salvageFor([4, 3, 3, 2, 2, 2, 1, 1, 1, 1], 1)).toBe(100); // a clean sweep
    expect(salvageFor([4], 1)).toBe(20);
    expect(salvageFor([], 1)).toBe(0);
  });

  it('adds the Scrapyard bonus', () => {
    expect(salvageFor([4, 3, 3], 3)).toBe(Math.floor(50 * 1.1));
  });

  it('lands in the pile and only reaches the wallet when you collect it', () => {
    const s = newCity(T0);
    const steel = s.steel;
    creditSalvage(s, [4, 3], T0);
    expect(s.steel).toBe(steel);
    expect(s.scrapPile).toBe(35);
    expect(collectScrap(s, T0)).toBe(35);
    expect(s.steel).toBe(steel + 35);
    expect(s.scrapPile).toBe(0);
  });
});

describe('raid economy', () => {
  it('protects a floor of the wallet and caps what one raid can take', () => {
    const s = newCity(T0);
    s.buildings.admiralty.level = 4;
    s.coins = 3_500; // 1,000 over the 2,500 protection
    s.steel = 5_000; // exactly the protection
    const pool = lootPool(s, T0);
    expect(pool.coins).toBe(100); // 10% of the unprotected 1,000
    expect(pool.steel).toBe(0);
    s.coins = 1_000_000;
    expect(lootPool(s, T0).coins).toBe(450); // capped
  });

  it('counts half of anything left sitting in a collector or the scrap pile', () => {
    const s = newCity(T0);
    s.buildings.admiralty.level = 3;
    s.scrapPile = 400;
    expect(lootPool(s, T0).steel).toBe(200);
  });

  it('hands over loot in proportion to the damage, plus a star bonus', () => {
    const pool = { coins: 200, steel: 400 };
    expect(lootEarned(pool, 0.5, 1)).toEqual({ coins: 100, steel: 240 });
    expect(lootEarned(pool, 1, 3)).toEqual({ coins: 200, steel: 700 });
    expect(lootEarned(pool, 0, 0)).toEqual({ coins: 0, steel: 0 });
  });

  it('moves renown from the loser to the winner and stays symmetric', () => {
    for (const [a, d, stars] of [
      [100, 100, 3],
      [50, 400, 1],
      [900, 100, 2],
      [100, 100, 0],
    ] as const) {
      const delta = renownDelta(a, d, stars);
      expect(delta.attacker).toBe(-delta.defender);
      if (stars > 0) expect(delta.attacker).toBeGreaterThan(0);
      else expect(delta.attacker).toBeLessThan(0);
    }
    expect(renownDelta(100, 900, 3).attacker).toBeGreaterThan(renownDelta(900, 100, 3).attacker);
  });

  it('grants a shield that scales with the beating', () => {
    expect(shieldHours(0.3)).toBe(0);
    expect(shieldHours(0.45)).toBe(6);
    expect(shieldHours(0.8)).toBe(10);
    expect(shieldHours(1)).toBe(14);
  });
});

describe('invariants', () => {
  it('never lets a balance go negative, whatever order things happen in', () => {
    const s = newCity(T0);
    let now = T0;
    for (let i = 0; i < 2_000; i++) {
      now += Math.floor(Math.random() * min(30));
      const ids = Object.keys(CATALOGUE) as (keyof typeof CATALOGUE)[];
      const id = ids[Math.floor(Math.random() * ids.length)];
      const roll = Math.random();
      if (roll < 0.45) startUpgrade(s, id, now);
      else if (roll < 0.6) speedUp(s, id, now);
      else if (roll < 0.7) cancelUpgrade(s, id, now);
      else if (roll < 0.85) collect(s, id, now);
      else creditSalvage(s, [4, 2, 1], now);
      expect(s.steel).toBeGreaterThanOrEqual(0);
      expect(s.coins).toBeGreaterThanOrEqual(0);
      expect(s.gems).toBeGreaterThanOrEqual(0);
      expect(freeWorkers(s)).toBeGreaterThanOrEqual(0);
    }
  });
});

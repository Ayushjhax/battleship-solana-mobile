/**
 * Loot, renown, shields and the search window — part-06 §7, §11.
 *
 * Every number here comes from NUMBERS.md. If a test needs changing, the table
 * changed, and NUMBERS.md changes with it.
 */
import { describe, expect, it } from 'vitest';

import {
  COVE_LOOT_RATE,
  LOOT_CAP,
  STAR_BONUS,
  STORE_LOOT_RATE,
  VAULT_PROTECTION,
  WALLET_LOOT_RATE,
  allocateLoss,
  lootEarned,
  lootPool,
  renownDelta,
  renownOffer,
  renownWindow,
  searchCost,
  settleRenown,
  shieldHours,
  type DefenderWealth,
} from '../index';

const broke: DefenderWealth = {
  coins: 0,
  steel: 0,
  storedCoins: 0,
  storedSteel: 0,
  scrapPile: 0,
  admiraltyLevel: 3,
};

const rich: DefenderWealth = {
  coins: 10_000,
  steel: 20_000,
  storedCoins: 400,
  storedSteel: 800,
  scrapPile: 200,
  admiraltyLevel: 3,
};

// ===========================================================================
// Loot (§11)
// ===========================================================================

describe('loot', () => {
  it('the vault floor protects the wallet entirely below it', () => {
    const vault = VAULT_PROTECTION[3]!;
    const pool = lootPool({ ...broke, coins: vault.coins, steel: vault.steel });
    expect(pool).toEqual({ coins: 0, steel: 0 });
  });

  it('only the wallet ABOVE the vault is exposed, at 10%', () => {
    const vault = VAULT_PROTECTION[3]!;
    const pool = lootPool({ ...broke, coins: vault.coins + 1_000, steel: vault.steel + 2_000 });
    expect(pool.coins).toBe(Math.floor(1_000 * WALLET_LOOT_RATE));
    expect(pool.steel).toBe(Math.floor(2_000 * WALLET_LOOT_RATE));
  });

  it('collectors and the scrap pile give up half, with no vault floor at all', () => {
    const pool = lootPool({ ...broke, storedCoins: 400, storedSteel: 800, scrapPile: 200 });
    expect(pool.coins).toBe(400 * STORE_LOOT_RATE);
    expect(pool.steel).toBe((800 + 200) * STORE_LOOT_RATE);
  });

  it('the per-raid cap bites however rich the defender is', () => {
    const cap = LOOT_CAP[3]!;
    const pool = lootPool({
      coins: 1_000_000,
      steel: 1_000_000,
      storedCoins: 1_000_000,
      storedSteel: 1_000_000,
      scrapPile: 1_000_000,
      admiraltyLevel: 3,
    });
    expect(pool).toEqual({ coins: cap.coins, steel: cap.steel });
  });

  it('the cap and the vault both follow the DEFENDER Admiralty level', () => {
    const wealth = { ...rich, coins: 1_000_000, steel: 1_000_000 };
    for (let level = 1; level <= 8; level++) {
      const pool = lootPool({ ...wealth, admiraltyLevel: level });
      expect(pool.coins).toBe(LOOT_CAP[level]!.coins);
      expect(pool.steel).toBe(LOOT_CAP[level]!.steel);
    }
  });

  it('loot is proportional to destruction', () => {
    const pool = { coins: 200, steel: 400 };
    const half = lootEarned(pool, { destruction: 0.5, stars: 0 });
    const all = lootEarned(pool, { destruction: 1, stars: 0 });
    expect(half.takenCoins).toBe(100);
    expect(half.takenSteel).toBe(200);
    expect(all.takenCoins).toBe(200);
    expect(all.takenSteel).toBe(400);
  });

  it('the star bonus is paid by the HOUSE — the defender never loses more than the pool', () => {
    const pool = { coins: 200, steel: 400 };
    const out = lootEarned(pool, { destruction: 1, stars: 3 });
    expect(out.starBonusSteel).toBe(STAR_BONUS[3]);
    expect(out.earnedSteel).toBe(400 + STAR_BONUS[3]!);
    expect(out.takenSteel).toBe(400); // NOT 700
    expect(out.takenSteel).toBeLessThanOrEqual(pool.steel);
    expect(out.takenCoins).toBeLessThanOrEqual(pool.coins);
  });

  it('a defender with nothing loses nothing, and the attacker still gets the star bonus', () => {
    const pool = lootPool(broke);
    expect(pool).toEqual({ coins: 0, steel: 0 });

    const out = lootEarned(pool, { destruction: 1, stars: 3 });
    expect(out.takenCoins).toBe(0);
    expect(out.takenSteel).toBe(0);
    expect(out.earnedCoins).toBe(0);
    expect(out.earnedSteel).toBe(STAR_BONUS[3]);
  });

  it('a zero-star raid takes nothing and earns nothing', () => {
    const out = lootEarned({ coins: 200, steel: 400 }, { destruction: 0, stars: 0 });
    expect(out).toMatchObject({ takenCoins: 0, takenSteel: 0, earnedCoins: 0, earnedSteel: 0 });
  });

  it('a pirate cove pays 70% and costs the defender nothing at all', () => {
    const pool = { coins: 200, steel: 400 };
    const out = lootEarned(pool, { destruction: 1, stars: 2 }, { cove: true });
    expect(out.takenCoins).toBe(0);
    expect(out.takenSteel).toBe(0);
    expect(out.earnedCoins).toBe(Math.floor(200 * COVE_LOOT_RATE));
    expect(out.earnedSteel).toBe(Math.floor(400 * COVE_LOOT_RATE) + STAR_BONUS[2]!);
  });
});

// ===========================================================================
// Where the loss comes from (§7.2)
// ===========================================================================

describe('the defender loses collectors and scrap first, then the wallet', () => {
  it('drains the stores before touching the wallet', () => {
    const alloc = allocateLoss(rich, { takenCoins: 300, takenSteel: 500 });
    expect(alloc.fromStoredCoins).toBe(300);
    expect(alloc.fromCoins).toBe(0);
    expect(alloc.fromStoredSteel).toBe(500);
    expect(alloc.fromScrap).toBe(0);
    expect(alloc.fromSteel).toBe(0);
  });

  it('spills into the scrap pile and only then the wallet', () => {
    const alloc = allocateLoss(rich, { takenCoins: 600, takenSteel: 1_200 });
    expect(alloc.fromStoredCoins).toBe(400); // all of it
    expect(alloc.fromCoins).toBe(200);
    expect(alloc.fromStoredSteel).toBe(800); // all of it
    expect(alloc.fromScrap).toBe(200); // all of it
    expect(alloc.fromSteel).toBe(200);
  });

  it('never takes more than exists, so a spent-out defender still settles', () => {
    const alloc = allocateLoss(broke, { takenCoins: 999, takenSteel: 999 });
    expect(alloc.takenCoins).toBe(0);
    expect(alloc.takenSteel).toBe(0);
  });

  it('always sums to what it says it took', () => {
    const alloc = allocateLoss(rich, { takenCoins: 600, takenSteel: 1_200 });
    expect(alloc.takenCoins).toBe(alloc.fromStoredCoins + alloc.fromCoins);
    expect(alloc.takenSteel).toBe(alloc.fromStoredSteel + alloc.fromScrap + alloc.fromSteel);
  });
});

// ===========================================================================
// Renown (§11)
// ===========================================================================

describe('renown', () => {
  it('is symmetric: what the attacker gains, the defender loses', () => {
    for (const stars of [1, 2, 3]) {
      const delta = renownDelta(800, 800, stars);
      expect(delta.attacker).toBe(-delta.defender);
    }
    const zero = renownDelta(800, 800, 0);
    expect(zero.attacker).toBe(-zero.defender);
  });

  it('is bigger for punching up and smaller for punching down', () => {
    const up = renownDelta(500, 1_200, 3).attacker;
    const level = renownDelta(800, 800, 3).attacker;
    const down = renownDelta(1_200, 500, 3).attacker;
    expect(up).toBeGreaterThan(level);
    expect(level).toBeGreaterThan(down);
  });

  it('a zero-star raid is negative for the attacker and positive for the defender', () => {
    const delta = renownDelta(800, 800, 0);
    expect(delta.attacker).toBeLessThan(0);
    expect(delta.defender).toBeGreaterThan(0);
  });

  it('scales with stars: three stars is the full offer, one star a third of it', () => {
    const full = renownDelta(800, 800, 3).attacker;
    const one = renownDelta(800, 800, 1).attacker;
    expect(one).toBe(Math.max(1, Math.round(full / 3)));
    expect(one).toBeLessThan(full);
  });

  it('the target card advertises exactly what settlement will do', () => {
    const offer = renownOffer(700, 900);
    expect(offer.best).toBe(renownDelta(700, 900, 3).attacker);
    expect(offer.worst).toBe(renownDelta(700, 900, 0).attacker);
    expect(offer.worst).toBeLessThan(0);
  });

  it('floors at 0 — and the row records what was actually applied', () => {
    const settled = settleRenown(800, 3, 3);
    expect(settled.defender.after).toBe(0);
    expect(settled.defender.delta).toBe(-3); // not the full amount
    // The attacker still gains their full amount: renown is not conserved.
    expect(settled.attacker.delta).toBe(renownDelta(800, 3, 3).attacker);
  });

  it('an attacker at 0 renown cannot go below it on a failed raid', () => {
    const settled = settleRenown(0, 800, 0);
    expect(settled.attacker.after).toBe(0);
    expect(settled.attacker.delta).toBe(0);
    expect(settled.defender.delta).toBeGreaterThan(0);
  });

  it('a pirate cove moves nothing', () => {
    const settled = settleRenown(800, 800, 3, { cove: true });
    expect(settled.attacker.delta).toBe(0);
    expect(settled.defender.delta).toBe(0);
    expect(settled.attacker.after).toBe(800);
  });

  it('never returns a fractional value', () => {
    for (let a = 0; a <= 2_000; a += 137) {
      for (let d = 0; d <= 2_000; d += 211) {
        for (const stars of [0, 1, 2, 3]) {
          const delta = renownDelta(a, d, stars);
          expect(Number.isInteger(delta.attacker)).toBe(true);
          expect(Number.isInteger(delta.defender)).toBe(true);
        }
      }
    }
  });
});

// ===========================================================================
// Shields (§7.4)
// ===========================================================================

describe('shields', () => {
  it('follows the destruction bands exactly', () => {
    expect(shieldHours(0)).toBe(0);
    expect(shieldHours(0.39)).toBe(0);
    expect(shieldHours(0.4)).toBe(6);
    expect(shieldHours(0.69)).toBe(6);
    expect(shieldHours(0.7)).toBe(10);
    expect(shieldHours(0.99)).toBe(10);
    expect(shieldHours(1)).toBe(14);
  });

  it('is monotonic — taking more damage never shortens the shield', () => {
    let previous = 0;
    for (let d = 0; d <= 1.0001; d += 0.01) {
      const hours = shieldHours(Math.min(1, d));
      expect(hours).toBeGreaterThanOrEqual(previous);
      previous = hours;
    }
  });
});

// ===========================================================================
// Search (§5, §11)
// ===========================================================================

describe('search', () => {
  it('costs 10 x Admiralty level', () => {
    expect(searchCost(3)).toBe(30);
    expect(searchCost(8)).toBe(80);
  });

  it('never costs nothing, even at a nonsense level', () => {
    expect(searchCost(0)).toBe(10);
    expect(searchCost(-5)).toBe(10);
  });

  it('opens at +/-200 and widens by 100 every SECOND search', () => {
    expect(renownWindow(0)).toBe(200);
    expect(renownWindow(1)).toBe(200);
    expect(renownWindow(2)).toBe(300);
    expect(renownWindow(3)).toBe(300);
    expect(renownWindow(4)).toBe(400);
    expect(renownWindow(6)).toBe(500);
    expect(renownWindow(7)).toBe(500);
  });

  it('is uncapped after eight searches', () => {
    expect(renownWindow(8)).toBeNull();
    expect(renownWindow(40)).toBeNull();
  });

  it('never narrows', () => {
    let previous = 0;
    for (let n = 0; n < 8; n++) {
      const window = renownWindow(n)!;
      expect(window).toBeGreaterThanOrEqual(previous);
      previous = window;
    }
  });
});

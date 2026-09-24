/**
 * The shared currency metadata.
 *
 * The design's rule is "one source of truth, verified copy, no cash value
 * invented from a colour". These assertions pin the names, the coverage of
 * the three displayed balances, and the absence of claims the code cannot
 * back up.
 */
import { describe, expect, it } from 'vitest';

import { CURRENCIES, CURRENCY_IDS, currencyInfoFor } from '../../src/data/currencies';
import { useCurrencyInfo } from '../../src/state/currencyInfo';

describe('currency metadata', () => {
  it('covers exactly the three displayed balances', () => {
    expect(CURRENCY_IDS).toEqual(['points', 'coins', 'gems']);
    for (const id of CURRENCY_IDS) {
      const info = CURRENCIES[id];
      expect(info.id).toBe(id);
      expect(info.chip).toBe(id);
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.what.length).toBeGreaterThan(0);
      expect(info.earned.length).toBeGreaterThan(0);
      expect(info.used.length).toBeGreaterThan(0);
      for (const line of [...info.earned, ...info.used]) expect(line.length).toBeGreaterThan(8);
    }
  });

  it('resolves chips by kind and refuses to invent one for steel', () => {
    expect(currencyInfoFor('points')?.name).toBe("Captain's points");
    expect(currencyInfoFor('coins')?.name).toBe('Coins');
    expect(currencyInfoFor('gems')?.name).toBe('Gems');
    expect(currencyInfoFor('steel')).toBeNull();
    expect(currencyInfoFor('nonsense')).toBeNull();
  });

  it('describes only verified flows', () => {
    const points = CURRENCIES.points;
    expect(points.earned.join(' ')).toMatch(/welcome/i);
    expect(points.earned.join(' ')).toMatch(/0\.001 SOL/);
    expect(points.used.join(' ')).toMatch(/50-point stake/);

    const coins = CURRENCIES.coins;
    expect(coins.earned.join(' ')).toMatch(/50 for a win and 10 for a loss/);
    expect(coins.used.join(' ')).toMatch(/Port City/);

    const gems = CURRENCIES.gems;
    expect(gems.earned.join(' ')).toMatch(/Admiralty/);
    expect(gems.used.join(' ')).toMatch(/worker/i);

    // No currency explanation claims a fiat value or an exchange the game
    // does not have (only points have a SOL rail, and it is stated as such).
    for (const id of CURRENCY_IDS) {
      const text = [CURRENCIES[id].what, ...CURRENCIES[id].earned, ...CURRENCIES[id].used].join(' ');
      expect(text).not.toMatch(/\$|USD|dollar|cash|fiat/i);
    }
  });
});

describe('currency info sheet store', () => {
  it('opens one currency at a time and closes cleanly', () => {
    const store = useCurrencyInfo.getState();
    expect(store.open).toBeNull();
    store.openCurrency('gems');
    expect(useCurrencyInfo.getState().open).toBe('gems');
    useCurrencyInfo.getState().openCurrency('points');
    expect(useCurrencyInfo.getState().open).toBe('points');
    useCurrencyInfo.getState().closeCurrency();
    expect(useCurrencyInfo.getState().open).toBeNull();
  });
});

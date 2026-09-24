/**
 * The city store and its selectors — part-01 §5, §6.
 *
 * The rule these tests exist to hold: the client renders timers locally but
 * never advances a balance on its own. Everything numeric comes from the last
 * server response.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/localStorage/install', () => ({}));

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

import { newCity, type BuildingId, type CityState } from '@engine/city';
import type { CityResponse } from '@/city/types';

/**
 * Loaded dynamically, AFTER the localStorage stub above is installed.
 *
 * A static `import ... from '@/city/store'` is hoisted above the
 * Object.defineProperty, so zustand's persist middleware captures
 * `localStorage` as undefined, silently stops writing, and every cache
 * assertion fails for a reason that has nothing to do with the store. (The
 * existing src/state/__tests__/profile.test.ts has the same hazard but never
 * asserts persistence, so it never surfaced.)
 */
type StoreModule = typeof import('@/city/store');
let buildProgress: StoreModule['buildProgress'];
let canAfford: StoreModule['canAfford'];
let collectable: StoreModule['collectable'];
let freeWorkers: StoreModule['freeWorkers'];
let plotVisible: StoreModule['plotVisible'];
let secondsLeft: StoreModule['secondsLeft'];
let serverNow: StoreModule['serverNow'];
let useCity: StoreModule['useCity'];

beforeAll(async () => {
  ({ buildProgress, canAfford, collectable, freeWorkers, plotVisible, secondsLeft, serverNow, useCity } =
    await import('@/city/store'));
});

const NOW = 1_700_000_000_000;
const DAY = '2023-11-14';

function response(patch: {
  city?: Partial<CityState>;
  wallet?: { coins: number; steel: number; gems: number };
  serverNow?: number;
  features?: string[];
  unlocks?: string[];
  collectable?: { total: number; ids: BuildingId[] };
}): CityResponse {
  const city = { ...newCity(NOW, DAY), ...patch.city };
  return {
    city: {
      city,
      wallet: patch.wallet ?? { coins: 0, steel: 0, gems: 0 },
      freeWorkers: 2,
      collectable: patch.collectable ?? { total: 0, ids: [] },
      features: patch.features ?? [],
      unlocks: patch.unlocks ?? [],
    },
    serverNow: patch.serverNow ?? NOW,
  };
}

beforeEach(() => {
  values.clear();
  useCity.getState().reset();
});

describe('applying a response', () => {
  it('stores the snapshot and derives the clock offset from serverNow', () => {
    const deviceNow = Date.now();
    useCity.getState().applyResponse(response({ serverNow: deviceNow + 45_000 }));

    const state = useCity.getState();
    expect(state.fresh).toBe(true);
    expect(state.error).toBeNull();
    // Within a second of the 45s skew; the clock ticks while the test runs.
    expect(Math.abs(state.serverOffset - 45_000)).toBeLessThan(1_000);
    expect(serverNow(state, deviceNow)).toBeCloseTo(deviceNow + state.serverOffset, -2);
  });

  it('never invents a balance: the wallet is exactly what arrived', () => {
    useCity.getState().applyResponse(
      response({ wallet: { coins: 12, steel: 34, gems: 56 } }),
    );
    expect(useCity.getState().snapshot?.wallet).toEqual({ coins: 12, steel: 34, gems: 56 });
  });

  it('caches across a store rebuild, and reads as stale until a response lands', () => {
    useCity.getState().applyResponse(response({ wallet: { coins: 7, steel: 8, gems: 9 } }));
    expect(values.get('eob.city')).toBeTruthy();

    const persisted = JSON.parse(values.get('eob.city') as string) as {
      state: Record<string, unknown>;
    };
    // `fresh` is a session fact and must not be cached, or a cold start would
    // claim the cached city is live.
    expect(persisted.state).not.toHaveProperty('fresh');
    expect(persisted.state.snapshot).toBeTruthy();
  });
});

describe('secondsLeft (§6)', () => {
  const withJob = (endsAt: number) =>
    response({
      city: {
        buildings: {
          ...newCity(NOW, DAY).buildings,
          fish_market: {
            level: 0,
            stored: 0,
            lastAccrualAt: NOW,
            carry: 0,
            upgrading: { toLevel: 1, startedAt: NOW, endsAt },
          },
        },
      },
    });

  it('counts down from the SERVER clock, not the device clock', () => {
    const deviceNow = Date.now();
    // The device is an hour fast; the server says the job has 60s left.
    useCity.getState().applyResponse({
      ...withJob(NOW + 60_000),
      serverNow: NOW,
    });
    useCity.setState({ serverOffset: NOW - deviceNow });

    expect(secondsLeft(useCity.getState(), 'fish_market', deviceNow)).toBe(60);
  });

  it('clamps a passed deadline to 0 rather than going negative', () => {
    const deviceNow = Date.now();
    useCity.getState().applyResponse({ ...withJob(NOW - 5_000), serverNow: NOW });
    useCity.setState({ serverOffset: NOW - deviceNow });

    expect(secondsLeft(useCity.getState(), 'fish_market', deviceNow)).toBe(0);
  });

  it('is 0 for a building with no job', () => {
    useCity.getState().applyResponse(response({}));
    expect(secondsLeft(useCity.getState(), 'admiralty')).toBe(0);
  });

  it('reports progress clamped to 0..1', () => {
    const deviceNow = Date.now();
    useCity.getState().applyResponse({ ...withJob(NOW + 100_000), serverNow: NOW });
    useCity.setState({ serverOffset: NOW - deviceNow });
    expect(buildProgress(useCity.getState(), 'fish_market', deviceNow)).toBe(0);

    useCity.setState({ serverOffset: NOW + 200_000 - deviceNow });
    expect(buildProgress(useCity.getState(), 'fish_market', deviceNow)).toBe(1);
  });
});

describe('canAfford', () => {
  it('names the exact shortfall per resource', () => {
    // The Fish Market's first level costs 150 steel and 0 coins.
    useCity.getState().applyResponse(response({ wallet: { coins: 0, steel: 100, gems: 0 } }));
    const afford = canAfford(useCity.getState(), 'fish_market');
    expect(afford.ok).toBe(false);
    expect(afford.shortSteel).toBe(50);
    expect(afford.shortCoins).toBe(0);
  });

  it('is happy when there is enough', () => {
    useCity.getState().applyResponse(response({ wallet: { coins: 0, steel: 150, gems: 0 } }));
    expect(canAfford(useCity.getState(), 'fish_market').ok).toBe(true);
  });

  it('never claims affordability without a snapshot', () => {
    expect(canAfford(useCity.getState(), 'fish_market').ok).toBe(false);
  });
});

describe('plot visibility and collectables', () => {
  it('hides a gated plot until the server says its flag is on', () => {
    useCity.getState().applyResponse(response({ features: [] }));
    expect(plotVisible(useCity.getState(), 'shipyard')).toBe(false);
    expect(plotVisible(useCity.getState(), 'fish_market')).toBe(true); // ungated

    useCity.getState().applyResponse(response({ features: ['cosmetics'] }));
    expect(plotVisible(useCity.getState(), 'shipyard')).toBe(true);
  });

  it('passes the server collectables straight through', () => {
    useCity
      .getState()
      .applyResponse(response({ collectable: { total: 148, ids: ['fish_market'] } }));
    expect(collectable(useCity.getState())).toEqual({ total: 148, ids: ['fish_market'] });
    expect(freeWorkers(useCity.getState())).toBe(2);
  });

  it('is safe with no snapshot at all', () => {
    expect(collectable(useCity.getState())).toEqual({ total: 0, ids: [] });
    expect(freeWorkers(useCity.getState())).toBe(0);
  });
});

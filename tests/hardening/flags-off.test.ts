/**
 * Hardening — every Port City flag unset, app side.
 *
 * The client's contract (src/city/features.ts): every flag defaults to OFF and
 * only turns on when the server's `/config` says so; a failed or absent
 * `/config` leaves the city dark. That direction is the safe one — the failure
 * mode is "old experience", never "half a feature".
 *
 * The screen gate itself is app/city.tsx:
 *
 *     void loadFlags().then(() => { const on = cityEnabled(); if (!on) return; ... })
 *
 * A React Native screen cannot be rendered under vitest's node environment, so
 * this file pins the decision the gate is built on: with the flags off,
 * `cityEnabled()` is false, `loadFlags()` never touches a city endpoint, and a
 * `feature-off` refusal from the server is a typed code rather than a crash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('@/net/api', () => ({
  getAccessToken: vi.fn(async () => ({ ok: true as const, value: 'test-token' })),
}));
vi.mock('@/net/connectivity', () => ({ hasInternet: vi.fn(async () => true) }));
vi.mock('@/state/demo', () => ({ isForcedOffline: vi.fn(() => false) }));

import {
  CITY_FLAGS,
  __resetFlagsForTests,
  cityEnabled,
  flags,
  isFlagOn,
  livingWorldConfig,
  loadFlags,
  seasonSea,
} from '@/city/features';
import { getCity } from '@/city/api';
import { getGazette } from '@/daily/api';
import { getHarbour } from '@/raid/api';

const ALL_OFF = Object.fromEntries(CITY_FLAGS.map((flag) => [flag, false]));

function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  __resetFlagsForTests(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EXPO_PUBLIC_API_URL;
  __resetFlagsForTests(null);
  vi.clearAllMocks();
});

describe('flag defaults', () => {
  it('is dark before the server has said anything', () => {
    expect(flags()).toEqual({});
    for (const flag of CITY_FLAGS) expect(isFlagOn(flag), flag).toBe(false);
    expect(cityEnabled()).toBe(false);
    expect(seasonSea()).toBeNull();
    expect(livingWorldConfig()).toBeUndefined();
  });

  it('a /config with every flag false leaves every flag off', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        features: ALL_OFF,
        livingWorld: { seasonWindows: [], weatherSeed: 11011 },
        seasonSea: null,
        serverNow: 1,
      }),
    );

    await expect(loadFlags()).resolves.toEqual(ALL_OFF);
    for (const flag of CITY_FLAGS) expect(isFlagOn(flag), flag).toBe(false);
    expect(cityEnabled()).toBe(false);
    expect(seasonSea()).toBeNull();
  });

  it('an unreachable /config leaves every flag off and does not throw', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));

    await expect(loadFlags()).resolves.toEqual({});
    expect(cityEnabled()).toBe(false);
    // The failure is cached as "dark", not retried into a spinner.
    await expect(loadFlags()).resolves.toEqual({});
  });

  it('turns on only what the server reports, even when other flags exist', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        features: { ...ALL_OFF, 'portCity.core': true },
        livingWorld: { seasonWindows: [], weatherSeed: 11011 },
        seasonSea: null,
        serverNow: 1,
      }),
    );

    await loadFlags();
    expect(cityEnabled()).toBe(true);
    for (const flag of CITY_FLAGS.filter((f) => f !== 'portCity.core')) {
      expect(isFlagOn(flag), flag).toBe(false);
    }
  });
});

describe('no Port City code path runs while the flags are off', () => {
  it('the city screen gate stays on the old experience and never refreshes', async () => {
    fetchMock.mockResolvedValue(
      reply(200, { features: ALL_OFF, livingWorld: { seasonWindows: [], weatherSeed: 1 }, seasonSea: null, serverNow: 1 }),
    );

    // Exactly the sequence app/city.tsx runs on mount.
    await loadFlags();
    if (cityEnabled()) await getCity();

    expect(cityEnabled()).toBe(false);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(['https://api.example.test/config']);
  });

  it('the same gate does refresh once the server turns the city on', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/config')) {
        return reply(200, {
          features: { ...ALL_OFF, 'portCity.core': true },
          livingWorld: { seasonWindows: [], weatherSeed: 1 },
          seasonSea: null,
          serverNow: 1,
        });
      }
      return reply(200, { city: {}, serverNow: 1 });
    });

    await loadFlags();
    if (cityEnabled()) await getCity();

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      'https://api.example.test/config',
      'https://api.example.test/city',
    ]);
  });

  it('a feature-off refusal from every family is a typed code, not a crash, and is not retried', async () => {
    fetchMock.mockResolvedValue(reply(409, { code: 'feature-off' }));

    await expect(getCity()).rejects.toMatchObject({ code: 'feature-off' });
    await expect(getHarbour()).rejects.toMatchObject({ code: 'feature-off' });
    await expect(getGazette()).rejects.toMatchObject({ code: 'feature-off' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

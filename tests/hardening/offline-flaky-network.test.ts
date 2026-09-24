/**
 * Hardening — offline and flaky networks on the Port City feature clients.
 *
 * The three transports that matter here are all real:
 *   - src/city/api.ts        — Part 1's own copy of the transport
 *   - src/net/featureClient.ts — the shared one (raid, daily, fleets, ...)
 *   - the feature clients that sit on top of them
 *
 * Only the process edges are mocked (expo-sqlite's shim, the token source,
 * the connectivity gate, the demo offline toggle, global fetch), exactly as
 * tests/city/api.test.ts and src/net/__tests__/offlineResults.test.ts do.
 *
 * The behaviour under test is the one a player on a train actually meets:
 *   1. airplane mode — forcedOffline, OS-level, or a fetch that simply rejects;
 *   2. a 3G-shaped link — a request that hangs until the client timeout aborts
 *      it, and a 503 that succeeds on the retry;
 *   3. a typed 409 — the server said no, and asking again cannot change it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('@/net/api', () => ({
  getAccessToken: vi.fn(async () => ({ ok: true as const, value: 'test-token' })),
}));
vi.mock('@/net/connectivity', () => ({ hasInternet: vi.fn(async () => true) }));
vi.mock('@/state/demo', () => ({ isForcedOffline: vi.fn(() => false) }));

import { buildBuilding, fetchConfig, getCity } from '@/city/api';
import { CityApiError } from '@/city/types';
import { getGazette, getPuzzle, listVoyages, markGazetteRead } from '@/daily/api';
import { MAX_ATTEMPTS, RETRY_DELAY_MS, TIMEOUT_MS } from '@/net/retryPolicy';
import { hasInternet } from '@/net/connectivity';
import { markLogRead, searchTarget, sendRaidAction } from '@/raid/api';
import { isForcedOffline } from '@/state/demo';

const OK_BODY = { city: { city: {}, wallet: {}, freeWorkers: 2, collectable: { total: 0, ids: [] }, features: [], unlocks: [] }, serverNow: 1 };

function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Every call a player can make, one per feature family. */
const CALLS: readonly [string, () => Promise<unknown>][] = [
  ['city read', () => getCity()],
  ['city mutation', () => buildBuilding('fish_market')],
  ['raid search', () => searchTarget(0)],
  ['raid action', () => sendRaidAction({ kind: 'fire', raidId: '11111111-1111-4111-8111-111111111111', at: { r: 0, c: 0 } })],
  ['gazette', () => getGazette()],
  ['puzzle', () => getPuzzle()],
  ['voyage list', () => listVoyages()],
];

/** fetch call count for one endpoint path. */
function callsTo(path: string): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path)).length;
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(hasInternet).mockResolvedValue(true);
  vi.mocked(isForcedOffline).mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.EXPO_PUBLIC_API_URL;
  vi.clearAllMocks();
});

// ===========================================================================
// 1. Airplane mode
// ===========================================================================

describe('airplane mode — the device has no network', () => {
  it('forced offline short-circuits every Port City call before any fetch', async () => {
    vi.mocked(isForcedOffline).mockReturnValue(true);

    for (const [name, call] of CALLS) {
      await expect(call(), name).rejects.toMatchObject({ code: 'offline' });
    }
    // The public /config too — it is the same transport.
    await expect(fetchConfig()).rejects.toMatchObject({ code: 'offline' });

    expect(fetchMock).not.toHaveBeenCalled();
    // The hard toggle must not even consult the OS radio.
    expect(hasInternet).not.toHaveBeenCalled();
  });

  it('an OS-level airplane mode short-circuits every Port City call before any fetch', async () => {
    vi.mocked(hasInternet).mockResolvedValue(false);

    for (const [name, call] of CALLS) {
      await expect(call(), name).rejects.toMatchObject({ code: 'offline' });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a fetch that rejects is offline, retried MAX_ATTEMPTS times, and never crashes', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('Network request failed'));

    const pending = [
      getCity().catch((error: { code: string }) => error.code),
      searchTarget(0).catch((error: { code: string }) => error.code),
      listVoyages().catch((error: { code: string }) => error.code),
    ];
    // 600 ms + 1200 ms of backoff on each of the three calls, concurrently.
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 4 + TIMEOUT_MS);

    await expect(Promise.all(pending)).resolves.toEqual(['offline', 'offline', 'offline']);
    expect(callsTo('/city')).toBe(MAX_ATTEMPTS);
    expect(callsTo('/raid/search')).toBe(MAX_ATTEMPTS);
    expect(callsTo('/voyage')).toBe(MAX_ATTEMPTS);
  });
});

// ===========================================================================
// 2. A 3G-shaped connection
// ===========================================================================

describe('a 3G-shaped connection', () => {
  it('aborts a request that hangs past the client timeout, then recovers on the retry', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      attempt += 1;
      if (attempt === 1) {
        return new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          if (signal.aborted) return reject(new Error('The operation was aborted.'));
          signal.addEventListener('abort', () => reject(new Error('The operation was aborted.')));
        });
      }
      return Promise.resolve(reply(200, OK_BODY));
    });

    const pending = getCity();
    // The request hangs: nothing happens until the transport's own timer fires.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1_000);
    expect(attempt).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000 + RETRY_DELAY_MS);

    await expect(pending).resolves.toEqual(OK_BODY);
    expect(attempt).toBe(2);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('retries a 503 and succeeds on the next attempt — city, raid and daily', async () => {
    // A stateful 3G server: the FIRST request to each path answers 503 (a
    // transient server fault), every later one succeeds. Concurrency between
    // the three calls must not change which response each one sees.
    const attempts = new Map<string, number>();
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(String(url)).pathname;
      const attempt = (attempts.get(path) ?? 0) + 1;
      attempts.set(path, attempt);
      if (attempt === 1) return reply(503, { code: 'internal' });
      return path === '/city' ? reply(200, OK_BODY) : reply(200, {});
    });

    await expect(
      Promise.all([getCity(), markLogRead([]), markGazetteRead()]),
    ).resolves.toBeDefined();

    expect(callsTo('/city')).toBe(2);
    expect(callsTo('/raid/log/read')).toBe(2);
    expect(callsTo('/gazette/read')).toBe(2);
  });
});

// ===========================================================================
// 3. A typed 409 is an answer
// ===========================================================================

describe('server refusals', () => {
  it('never retries a typed 409 — city, raid and daily', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(409, { code: 'already-upgrading' }))
      .mockResolvedValueOnce(reply(409, { code: 'target-locked' }))
      .mockResolvedValueOnce(reply(409, { code: 'no-slot' }));

    await expect(buildBuilding('fish_market')).rejects.toMatchObject({ code: 'already-upgrading' });
    await expect(
      sendRaidAction({ kind: 'retreat', raidId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toMatchObject({ code: 'target-locked' });
    await expect(listVoyages()).rejects.toMatchObject({ code: 'no-slot' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 409 carrying an unknown code, whatever the code', async () => {
    // City/api.ts casts the server's code into its union without narrowing
    // (finding H2 in the hardening report); the transport invariant asserted
    // here is that an unrecognised refusal is still a refusal: surfaced once,
    // never retried.
    fetchMock.mockResolvedValue(reply(409, { code: 'some-future-code' }));

    await expect(getCity()).rejects.toBeInstanceOf(CityApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

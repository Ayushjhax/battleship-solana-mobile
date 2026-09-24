/**
 * The city API client — part-01 §5.
 *
 * The rule worth a test: "retries only on network errors (never on a 409)".
 * A 409 is the server's typed answer, and retrying it would double-charge a
 * rate limiter, spam the log, and tell the player nothing new.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('@/net/api', () => ({
  getAccessToken: vi.fn(async () => ({ ok: true as const, value: 'test-token' })),
}));
vi.mock('@/net/connectivity', () => ({ hasInternet: vi.fn(async () => true) }));
vi.mock('@/state/demo', () => ({ isForcedOffline: vi.fn(() => false) }));

import { buildBuilding, collectAllBuildings, fetchConfig, getCity } from '@/city/api';
import { hasInternet } from '@/net/connectivity';
import { isForcedOffline } from '@/state/demo';
import { CityApiError } from '@/city/types';

const OK_BODY = { city: { city: {}, wallet: {}, freeWorkers: 2, collectable: { total: 0, ids: [] }, features: [] }, serverNow: 1 };

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
  vi.mocked(hasInternet).mockResolvedValue(true);
  vi.mocked(isForcedOffline).mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EXPO_PUBLIC_API_URL;
});

describe('requests', () => {
  it('sends a bearer token and returns the parsed body', async () => {
    fetchMock.mockResolvedValue(reply(200, OK_BODY));
    await expect(getCity()).resolves.toEqual(OK_BODY);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/city');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-token');
  });

  it('generates a distinct requestId per mutation', async () => {
    fetchMock.mockResolvedValue(reply(200, OK_BODY));
    await collectAllBuildings();
    await collectAllBuildings();

    const bodies = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string) as { requestId: string },
    );
    expect(bodies[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodies[0]?.requestId).not.toBe(bodies[1]?.requestId);
  });

  it('reuses a caller-supplied requestId verbatim, so a retry replays', async () => {
    fetchMock.mockResolvedValue(reply(200, OK_BODY));
    const id = '11111111-2222-4333-8444-555555555555';
    await buildBuilding('fish_market', id);
    await buildBuilding('fish_market', id);

    const bodies = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string) as { requestId: string },
    );
    expect(bodies[0]?.requestId).toBe(id);
    expect(bodies[1]?.requestId).toBe(id);
  });

  it('does not send a token to /config, which is public', async () => {
    fetchMock.mockResolvedValue(reply(200, { features: {}, serverNow: 1 }));
    await fetchConfig();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe('errors', () => {
  it('NEVER retries a 409, and surfaces its typed code', async () => {
    fetchMock.mockResolvedValue(reply(409, { code: 'not-enough-steel' }));

    await expect(buildBuilding('fish_market')).rejects.toMatchObject({
      code: 'not-enough-steel',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry any other 4xx either', async () => {
    fetchMock.mockResolvedValue(reply(401, { error: 'nope' }));
    await expect(getCity()).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transport failure and succeeds on a later attempt', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(reply(200, OK_BODY));

    await expect(getCity()).resolves.toEqual(OK_BODY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('retries a 500 but gives up after three attempts', async () => {
    fetchMock.mockResolvedValue(reply(500, {}));
    await expect(getCity()).rejects.toBeInstanceOf(CityApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 20_000);

  it('short-circuits when hard-offline mode is on, without touching the network', async () => {
    vi.mocked(isForcedOffline).mockReturnValue(true);
    await expect(getCity()).rejects.toMatchObject({ code: 'offline' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('short-circuits with no connection', async () => {
    vi.mocked(hasInternet).mockResolvedValue(false);
    await expect(getCity()).rejects.toMatchObject({ code: 'offline' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

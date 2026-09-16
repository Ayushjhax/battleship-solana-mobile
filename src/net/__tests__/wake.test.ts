/**
 * Waking a suspended match server. The property that matters: a server that is
 * already up costs one fast request and shows nothing, and one that is asleep
 * is waited out rather than reported as a failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasInternet: vi.fn(async () => true),
  isForcedOffline: vi.fn(() => false),
}));

vi.mock('../connectivity', () => ({ hasInternet: mocks.hasInternet }));
vi.mock('@/state/demo', () => ({ isForcedOffline: mocks.isForcedOffline }));

const WS_URL = 'wss://seabattle.example.com/ws';

async function load() {
  const wake = await import('../wake');
  const store = await import('@/state/backendWake');
  return { ensureBackendAwake: wake.ensureBackendAwake, useBackendWake: store.useBackendWake };
}

describe('ensureBackendAwake', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.hasInternet.mockResolvedValue(true);
    mocks.isForcedOffline.mockReturnValue(false);
    process.env.EXPO_PUBLIC_WS_URL = WS_URL;
    delete process.env.EXPO_PUBLIC_API_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers on the first ping when the server is already up', async () => {
    const requested: string[] = [];
    const fetchMock = vi.fn(async (input: string) => {
      requested.push(input);
      return { ok: true } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ensureBackendAwake, useBackendWake } = await load();

    await expect(ensureBackendAwake()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Derived from the socket URL: same process, same host, http scheme.
    expect(requested).toEqual(['https://seabattle.example.com/health']);
    expect(useBackendWake.getState().phase).toBe('awake');
  });

  it('keeps pinging a sleeping server until it comes back', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        // A suspended host refuses the connection rather than answering.
        if (calls < 3) throw new Error('Network request failed');
        return { ok: true } as Response;
      }),
    );
    const { ensureBackendAwake, useBackendWake } = await load();

    await expect(ensureBackendAwake()).resolves.toBe(true);

    expect(calls).toBe(3);
    expect(useBackendWake.getState().phase).toBe('awake');
    expect(useBackendWake.getState().startedAt).not.toBeNull();
  }, 20000);

  it('treats a 5xx from a half-started instance as not awake yet', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return { ok: calls > 1 } as Response;
      }),
    );
    const { ensureBackendAwake } = await load();

    await expect(ensureBackendAwake()).resolves.toBe(true);
    expect(calls).toBe(2);
  }, 20000);

  it('skips entirely when no server is configured, rather than blocking', async () => {
    delete process.env.EXPO_PUBLIC_WS_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { ensureBackendAwake, useBackendWake } = await load();

    await expect(ensureBackendAwake()).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useBackendWake.getState().phase).toBe('skipped');
  });

  it('skips while hard offline, so the demo toggle still works', async () => {
    mocks.isForcedOffline.mockReturnValue(true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { ensureBackendAwake, useBackendWake } = await load();

    await expect(ensureBackendAwake()).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useBackendWake.getState().phase).toBe('skipped');
  });

  it('collapses concurrent callers onto one wake', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { ensureBackendAwake } = await load();

    const [a, b, c] = await Promise.all([
      ensureBackendAwake(),
      ensureBackendAwake(),
      ensureBackendAwake(),
    ]);

    expect([a, b, c]).toEqual([true, true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prefers an explicit API url over the socket one', async () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com/';
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        requested.push(input);
        return { ok: true } as Response;
      }),
    );
    const { ensureBackendAwake } = await load();

    await ensureBackendAwake();

    expect(requested).toEqual(['https://api.example.com/health']);
  });
});

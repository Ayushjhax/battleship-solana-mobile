/** The demo menu's hard offline toggle must make every network path answer "offline" at once. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
  addNetworkStateListener: () => ({ remove: () => {} }),
}));
vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u' }, access_token: 't' } }, error: null }) },
    from: () => {
      throw new Error('a query went out while forced offline');
    },
    rpc: () => {
      throw new Error('an rpc went out while forced offline');
    },
  },
}));

import { useDemo } from '@/state/demo';
import { getLeaderboard, getSessionUserId } from '../api';
import { hasInternet, subscribeConnectivity } from '../connectivity';

describe('hard offline', () => {
  beforeEach(() => useDemo.getState().setForceOffline(false));

  it('flips hasInternet() and the connectivity subscribers', async () => {
    expect(await hasInternet()).toBe(true);
    const seen: boolean[] = [];
    const stop = subscribeConnectivity((online) => seen.push(online));
    useDemo.getState().setForceOffline(true);
    expect(await hasInternet()).toBe(false);
    expect(seen).toEqual([false]);
    stop();
  });

  it('turns every api.ts call into an offline Result without touching Supabase', async () => {
    expect((await getSessionUserId()).ok).toBe(true);
    useDemo.getState().setForceOffline(true);
    for (const call of [getSessionUserId, getLeaderboard]) {
      const r = await call();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('offline');
    }
  });

  it('fails a match connect() immediately with a plain reason', async () => {
    process.env.EXPO_PUBLIC_WS_URL = 'ws://127.0.0.1:1/ws';
    useDemo.getState().setForceOffline(true);
    const { useMatchClient, failureCopy } = await import('../match-client');
    useMatchClient.getState().queue('classic');
    await new Promise((r) => setTimeout(r, 50));
    const s = useMatchClient.getState();
    expect(s.status).toBe('failed');
    expect(s.failure?.reason).toBe('forced_offline');
    expect(failureCopy(s.failure!)).toMatch(/five taps/);
  });
});

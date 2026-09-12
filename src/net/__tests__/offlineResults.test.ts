import { beforeEach, describe, expect, it, vi } from 'vitest';

const { networkState, accessToken, ensureSession, settleResults, profile } = vi.hoisted(() => {
  const settle = vi.fn();
  const state = {
    userId: 'user-1' as string | null,
    pendingResults: [
      {
        id: 'offline-1',
        mode: 'ai' as const,
        won: true,
        completedAt: '2026-09-12T00:00:00.000Z',
      },
    ],
    setUserId: vi.fn(),
    settleResults: settle,
  };
  state.setUserId.mockImplementation((userId: string) => {
    state.userId = userId;
  });
  return {
    networkState: vi.fn(),
    accessToken: vi.fn(),
    ensureSession: vi.fn(),
    settleResults: settle,
    profile: state,
  };
});

vi.mock('expo-network', () => ({ getNetworkStateAsync: networkState }));
vi.mock('../api', () => ({ getAccessToken: accessToken }));
vi.mock('../auth', () => ({ ensureSession }));
vi.mock('@/state/profile', () => ({ useProfile: { getState: () => profile } }));

import { flushPendingResults } from '../offlineResults';

describe('offline result transport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.EXPO_PUBLIC_API_URL = 'https://match.example.test';
    profile.userId = 'user-1';
    profile.pendingResults = [
      {
        id: 'offline-1',
        mode: 'ai',
        won: true,
        completedAt: '2026-09-12T00:00:00.000Z',
      },
    ];
    settleResults.mockReset();
    accessToken.mockReset();
    ensureSession.mockReset();
  });

  it('makes zero auth or HTTP calls while the OS reports airplane mode', async () => {
    networkState.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(flushPendingResults()).resolves.toBe(false);

    expect(accessToken).not.toHaveBeenCalled();
    expect(ensureSession).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('acknowledges queued results and applies authoritative totals after reconnect', async () => {
    networkState.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    accessToken.mockResolvedValue({ ok: true, value: 'jwt' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        acknowledged: ['offline-1'],
        profile: { rankPoints: 25, battlesPlayed: 1, battlesWon: 1, coins: 50 },
      }),
    } as Response);

    await expect(flushPendingResults()).resolves.toBe(true);

    expect(settleResults).toHaveBeenCalledWith(['offline-1'], {
      rankPoints: 25,
      battlesPlayed: 1,
      battlesWon: 1,
      coins: 50,
    });
  });
});

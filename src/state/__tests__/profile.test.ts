import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { DEFAULT_PROFILE, useProfile } from '../profile';

describe('offline result queue', () => {
  beforeEach(() => {
    values.clear();
    useProfile.setState({ ...DEFAULT_PROFILE });
  });

  // BUG-010: only matches the server sees count toward the ladder. Offline AI
  // and hot-seat results are the device's word (a hot-seat player could hand
  // themselves a win by resigning as player two), so they award coins only —
  // no rank points, and they don't count as battles played or won.
  it('awards coins at once, never ladder points, and stays idempotent for the same result id', () => {
    const result = {
      id: 'local-match-one',
      mode: 'ai' as const,
      won: true,
      completedAt: '2026-09-12T00:00:00.000Z',
    };

    useProfile.getState().queueResult(result);
    useProfile.getState().queueResult(result);

    const state = useProfile.getState();
    expect(state.rankPoints).toBe(0);
    expect(state.coins).toBe(50);
    expect(state.battlesPlayed).toBe(0);
    expect(state.battlesWon).toBe(0);
    expect(state.pendingResults).toEqual([result]);
  });

  it('reconciles cloud totals without losing a result queued during the request', () => {
    const first = {
      id: 'first',
      mode: 'ai' as const,
      won: true,
      completedAt: '2026-09-12T00:00:00.000Z',
    };
    const second = {
      id: 'second',
      mode: 'hotseat' as const,
      won: false,
      completedAt: '2026-09-12T00:01:00.000Z',
    };
    useProfile.getState().queueResult(first);
    useProfile.getState().queueResult(second);

    useProfile.getState().settleResults(['first'], {
      rankPoints: 125,
      coins: 250,
      battlesPlayed: 5,
      battlesWon: 3,
    });

    const state = useProfile.getState();
    expect(state.pendingResults).toEqual([second]);
    // The cloud's totals, plus only the coins of the loss still unsynced.
    expect(state.rankPoints).toBe(125);
    expect(state.coins).toBe(260);
    expect(state.battlesPlayed).toBe(5);
    expect(state.battlesWon).toBe(3);
  });

  // BUG-022: every launch merges the cloud row over the local profile, and the
  // merge took the cloud's coins as they were — dropping what the offline
  // games still waiting to sync had paid, so the balance dipped until the
  // next sync put them back.
  it('keeps the coins of results still waiting to sync when the cloud row is merged in', () => {
    useProfile.getState().queueResult({
      id: 'unsynced-win',
      mode: 'ai',
      won: true,
      completedAt: '2026-09-12T00:00:00.000Z',
    });

    useProfile.getState().mergeRemote({ name: 'Cloud captain', rankPoints: 125, coins: 300 });

    const state = useProfile.getState();
    expect(state.coins).toBe(350);
    expect(state.rankPoints).toBe(125);
    expect(state.name).toBe('Cloud captain');
    expect(state.pendingResults).toHaveLength(1);
  });

  it('leaves the coins alone when the merged data carries none', () => {
    useProfile.setState({ coins: 80 });
    useProfile.getState().queueResult({
      id: 'unsynced-loss',
      mode: 'hotseat',
      won: false,
      completedAt: '2026-09-12T00:00:00.000Z',
    });

    useProfile.getState().mergeRemote({ name: 'Renamed' });

    expect(useProfile.getState().coins).toBe(90);
  });

  it('clears account data on sign-out while keeping device preferences', () => {
    useProfile.setState({
      userId: 'previous-user',
      name: 'Previous captain',
      rankPoints: 900,
      battlesPlayed: 12,
      pendingResults: [
        {
          id: 'pending-old-account',
          mode: 'ai',
          won: true,
          completedAt: '2026-09-12T00:00:00.000Z',
        },
      ],
      soundOn: false,
      musicVolume: 0.6,
    });

    useProfile.getState().clearAccount();

    const state = useProfile.getState();
    expect(state.userId).toBeNull();
    expect(state.name).toBe('');
    expect(state.rankPoints).toBe(0);
    expect(state.battlesPlayed).toBe(0);
    expect(state.pendingResults).toEqual([]);
    expect(state.soundOn).toBe(false);
    expect(state.musicVolume).toBe(0.6);
  });
});

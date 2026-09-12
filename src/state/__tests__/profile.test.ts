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

  it('awards immediately and remains idempotent for the same result id', () => {
    const result = {
      id: 'local-match-one',
      mode: 'ai' as const,
      won: true,
      completedAt: '2026-09-12T00:00:00.000Z',
    };

    useProfile.getState().queueResult(result);
    useProfile.getState().queueResult(result);

    const state = useProfile.getState();
    expect(state.rankPoints).toBe(25);
    expect(state.coins).toBe(50);
    expect(state.battlesPlayed).toBe(1);
    expect(state.battlesWon).toBe(1);
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
    expect(state.rankPoints).toBe(130);
    expect(state.coins).toBe(260);
    expect(state.battlesPlayed).toBe(6);
    expect(state.battlesWon).toBe(3);
  });
});

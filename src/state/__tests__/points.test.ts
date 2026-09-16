import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/localStorage/install', () => ({}));

// Hoisted: the store's persist middleware resolves its storage while the
// import below is still being evaluated, so the shim has to exist first.
const values = vi.hoisted(() => {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    },
  });
  return map;
});

import { usePoints, WAGER_STAKE } from '../points';

function reset(): void {
  values.clear();
  usePoints.getState().clear();
}

describe('offline wager lifecycle', () => {
  beforeEach(reset);

  it('carries the live stake into a settlement the app can retry', () => {
    const points = usePoints.getState();
    points.sync(100);
    points.beginWager('11111111-1111-4111-8111-111111111111');
    // The server already deducted the stake; the store mirrors that balance.
    points.sync(100 - WAGER_STAKE);

    expect(usePoints.getState().activeWager).toEqual({
      requestId: '11111111-1111-4111-8111-111111111111',
      stake: WAGER_STAKE,
    });

    usePoints.getState().finishWager(true);
    const after = usePoints.getState();
    expect(after.activeWager).toBeNull();
    expect(after.pendingWagerSettlement).toEqual({
      requestId: '11111111-1111-4111-8111-111111111111',
      stake: WAGER_STAKE,
      won: true,
    });
  });

  it('does nothing when the match carried no wager', () => {
    usePoints.getState().finishWager(true);

    expect(usePoints.getState().pendingWagerSettlement).toBeNull();
  });

  it('keeps one settlement per match — a second finish cannot queue another', () => {
    const points = usePoints.getState();
    points.beginWager('22222222-2222-4222-8222-222222222222');
    points.finishWager(false);
    // markFinished can run more than once for the same match; the second call
    // has no active wager left to move, so the queued settlement stands.
    usePoints.getState().finishWager(true);

    expect(usePoints.getState().pendingWagerSettlement?.won).toBe(false);
  });

  it('persists an unpaid settlement but never the live hold', () => {
    const points = usePoints.getState();
    points.beginWager('33333333-3333-4333-8333-333333333333');
    points.finishWager(true);
    const persisted = JSON.parse(values.get('eob.points') as string) as {
      state: Record<string, unknown>;
    };

    // A won stake must survive a crash or a kill so the payout still happens.
    expect(persisted.state.pendingWagerSettlement).toEqual({
      requestId: '33333333-3333-4333-8333-333333333333',
      stake: WAGER_STAKE,
      won: true,
    });
    // An abandoned hold is handed straight back by the next reservation, so
    // the live wager is deliberately dropped on restart.
    expect(persisted.state).not.toHaveProperty('activeWager');
  });

  it('clears both halves when the account signs out', () => {
    const points = usePoints.getState();
    points.beginWager('44444444-4444-4444-8444-444444444444');
    points.finishWager(true);
    usePoints.getState().clear();

    expect(usePoints.getState().pendingWagerSettlement).toBeNull();
    expect(usePoints.getState().activeWager).toBeNull();
  });
});

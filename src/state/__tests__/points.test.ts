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

describe('offline wagers are gone (BUG-001)', () => {
  beforeEach(reset);

  it('offers no way to stake points on a match the server never sees', () => {
    const points = usePoints.getState() as unknown as Record<string, unknown>;

    // These carried a stake into a match against the device's own AI, which
    // the server then paid out on the device's word.
    expect(points.beginWager).toBeUndefined();
    expect(points.finishWager).toBeUndefined();
    expect(points.activeWager).toBeUndefined();
  });

  it('still persists a settlement an older version left behind, so it can be refunded', () => {
    usePoints.setState({
      pendingWagerSettlement: {
        requestId: '33333333-3333-4333-8333-333333333333',
        stake: WAGER_STAKE,
        won: true,
      },
    });
    const persisted = JSON.parse(values.get('eob.points') as string) as {
      state: Record<string, unknown>;
    };

    expect(persisted.state.pendingWagerSettlement).toEqual({
      requestId: '33333333-3333-4333-8333-333333333333',
      stake: WAGER_STAKE,
      won: true,
    });
  });

  it('clears that settlement when the account signs out', () => {
    usePoints.setState({
      pendingWagerSettlement: {
        requestId: '44444444-4444-4444-8444-444444444444',
        stake: WAGER_STAKE,
        won: true,
      },
    });
    usePoints.getState().clear();

    expect(usePoints.getState().pendingWagerSettlement).toBeNull();
  });
});

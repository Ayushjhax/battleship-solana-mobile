/**
 * "no lag" for an online match, stated as assertions.
 *
 * Two things used to sit between a tap and the server hearing about it:
 *
 *  1. The crosshair's AIM_MS ran BEFORE the request was sent, so it stacked on
 *     top of the round trip instead of hiding inside it. On a server a
 *     continent away that turned a ~850 ms wait into ~1.1 s.
 *  2. USE_ARSENAL sent and then drew nothing at all until the server replied
 *     (covered in arsenal-deploy-lag.test.ts).
 *
 * The rule these pin: in online mode, a legal tap reaches the network in the
 * same tick, and local feedback is enqueued before the send so the server's
 * verdict can never be animated ahead of the shell that precedes it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ME = 'player-1';

const mocks = vi.hoisted(() => ({
  fire: vi.fn(),
  useArsenal: vi.fn(),
  resign: vi.fn(),
  enqueue: vi.fn(),
  skip: vi.fn(),
  clear: vi.fn(),
  onBusy: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

vi.mock('../../src/state/profile', () => ({
  useProfile: { getState: () => ({ userId: ME, setUserId: vi.fn() }) },
}));
vi.mock('../../src/state/points', () => ({
  usePoints: { getState: () => ({ activeWager: null }) },
}));
vi.mock('../../src/net/match-client', () => ({
  useMatchClient: Object.assign(() => ({}), {
    getState: () => ({
      fire: mocks.fire,
      useArsenal: mocks.useArsenal,
      resign: mocks.resign,
      status: 'active',
      takePendingEvents: () => [],
      view: null,
    }),
    subscribe: mocks.subscribe,
  }),
}));
vi.mock('../../src/fx/EventPlayer', () => ({
  EventPlayer: class {
    busy = false;
    enqueue = mocks.enqueue;
    skip = mocks.skip;
    clear = mocks.clear;
    onBusy = mocks.onBusy;
    wait = async () => {};
    dispose = vi.fn();
  },
}));

function playingView() {
  return {
    phase: 'playing',
    turn: ME,
    moves: 3,
    you: { board: { arsenal: [] } },
    enemy: { marks: {} },
  };
}

async function onlineBattle() {
  const { useBattle } = await import('../../src/state/battle');
  useBattle.setState({
    mode: 'online',
    me: ME,
    shown: playingView() as never,
    pending: false,
    aiming: null,
    animating: false,
    finished: false,
    fleetCovered: false,
    pendingShotAt: null,
    pendingArsenalAt: null,
  });
  return useBattle;
}

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.subscribe.mockReturnValue(() => {});
});

describe('a tap reaches the network immediately', () => {
  it('sends the shot in the same tick, with no timer in between', async () => {
    const useBattle = await onlineBattle();

    useBattle.getState().aim({ r: 4, c: 4 });

    // Synchronous: no fake timers advanced, nothing awaited.
    expect(mocks.fire).toHaveBeenCalledTimes(1);
    expect(mocks.fire).toHaveBeenCalledWith({ r: 4, c: 4 });
  });

  it('does not park the tap behind the crosshair animation', async () => {
    const useBattle = await onlineBattle();

    useBattle.getState().aim({ r: 2, c: 7 });

    // `aiming` is the crosshair; online it must not gate the send.
    expect(useBattle.getState().aiming).toBeNull();
  });

  it('locks input the instant the shot goes out', async () => {
    const useBattle = await onlineBattle();

    useBattle.getState().aim({ r: 1, c: 1 });

    expect(useBattle.getState().pending).toBe(true);
    expect(useBattle.getState().pendingShotAt).toEqual({ r: 1, c: 1 });
  });

  it('flies the shell locally before the server has said anything', async () => {
    const useBattle = await onlineBattle();

    useBattle.getState().aim({ r: 3, c: 6 });

    expect(mocks.enqueue).toHaveBeenCalledWith([
      { type: 'SHOT_FIRED', playerId: ME, at: { r: 3, c: 6 } },
    ]);
  });

  it('enqueues the shell BEFORE sending, so a fast reply cannot overtake it', async () => {
    // On a local server the verdict can come back within a millisecond. If the
    // send happened first, those events could be queued ahead of the shell and
    // the player would see the result before the shot.
    const order: string[] = [];
    mocks.enqueue.mockImplementation(() => order.push('enqueue'));
    mocks.fire.mockImplementation(() => order.push('send'));
    const useBattle = await onlineBattle();

    useBattle.getState().aim({ r: 0, c: 0 });

    expect(order).toEqual(['enqueue', 'send']);
  });
});

describe('a second tap cannot double-fire', () => {
  it('ignores taps while a shot is in flight', async () => {
    const useBattle = await onlineBattle();

    useBattle.getState().aim({ r: 4, c: 4 });
    useBattle.getState().aim({ r: 5, c: 5 });
    useBattle.getState().aim({ r: 6, c: 6 });

    expect(mocks.fire).toHaveBeenCalledTimes(1);
  });

  it('ignores a tap on a cell already marked', async () => {
    const useBattle = await onlineBattle();
    useBattle.setState({
      shown: { ...playingView(), enemy: { marks: { '4,4': 'miss' } } } as never,
    });

    useBattle.getState().aim({ r: 4, c: 4 });

    expect(mocks.fire).not.toHaveBeenCalled();
  });

  it('ignores a tap when it is not your turn', async () => {
    const useBattle = await onlineBattle();
    useBattle.setState({ shown: { ...playingView(), turn: 'someone-else' } as never });

    useBattle.getState().aim({ r: 4, c: 4 });

    expect(mocks.fire).not.toHaveBeenCalled();
  });

  it('ignores a tap while the queue is animating', async () => {
    const useBattle = await onlineBattle();
    useBattle.setState({ animating: true });

    useBattle.getState().aim({ r: 4, c: 4 });

    expect(mocks.fire).not.toHaveBeenCalled();
  });

  it('ignores a tap once the match is over', async () => {
    const useBattle = await onlineBattle();
    useBattle.setState({ finished: true });

    useBattle.getState().aim({ r: 4, c: 4 });

    expect(mocks.fire).not.toHaveBeenCalled();
  });
});

describe('an armed arsenal item is just as immediate', () => {
  it('sends in the same tick and marks the target', async () => {
    const useBattle = await onlineBattle();
    useBattle.setState({ targeting: { itemId: 'bomb-1', kind: 'bomber' } });

    useBattle.getState().aim({ r: 7, c: 2 });

    expect(mocks.useArsenal).toHaveBeenCalledTimes(1);
    expect(useBattle.getState().pendingArsenalAt).toEqual({ r: 7, c: 2 });
  });

  it('routes a row weapon by row, not by cell', async () => {
    const useBattle = await onlineBattle();
    useBattle.setState({ targeting: { itemId: 'torp-1', kind: 'torpedoBomber' } });

    useBattle.getState().aim({ r: 6, c: 9 });

    expect(mocks.useArsenal).toHaveBeenCalledWith('torp-1', { at: undefined, row: 6 });
  });

  it('disarms after firing so the next tap is an ordinary shot', async () => {
    const useBattle = await onlineBattle();
    useBattle.setState({ targeting: { itemId: 'bomb-1', kind: 'bomber' } });

    useBattle.getState().aim({ r: 7, c: 2 });

    expect(useBattle.getState().targeting).toBeNull();
  });
});

describe('offline keeps its crosshair', () => {
  it('still waits out the aim before firing against the AI', async () => {
    vi.useFakeTimers();
    const { useBattle } = await import('../../src/state/battle');
    const { AIM_MS } = await import('../../src/state/battle');
    useBattle.setState({
      mode: 'ai',
      me: ME,
      match: { id: 'm', phase: 'playing', turn: ME } as never,
      shown: playingView() as never,
      pending: false,
      aiming: null,
      animating: false,
      finished: false,
      fleetCovered: false,
    });

    useBattle.getState().aim({ r: 4, c: 4 });

    // The crosshair is worth its 260 ms where there is no network to hide it in.
    expect(useBattle.getState().aiming).toEqual({ r: 4, c: 4 });
    vi.advanceTimersByTime(AIM_MS);
    expect(useBattle.getState().aiming).toBeNull();
  });
});

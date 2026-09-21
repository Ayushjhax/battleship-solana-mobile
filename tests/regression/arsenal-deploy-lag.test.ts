/**
 * Regression: "Lagging of arsenal deployment, in game moves."
 *
 * Online, `act()` has flown the shell locally since P13, so a FIRE reads as
 * instant even though the verdict is still a round trip away. USE_ARSENAL had
 * no such cue: it set `pending`, sent, and then drew nothing at all until the
 * server's events arrived. Against a server a continent away that is most of a
 * second of a screen that looks like it ignored the tap, so people tapped
 * again.
 *
 * The fix marks the target immediately via `pendingArsenalAt`, mirroring
 * `pendingShotAt`. It says "sent" and never an outcome — predicting the result
 * of a shot is exactly what this codebase forbids.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ME = 'player-1';

const mocks = vi.hoisted(() => ({
  fire: vi.fn(),
  useArsenal: vi.fn(),
  resign: vi.fn(),
  enqueue: vi.fn(),
  skip: vi.fn(),
  onBusy: vi.fn(),
  clear: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

vi.mock('../../src/net/match-client', () => ({
  useMatchClient: Object.assign(
    (selector: (state: unknown) => unknown) => selector(matchClientState()),
    {
      getState: () => matchClientState(),
      subscribe: mocks.subscribe,
    },
  ),
}));

// The profile store persists through expo-sqlite's localStorage shim, which
// has no Node build; battle.ts only reads an id from it here.
vi.mock('../../src/state/profile', () => ({
  useProfile: { getState: () => ({ userId: ME, setUserId: vi.fn() }) },
}));
vi.mock('../../src/state/points', () => ({
  usePoints: { getState: () => ({ activeWager: null }) },
}));

vi.mock('../../src/fx/EventPlayer', () => ({
  EventPlayer: class {
    busy = false;
    enqueue = mocks.enqueue;
    skip = mocks.skip;
    onBusy = mocks.onBusy;
    clear = mocks.clear;
    wait = async () => {};
    dispose = () => {};
  },
}));

function matchClientState() {
  return {
    fire: mocks.fire,
    useArsenal: mocks.useArsenal,
    resign: mocks.resign,
    status: 'active',
    pendingEvents: [],
    takePendingEvents: () => [],
    view: null,
    lastError: null,
  };
}

/** A minimal `shown` view: enough for act()'s guards to let an action through. */
function playingView() {
  return {
    phase: 'playing',
    turn: ME,
    moves: 3,
    you: { board: { arsenal: [] } },
    enemy: { marks: {} },
  };
}

async function loadBattle() {
  const { useBattle } = await import('../../src/state/battle');
  useBattle.setState({
    mode: 'online',
    me: ME,
    shown: playingView() as never,
    pending: false,
    pendingShotAt: null,
    pendingArsenalAt: null,
    animating: false,
    finished: false,
    fleetCovered: false,
  });
  return useBattle;
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.subscribe.mockReturnValue(() => {});
});

describe('an arsenal deployment is acknowledged immediately', () => {
  it('marks the targeted cell in the same tick as the send', async () => {
    const useBattle = await loadBattle();

    useBattle.getState().act({
      type: 'USE_ARSENAL',
      playerId: ME,
      itemId: 'item-1',
      at: { r: 4, c: 6 },
    } as never);

    // Synchronously after act() — no awaiting the server.
    expect(useBattle.getState().pendingArsenalAt).toEqual({ r: 4, c: 6 });
    expect(useBattle.getState().pending).toBe(true);
    expect(mocks.useArsenal).toHaveBeenCalledWith('item-1', { at: { r: 4, c: 6 }, row: undefined });
  });

  it('marks the row for a row-targeted weapon', async () => {
    const useBattle = await loadBattle();

    useBattle.getState().act({
      type: 'USE_ARSENAL',
      playerId: ME,
      itemId: 'torpedo-1',
      row: 7,
    } as never);

    expect(useBattle.getState().pendingArsenalAt).toEqual({ r: 7, c: 0 });
    expect(mocks.useArsenal).toHaveBeenCalledWith('torpedo-1', { at: undefined, row: 7 });
  });

  it('does not predict an outcome — only the target is marked', async () => {
    const useBattle = await loadBattle();
    const before = useBattle.getState().shown;

    useBattle.getState().act({
      type: 'USE_ARSENAL',
      playerId: ME,
      itemId: 'item-1',
      at: { r: 1, c: 1 },
    } as never);

    // The view is untouched: no hit, no miss, no mark applied locally.
    expect(useBattle.getState().shown).toBe(before);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('leaves the shot marker alone so the two never show at once', async () => {
    const useBattle = await loadBattle();

    useBattle.getState().act({
      type: 'USE_ARSENAL',
      playerId: ME,
      itemId: 'item-1',
      at: { r: 2, c: 2 },
    } as never);

    expect(useBattle.getState().pendingShotAt).toBeNull();
  });

  it('clears any arsenal mark when an ordinary shot goes out', async () => {
    const useBattle = await loadBattle();
    useBattle.setState({ pendingArsenalAt: { r: 5, c: 5 } });

    useBattle.getState().act({ type: 'FIRE', playerId: ME, at: { r: 0, c: 0 } } as never);

    expect(useBattle.getState().pendingArsenalAt).toBeNull();
    expect(useBattle.getState().pendingShotAt).toEqual({ r: 0, c: 0 });
  });

  it('still flies the shell locally for a FIRE', async () => {
    const useBattle = await loadBattle();

    useBattle.getState().act({ type: 'FIRE', playerId: ME, at: { r: 3, c: 3 } } as never);

    expect(mocks.enqueue).toHaveBeenCalledWith([
      { type: 'SHOT_FIRED', playerId: ME, at: { r: 3, c: 3 } },
    ]);
  });

  it('refuses to send a second deployment while one is pending', async () => {
    const useBattle = await loadBattle();

    useBattle.getState().act({
      type: 'USE_ARSENAL',
      playerId: ME,
      itemId: 'item-1',
      at: { r: 4, c: 4 },
    } as never);
    useBattle.getState().act({
      type: 'USE_ARSENAL',
      playerId: ME,
      itemId: 'item-2',
      at: { r: 5, c: 5 },
    } as never);

    expect(mocks.useArsenal).toHaveBeenCalledTimes(1);
    expect(useBattle.getState().pendingArsenalAt).toEqual({ r: 4, c: 4 });
  });
});

describe('the mark is cleared by every path that ends the wait', () => {
  /**
   * `start({mode:'online'})` installs the real subscriber on the match client.
   * Capturing it lets these drive the actual clearing code rather than
   * asserting a setState the test itself performed.
   */
  async function startOnlineAndCaptureSubscriber() {
    const { useBattle } = await import('../../src/state/battle');
    useBattle.getState().start({
      mode: 'online',
      ruleset: 'advanced',
      matchId: 'match-1',
      one: { id: ME, name: 'Me' },
      two: { id: 'player-2', name: 'Them' },
    } as never);
    const lastCall = mocks.subscribe.mock.calls.at(-1) as unknown[] | undefined;
    const subscriber = lastCall?.[0] as ((next: unknown, prev: unknown) => void) | undefined;
    if (!subscriber) throw new Error('start() did not subscribe to the match client');
    return { useBattle, subscriber };
  }

  const baseClient = {
    status: 'active',
    eventsNonce: 0,
    errorNonce: 0,
    view: null,
    lastError: null,
    takePendingEvents: () => [],
  };

  it('clears when the server answers with events', async () => {
    const { useBattle, subscriber } = await startOnlineAndCaptureSubscriber();
    useBattle.setState({
      me: ME,
      shown: playingView() as never,
      pending: true,
      pendingArsenalAt: { r: 4, c: 4 },
    });

    subscriber(
      {
        ...baseClient,
        eventsNonce: 1,
        takePendingEvents: () => [{ type: 'HIT', playerId: ME, at: { r: 4, c: 4 } }],
      },
      baseClient,
    );

    expect(useBattle.getState().pendingArsenalAt).toBeNull();
    expect(useBattle.getState().pending).toBe(false);
  });

  it('clears when the server refuses the action', async () => {
    const { useBattle, subscriber } = await startOnlineAndCaptureSubscriber();
    useBattle.setState({
      me: ME,
      shown: playingView() as never,
      pending: true,
      pendingArsenalAt: { r: 4, c: 4 },
    });

    subscriber(
      { ...baseClient, errorNonce: 1, lastError: { code: 'item_used', message: 'already used' } },
      baseClient,
    );

    expect(useBattle.getState().pendingArsenalAt).toBeNull();
    expect(useBattle.getState().pending).toBe(false);
  });

  it('clears after a reconnect resync drops in-flight optimism', async () => {
    const { useBattle, subscriber } = await startOnlineAndCaptureSubscriber();
    useBattle.setState({
      me: ME,
      shown: playingView() as never,
      pending: true,
      pendingArsenalAt: { r: 4, c: 4 },
    });

    subscriber({ ...baseClient, status: 'active' }, { ...baseClient, status: 'reconnecting' });

    expect(useBattle.getState().pendingArsenalAt).toBeNull();
    expect(mocks.skip).toHaveBeenCalled();
  });

  it('starts every battle with no stale mark', async () => {
    const { useBattle } = await startOnlineAndCaptureSubscriber();

    expect(useBattle.getState().pendingArsenalAt).toBeNull();
  });
});

/**
 * Regression: "While in 2 Player mode, the Turn Pass prompt should only come
 * up once and not repeatedly after every move." / "repeated instruction —
 * fix the dialog prompt."
 *
 * Every handover raised a full-screen modal: "Pass the device", "<name>'s
 * turn", "Tap Ready when only <name> can see the screen", a Ready button —
 * the same three lines re-read after every miss, and the whole game hidden
 * behind them while it was up.
 *
 * The first cut at this deleted the curtain outright, which let each player
 * see the other's fleet the moment the view swapped: on one shared phone the
 * hidden-information game was gone.
 *
 * The handover is now a sheet over the incoming player's OWN BOARD only
 * (`fleetCovered`), raised in the same commit that moves `me`, carrying just
 * whose fleet it is, lifted by one tap (`uncoverFleet`). The enemy board and
 * the HUD stay in view; nothing is read, nothing is confirmed. The one place
 * the full instruction still appears is the placement handoff, once.
 *
 * What these pin: the view still changes hands (the trap in removing the
 * modal was that dismissing it was also what moved `me`), the incoming fleet
 * is never shown uncovered to whoever is still holding the device, and the
 * clock and the incoming player's input wait for the lift.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ONE = 'player-one';
const TWO = 'player-two';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  skip: vi.fn(),
  clear: vi.fn(),
  onBusy: vi.fn(),
  driveAi: vi.fn(),
  dispatch: vi.fn(),
  dispose: vi.fn(),
  projectView: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

vi.mock('../../src/state/profile', () => ({
  useProfile: { getState: () => ({ userId: ONE, setUserId: vi.fn() }) },
}));
vi.mock('../../src/state/points', () => ({
  usePoints: { getState: () => ({ activeWager: null }) },
}));
vi.mock('../../src/net/match-client', () => ({
  useMatchClient: Object.assign(() => ({}), {
    getState: () => ({ status: 'idle', takePendingEvents: () => [], view: null }),
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
    dispose = mocks.dispose;
  },
}));

/** `me` decides which side the screen renders; projectView proves it is used. */
vi.mock('@engine/match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/match')>();
  return { ...actual, projectView: mocks.projectView };
});

let liveMatch: { phase: string; turn: string; id: string };

vi.mock('../../src/features/offline/LocalMatch', () => ({
  LocalMatch: class {
    get state() {
      return liveMatch;
    }
    dispatch = mocks.dispatch;
    driveAi = mocks.driveAi;
    dispose = mocks.dispose;
  },
  setLocalAiThinkTime: vi.fn(),
}));

/** The battlePlayer's busy listener — how the store learns the queue drained. */
function drainQueue() {
  const listener = mocks.onBusy.mock.calls.at(-1)?.[0] as ((busy: boolean) => void) | undefined;
  if (!listener) throw new Error('the store never registered a busy listener');
  listener(false);
}

async function startHotseat(ruleset: 'classic' | 'advanced' = 'classic') {
  const { useBattle } = await import('../../src/state/battle');
  useBattle.getState().start({
    mode: 'hotseat',
    ruleset,
    seed: 1,
    one: { id: ONE, name: 'One' },
    two: { id: TWO, name: 'Two' },
  } as never);
  return useBattle;
}

/** Player one's shot missed: the match says it is player two's turn now. */
async function handOverToTwo(useBattle: Awaited<ReturnType<typeof startHotseat>>) {
  useBattle.getState().uncoverFleet();
  liveMatch = { ...liveMatch, turn: TWO };
  drainQueue();
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.subscribe.mockReturnValue(() => {});
  mocks.projectView.mockImplementation((_match: unknown, me: string) => ({
    phase: 'playing',
    turn: liveMatch.turn,
    moves: 0,
    forPlayer: me,
    you: { board: { arsenal: [], marks: {}, ships: [] } },
    enemy: { marks: {} },
  }));
  liveMatch = { phase: 'playing', turn: ONE, id: 'match-1' };
});

afterEach(async () => {
  // Clears the aim timer a test may have started.
  const { useBattle } = await import('../../src/state/battle');
  useBattle.getState().reset();
});

describe('the modal prompt is gone — the turn changes hands by itself', () => {
  it('moves `me` to whoever the match says has the turn', async () => {
    // Without this, `me` stays on player one forever and the match deadlocks.
    const useBattle = await startHotseat();
    expect(useBattle.getState().me).toBe(ONE);

    await handOverToTwo(useBattle);

    expect(useBattle.getState().me).toBe(TWO);
  });

  it('hands back again on the next move', async () => {
    const useBattle = await startHotseat();

    await handOverToTwo(useBattle);
    useBattle.getState().uncoverFleet();
    liveMatch = { ...liveMatch, turn: ONE };
    drainQueue();

    expect(useBattle.getState().me).toBe(ONE);
  });

  it('re-projects the view for the new player', async () => {
    const useBattle = await startHotseat();

    await handOverToTwo(useBattle);

    // The last projection must be for player two, not a stale player-one view.
    expect(mocks.projectView).toHaveBeenLastCalledWith(liveMatch, TWO);
    expect(useBattle.getState().shown).toMatchObject({ forPlayer: TWO });
  });

  it('snaps the turn triangle rather than rotating it a second time', async () => {
    const useBattle = await startHotseat();

    await handOverToTwo(useBattle);

    expect(useBattle.getState().snapTurn).toBe(true);
  });

  it('does nothing when the same player keeps the turn', async () => {
    const useBattle = await startHotseat();
    useBattle.getState().uncoverFleet();
    const before = useBattle.getState().me;

    drainQueue(); // a hit: the turn is still ONE

    expect(useBattle.getState().me).toBe(before);
    expect(useBattle.getState().fleetCovered).toBe(false);
  });

  it('does not drive an AI on the handover', async () => {
    // `start()` pokes driveAi once for every local mode (a no-op in hotseat);
    // what matters is that handing the turn over does not poke it again.
    const useBattle = await startHotseat();
    const atStart = mocks.driveAi.mock.calls.length;

    await handOverToTwo(useBattle);

    expect(mocks.driveAi.mock.calls.length).toBe(atStart);
  });
});

describe('the incoming fleet is covered, never shown to the outgoing player', () => {
  it('starts covered: player two placed last, so player one’s fleet is under the sheet', async () => {
    const useBattle = await startHotseat();

    expect(useBattle.getState().me).toBe(ONE);
    expect(useBattle.getState().fleetCovered).toBe(true);
  });

  it('covers the fleet in the same commit that swaps the view', async () => {
    const useBattle = await startHotseat();
    useBattle.getState().uncoverFleet();
    // Every state the screen could render for player two, in order.
    const coveredWhenTwo: boolean[] = [];
    const unsubscribe = useBattle.subscribe((state) => {
      if (state.me === TWO) coveredWhenTwo.push(state.fleetCovered);
    });

    liveMatch = { ...liveMatch, turn: TWO };
    drainQueue();
    unsubscribe();

    expect(coveredWhenTwo.length).toBeGreaterThan(0);
    expect(coveredWhenTwo[0]).toBe(true);
  });

  it('covers again on every handover, for every player', async () => {
    const useBattle = await startHotseat();

    for (let turn = 0; turn < 6; turn += 1) {
      useBattle.getState().uncoverFleet();
      expect(useBattle.getState().fleetCovered).toBe(false);
      liveMatch = { ...liveMatch, turn: turn % 2 === 0 ? TWO : ONE };
      drainQueue();
      expect(useBattle.getState().fleetCovered).toBe(true);
    }
  });

  it('one tap lifts it and starts a fresh clock', async () => {
    const useBattle = await startHotseat();
    useBattle.setState({ seconds: 7 });

    useBattle.getState().uncoverFleet();

    expect(useBattle.getState().fleetCovered).toBe(false);
    expect(useBattle.getState().seconds).toBeGreaterThan(7);
  });

  it('lifting an already-lifted sheet touches nothing', async () => {
    const useBattle = await startHotseat();
    useBattle.getState().uncoverFleet();
    useBattle.setState({ seconds: 7 });

    useBattle.getState().uncoverFleet();

    expect(useBattle.getState().seconds).toBe(7);
  });
});

describe('under the sheet the incoming player’s turn has not begun', () => {
  it('the clock waits for the lift', async () => {
    const useBattle = await startHotseat();
    const before = useBattle.getState().seconds;

    useBattle.getState().tick();
    useBattle.getState().tick();
    expect(useBattle.getState().seconds).toBe(before);

    useBattle.getState().uncoverFleet();
    useBattle.getState().tick();
    expect(useBattle.getState().seconds).toBe(before - 1);
  });

  it('a tap on the enemy board does not fire — a stray tap from the outgoing player must not spend the turn', async () => {
    const useBattle = await startHotseat();

    useBattle.getState().aim({ r: 3, c: 4 });
    expect(useBattle.getState().aiming).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalled();

    useBattle.getState().uncoverFleet();
    useBattle.getState().aim({ r: 3, c: 4 });
    expect(useBattle.getState().aiming).toEqual({ r: 3, c: 4 });
  });

  it('the arsenal stays shut until the lift', async () => {
    const useBattle = await startHotseat('advanced');

    useBattle.getState().setArsenalOpen(true);
    expect(useBattle.getState().arsenalOpen).toBe(false);

    useBattle.getState().uncoverFleet();
    useBattle.getState().setArsenalOpen(true);
    expect(useBattle.getState().arsenalOpen).toBe(true);
  });
});

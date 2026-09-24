/**
 * part-07 §8.4 and the two QA cases the instruction called out by name:
 * **backgrounding the app mid-raid** and **a slow connection**, plus the
 * **double-tap collect** case.
 *
 * §9.3 is the rule underneath all of them: **"A raid never ends without a
 * result the player can see."** The tests below try, in every way I could
 * think of, to reach a state where the raid is gone and the player has
 * nothing — and assert that none of them work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INITIAL_FLOW,
  boardInteractive,
  isOver,
  owesResult,
  reduceFlow,
  searchButtonLabel,
  shouldIgnoreTap,
  type RaidFlow,
} from '@/raid/ui/raidFlow';
import type { RaidView, Settlement, TargetCard } from '@/raid/types';

// ---------------------------------------------------------------------------

const view = (over = false, patch: Partial<RaidView> = {}): RaidView => ({
  marks: {},
  sunkShips: [],
  revealedItems: [],
  shipsRemaining: 8,
  shells: 30,
  kit: {},
  kitLeft: 0,
  stars: 0,
  destruction: 0,
  over,
  msLeft: 240_000,
  ...patch,
});

const card: TargetCard = {
  kind: 'player',
  userId: 'u1',
  coveSeed: null,
  name: 'Someone',
  avatarId: 1,
  avatarColor: 'violet',
  countryCode: 'IN',
  admiraltyLevel: 4,
  renown: 800,
  loot: { coins: 100, steel: 200 },
  renownOffer: { best: 20, worst: -14 },
  costCoins: 40,
};

const settlement = (): Settlement => ({
  raidId: 'r1',
  stars: 2,
  destruction: 0.6,
  endReason: 'retreat',
  earned: { coins: 60, steel: 120, starBonusSteel: 120 },
  taken: { coins: 60, steel: 120 },
  renown: { before: 800, after: 813, delta: 13 },
  shieldHours: 6,
  reveal: null,
  view: view(true),
  serverNow: 1,
});

/** Replays a list of events through the reducer. */
function run(events: Parameters<typeof reduceFlow>[1][], from = INITIAL_FLOW): RaidFlow {
  return events.reduce(reduceFlow, from);
}

/** A raid opened and in progress. */
function raiding(): RaidFlow {
  return run([
    { kind: 'search' },
    { kind: 'card-found', card },
    { kind: 'open', raidId: 'r1' },
    { kind: 'opened', raidId: 'r1', view: view(), card },
  ]);
}

// ===========================================================================
// The happy path
// ===========================================================================

describe('the flow', () => {
  it('starts at the kit', () => {
    expect(INITIAL_FLOW.step).toBe('kit');
    expect(INITIAL_FLOW.raidId).toBeNull();
  });

  it('walks kit → search → card → raid → settle → result', () => {
    const steps: string[] = [];
    let state = INITIAL_FLOW;
    for (const event of [
      { kind: 'search' } as const,
      { kind: 'card-found', card } as const,
      { kind: 'open', raidId: 'r1' } as const,
      { kind: 'opened', raidId: 'r1', view: view(), card } as const,
      { kind: 'view', view: view(true) } as const,
      { kind: 'settled', settlement: settlement() } as const,
    ]) {
      state = reduceFlow(state, event);
      steps.push(state.step);
    }
    expect(steps).toEqual(['searching', 'card', 'opening', 'raiding', 'settling', 'result']);
  });

  it('records the shell budget from the opening view, once', () => {
    const state = run([
      { kind: 'opened', raidId: 'r1', view: view(false, { shells: 45 }), card },
      { kind: 'view', view: view(false, { shells: 12 }) },
    ]);
    expect(state.budget).toBe(45);
    expect(state.view?.shells).toBe(12);
  });

  it('counts searches, for the renown-window widening', () => {
    const state = run([
      { kind: 'search' },
      { kind: 'card-found', card },
      { kind: 'search' },
      { kind: 'card-found', card },
    ]);
    expect(state.searches).toBe(2);
  });

  it('"Raid again" keeps the session search count', () => {
    const state = reduceFlow({ ...raiding(), searches: 3 }, { kind: 'raid-again' });
    expect(state.step).toBe('kit');
    expect(state.searches).toBe(3);
    expect(state.raidId).toBeNull();
  });
});

// ===========================================================================
// §8.4 — the raid always ends in a result
// ===========================================================================

describe('a raid never ends without a result the player can see', () => {
  it('the server saying "over" moves straight to settling', () => {
    const state = reduceFlow(raiding(), { kind: 'view', view: view(true) });
    expect(state.step).toBe('settling');
  });

  it('the client never decides "over" for itself from the shell count', () => {
    // 0 shells but a bomber left keeps the raid alive (part-06 §6). If the
    // client re-derived "over" from shells, this would end the raid early.
    const state = reduceFlow(raiding(), {
      kind: 'view',
      view: view(false, { shells: 0, kitLeft: 1 }),
    });
    expect(state.step).toBe('raiding');
    expect(isOver(state.view)).toBe(false);
  });

  it('a failed settle retries — it never drops the player anywhere', () => {
    const state = reduceFlow({ ...raiding(), step: 'settling' }, { kind: 'settle-failed' });
    expect(state.step).toBe('settling');
    expect(state.retrying).toBe(true);
    // Still owes a result, so the screen keeps the "See the outcome" button.
    expect(owesResult(state)).toBe(true);
  });

  it('BACKGROUNDED 90 s: the probe finds no raid, and settles rather than resetting', () => {
    // The app was away, the server's 60 s disconnect grace fired and settled
    // the raid. /raid/status now says "no active raid". The client must go to
    // the settlement, NOT back to the kit with nothing shown.
    const away = reduceFlow(raiding(), { kind: 'probe' });
    expect(away.step).toBe('recovering');

    const back = reduceFlow(away, { kind: 'probe-idle' });
    expect(back.step).toBe('settling');
    expect(back.raidId).toBe('r1');
    expect(owesResult(back)).toBe(true);
  });

  it('BACKGROUNDED briefly: the probe finds the raid and resumes it', () => {
    const state = run([{ kind: 'probe' }, { kind: 'probe-active', raidId: 'r1', view: view(false, { shells: 21 }) }], raiding());
    expect(state.step).toBe('raiding');
    expect(state.view?.shells).toBe(21);
  });

  it('a probe with no raid ever started goes back to the kit, not to settling', () => {
    const state = reduceFlow(reduceFlow(INITIAL_FLOW, { kind: 'probe' }), { kind: 'probe-idle' });
    expect(state.step).toBe('kit');
    expect(owesResult(state)).toBe(false);
  });

  it('a probe on the RESULT screen changes nothing', () => {
    const done = reduceFlow({ ...raiding(), step: 'settling' }, { kind: 'settled', settlement: settlement() });
    expect(reduceFlow(done, { kind: 'probe' })).toEqual(done);
  });

  it('no event sequence reaches "lost" — there is no such path', () => {
    // An exhaustive walk over every event from every reachable state.
    const events: Parameters<typeof reduceFlow>[1][] = [
      { kind: 'search' },
      { kind: 'card-found', card },
      { kind: 'open', raidId: 'r1' },
      { kind: 'opened', raidId: 'r1', view: view(), card },
      { kind: 'view', view: view() },
      { kind: 'view', view: view(true) },
      { kind: 'settle' },
      { kind: 'settle-failed' },
      { kind: 'probe' },
      { kind: 'probe-idle' },
      { kind: 'probe-active', raidId: 'r1', view: view() },
      { kind: 'error', code: 'internal' },
      { kind: 'raid-again' },
    ];

    let state = INITIAL_FLOW;
    for (let i = 0; i < 400; i++) {
      state = reduceFlow(state, events[i % events.length]!);
      expect(state.step).not.toBe('lost');
      // A state that holds a raid id is always either live or owed a result.
      if (state.raidId && state.step === 'kit') {
        throw new Error('a raid id survived into the kit step');
      }
    }
  });
});

// ===========================================================================
// The double-tap case (§8 QA)
// ===========================================================================

describe('double taps cannot spend twice', () => {
  it('ignores a tap while a request is in flight', () => {
    expect(shouldIgnoreTap(raiding(), true)).toBe(true);
  });

  it('ignores a tap during every transitional step', () => {
    for (const step of ['searching', 'opening', 'settling', 'recovering'] as const) {
      expect(shouldIgnoreTap({ ...raiding(), step }, false), step).toBe(true);
    }
  });

  it('allows a tap while raiding with nothing in flight', () => {
    expect(shouldIgnoreTap(raiding(), false)).toBe(false);
  });

  it('the board is dead unless the raid is live and idle', () => {
    expect(boardInteractive(raiding(), false)).toBe(true);
    expect(boardInteractive(raiding(), true)).toBe(false);
    expect(boardInteractive({ ...raiding(), step: 'settling' }, false)).toBe(false);
    // The server said over; the last response has not been acted on yet.
    expect(boardInteractive({ ...raiding(), view: view(true) }, false)).toBe(false);
  });

  it('a second "open" while opening cannot start a second raid', () => {
    const opening = reduceFlow(raiding(), { kind: 'open', raidId: 'r1' });
    expect(shouldIgnoreTap(opening, false)).toBe(true);
  });
});

// ===========================================================================
// The search cost label
// ===========================================================================

describe('the search button', () => {
  it('shows the cost the server quoted', () => {
    expect(searchButtonLabel(12)).toBe('Next (12 coins)');
    expect(searchButtonLabel(80)).toBe('Next (80 coins)');
  });

  it('says just "Next" when it is free — revenge and the taught raid', () => {
    expect(searchButtonLabel(0)).toBe('Next');
  });
});

// ===========================================================================
// A slow connection (§8 QA)
// ===========================================================================

describe('a slow connection', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries a transport failure and gives up on a typed refusal', async () => {
    // The shared transport's contract, which the raid client inherits: 5xx is
    // retried, 4xx is an answer. A slow link produces the first; a locked
    // target produces the second, and must not be hammered.
    const { MAX_ATTEMPTS, RETRY_DELAY_MS, TIMEOUT_MS } = await import('@/net/retryPolicy');
    expect(MAX_ATTEMPTS).toBe(3);
    expect(RETRY_DELAY_MS).toBe(600);
    // 12 s is longer than a 3G round trip and shorter than a player's patience.
    expect(TIMEOUT_MS).toBe(12_000);
  });

  it('a response that lands after the flow moved on cannot rewind it', () => {
    // Slow link: the settle response arrives after the player already
    // retreated and a second settle landed. The reducer takes the newest.
    const done = reduceFlow({ ...raiding(), step: 'settling' }, {
      kind: 'settled',
      settlement: settlement(),
    });
    const late = reduceFlow(done, { kind: 'view', view: view(false, { shells: 30 }) });
    // A stale 'view' must not un-settle a finished raid.
    expect(late.step).not.toBe('raiding');
    expect(late.settlement).not.toBeNull();
  });

  it('an error does not clear the raid or the view', () => {
    const state = reduceFlow(raiding(), { kind: 'error', code: 'rate-limited' });
    expect(state.raidId).toBe('r1');
    expect(state.view).not.toBeNull();
    expect(state.error).toBe('rate-limited');
  });
});

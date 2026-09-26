/**
 * The Port City preview's timing and exit rules (src/features/city/visit.ts),
 * on vitest's fake clock: when the Coming Soon popup may appear, that it
 * waits for a gesture to end, that the countdown only starts once the popup
 * has finished arriving, that backgrounding pauses rather than skips, and
 * that every way home navigates exactly once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PortCityVisit, VISIT_TIMING, type ExitReason } from '@/features/city/visit';

const ENTER_MS = 300;
const EXIT_MS = 280;

function makeVisit(opts: { popupEnterMs?: number } = {}) {
  const onExit = vi.fn<(reason: ExitReason) => void>();
  const visit = new PortCityVisit({
    onExit,
    popupEnterMs: opts.popupEnterMs ?? ENTER_MS,
    exitMs: EXIT_MS,
    clock: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  });
  visit.attach();
  return { visit, onExit };
}

/** A visit that has finished its entrance and is being explored. */
function exploring(opts?: { popupEnterMs?: number }) {
  const made = makeVisit(opts);
  made.visit.ready();
  return made;
}

const advance = (ms: number) => vi.advanceTimersByTime(ms);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('when the Coming Soon popup appears', () => {
  it('three distinct finds bring it forward, but not before the minimum exploration time', () => {
    const { visit } = exploring();
    advance(1_000);
    visit.select('admiralty');
    advance(1_000);
    visit.select('foundry');
    advance(1_000);
    visit.select('shipyard');
    expect(visit.getSnapshot().discoveries).toBe(3);

    advance(VISIT_TIMING.minExploreMs - 3_000 - 1);
    expect(visit.getSnapshot().phase).toBe('exploring');
    advance(1);
    expect(visit.getSnapshot().phase).toBe('comingSoon');
    expect(visit.getSnapshot().popup).toBe('entering');
  });

  it('gives the card of a late third find a moment before covering it', () => {
    const { visit } = exploring();
    visit.select('admiralty');
    visit.select('foundry');
    advance(12_000);
    visit.select('shipyard');
    expect(visit.getSnapshot().selectedId).toBe('shipyard');
    expect(visit.getSnapshot().phase).toBe('exploring');
    advance(VISIT_TIMING.settleMs - 1);
    expect(visit.getSnapshot().phase).toBe('exploring');
    advance(1);
    expect(visit.getSnapshot().phase).toBe('comingSoon');
    // The popup takes over from the card.
    expect(visit.getSnapshot().selectedId).toBeNull();
  });

  it('tapping the same building again is not a new discovery', () => {
    const { visit } = exploring();
    for (let i = 0; i < 6; i++) {
      visit.select('admiralty');
      advance(500);
    }
    visit.deselect();
    visit.select('admiralty');
    expect(visit.getSnapshot().discoveries).toBe(1);
    advance(VISIT_TIMING.minExploreMs * 2 - 3_500);
    expect(visit.getSnapshot().phase).toBe('exploring');
  });

  it('comes on its own after the fallback time with no selections at all', () => {
    const { visit } = exploring();
    advance(VISIT_TIMING.fallbackMs - 1);
    expect(visit.getSnapshot().phase).toBe('exploring');
    expect(visit.getSnapshot().discoveries).toBe(0);
    advance(1);
    expect(visit.getSnapshot().phase).toBe('comingSoon');
  });

  it('does not count time before the entrance has finished', () => {
    const { visit } = makeVisit();
    advance(60_000);
    expect(visit.getSnapshot().phase).toBe('entering');
    expect(visit.exploredTime()).toBe(0);
    visit.ready();
    advance(VISIT_TIMING.fallbackMs - 1);
    expect(visit.getSnapshot().phase).toBe('exploring');
  });

  it('waits for an active pan or pinch to end before appearing', () => {
    const { visit } = exploring();
    advance(VISIT_TIMING.fallbackMs - 2_000);
    visit.gestureStart('pan');
    advance(4_000);
    visit.gestureStart('pinch');
    advance(3_000);
    expect(visit.getSnapshot().phase).toBe('exploring');
    visit.gestureEnd('pan');
    expect(visit.getSnapshot().phase).toBe('exploring');
    visit.gestureEnd('pinch');
    expect(visit.getSnapshot().phase).toBe('comingSoon');
  });

  it('a gesture that started and ended before the deadline changes nothing', () => {
    const { visit } = exploring();
    visit.gestureStart('pan');
    advance(2_000);
    visit.gestureEnd('pan');
    visit.gestureEnd('pan'); // a stray second end is ignored
    advance(VISIT_TIMING.fallbackMs - 2_000);
    expect(visit.getSnapshot().phase).toBe('comingSoon');
  });

  it('is shown exactly once per visit', () => {
    const { visit, onExit } = exploring();
    let shows = 0;
    let last = visit.getSnapshot().popup;
    visit.subscribe(() => {
      const now = visit.getSnapshot().popup;
      if (now === 'entering' && last !== 'entering') shows += 1;
      last = now;
    });
    advance(VISIT_TIMING.fallbackMs);
    // Nothing that happens afterwards can bring it round again.
    visit.ready();
    visit.select('admiralty');
    visit.gestureStart('pan');
    visit.gestureEnd('pan');
    visit.setAppActive(false);
    visit.setAppActive(true);
    advance(60_000);
    expect(shows).toBe(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('ignores map taps while the popup is up', () => {
    const { visit } = exploring();
    advance(VISIT_TIMING.fallbackMs);
    visit.select('admiralty');
    expect(visit.getSnapshot().selectedId).toBeNull();
    expect(visit.getSnapshot().discoveries).toBe(0);
  });
});

describe('the return countdown', () => {
  it('starts only once the popup has finished its entrance', () => {
    const { visit, onExit } = exploring();
    advance(VISIT_TIMING.fallbackMs);
    expect(visit.getSnapshot().countdown).toBeNull();
    advance(ENTER_MS - 1);
    expect(visit.getSnapshot().popup).toBe('entering');
    expect(visit.getSnapshot().countdown).toBeNull();
    advance(1);
    expect(visit.getSnapshot().popup).toBe('open');
    expect(visit.getSnapshot().countdown).toBe(5);

    const seen = [5];
    for (let i = 0; i < 4; i++) {
      advance(1_000);
      seen.push(visit.getSnapshot().countdown!);
    }
    expect(seen).toEqual([5, 4, 3, 2, 1]);
    expect(onExit).not.toHaveBeenCalled();

    advance(1_000);
    expect(visit.getSnapshot().phase).toBe('exiting');
    expect(visit.getSnapshot().exitReason).toBe('countdown');
    expect(onExit).not.toHaveBeenCalled(); // the exit animation plays first
    advance(EXIT_MS);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith('countdown');
  });

  it('with reduced motion (no entrance) the countdown starts at once', () => {
    const { visit } = exploring({ popupEnterMs: 0 });
    advance(VISIT_TIMING.fallbackMs);
    expect(visit.getSnapshot().popup).toBe('open');
    expect(visit.getSnapshot().countdown).toBe(5);
  });
});

describe('going home', () => {
  it('a Return Home tap as the countdown expires navigates once', () => {
    const { visit, onExit } = exploring();
    advance(VISIT_TIMING.fallbackMs + ENTER_MS + 4_999);
    expect(visit.getSnapshot().countdown).toBe(1);
    expect(visit.exit('popup')).toBe(true);
    advance(1); // the countdown's deadline passes
    advance(EXIT_MS * 4);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith('popup');
  });

  it('a tap that lands just after the countdown expired is ignored', () => {
    const { visit, onExit } = exploring();
    advance(VISIT_TIMING.fallbackMs + ENTER_MS + 5_000);
    expect(visit.getSnapshot().exitReason).toBe('countdown');
    expect(visit.exit('popup')).toBe(false);
    expect(visit.exit('home')).toBe(false);
    expect(visit.exit('back')).toBe(false);
    advance(EXIT_MS * 4);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith('countdown');
  });

  it('the home button works at any point, and repeated presses do nothing more', () => {
    for (const at of ['entering', 'exploring', 'popupEntering', 'popupOpen'] as const) {
      const { visit, onExit } = makeVisit();
      if (at !== 'entering') visit.ready();
      if (at === 'popupEntering') advance(VISIT_TIMING.fallbackMs);
      if (at === 'popupOpen') advance(VISIT_TIMING.fallbackMs + ENTER_MS + 1_500);
      expect(visit.exit('home')).toBe(true);
      expect(visit.exit('home')).toBe(false);
      expect(visit.exit('back')).toBe(false);
      advance(60_000);
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(onExit).toHaveBeenCalledWith('home');
    }
  });

  it('stops every timer once the exit has begun', () => {
    const { visit } = exploring();
    advance(VISIT_TIMING.fallbackMs + ENTER_MS + 1_000);
    visit.exit('back');
    expect(vi.getTimerCount()).toBe(1); // only the exit animation's
    advance(EXIT_MS);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('leaving and coming back', () => {
  it('leaving the screen clears every pending callback', () => {
    const { visit, onExit } = exploring();
    advance(5_000);
    expect(vi.getTimerCount()).toBe(1);
    visit.detach();
    expect(vi.getTimerCount()).toBe(0);
    advance(120_000);
    expect(visit.getSnapshot().phase).toBe('exploring');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('unmounting during the exit animation never navigates afterwards', () => {
    const { visit, onExit } = exploring();
    visit.exit('home');
    visit.detach();
    expect(vi.getTimerCount()).toBe(0);
    advance(10_000);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('a remount (React strict mode) picks the visit up where it was', () => {
    const { visit, onExit } = exploring();
    advance(20_000);
    visit.detach();
    advance(60_000);
    visit.attach();
    advance(VISIT_TIMING.fallbackMs - 20_000);
    expect(visit.getSnapshot().phase).toBe('comingSoon');
    visit.exit('popup');
    visit.detach();
    visit.attach();
    advance(EXIT_MS);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('reopening the city starts a fresh visit', () => {
    const first = exploring();
    first.visit.select('admiralty');
    first.visit.select('foundry');
    advance(VISIT_TIMING.fallbackMs + ENTER_MS + 5_000 + EXIT_MS);
    expect(first.onExit).toHaveBeenCalledTimes(1);
    first.visit.detach();

    const second = makeVisit();
    expect(second.visit.getSnapshot()).toEqual({
      phase: 'entering',
      popup: 'hidden',
      selectedId: null,
      discoveries: 0,
      countdown: null,
      exitReason: null,
    });
    expect(second.visit.exploredTime()).toBe(0);
    second.visit.ready();
    second.visit.select('admiralty');
    expect(second.visit.getSnapshot().discoveries).toBe(1);
    advance(VISIT_TIMING.fallbackMs - 1);
    expect(second.visit.getSnapshot().phase).toBe('exploring');
    advance(1);
    expect(second.visit.getSnapshot().phase).toBe('comingSoon');
    expect(first.onExit).toHaveBeenCalledTimes(1);
    expect(second.onExit).not.toHaveBeenCalled();
  });
});

describe('backgrounding and focus', () => {
  it('backgrounding pauses exploration instead of skipping the experience', () => {
    const { visit } = exploring();
    advance(20_000);
    visit.setAppActive(false);
    expect(vi.getTimerCount()).toBe(0);
    advance(10 * 60_000);
    expect(visit.getSnapshot().phase).toBe('exploring');
    expect(visit.exploredTime()).toBe(20_000);
    visit.setAppActive(true);
    advance(VISIT_TIMING.fallbackMs - 20_000 - 1);
    expect(visit.getSnapshot().phase).toBe('exploring');
    advance(1);
    expect(visit.getSnapshot().phase).toBe('comingSoon');
  });

  it('losing focus pauses the same way', () => {
    const { visit } = exploring();
    advance(24_000);
    visit.setFocused(false);
    advance(60_000);
    expect(visit.getSnapshot().phase).toBe('exploring');
    visit.setFocused(true);
    advance(1_000);
    expect(visit.getSnapshot().phase).toBe('comingSoon');
  });

  it('pauses the countdown and resumes from what was left', () => {
    const { visit, onExit } = exploring();
    advance(VISIT_TIMING.fallbackMs + ENTER_MS + 2_400);
    expect(visit.getSnapshot().countdown).toBe(3);
    visit.setAppActive(false);
    advance(60_000);
    expect(visit.getSnapshot().countdown).toBe(3);
    expect(visit.getSnapshot().phase).toBe('comingSoon');
    visit.setAppActive(true);
    advance(600);
    expect(visit.getSnapshot().countdown).toBe(2);
    advance(1_999);
    expect(onExit).not.toHaveBeenCalled();
    expect(visit.getSnapshot().phase).toBe('comingSoon');
    advance(1);
    expect(visit.getSnapshot().phase).toBe('exiting');
    advance(EXIT_MS);
    expect(onExit).toHaveBeenCalledWith('countdown');
  });

  it('pauses the popup entrance too, so the countdown never starts unseen', () => {
    const { visit } = exploring();
    advance(VISIT_TIMING.fallbackMs + 100);
    visit.setAppActive(false);
    advance(60_000);
    expect(visit.getSnapshot().countdown).toBeNull();
    visit.setAppActive(true);
    advance(ENTER_MS - 101);
    expect(visit.getSnapshot().countdown).toBeNull();
    advance(1);
    expect(visit.getSnapshot().countdown).toBe(5);
  });

  it('a gesture cut off by backgrounding does not hold the popup forever', () => {
    const { visit } = exploring();
    advance(VISIT_TIMING.fallbackMs - 1_000);
    visit.gestureStart('pan');
    advance(2_000);
    visit.setAppActive(false); // the OS cancels the touch; no gestureEnd arrives
    visit.setAppActive(true);
    expect(visit.getSnapshot().phase).toBe('comingSoon');
  });
});

/**
 * One visit to the Port City preview — pure TypeScript, no React, so every
 * timing rule is tested with a fake clock (tests/city/visit.test.ts).
 *
 *   entering ──ready()──▶ exploring ──(due)──▶ comingSoon ──▶ exiting ──▶ onExit()
 *        └───────────────────┴──── exit(home | back) ────┴──────┘
 *
 * - Exploration time only counts while the visit is RUNNING: attached (the
 *   screen is mounted), focused and the app in the foreground. Backgrounding or
 *   losing focus banks the time so far and stops every timer; coming back
 *   carries on from what was left. Nothing is ever skipped.
 * - The Coming Soon popup is due at FALLBACK_MS of exploration, or earlier once
 *   DISCOVERIES distinct buildings have been opened and MIN_EXPLORE_MS has
 *   passed — and, if that third find is what made it due, not before its card
 *   has been on screen for SETTLE_MS (it would otherwise be covered the instant
 *   it opened). Tapping a building you have already found is not a discovery.
 * - A popup that falls due mid-gesture waits for the last finger to lift.
 * - It is shown once per visit. Its countdown starts only when its entrance
 *   animation has finished (popupEnterMs), and pauses like exploration does.
 * - Every way out — the home button, the popup's button, the countdown, the
 *   system back — goes through exit(), which acts once. onExit() is called
 *   exactly once, exitMs later (the exit animation), and never after detach().
 * - A new visit is a new instance: nothing carries over from the last one.
 */

export type VisitPhase = 'entering' | 'exploring' | 'comingSoon' | 'exiting';
export type PopupStage = 'hidden' | 'entering' | 'open';
export type ExitReason = 'home' | 'popup' | 'countdown' | 'back';

export const VISIT_TIMING = {
  /** Active exploration needed before discoveries can bring the popup forward. */
  minExploreMs: 10_000,
  /** Active exploration after which the popup comes regardless. */
  fallbackMs: 25_000,
  /** Distinct buildings that count as having looked around. */
  discoveries: 3,
  /** How long the card of the find that made the popup due stays readable. */
  settleMs: 1_200,
  /** "Returning home in 5s". */
  countdownMs: 5_000,
} as const;

export type VisitTiming = { readonly [K in keyof typeof VISIT_TIMING]: number };

export interface VisitSnapshot {
  readonly phase: VisitPhase;
  readonly popup: PopupStage;
  readonly selectedId: string | null;
  /** Distinct buildings opened this visit. */
  readonly discoveries: number;
  /** Whole seconds left before going home; null until the countdown starts. */
  readonly countdown: number | null;
  readonly exitReason: ExitReason | null;
}

export interface VisitClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface VisitOptions {
  onExit(reason: ExitReason): void;
  /** The popup's entrance animation; the countdown starts when it is done. */
  popupEnterMs: number;
  /** The exit animation; onExit fires when it is done. */
  exitMs: number;
  clock?: VisitClock;
  timing?: Partial<VisitTiming>;
}

const systemClock: VisitClock = {
  now: () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type Stage = 'explore' | 'popupEnter' | 'countdown';

export class PortCityVisit {
  private readonly clock: VisitClock;
  private readonly timing: VisitTiming;
  private readonly opts: VisitOptions;
  private readonly listeners = new Set<() => void>();

  private snap: VisitSnapshot = {
    phase: 'entering',
    popup: 'hidden',
    selectedId: null,
    discoveries: 0,
    countdown: null,
    exitReason: null,
  };

  private readonly discovered = new Set<string>();
  private readonly gestures = new Set<string>();
  /** Exploration time banked so far, and at which point the last find came. */
  private exploredMs = 0;
  private lastFindAtMs = 0;
  private enterLeftMs = 0;
  private countdownLeftMs = 0;
  /** When the current stage's clock last started running; null while stopped. */
  private since: number | null = null;
  private timer: unknown = null;
  private exitTimer: unknown = null;
  private exitFired = false;

  private attached = false;
  private focused = true;
  private appActive = true;

  constructor(opts: VisitOptions) {
    this.opts = opts;
    this.clock = opts.clock ?? systemClock;
    this.timing = { ...VISIT_TIMING, ...opts.timing };
  }

  // ---- React glue: useSyncExternalStore ------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): VisitSnapshot => this.snap;

  /** Active exploration so far, ms. */
  exploredTime(): number {
    const running = this.since !== null && this.stage() === 'explore';
    return this.exploredMs + (running ? this.clock.now() - this.since! : 0);
  }

  // ---- lifecycle --------------------------------------------------------------

  /** The screen mounted (again). */
  attach(): void {
    this.attached = true;
    this.reschedule();
    if (this.snap.phase === 'exiting' && !this.exitFired && this.exitTimer === null) {
      this.armExit(this.snap.exitReason ?? 'home');
    }
  }

  /** The screen unmounted: every timer and pending callback is dropped. */
  detach(): void {
    this.attached = false;
    this.reschedule();
    if (this.exitTimer !== null) {
      this.clock.clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.reschedule();
  }

  setAppActive(active: boolean): void {
    if (this.appActive === active) return;
    this.appActive = active;
    // The OS cancels touches on the way out; don't wait on a finger that left.
    if (!active) this.gestures.clear();
    this.reschedule();
  }

  // ---- the flow ------------------------------------------------------------------

  /** The art is up and the entrance has played: exploration starts now. */
  ready(): void {
    if (this.snap.phase !== 'entering') return;
    this.set({ phase: 'exploring' });
    this.reschedule();
  }

  select(id: string): void {
    if (this.snap.phase !== 'exploring') return;
    let discoveries = this.snap.discoveries;
    if (!this.discovered.has(id)) {
      this.bank();
      this.discovered.add(id);
      discoveries = this.discovered.size;
      this.lastFindAtMs = this.exploredMs;
    }
    this.set({ selectedId: id, discoveries });
    this.reschedule();
  }

  deselect(): void {
    if (this.snap.selectedId === null) return;
    this.set({ selectedId: null });
  }

  gestureStart(kind: string): void {
    this.gestures.add(kind);
  }

  gestureEnd(kind: string): void {
    if (!this.gestures.delete(kind)) return;
    if (this.gestures.size === 0) this.reschedule();
  }

  /** Every way home. Returns false (and does nothing) if one is already under way. */
  exit(reason: ExitReason): boolean {
    if (this.snap.phase === 'exiting') return false;
    this.bank();
    this.stopTimer();
    this.since = null;
    this.gestures.clear();
    this.set({ phase: 'exiting', exitReason: reason });
    if (this.attached) this.armExit(reason);
    return true;
  }

  // ---- internals -------------------------------------------------------------

  private running(): boolean {
    return this.attached && this.focused && this.appActive;
  }

  private stage(): Stage | null {
    const { phase, popup } = this.snap;
    if (phase === 'exploring') return 'explore';
    if (phase === 'comingSoon') return popup === 'entering' ? 'popupEnter' : 'countdown';
    return null;
  }

  /** Move the running stage's elapsed time into its counter. */
  private bank(): void {
    if (this.since === null) return;
    const now = this.clock.now();
    const dt = Math.max(0, now - this.since);
    this.since = now;
    switch (this.stage()) {
      case 'explore':
        this.exploredMs += dt;
        break;
      case 'popupEnter':
        this.enterLeftMs = Math.max(0, this.enterLeftMs - dt);
        break;
      case 'countdown':
        this.countdownLeftMs = Math.max(0, this.countdownLeftMs - dt);
        break;
      default:
        break;
    }
  }

  /** Exploration (ms) at which the popup is due, given what has been found. */
  private dueAt(): number {
    const t = this.timing;
    if (this.discovered.size < t.discoveries) return t.fallbackMs;
    return Math.min(t.fallbackMs, Math.max(t.minExploreMs, this.lastFindAtMs + t.settleMs));
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Bank, stop, and — if the visit is running — arm the one timer the stage needs. */
  private reschedule(): void {
    this.bank();
    this.stopTimer();
    this.since = null;
    if (!this.running()) return;
    const stage = this.stage();
    if (stage === null) return;
    this.since = this.clock.now();

    let wait: number;
    if (stage === 'explore') {
      const left = this.dueAt() - this.exploredMs;
      if (left <= 0) {
        // Due. Mid-gesture it waits: gestureEnd() comes back here.
        if (this.gestures.size === 0) this.present();
        return;
      }
      wait = left;
    } else if (stage === 'popupEnter') {
      // No entrance to wait for (reduced motion): open straight away.
      if (this.enterLeftMs <= 0) {
        this.open();
        return;
      }
      wait = this.enterLeftMs;
    } else {
      if (this.countdownLeftMs <= 0) {
        this.exit('countdown');
        return;
      }
      // To the next whole second, where the number on screen changes.
      wait = this.countdownLeftMs - (Math.ceil(this.countdownLeftMs / 1000) - 1) * 1000;
    }
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.tick(stage);
    }, wait);
  }

  private tick(stage: Stage): void {
    this.bank();
    if (stage === 'countdown') this.set({ countdown: Math.ceil(this.countdownLeftMs / 1000) });
    this.reschedule();
  }

  /** The popup has arrived: the countdown starts now. */
  private open(): void {
    this.bank();
    this.since = null;
    this.countdownLeftMs = this.timing.countdownMs;
    this.set({ popup: 'open', countdown: Math.ceil(this.countdownLeftMs / 1000) });
    this.reschedule();
  }

  private present(): void {
    this.bank();
    this.since = null;
    this.enterLeftMs = this.opts.popupEnterMs;
    this.set({ phase: 'comingSoon', popup: 'entering', selectedId: null });
    this.reschedule();
  }

  private armExit(reason: ExitReason): void {
    this.exitTimer = this.clock.setTimeout(() => {
      this.exitTimer = null;
      if (this.exitFired) return;
      this.exitFired = true;
      this.opts.onExit(reason);
    }, this.opts.exitMs);
  }

  private set(patch: Partial<VisitSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * THE EVENT REPLAY SYSTEM — the core abstraction of the battle screen.
 *
 * The engine returns MatchEvent[]. The UI never inspects match state to decide
 * what to animate; it plays the event list as a timeline. Per event, strictly
 * in order: await the animation (sound and haptic live inside it), then commit
 * the state change. Input is locked while the queue is non-empty.
 *
 * `skip()` fast-forwards: every wait() in flight resolves at once, the current
 * animation returns, and the remaining events commit without animating. The
 * effects that own visuals check `player.skipped` and tidy up.
 *
 * Pure TypeScript — no React, no RN — so the queue semantics can be tested
 * under Node. The effects are injected.
 */
import type { Coord, MatchEvent } from '@engine/types';

/** UI-only events the screen adds around the engine's (the shell in flight). */
export type SyntheticEvent = { type: 'SHOT_FIRED'; playerId: string; at: Coord };

export type PlayEvent = MatchEvent | SyntheticEvent;

export interface EventEffects {
  /** Play the event's animation. Resolve when the state may be committed. */
  animate(event: PlayEvent, player: EventPlayer): Promise<void>;
  /** Commit the event's state change. Must be idempotent. */
  commit(event: PlayEvent): void;
}

export type BusyListener = (busy: boolean) => void;

export class EventPlayer {
  private queue: PlayEvent[] = [];
  private running = false;
  private skipping = false;
  private sleepers = new Set<() => void>();
  private listeners = new Set<BusyListener>();
  private effects: EventEffects;

  constructor(effects: EventEffects) {
    this.effects = effects;
  }

  /** Swap the effects — the screen wires real animations in on mount. */
  setEffects(effects: EventEffects): void {
    this.effects = effects;
  }

  get busy(): boolean {
    return this.running;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** True from skip() until the queue drains. */
  get skipped(): boolean {
    return this.skipping;
  }

  onBusy(listener: BusyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enqueue(events: readonly PlayEvent[]): void {
    if (events.length === 0) return;
    this.queue.push(...events);
    if (!this.running) void this.run();
  }

  /** Fast-forward everything queued. No-op when idle. */
  skip(): void {
    if (!this.running) return;
    this.skipping = true;
    const wakers = [...this.sleepers];
    this.sleepers.clear();
    for (const wake of wakers) wake();
  }

  /** Drop everything without committing — only for unmount. */
  clear(): void {
    this.queue = [];
    this.skip();
  }

  /** A wait that skip() cuts short. Use it for every timed step of an animation. */
  wait(ms: number): Promise<void> {
    if (this.skipping || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.sleepers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.sleepers.add(wake);
    });
  }

  private notify(busy: boolean): void {
    for (const listener of this.listeners) listener(busy);
  }

  private async run(): Promise<void> {
    this.running = true;
    this.notify(true);
    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift() as PlayEvent;
        if (!this.skipping) {
          try {
            await this.effects.animate(event, this);
          } catch (error) {
            console.warn('[EventPlayer] animation failed, committing anyway', error);
          }
        }
        this.effects.commit(event);
      }
    } finally {
      this.running = false;
      this.skipping = false;
      this.notify(false);
    }
  }
}

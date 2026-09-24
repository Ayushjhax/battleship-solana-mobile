/**
 * Live raids, in memory — part-06 §6, §10.
 *
 * THIS IS THE SECRECY BOUNDARY. A `RaidSession` holds the full harbour layout,
 * because the engine needs it to resolve a shell. Nothing in this module
 * returns it. Every method that answers a client returns `RaidView`, which
 * `raidView()` built and which has no field that could hold a layout.
 *
 * A session is deliberately NOT a database row per action. A raid is four
 * minutes long and ~30 actions; writing each one would be 30 round trips for a
 * result that is only interesting once. The actions accumulate here and land
 * in raid_log at settlement, with the layout that was snapshotted at open.
 *
 * Where it sits relative to the match room: alongside it, not inside it.
 * server/src/room.ts is a two-seat, turn-taking, socket-driven object; a raid
 * is one seat, no turns and request/response. They share the ENGINE, not the
 * plumbing.
 */
import {
  fireShell,
  raidFinalReveal,
  raidScore,
  raidView,
  retreat,
  settleRaid,
  startRaid,
  useKit,
  type HarbourLayout,
  type KitCounts,
  type RaidAction,
  type RaidConfig,
  type RaidError,
  type RaidState,
  type RaidView,
} from '@engine/raid';
import type { ArsenalKind, Coord, MatchEvent } from '@engine/types';

import { raidLimits, type RaidLimits } from './config';

export interface SessionTarget {
  readonly kind: 'player' | 'cove';
  readonly defenderId: string | null;
  readonly coveSeed: number | null;
  /** What the UI shows. A cove says so — §5: "never disguised as a person". */
  readonly name: string;
  readonly admiraltyLevel: number;
  readonly renown: number;
}

export type ActionError = RaidError | 'no-session' | 'rate-limited' | 'too-many-rejects' | 'expired';

export interface ActionOutcome {
  readonly ok: boolean;
  readonly error?: ActionError;
  readonly view: RaidView;
  readonly events: readonly MatchEvent[];
  readonly shellDelta: number;
}

interface Rejections {
  count: number;
  windowStart: number;
  inWindow: number;
}

export class RaidSession {
  readonly raidId: string;
  readonly attackerId: string;
  readonly target: SessionTarget;
  readonly startedAt: number;
  readonly config: RaidConfig;

  /** SERVER ONLY. Private so a stray `JSON.stringify(session)` cannot reach it. */
  readonly #layout: HarbourLayout;
  #state: RaidState;
  #actions: RaidAction[] = [];
  #results: unknown[] = [];
  #rejects: Rejections;
  #limits: RaidLimits;
  #lastSeenAt: number;

  constructor(input: {
    raidId: string;
    attackerId: string;
    target: SessionTarget;
    layout: HarbourLayout;
    kit: KitCounts;
    config: RaidConfig;
    now: number;
    limits?: RaidLimits;
  }) {
    this.raidId = input.raidId;
    this.attackerId = input.attackerId;
    this.target = input.target;
    this.startedAt = input.now;
    this.config = input.config;
    this.#layout = input.layout;
    this.#state = startRaid(input.layout, input.kit, input.now, input.config);
    this.#limits = input.limits ?? raidLimits();
    this.#rejects = { count: 0, windowStart: input.now, inWindow: 0 };
    this.#lastSeenAt = input.now;
  }

  get over(): boolean {
    return this.#state.over;
  }

  get endReason(): string | undefined {
    return this.#state.endReason;
  }

  get actions(): readonly RaidAction[] {
    return this.#actions;
  }

  get results(): readonly unknown[] {
    return this.#results;
  }

  get score() {
    return raidScore(this.#state);
  }

  get lastSeenAt(): number {
    return this.#lastSeenAt;
  }

  /** The only thing that may be serialised. */
  view(now: number): RaidView {
    return raidView(this.#state, now);
  }

  /**
   * §8 — the full layout, but ONLY once the raid is over. It is a separate
   * call with `over` in the engine's guard, so a mid-raid caller gets null
   * rather than a board.
   */
  finalReveal(): unknown {
    return raidFinalReveal(this.#state);
  }

  /** §10 — 4 actions/second, and the clock plus a 10 s grace. */
  #gate(now: number): ActionError | null {
    if (this.#state.over) return 'raid-over';

    const elapsed = now - this.startedAt;
    if (elapsed >= this.config.timeLimitMs + this.#limits.clockGraceMs) {
      this.#state = { ...this.#state, over: true, endReason: 'time' };
      return 'expired';
    }

    if (now - this.#rejects.windowStart >= 1_000) {
      this.#rejects.windowStart = now;
      this.#rejects.inWindow = 0;
    }
    this.#rejects.inWindow++;
    if (this.#rejects.inWindow > this.#limits.actionsPerSecond) return 'rate-limited';

    return null;
  }

  /** §10 — "five rejected raid actions from one session ends the raid". */
  #reject(error: ActionError, now: number): ActionOutcome {
    // A rate limit is throttling, not cheating: it does not count toward the
    // five. Only an action the RULES refused does.
    if (error !== 'rate-limited' && error !== 'expired') {
      this.#rejects.count++;
      if (this.#rejects.count >= this.#limits.maxRejects) {
        this.#state = { ...this.#state, over: true, endReason: 'retreat' };
        return { ok: false, error: 'too-many-rejects', view: this.view(now), events: [], shellDelta: 0 };
      }
    }
    return { ok: false, error, view: this.view(now), events: [], shellDelta: 0 };
  }

  fire(at: Coord, now: number): ActionOutcome {
    this.#lastSeenAt = now;
    const gated = this.#gate(now);
    if (gated) return this.#reject(gated, now);

    const out = fireShell(this.#state, at, now);
    if (out.error) return this.#reject(out.error, now);

    this.#state = out.state;
    this.#actions.push({ kind: 'fire', at });
    this.#results.push({ shellDelta: out.shellDelta, events: out.events });
    return { ok: true, view: this.view(now), events: out.events, shellDelta: out.shellDelta };
  }

  use(weapon: ArsenalKind, target: { at?: Coord; row?: number }, now: number): ActionOutcome {
    this.#lastSeenAt = now;
    const gated = this.#gate(now);
    if (gated) return this.#reject(gated, now);

    const out = useKit(this.#state, weapon, target, now);
    if (out.error) return this.#reject(out.error, now);

    this.#state = out.state;
    this.#actions.push({
      kind: 'use',
      weapon,
      ...(target.at ? { at: target.at } : {}),
      ...(target.row !== undefined ? { row: target.row } : {}),
    });
    this.#results.push({ shellDelta: out.shellDelta, events: out.events });
    return { ok: true, view: this.view(now), events: out.events, shellDelta: out.shellDelta };
  }

  retreat(now: number): ActionOutcome {
    this.#lastSeenAt = now;
    if (this.#state.over) {
      return { ok: false, error: 'raid-over', view: this.view(now), events: [], shellDelta: 0 };
    }
    this.#state = retreat(this.#state, now);
    this.#actions.push({ kind: 'retreat' });
    this.#results.push({ shellDelta: 0, events: [] });
    return { ok: true, view: this.view(now), events: [], shellDelta: 0 };
  }

  /**
   * §6 — "the attacker disconnects for more than 60 s (the raid settles with
   * what it had — never 'no result')". Returns true if the raid should now be
   * settled by the sweeper.
   */
  isAbandoned(now: number): boolean {
    return !this.#state.over && now - this.#lastSeenAt > this.#limits.disconnectGraceMs;
  }

  expired(now: number): boolean {
    return now - this.startedAt >= this.config.timeLimitMs + this.#limits.clockGraceMs;
  }

  /** Closes the raid and returns the final score. Safe to call twice. */
  close(now: number, reason?: 'time' | 'disconnect') {
    return settleRaid(this.#state, now, reason);
  }
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const sessions = new Map<string, RaidSession>();
const byAttacker = new Map<string, string>();

export function putSession(session: RaidSession): void {
  sessions.set(session.raidId, session);
  byAttacker.set(session.attackerId, session.raidId);
}

/** A raid may be acted on only by the attacker who opened it. */
export function getSession(raidId: string, attackerId: string): RaidSession | null {
  const session = sessions.get(raidId);
  if (!session || session.attackerId !== attackerId) return null;
  return session;
}

export function sessionForAttacker(attackerId: string): RaidSession | null {
  const raidId = byAttacker.get(attackerId);
  return raidId ? (sessions.get(raidId) ?? null) : null;
}

export function dropSession(raidId: string): void {
  const session = sessions.get(raidId);
  if (session) byAttacker.delete(session.attackerId);
  sessions.delete(raidId);
}

/** Raids that the clock or a disconnect has ended and that need settling. */
export function staleSessions(now: number): RaidSession[] {
  const out: RaidSession[] = [];
  for (const session of sessions.values()) {
    if (session.over || session.expired(now) || session.isAbandoned(now)) out.push(session);
  }
  return out;
}

export function __resetSessionsForTests(): void {
  sessions.clear();
  byAttacker.clear();
}

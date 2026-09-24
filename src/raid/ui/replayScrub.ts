/**
 * The replay scrubber — part-07 §5, tested by §8.5.
 *
 * §5's hard requirement: **"Skipping and scrubbing must never desync: rebuild
 * the state from action 0 to the target index rather than trying to rewind."**
 *
 * So there is no rewind in this file. There is one function that runs the
 * engine's own `replayRaid` over `actions.slice(0, index)`, and a cache in
 * front of it. An incremental undo would be faster and would be the thing
 * that eventually got a mine or a decoy wrong; running forward from zero
 * cannot, because it is the same code path that produced the raid.
 *
 * Cost: 30 actions is the whole budget, and `replayRaid` over 30 actions is
 * well under a frame. There is nothing to optimise here.
 */
import { raidView, replayRaid, type HarbourLayout, type KitCounts, type RaidAction, type RaidConfig, type RaidState, type RaidView } from '@engine/raid';

export interface ReplaySource {
  readonly layout: HarbourLayout;
  readonly kit: KitCounts;
  readonly actions: readonly RaidAction[];
  readonly config: RaidConfig;
}

/** §5 — "1x / 2x / 4x". */
export const REPLAY_SPEEDS = [1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/**
 * The pace a replay plays at. The original raid had no fixed per-action
 * interval — a player thinks between shells — so the replay uses one beat per
 * action, scaled by the speed, which is what "the original pace" means for a
 * turn-free format.
 */
export const REPLAY_BEAT_MS = 700;

export function beatMs(speed: ReplaySpeed): number {
  return Math.round(REPLAY_BEAT_MS / speed);
}

/**
 * The state after the first `index` actions. `index` 0 is the opening board;
 * `index === actions.length` is the end.
 *
 * Clamped rather than throwing: a scrub bar handed a stale index during a
 * re-render must produce a board, not an exception.
 */
export function stateAt(source: ReplaySource, index: number): RaidState {
  const upto = Math.max(0, Math.min(Math.trunc(index), source.actions.length));
  return replayRaid(source.layout, source.kit, source.actions.slice(0, upto), source.config, 0);
}

/** What the viewer renders. Same masking as a live raid. */
export function viewAt(source: ReplaySource, index: number): RaidView {
  return raidView(stateAt(source, index), 0);
}

/**
 * A one-entry cache, so dragging the scrub bar forward does not re-run the
 * whole list on every frame. It is keyed on the action array's identity: a
 * new replay simply misses and recomputes, which is correct and cheap.
 *
 * Deliberately NOT a rewind: on a miss it still rebuilds from action 0.
 */
export function createScrubber(source: ReplaySource) {
  let cachedIndex = -1;
  let cachedState: RaidState | null = null;

  return {
    at(index: number): RaidState {
      const upto = Math.max(0, Math.min(Math.trunc(index), source.actions.length));
      if (cachedState && cachedIndex === upto) return cachedState;
      cachedState = stateAt(source, upto);
      cachedIndex = upto;
      return cachedState;
    },
    viewAt(index: number): RaidView {
      return raidView(this.at(index), 0);
    },
    get length(): number {
      return source.actions.length;
    },
    reset(): void {
      cachedIndex = -1;
      cachedState = null;
    },
  };
}

// ---------------------------------------------------------------------------
// The transport controls
// ---------------------------------------------------------------------------

export interface ReplayTransport {
  readonly index: number;
  readonly playing: boolean;
  readonly speed: ReplaySpeed;
}

export const INITIAL_TRANSPORT: ReplayTransport = { index: 0, playing: false, speed: 1 };

export type TransportAction =
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'toggle' }
  | { kind: 'speed'; speed: ReplaySpeed }
  | { kind: 'scrub'; index: number }
  | { kind: 'tick' }
  | { kind: 'restart' };

/**
 * A reducer, so the transport is testable without a renderer and cannot grow
 * a second source of truth for "which action are we on".
 */
export function transportReducer(
  state: ReplayTransport,
  action: TransportAction,
  length: number,
): ReplayTransport {
  const clamp = (n: number) => Math.max(0, Math.min(Math.trunc(n), length));

  switch (action.kind) {
    case 'play':
      // Playing from the end restarts, rather than sitting there doing nothing.
      return state.index >= length
        ? { ...state, index: 0, playing: true }
        : { ...state, playing: true };
    case 'pause':
      return { ...state, playing: false };
    case 'toggle':
      return transportReducer(state, { kind: state.playing ? 'pause' : 'play' }, length);
    case 'speed':
      return { ...state, speed: action.speed };
    case 'scrub':
      // Scrubbing pauses: the player is driving now.
      return { ...state, index: clamp(action.index), playing: false };
    case 'tick': {
      const next = clamp(state.index + 1);
      return { ...state, index: next, playing: next < length };
    }
    case 'restart':
      return { ...state, index: 0, playing: false };
    default:
      return state;
  }
}

/**
 * §5 — "the defender's view shows their full board from the start (they own
 * it); the attacker's view reveals the full layout at the end."
 */
export function layoutVisible(
  viewer: 'attacker' | 'defender',
  index: number,
  length: number,
): boolean {
  return viewer === 'defender' || index >= length;
}

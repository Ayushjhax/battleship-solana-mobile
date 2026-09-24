/**
 * Offline match transport. It owns the authoritative MatchState for AI,
 * hot-seat and tutorial games, applies every action through the shared pure
 * reducer, and emits the same event batches as the match server.
 *
 * Nothing in here imports React Native or UI state. The battle store is only
 * an adapter between this transport and EventPlayer.
 */
import { chooseMove, type Difficulty } from '@engine/ai';
import { createMatch, projectView, reduce, type ReduceResult } from '@engine/match';
import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import type { Terrain } from '@engine/terrain';
import type {
  ArsenalItem,
  CaptainId,
  MatchAction,
  MatchEvent,
  MatchMode,
  MatchState,
  Ship,
} from '@engine/types';

export type LocalMatchMode = 'ai' | 'hotseat' | 'tutorial';

export interface LocalCombatant {
  readonly id: string;
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
  /** Part 10A — the captain this side brings. Absent means none. */
  readonly captainId?: CaptainId | null;
}

export interface LocalMatchOptions {
  readonly mode: LocalMatchMode;
  readonly ruleset: MatchMode;
  readonly seed: number;
  readonly one: LocalCombatant;
  readonly two: LocalCombatant;
  readonly difficulty: Difficulty;
  /** Part 10B — the sea the match plays on; default water. */
  readonly terrain?: Terrain;
  readonly onResolved: (action: MatchAction, result: ReduceResult) => void;
}

export interface LocalDispatchResult {
  readonly accepted: boolean;
  readonly result: ReduceResult;
}

let thinkMinMs = 900;
let thinkSpreadMs = 500;

/** Test/dev hook. Production remains an inclusive random 900–1400 ms. */
export function setLocalAiThinkTime(minMs: number, spreadMs: number): void {
  thinkMinMs = Math.max(0, minMs);
  thinkSpreadMs = Math.max(0, spreadMs);
}

/**
 * Submits one side's board. The last-resort fallback stays — a match that
 * cannot start at all is worse than one on an auto-placed fleet — but it is
 * NOT silent: substituting a board the player did not arrange is a bug
 * upstream (see usableLayout in src/features/battle/setup.ts), and it says so
 * with the reducer's own reason.
 */
function submitSide(state: MatchState, side: LocalCombatant, seed: number): MatchState {
  const result = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: side.id,
    ships: side.ships,
    arsenal: side.arsenal,
    ...(side.captainId ? { captainId: side.captainId } : {}),
  });
  const rejected = result.events.find(
    (event): event is Extract<MatchEvent, { type: 'REJECTED' }> => event.type === 'REJECTED',
  );
  if (!rejected) return result.state;

  console.error(
    `[local-match] ${side.id}'s layout was rejected (${rejected.reason}). ` +
      'Falling back to an auto-placed fleet with no arsenal — the arranged board is lost.',
  );
  return reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: side.id,
    ships: autoPlaceFleet(createRng(seed), state.terrain),
    arsenal: [],
  }).state;
}

export class LocalMatch {
  private current: MatchState;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: LocalMatchOptions) {
    let state = createMatch({
      id: `local-${options.seed}`,
      mode: options.ruleset,
      seed: options.seed,
      playerIds: [options.one.id, options.two.id],
      ...(options.terrain ? { terrain: options.terrain } : {}),
    });
    state = submitSide(state, options.one, options.seed + options.one.id.length);
    state = submitSide(state, options.two, options.seed + options.two.id.length);
    if (state.phase !== 'playing') throw new Error('local match could not start');
    this.current = state;
  }

  get state(): MatchState {
    return this.current;
  }

  dispatch(action: MatchAction): LocalDispatchResult {
    const result = reduce(this.current, action);
    const accepted = !result.events.some((event) => event.type === 'REJECTED');
    if (!accepted || this.disposed) return { accepted, result };
    this.current = result.state;
    this.options.onResolved(action, result);
    return { accepted: true, result };
  }

  /** Called when EventPlayer is idle so AI never thinks during an animation. */
  driveAi(): void {
    if (
      this.disposed ||
      this.options.mode !== 'ai' ||
      this.current.phase !== 'playing' ||
      this.current.turn === this.options.one.id ||
      this.aiTimer
    )
      return;

    const turnSeed = this.current.seed * 31 + this.current.moves;
    const delay = thinkMinMs + createRng(turnSeed).int(thinkSpreadMs + 1);
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      if (
        this.disposed ||
        this.current.phase !== 'playing' ||
        this.current.turn === this.options.one.id
      )
        return;
      const actor = this.current.turn;
      const action = chooseMove(
        projectView(this.current, actor),
        this.options.difficulty,
        createRng(this.current.seed * 17 + this.current.moves),
      );
      this.dispatch(action);
    }, delay);
  }

  dispose(): void {
    this.disposed = true;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = null;
  }
}

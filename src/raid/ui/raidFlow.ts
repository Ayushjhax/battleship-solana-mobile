/**
 * The raid screen's state machine — part-07 §3, tested by §8.4.
 *
 * THE HARD RULE THIS FILE OWNS: **"A raid never ends without a result the
 * player can see."** (§9.3.)
 *
 * That is not a rendering concern, it is a state-machine concern, so it lives
 * here where a test can drive every path without a renderer. There are five
 * ways a raid stops — retreat, shells out, cleared, the clock, and the player
 * walking away from their phone — and exactly one way out of all five:
 * `settling` → `result`. There is no transition that reaches `idle` from a
 * live raid, and no state that renders a board with no result behind it.
 *
 * The recovery path is a single mechanism: **the status probe.** `AppState`
 * returning to active and a reconnect both fire it, it asks the server
 * whether this player has a live raid, and either resumes the one it finds or
 * settles the one it does not.
 */
import type { RaidView, Settlement, TargetCard } from '../types';

export type RaidStep =
  | 'kit'
  | 'searching'
  | 'card'
  | 'opening'
  | 'raiding'
  | 'settling'
  | 'result'
  | 'recovering'
  | 'lost';

export interface RaidFlow {
  readonly step: RaidStep;
  readonly raidId: string | null;
  readonly card: TargetCard | null;
  readonly view: RaidView | null;
  readonly settlement: Settlement | null;
  /** The shell budget the raid opened with — the row's length. */
  readonly budget: number;
  /** Searches so far this session, for the renown-window widening (§5). */
  readonly searches: number;
  /** A typed code to show in the Captain's voice, or null. */
  readonly error: string | null;
  /** Set while a settle is being retried, so the UI can say so. */
  readonly retrying: boolean;
}

export const INITIAL_FLOW: RaidFlow = {
  step: 'kit',
  raidId: null,
  card: null,
  view: null,
  settlement: null,
  budget: 0,
  searches: 0,
  error: null,
  retrying: false,
};

export type FlowEvent =
  | { kind: 'search' }
  | { kind: 'card-found'; card: TargetCard }
  | { kind: 'open'; raidId: string }
  | { kind: 'opened'; raidId: string; view: RaidView; card: TargetCard }
  | { kind: 'view'; view: RaidView }
  | { kind: 'settle' }
  | { kind: 'settled'; settlement: Settlement }
  | { kind: 'settle-failed' }
  /** The app came back, or the socket did. */
  | { kind: 'probe' }
  | { kind: 'probe-active'; raidId: string; view: RaidView }
  | { kind: 'probe-idle' }
  | { kind: 'error'; code: string }
  | { kind: 'raid-again' }
  | { kind: 'reset' };

/**
 * A raid is over when the SERVER says so. The client never decides this from
 * the shell count, because a bomber left in the kit keeps a 0-shell raid
 * alive (part-06 §6) and re-deriving that rule here is how the two drift.
 */
export function isOver(view: RaidView | null): boolean {
  return view?.over === true;
}

export function reduceFlow(state: RaidFlow, event: FlowEvent): RaidFlow {
  switch (event.kind) {
    case 'search':
      return { ...state, step: 'searching', error: null, card: null };

    case 'card-found':
      return { ...state, step: 'card', card: event.card, searches: state.searches + 1 };

    case 'open':
      return { ...state, step: 'opening', raidId: event.raidId, error: null };

    case 'opened':
      return {
        ...state,
        step: 'raiding',
        raidId: event.raidId,
        card: event.card,
        view: event.view,
        budget: event.view.shells,
        error: null,
      };

    case 'view': {
      // The one place the raid can move itself to its end: the server said over.
      const next = { ...state, view: event.view, error: null };
      return event.view.over ? { ...next, step: 'settling' } : next;
    }

    case 'settle':
      return { ...state, step: 'settling', retrying: false };

    case 'settled':
      return {
        ...state,
        step: 'result',
        settlement: event.settlement,
        view: event.settlement.view,
        retrying: false,
        error: null,
      };

    case 'settle-failed':
      // NOT 'lost'. The player stays on a screen that says "See the outcome",
      // and the button probes again. Losing the result is the one thing that
      // may not happen.
      return { ...state, step: 'settling', retrying: true };

    case 'probe':
      return state.step === 'result' ? state : { ...state, step: 'recovering' };

    case 'probe-active':
      return {
        ...state,
        step: 'raiding',
        raidId: event.raidId,
        view: event.view,
        budget: state.budget || event.view.shells,
        retrying: false,
        error: null,
      };

    case 'probe-idle':
      // The server has no live raid for us. If we had one, it ended while we
      // were away and there is a settlement to fetch — §8.4's backgrounding
      // case. If we never had one, we are simply back at the kit.
      return state.raidId
        ? { ...state, step: 'settling', retrying: false }
        : { ...INITIAL_FLOW, searches: state.searches };

    case 'error':
      return { ...state, error: event.code, retrying: false };

    case 'raid-again':
      return { ...INITIAL_FLOW, searches: state.searches };

    case 'reset':
      return INITIAL_FLOW;

    default:
      return state;
  }
}

/**
 * Is the board interactive? Only while raiding, only when the server's view
 * says the raid is live. Everything else — searching, settling, recovering —
 * locks input, so a double tap during a settle cannot fire a shell into a
 * closed raid.
 */
export function boardInteractive(state: RaidFlow, pending: boolean): boolean {
  return state.step === 'raiding' && !pending && !isOver(state.view);
}

/**
 * §8 QA — the **double-tap collect** case, generalised: any button that
 * spends something must be disabled while its request is in flight AND while
 * the flow is in a transitional step. Returns true when the tap should be
 * ignored entirely.
 */
export function shouldIgnoreTap(state: RaidFlow, pending: boolean): boolean {
  if (pending) return true;
  return state.step === 'searching' || state.step === 'opening' || state.step === 'settling' || state.step === 'recovering';
}

/** Does this step still owe the player a result? */
export function owesResult(state: RaidFlow): boolean {
  return state.raidId !== null && state.step !== 'result' && state.step !== 'kit';
}

/**
 * §5 — "Next (12 coins)". The cost rises with the caller's Admiralty level
 * and is the SERVER's number; this only formats it. Revenge is free, and
 * passes 0.
 */
export function searchButtonLabel(costCoins: number): string {
  return costCoins > 0 ? `Next (${costCoins} coins)` : 'Next';
}

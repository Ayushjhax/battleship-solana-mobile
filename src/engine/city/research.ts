/**
 * The Naval Academy's research queue — part-05 §5.
 *
 * "The Naval Academy researches one item at a time in its own queue (it does
 *  **not** use a dock worker)."
 *
 * That parenthesis is the whole design. Part 1's upgrade queue is gated on
 * `freeWorkers`, which is a scarce, bought resource; research deliberately is
 * not. So this is a SEPARATE queue with a separate slot — one item at a time,
 * and a Fish Market upgrade running in the background does not block it.
 *
 * This module closes DECISIONS.md D23, which stood in for it: Parts 6, 7 and 8
 * all ask "has this player researched the decoy?" and until now the answer was
 * "is the Naval Academy built at all?".
 */
import { ACADEMY_KINDS, type ArsenalKind } from '../types';

/** §5's table, verbatim. Index by item, not by level: the level is a gate. */
export interface ResearchSpec {
  readonly item: ArsenalKind;
  /** The Academy level this needs. */
  readonly academyLevel: number;
  readonly coins: number;
  readonly minutes: number;
}

const h = 60;
const d = 24 * h;

export const RESEARCH: readonly ResearchSpec[] = [
  { item: 'sonar_net', academyLevel: 1, coins: 1_000, minutes: 2 * h },
  { item: 'decoy', academyLevel: 2, coins: 2_500, minutes: 8 * h },
  { item: 'minesweeper', academyLevel: 3, coins: 5_000, minutes: 1 * d },
];

export function researchSpec(item: ArsenalKind): ResearchSpec | null {
  return RESEARCH.find((r) => r.item === item) ?? null;
}

/** §5 — "reserved" levels 4–5 have nothing in them yet, and that is not a bug. */
export function researchableAt(academyLevel: number): readonly ResearchSpec[] {
  return RESEARCH.filter((r) => r.academyLevel <= academyLevel);
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface ResearchJob {
  readonly item: ArsenalKind;
  readonly startedAt: number;
  readonly endsAt: number;
}

export interface ResearchState {
  /** Finished research. The server validates layouts against exactly this. */
  readonly unlocks: readonly ArsenalKind[];
  /** One at a time (§5), so this is a single job and not a list. */
  readonly job: ResearchJob | null;
}

export const EMPTY_RESEARCH: ResearchState = { unlocks: [], job: null };

export type ResearchError =
  | 'unknown-item'
  | 'already-researched'
  | 'already-researching'
  | 'needs-academy'
  | 'not-enough-coins'
  | 'not-researching'
  | 'not-finished'
  | 'not-enough-gems';

export type ResearchResult =
  | { readonly ok: true; readonly state: ResearchState; readonly dCoins: number; readonly dGems: number }
  | { readonly ok: false; readonly error: ResearchError };

const fail = (error: ResearchError): ResearchResult => ({ ok: false, error });

export function isResearched(state: ResearchState, item: ArsenalKind): boolean {
  return state.unlocks.includes(item);
}

/**
 * Start researching one item.
 *
 * `now` is a parameter and there is no `Date.now()` here, like every other
 * module in this directory — the server passes its own clock so a device with
 * a wrong one cannot finish research early.
 */
export function startResearch(
  state: ResearchState,
  item: ArsenalKind,
  academyLevel: number,
  coins: number,
  now: number,
): ResearchResult {
  const spec = researchSpec(item);
  if (!spec) return fail('unknown-item');
  if (isResearched(state, item)) return fail('already-researched');
  // §5 — ONE at a time, in its OWN queue. A building upgrade does not block
  // this, and this does not consume a dock worker.
  if (state.job) return fail('already-researching');
  if (academyLevel < spec.academyLevel) return fail('needs-academy');
  if (coins < spec.coins) return fail('not-enough-coins');

  return {
    ok: true,
    state: {
      unlocks: state.unlocks,
      job: { item, startedAt: now, endsAt: now + spec.minutes * 60_000 },
    },
    dCoins: -spec.coins,
    dGems: 0,
  };
}

/** Settles a finished job. Called on every read, like the city's accrual. */
export function settleResearch(state: ResearchState, now: number): ResearchState {
  if (!state.job || now < state.job.endsAt) return state;
  return {
    unlocks: state.unlocks.includes(state.job.item)
      ? state.unlocks
      : [...state.unlocks, state.job.item],
    job: null,
  };
}

/**
 * §5 — "Research can be finished early with gems using the same formula as
 * buildings." The formula lives in the city's actions.ts; this takes the
 * already-computed cost so the two cannot drift.
 */
export function rushResearch(
  state: ResearchState,
  gemCost: number,
  gems: number,
  now: number,
): ResearchResult {
  if (!state.job) return fail('not-researching');
  if (now >= state.job.endsAt) return fail('not-finished');
  if (gems < gemCost) return fail('not-enough-gems');

  return {
    ok: true,
    state: settleResearch({ ...state, job: { ...state.job, endsAt: now } }, now),
    dCoins: 0,
    dGems: -gemCost,
  };
}

/** Milliseconds left, for the plot's countdown. */
export function researchMsLeft(state: ResearchState, now: number): number {
  return state.job ? Math.max(0, state.job.endsAt - now) : 0;
}

/**
 * The unlocks as the rest of the package wants them: plain strings, because
 * `validateSubmission`, `validateHarbour` and `validateKit` all take
 * `readonly string[]`.
 */
export function unlockList(state: ResearchState): readonly string[] {
  return state.unlocks;
}

/** Every kind research can ever grant. Pinned against the engine's own list. */
export const RESEARCHABLE: readonly ArsenalKind[] = RESEARCH.map((r) => r.item);

/** A guard: the table and the engine's ACADEMY_KINDS must not drift apart. */
export function researchCoversAcademyKinds(): boolean {
  return (
    ACADEMY_KINDS.length === RESEARCHABLE.length &&
    ACADEMY_KINDS.every((kind) => RESEARCHABLE.includes(kind))
  );
}

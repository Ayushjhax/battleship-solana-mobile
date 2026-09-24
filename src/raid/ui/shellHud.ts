/**
 * The shell HUD's decisions — part-07 §3 step 3, tested by §8.2 and §8.3.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: the client renders only what the
 * server sent. The shell count on screen is always `view.shells` from the
 * last response — never a number this app worked out. What the app decides is
 * only *what to draw*, and it decides it by comparing two server numbers.
 *
 * So there is no arithmetic here that could disagree with the server. There is
 * a comparison, and a choice of animation.
 */

export type ShellFeedbackKind = 'refund' | 'spend' | 'mine' | 'free';

export interface ShellFeedback {
  readonly kind: ShellFeedbackKind;
  /** after - before. Negative spends, 0 a refund or a free action. */
  readonly delta: number;
  /** The +1 shell flying back into the row (§3: 220 ms). */
  readonly popBack: boolean;
  /** The red flash a mine gets. */
  readonly flash: boolean;
  /** What the little floating number says, or null for no float. */
  readonly label: string | null;
}

/** §3 — "A hit makes the spent shell fly back into the row (+1 pop, 220 ms)." */
export const SHELL_POP_MS = 220;
/** The red flash a mine gets, borrowed from the battle mine timing. */
export const MINE_FLASH_MS = 420;

/**
 * What to draw, from the server's before/after shell counts.
 *
 * `hit` and `mine` come from the engine events in the same response, so a
 * decoy — which serialises as a plain HIT — produces a refund here exactly as
 * a real hit does. That is not a bug to route around: the whole point of the
 * decoy is that the attacker cannot tell, and the HUD must not tell them.
 */
export function shellFeedback(
  before: number,
  after: number,
  outcome: { hit: boolean; mine: boolean },
): ShellFeedback {
  const delta = after - before;

  if (outcome.mine) {
    return { kind: 'mine', delta, popBack: false, flash: true, label: `${delta}` };
  }

  // A hit hands the shell straight back: the count did not move.
  if (outcome.hit && delta === 0) {
    return { kind: 'refund', delta: 0, popBack: true, flash: false, label: '+1' };
  }

  // A kit weapon costs no shell and found no mine — nothing to say.
  if (delta === 0) {
    return { kind: 'free', delta: 0, popBack: false, flash: false, label: null };
  }

  return { kind: 'spend', delta, popBack: false, flash: false, label: null };
}

/**
 * The row of shell icons. `filled` is what the server says is left; `total` is
 * the budget the raid started with, which came from the open response — also
 * the server's. The row never grows past the budget even if a response is
 * replayed out of order.
 */
export function shellRow(shells: number, budget: number): { filled: number; empty: number } {
  const filled = Math.max(0, Math.min(shells, budget));
  return { filled, empty: Math.max(0, budget - filled) };
}

// ---------------------------------------------------------------------------
// Stars and destruction (§8.3 — "render from the server payload only")
// ---------------------------------------------------------------------------

export interface StarStrip {
  /** Three slots, each inked or outline. Always exactly three. */
  readonly slots: readonly ('inked' | 'outline')[];
  /** The rolling percentage beneath, as an integer 0-100. */
  readonly destructionPercent: number;
}

/**
 * Deliberately takes `stars` and `destruction` and derives NOTHING else. It
 * does not recompute stars from destruction — the server already decided, and
 * a client that re-derived them would disagree the moment a rule changed.
 */
export function starStrip(view: { stars: number; destruction: number }): StarStrip {
  const inked = Math.max(0, Math.min(3, Math.trunc(view.stars)));
  return {
    slots: [0, 1, 2].map((i) => (i < inked ? 'inked' : 'outline')),
    destructionPercent: Math.round(Math.max(0, Math.min(1, view.destruction)) * 100),
  };
}

/**
 * Which star just landed, for the stamp animation. `null` when none did.
 * Comparing two server payloads, again — not counting up locally.
 */
export function starEarned(before: number, after: number): number | null {
  return after > before ? after : null;
}

// ---------------------------------------------------------------------------
// The raid clock (§3 — "the raid clock (4:00)")
// ---------------------------------------------------------------------------

/**
 * Rendered from the server's `msLeft` plus elapsed device time, the same rule
 * the city timers use (Part 1 §5): a wrong device clock can make a countdown
 * look briefly wrong, and the next response repairs it. It can never earn
 * anything, because the server ends the raid on its own clock.
 */
export function clockText(msLeft: number, elapsedSinceResponse = 0): string {
  const left = Math.max(0, msLeft - elapsedSinceResponse);
  const total = Math.ceil(left / 1_000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** §3 — the loot tally "climbs as destruction does". */
export function lootTally(
  pool: { coins: number; steel: number },
  destruction: number,
): { coins: number; steel: number } {
  const rate = Math.max(0, Math.min(1, destruction));
  return {
    coins: Math.floor(pool.coins * rate),
    steel: Math.floor(pool.steel * rate),
  };
}

/**
 * Fleet wars — part-08 §4, tested by §7.4 and §7.5.
 *
 * Two things live here, and they are separate on purpose:
 *
 *   SCORING    best-stars-per-target, the two tiebreaks, the rewards. Pure
 *              arithmetic over a list of raids, so the server and the client
 *              can both render a live scoreboard from the same function.
 *   THE STATE  which transitions are legal, and when. The SCHEDULER applies
 *   MACHINE    them in SQL (that is where idempotency lives — see
 *              server/src/fleet/scheduler.ts); this module says what is legal
 *              so the two cannot disagree.
 *
 * `settled_at` is deliberately NOT modelled here. §6 says to use it as the
 * marker, and a marker that lives in two places is not a marker.
 */
import type { War, WarMember, WarRaid, WarSize, WarState } from './types';

// ---------------------------------------------------------------------------
// The clock (§4)
// ---------------------------------------------------------------------------

/** §4 — "Preparation day: 22 hours." */
export const PREP_MS = 22 * 60 * 60 * 1_000;
/** §4 — "Battle day: 24 hours." */
export const BATTLE_MS = 24 * 60 * 60 * 1_000;
/** §4 — matchmaking "gives up after 30 minutes". */
export const SEARCH_GIVE_UP_MS = 30 * 60 * 1_000;
/** §4 — "Each member gets 2 raids". */
export const RAIDS_PER_MEMBER = 2;

// ---------------------------------------------------------------------------
// Scoring (§4)
// ---------------------------------------------------------------------------

/** One enemy harbour's line on the scoreboard. */
export interface TargetScore {
  readonly targetUserId: string;
  /** §4 — "the best stars anyone achieved against it". */
  readonly stars: number;
  /** The destruction of the raid that set those stars — the first tiebreak. */
  readonly destruction: number;
  /** When that raid finished — the second tiebreak. */
  readonly finishedAt: number;
  /** Who set it, for the scoreboard's "held by". */
  readonly byUserId: string | null;
  readonly attempts: number;
}

/**
 * §4 — "each enemy harbour counts the best stars anyone achieved against it.
 * Ties break on total destruction, then on the earlier finish."
 *
 * The tiebreaks apply to picking which RAID represents a target, as well as
 * to the fleets' totals: if two raids both got 2★, the one that did more
 * damage is the one on the board, and if those tie, the earlier one. That
 * matters because the chosen raid's destruction feeds the fleet's total.
 */
export function bestPerTarget(
  targets: readonly string[],
  raids: readonly WarRaid[],
): TargetScore[] {
  return targets.map((targetUserId) => {
    const mine = raids.filter((r) => r.targetUserId === targetUserId);
    if (mine.length === 0) {
      return {
        targetUserId,
        stars: 0,
        destruction: 0,
        finishedAt: 0,
        byUserId: null,
        attempts: 0,
      };
    }

    const best = [...mine].sort(compareRaids)[0]!;
    return {
      targetUserId,
      stars: best.stars,
      destruction: best.destruction,
      finishedAt: best.finishedAt,
      byUserId: best.attackerId,
      attempts: mine.length,
    };
  });
}

/** Better raid first: more stars, then more destruction, then earlier. */
function compareRaids(a: WarRaid, b: WarRaid): number {
  if (a.stars !== b.stars) return b.stars - a.stars;
  if (a.destruction !== b.destruction) return b.destruction - a.destruction;
  return a.finishedAt - b.finishedAt;
}

export interface SideScore {
  readonly stars: number;
  readonly destruction: number;
  /** The latest finish among the scoring raids — the second tiebreak reads it. */
  readonly lastFinishAt: number;
  readonly targets: readonly TargetScore[];
}

export function sideScore(targets: readonly string[], raids: readonly WarRaid[]): SideScore {
  const perTarget = bestPerTarget(targets, raids);
  return {
    stars: perTarget.reduce((n, t) => n + t.stars, 0),
    destruction: perTarget.reduce((n, t) => n + t.destruction, 0),
    lastFinishAt: perTarget.reduce((n, t) => Math.max(n, t.finishedAt), 0),
    targets: perTarget,
  };
}

export type WarWinner = 'a' | 'b' | 'draw';

export interface WarResult {
  readonly winner: WarWinner;
  readonly a: SideScore;
  readonly b: SideScore;
  /** Which rule decided it, for the war log's one-line summary. */
  readonly decidedBy: 'stars' | 'destruction' | 'finish' | 'draw';
}

/**
 * §4 — stars, then total destruction, then the earlier finish.
 *
 * "Earlier finish" means the side that finished its scoring raids sooner,
 * which rewards the fleet that did its work rather than the one that waited
 * out the clock.
 */
export function warResult(
  targetsA: readonly string[],
  raidsA: readonly WarRaid[],
  targetsB: readonly string[],
  raidsB: readonly WarRaid[],
): WarResult {
  // A attacks B's harbours and vice versa: A's score is over B's targets.
  const a = sideScore(targetsB, raidsA);
  const b = sideScore(targetsA, raidsB);

  if (a.stars !== b.stars) {
    return { winner: a.stars > b.stars ? 'a' : 'b', a, b, decidedBy: 'stars' };
  }
  if (a.destruction !== b.destruction) {
    return {
      winner: a.destruction > b.destruction ? 'a' : 'b',
      a,
      b,
      decidedBy: 'destruction',
    };
  }
  // Both zero means nobody attacked at all — a genuine draw, not a race won
  // by the side whose `lastFinishAt` happens to be 0.
  if (a.lastFinishAt === 0 && b.lastFinishAt === 0) {
    return { winner: 'draw', a, b, decidedBy: 'draw' };
  }
  if (a.lastFinishAt !== b.lastFinishAt) {
    const earlier = a.lastFinishAt === 0 ? 'b' : b.lastFinishAt === 0 ? 'a' : a.lastFinishAt < b.lastFinishAt ? 'a' : 'b';
    return { winner: earlier, a, b, decidedBy: 'finish' };
  }
  return { winner: 'draw', a, b, decidedBy: 'draw' };
}

// ---------------------------------------------------------------------------
// Rewards (§4)
// ---------------------------------------------------------------------------

/**
 * §4 — "the winning fleet gets a war chest (steel and coins scaled by war size
 * and stars, plus 10 gems each); the loser gets a third. Every participant who
 * used both raids gets a participation bonus. A member who used none gets
 * nothing and is marked in the war log."
 *
 * NUMBERS.md does not give the chest's scale, so the two constants below are
 * proposed here and recorded in DECISIONS.md (D25): a per-size base, and a
 * per-star bonus. They are deliberately modest next to a raid's loot — a war
 * is a weekly event, and a fleet that wins one should not out-earn a week of
 * raiding on its own.
 */
export const WAR_CHEST_BASE: Readonly<Record<WarSize, { steel: number; coins: number }>> = {
  5: { steel: 1_500, coins: 500 },
  10: { steel: 3_500, coins: 1_200 },
  15: { steel: 6_000, coins: 2_000 },
};

/** Per star the winning side earned. */
export const WAR_CHEST_PER_STAR = { steel: 60, coins: 20 };

/** §4 — "plus 10 gems each". Winners only. */
export const WAR_WIN_GEMS = 10;

/** §4 — "the loser gets a third". */
export const LOSER_SHARE = 1 / 3;

/** §4 — "Every participant who used both raids gets a participation bonus." */
export const PARTICIPATION_STEEL = 200;

export interface MemberReward {
  readonly userId: string;
  readonly steel: number;
  readonly coins: number;
  readonly gems: number;
  /** §4 — "A member who used none ... is marked in the war log." */
  readonly noShow: boolean;
  readonly participated: boolean;
}

/**
 * The whole payout for one side, as a list the SQL only has to apply.
 *
 * Every number is computed here, in TypeScript, for the same reason Part 6's
 * settlement was: a game rule inside a plpgsql function is a rule nobody can
 * unit-test.
 */
export function memberRewards(
  members: readonly WarMember[],
  size: WarSize,
  stars: number,
  won: boolean,
  draw = false,
): MemberReward[] {
  const base = WAR_CHEST_BASE[size];
  const chest = {
    steel: base.steel + stars * WAR_CHEST_PER_STAR.steel,
    coins: base.coins + stars * WAR_CHEST_PER_STAR.coins,
  };

  // A draw pays both sides the loser's share: nobody won, but everybody
  // turned up, and paying nothing for a 22-hour commitment reads as a bug.
  const share = won && !draw ? 1 : LOSER_SHARE;
  const headcount = Math.max(1, members.length);

  return members.map((member) => {
    const noShow = member.raidsUsed === 0;
    const participated = member.raidsUsed >= RAIDS_PER_MEMBER;

    if (noShow) {
      // §4 — "A member who used none gets nothing".
      return { userId: member.userId, steel: 0, coins: 0, gems: 0, noShow: true, participated: false };
    }

    return {
      userId: member.userId,
      steel:
        Math.floor((chest.steel * share) / headcount) + (participated ? PARTICIPATION_STEEL : 0),
      coins: Math.floor((chest.coins * share) / headcount),
      gems: won && !draw ? WAR_WIN_GEMS : 0,
      noShow: false,
      participated,
    };
  });
}

// ---------------------------------------------------------------------------
// The state machine (§6)
// ---------------------------------------------------------------------------

/**
 * The legal transitions. The SCHEDULER performs them in SQL — that is where
 * idempotency lives — but it asks here whether a move is legal at all, so the
 * machine has exactly one definition.
 */
const TRANSITIONS: Readonly<Record<WarState, readonly WarState[]>> = {
  searching: ['prep', 'cancelled'],
  prep: ['battle', 'cancelled'],
  battle: ['settling'],
  settling: ['ended'],
  ended: [],
  cancelled: [],
};

export function canTransition(from: WarState, to: WarState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** What the clock says this war should be, now. `null` = leave it alone. */
export function dueTransition(war: War, now: number): WarState | null {
  switch (war.state) {
    case 'searching':
      return now - war.searchStartedAt >= SEARCH_GIVE_UP_MS ? 'cancelled' : null;
    case 'prep':
      return war.prepEndsAt !== null && now >= war.prepEndsAt ? 'battle' : null;
    case 'battle':
      return war.battleEndsAt !== null && now >= war.battleEndsAt ? 'settling' : null;
    case 'settling':
      // Settling is not time-driven: it ends when the payment commits.
      return 'ended';
    default:
      return null;
  }
}

/** The two timestamps a pairing sets. */
export function warSchedule(pairedAt: number): { prepEndsAt: number; battleEndsAt: number } {
  const prepEndsAt = pairedAt + PREP_MS;
  return { prepEndsAt, battleEndsAt: prepEndsAt + BATTLE_MS };
}

/** §4 — war raids "take no loot and move no renown". */
export const WAR_RAID_REWARDS = { loot: false, renown: false, shield: false, lock: false } as const;

export function raidsLeft(member: WarMember): number {
  return Math.max(0, RAIDS_PER_MEMBER - member.raidsUsed);
}

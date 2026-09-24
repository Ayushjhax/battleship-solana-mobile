/**
 * Roles and the permission table — part-08 §1, tested by §7.1.
 *
 * §1 gives the table as a grid. This module IS that grid, transcribed once,
 * so the server and the client cannot disagree about who may kick whom —
 * and so a test can walk every cell in both directions rather than checking
 * the four or five a developer happened to think of.
 *
 * Two rules the grid does not state but the prose does:
 *   - "Kick a lower role" and "Promote / demote below own role" are bounded by
 *     the actor's OWN rank, so a Commodore cannot kick a Commodore.
 *   - "Leaving is always allowed", including for the Admiral, who passes the
 *     flag on the way out.
 */
import { FLEET_ROLES, type FleetMember, type FleetRole } from './types';

/** Every action the table has a column for, plus the two the prose adds. */
export const FLEET_ACTIONS = [
  'review-requests',
  'kick',
  'promote',
  'start-war',
  'edit-fleet',
  'donate',
  'leave',
] as const;

export type FleetAction = (typeof FLEET_ACTIONS)[number];

/**
 * §1's table, verbatim. A `true` here means "this role may attempt it"; the
 * rank-bound checks (kick whom? promote to what?) are the functions below.
 */
const TABLE: Readonly<Record<FleetAction, Readonly<Record<FleetRole, boolean>>>> = {
  'review-requests': { admiral: true, commodore: true, officer: true, sailor: false },
  kick: { admiral: true, commodore: true, officer: false, sailor: false },
  promote: { admiral: true, commodore: true, officer: false, sailor: false },
  'start-war': { admiral: true, commodore: true, officer: false, sailor: false },
  'edit-fleet': { admiral: true, commodore: false, officer: false, sailor: false },
  donate: { admiral: true, commodore: true, officer: true, sailor: true },
  // "Leaving is always allowed."
  leave: { admiral: true, commodore: true, officer: true, sailor: true },
};

/** Higher number = more senior. Used for the "lower role" bounds. */
const RANK: Readonly<Record<FleetRole, number>> = {
  admiral: 3,
  commodore: 2,
  officer: 1,
  sailor: 0,
};

export function rankOf(role: FleetRole): number {
  return RANK[role];
}

export function isSenior(actor: FleetRole, target: FleetRole): boolean {
  return RANK[actor] > RANK[target];
}

/** The plain table lookup: may this role attempt this action at all? */
export function can(role: FleetRole, action: FleetAction): boolean {
  return TABLE[action][role];
}

export interface PermissionCheck {
  readonly ok: boolean;
  /** Player-facing, in the Captain's register. Null when ok. */
  readonly reason: string | null;
}

const ALLOWED: PermissionCheck = { ok: true, reason: null };
const deny = (reason: string): PermissionCheck => ({ ok: false, reason });

/**
 * §1 — "Kick a lower role". Strictly lower: a Commodore may not kick another
 * Commodore, and nobody may kick the Admiral.
 */
export function canKick(actor: FleetRole, target: FleetRole): PermissionCheck {
  if (!can(actor, 'kick')) return deny('Only the Admiral and Commodores can do that.');
  if (target === 'admiral') return deny('The Admiral cannot be put ashore.');
  if (!isSenior(actor, target)) return deny('You can only put ashore someone below you.');
  return ALLOWED;
}

/**
 * §1 — "Promote / demote below own role". The TARGET must be below the actor
 * and the DESTINATION must be below the actor too, or a Commodore could
 * promote a Sailor straight past themselves.
 */
export function canSetRole(
  actor: FleetRole,
  target: FleetRole,
  next: FleetRole,
): PermissionCheck {
  if (!can(actor, 'promote')) return deny('Only the Admiral and Commodores can do that.');
  if (next === 'admiral') return deny('There is only one Admiral, and the flag is passed, not given.');
  if (!isSenior(actor, target)) return deny('You can only rank someone below you.');
  if (!isSenior(actor, next)) return deny('You cannot rank anyone up to your own station.');
  if (target === next) return deny('They already hold that station.');
  return ALLOWED;
}

export function canReviewRequests(actor: FleetRole): PermissionCheck {
  return can(actor, 'review-requests')
    ? ALLOWED
    : deny('Officers and above handle the requests.');
}

export function canStartWar(actor: FleetRole): PermissionCheck {
  return can(actor, 'start-war') ? ALLOWED : deny('The Admiral or a Commodore calls a war.');
}

export function canEditFleet(actor: FleetRole): PermissionCheck {
  return can(actor, 'edit-fleet') ? ALLOWED : deny('Only the Admiral can change the colours.');
}

// ---------------------------------------------------------------------------
// Succession (§1)
// ---------------------------------------------------------------------------

export type Succession =
  | { readonly kind: 'promoted'; readonly userId: string; readonly from: FleetRole }
  | { readonly kind: 'archived' };

/**
 * §1 — "An Admiral who leaves passes the flag to the highest-ranked active
 * member; if the fleet empties it is archived."
 *
 * "Highest-ranked" first, then — because a fleet can hold five Commodores —
 * the one seen most recently, and finally the one who has been there longest.
 * The last tiebreak is the user id, so the result is deterministic and a test
 * can assert it rather than "one of these three".
 */
export function successorFor(
  members: readonly FleetMember[],
  leavingUserId: string,
): Succession {
  const remaining = members.filter((m) => m.userId !== leavingUserId);
  if (remaining.length === 0) return { kind: 'archived' };

  const best = [...remaining].sort((a, b) => {
    if (RANK[a.role] !== RANK[b.role]) return RANK[b.role] - RANK[a.role];
    const seenA = a.lastSeenAt ?? 0;
    const seenB = b.lastSeenAt ?? 0;
    if (seenA !== seenB) return seenB - seenA;
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
    return a.userId < b.userId ? -1 : 1;
  })[0]!;

  return { kind: 'promoted', userId: best.userId, from: best.role };
}

/** §1 — "Up to 30 captains", and the policy gate. */
export interface JoinCheck {
  readonly ok: boolean;
  /** 'joined' walks straight in; 'requested' waits for an officer. */
  readonly outcome: 'joined' | 'requested' | 'refused';
  readonly reason: string | null;
}

export function canJoin(
  fleet: { policy: string; minRenown: number; archived: boolean },
  memberCount: number,
  applicant: { renown: number },
): JoinCheck {
  if (fleet.archived) {
    return { ok: false, outcome: 'refused', reason: 'That fleet has struck its colours.' };
  }
  if (memberCount >= 30) {
    return { ok: false, outcome: 'refused', reason: 'That fleet is at full complement.' };
  }
  if (applicant.renown < fleet.minRenown) {
    return {
      ok: false,
      outcome: 'refused',
      reason: `They ask for ${fleet.minRenown} renown.`,
    };
  }
  if (fleet.policy === 'closed') {
    return { ok: false, outcome: 'refused', reason: 'That fleet is not taking captains.' };
  }
  return fleet.policy === 'open'
    ? { ok: true, outcome: 'joined', reason: null }
    : { ok: true, outcome: 'requested', reason: null };
}

/** The roster order §3 asks for: merit first, then rank, then name-stable. */
export function rosterOrder(members: readonly FleetMember[]): FleetMember[] {
  return [...members].sort((a, b) => {
    if (a.role === 'admiral' !== (b.role === 'admiral')) return a.role === 'admiral' ? -1 : 1;
    if (a.merit !== b.merit) return b.merit - a.merit;
    if (RANK[a.role] !== RANK[b.role]) return RANK[b.role] - RANK[a.role];
    return a.userId < b.userId ? -1 : 1;
  });
}

export { FLEET_ROLES };

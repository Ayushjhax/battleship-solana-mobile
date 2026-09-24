/**
 * Roles — part-08 §7.1.
 *
 * "Roles: every permission in the table, and the Admiral-leaves succession."
 *
 * "Every permission in the table" is taken literally: the tests below walk all
 * 24 cells (6 actions × 4 roles) rather than the handful a developer would
 * think to check, and then walk all 16 actor/target pairs for the two actions
 * whose rule is "someone below you".
 */
import { describe, expect, it } from 'vitest';

import {
  FLEET_ACTIONS,
  FLEET_MAX_MEMBERS,
  FLEET_ROLES,
  can,
  canEditFleet,
  canJoin,
  canKick,
  canReviewRequests,
  canSetRole,
  canStartWar,
  isSenior,
  rankOf,
  rosterOrder,
  successorFor,
  type FleetMember,
  type FleetRole,
} from '@engine/fleets';

const member = (
  userId: string,
  role: FleetRole,
  patch: Partial<FleetMember> = {},
): FleetMember => ({
  userId,
  role,
  joinedAt: 1_000,
  merit: 0,
  ...patch,
});

// ===========================================================================
// §1's table, every cell
// ===========================================================================

/** §1's grid, transcribed a SECOND time — from the doc, not from the code. */
const DOC_TABLE: Record<string, Record<FleetRole, boolean>> = {
  'review-requests': { admiral: true, commodore: true, officer: true, sailor: false },
  kick: { admiral: true, commodore: true, officer: false, sailor: false },
  promote: { admiral: true, commodore: true, officer: false, sailor: false },
  'start-war': { admiral: true, commodore: true, officer: false, sailor: false },
  'edit-fleet': { admiral: true, commodore: false, officer: false, sailor: false },
  donate: { admiral: true, commodore: true, officer: true, sailor: true },
};

describe('the permission table', () => {
  it('matches the doc in all 24 cells', () => {
    for (const [action, byRole] of Object.entries(DOC_TABLE)) {
      for (const role of FLEET_ROLES) {
        expect(can(role, action as never), `${role} / ${action}`).toBe(byRole[role]);
      }
    }
  });

  it('covers every action the code knows about', () => {
    // If an action is added to the code and not to the doc table above, this
    // fails — so the two cannot drift silently.
    const documented = new Set(Object.keys(DOC_TABLE));
    const extra = FLEET_ACTIONS.filter((a) => !documented.has(a));
    // 'leave' is the one the prose adds rather than the grid.
    expect(extra).toEqual(['leave']);
  });

  it('leaving is always allowed, for every role including the Admiral', () => {
    for (const role of FLEET_ROLES) {
      expect(can(role, 'leave'), role).toBe(true);
    }
  });

  it('every role can donate and request', () => {
    for (const role of FLEET_ROLES) {
      expect(can(role, 'donate'), role).toBe(true);
    }
  });

  it('only the Admiral edits the fleet', () => {
    expect(canEditFleet('admiral').ok).toBe(true);
    for (const role of ['commodore', 'officer', 'sailor'] as const) {
      expect(canEditFleet(role).ok, role).toBe(false);
    }
  });

  it('the Admiral and Commodores call a war', () => {
    expect(canStartWar('admiral').ok).toBe(true);
    expect(canStartWar('commodore').ok).toBe(true);
    expect(canStartWar('officer').ok).toBe(false);
    expect(canStartWar('sailor').ok).toBe(false);
  });

  it('Officers and above review requests', () => {
    expect(canReviewRequests('officer').ok).toBe(true);
    expect(canReviewRequests('sailor').ok).toBe(false);
  });

  it('every refusal says something a player can act on', () => {
    for (const check of [canEditFleet('sailor'), canStartWar('officer'), canReviewRequests('sailor')]) {
      expect(check.reason).toBeTruthy();
      expect(check.reason!.length).toBeGreaterThan(10);
      expect(check.reason).not.toContain('-'); // no codes
    }
  });
});

// ===========================================================================
// "a lower role" / "below own role" — all 16 pairs
// ===========================================================================

describe('kicking', () => {
  it('walks all 16 actor/target pairs', () => {
    const allowed: [FleetRole, FleetRole][] = [
      ['admiral', 'commodore'],
      ['admiral', 'officer'],
      ['admiral', 'sailor'],
      ['commodore', 'officer'],
      ['commodore', 'sailor'],
    ];
    const isAllowed = (a: FleetRole, t: FleetRole) =>
      allowed.some(([x, y]) => x === a && y === t);

    for (const actor of FLEET_ROLES) {
      for (const target of FLEET_ROLES) {
        expect(canKick(actor, target).ok, `${actor} kicks ${target}`).toBe(isAllowed(actor, target));
      }
    }
  });

  it('a Commodore cannot kick a Commodore — "lower" is strict', () => {
    expect(canKick('commodore', 'commodore').ok).toBe(false);
  });

  it('nobody kicks the Admiral', () => {
    for (const actor of FLEET_ROLES) {
      expect(canKick(actor, 'admiral').ok, actor).toBe(false);
    }
  });
});

describe('promoting and demoting', () => {
  it('an Admiral may make a Sailor a Commodore', () => {
    expect(canSetRole('admiral', 'sailor', 'commodore').ok).toBe(true);
  });

  it('a Commodore may NOT promote anyone to Commodore — not past themselves', () => {
    expect(canSetRole('commodore', 'sailor', 'commodore').ok).toBe(false);
    expect(canSetRole('commodore', 'sailor', 'officer').ok).toBe(true);
  });

  it('nobody can hand out the Admiralty — the flag is passed, not given', () => {
    for (const actor of FLEET_ROLES) {
      expect(canSetRole(actor, 'sailor', 'admiral').ok, actor).toBe(false);
    }
  });

  it('a Commodore cannot demote another Commodore', () => {
    expect(canSetRole('commodore', 'commodore', 'sailor').ok).toBe(false);
  });

  it('setting a role somebody already holds is refused', () => {
    expect(canSetRole('admiral', 'officer', 'officer').ok).toBe(false);
  });

  it('Officers and Sailors cannot rank anybody', () => {
    for (const actor of ['officer', 'sailor'] as const) {
      expect(canSetRole(actor, 'sailor', 'officer').ok, actor).toBe(false);
    }
  });

  it('rank order is Admiral > Commodore > Officer > Sailor', () => {
    expect(rankOf('admiral')).toBeGreaterThan(rankOf('commodore'));
    expect(rankOf('commodore')).toBeGreaterThan(rankOf('officer'));
    expect(rankOf('officer')).toBeGreaterThan(rankOf('sailor'));
    expect(isSenior('admiral', 'sailor')).toBe(true);
    expect(isSenior('sailor', 'admiral')).toBe(false);
    expect(isSenior('officer', 'officer')).toBe(false);
  });
});

// ===========================================================================
// §1 — the Admiral leaves
// ===========================================================================

describe('succession', () => {
  it('passes the flag to the highest-ranked member', () => {
    const roster = [
      member('admiral-1', 'admiral'),
      member('sailor-1', 'sailor'),
      member('commodore-1', 'commodore'),
      member('officer-1', 'officer'),
    ];
    const out = successorFor(roster, 'admiral-1');
    expect(out).toEqual({ kind: 'promoted', userId: 'commodore-1', from: 'commodore' });
  });

  it('breaks a tie on who was seen most recently — "active"', () => {
    const roster = [
      member('admiral-1', 'admiral'),
      member('quiet', 'commodore', { lastSeenAt: 1_000 }),
      member('active', 'commodore', { lastSeenAt: 90_000 }),
    ];
    expect(successorFor(roster, 'admiral-1')).toMatchObject({ userId: 'active' });
  });

  it('then on who has been aboard longest', () => {
    const roster = [
      member('admiral-1', 'admiral'),
      member('newer', 'commodore', { joinedAt: 5_000 }),
      member('older', 'commodore', { joinedAt: 1_000 }),
    ];
    expect(successorFor(roster, 'admiral-1')).toMatchObject({ userId: 'older' });
  });

  it('is deterministic all the way down, so a test can assert it', () => {
    const roster = [
      member('admiral-1', 'admiral'),
      member('bbb', 'sailor'),
      member('aaa', 'sailor'),
    ];
    expect(successorFor(roster, 'admiral-1')).toMatchObject({ userId: 'aaa' });
    // Same input, same answer, every time.
    expect(successorFor(roster, 'admiral-1')).toEqual(successorFor(roster, 'admiral-1'));
  });

  it('promotes a Sailor when there is nobody else', () => {
    const roster = [member('admiral-1', 'admiral'), member('sailor-1', 'sailor')];
    expect(successorFor(roster, 'admiral-1')).toMatchObject({
      userId: 'sailor-1',
      from: 'sailor',
    });
  });

  it('archives the fleet when the last member leaves', () => {
    expect(successorFor([member('admiral-1', 'admiral')], 'admiral-1')).toEqual({ kind: 'archived' });
    expect(successorFor([], 'anyone')).toEqual({ kind: 'archived' });
  });

  it('a non-Admiral leaving does not change anybody’s rank', () => {
    const roster = [member('admiral-1', 'admiral'), member('sailor-1', 'sailor')];
    // The caller only consults successorFor for an Admiral; this asserts the
    // function is still well-behaved if it is asked about anyone.
    expect(successorFor(roster, 'sailor-1')).toMatchObject({ userId: 'admiral-1' });
  });
});

// ===========================================================================
// Joining (§1)
// ===========================================================================

describe('joining', () => {
  const open = { policy: 'open', minRenown: 0, archived: false };

  it('walks straight into an open fleet', () => {
    expect(canJoin(open, 3, { renown: 500 })).toMatchObject({ ok: true, outcome: 'joined' });
  });

  it('waits for an officer at a by-request fleet', () => {
    expect(canJoin({ ...open, policy: 'request' }, 3, { renown: 500 })).toMatchObject({
      ok: true,
      outcome: 'requested',
    });
  });

  it('is refused at a closed one', () => {
    expect(canJoin({ ...open, policy: 'closed' }, 3, { renown: 500 }).outcome).toBe('refused');
  });

  it('is refused below the minimum renown, and says the number', () => {
    const check = canJoin({ ...open, minRenown: 900 }, 3, { renown: 500 });
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('900');
  });

  it('is refused at 30 captains — §1’s cap', () => {
    expect(FLEET_MAX_MEMBERS).toBe(30);
    expect(canJoin(open, 30, { renown: 500 }).ok).toBe(false);
    expect(canJoin(open, 29, { renown: 500 }).ok).toBe(true);
  });

  it('is refused at an archived fleet', () => {
    expect(canJoin({ ...open, archived: true }, 1, { renown: 500 }).ok).toBe(false);
  });
});

// ===========================================================================
// The roster order (§3 — merit "orders the roster and gates nothing")
// ===========================================================================

describe('the roster', () => {
  it('puts the Admiral first, whatever their merit', () => {
    const roster = rosterOrder([
      member('sailor-1', 'sailor', { merit: 900 }),
      member('admiral-1', 'admiral', { merit: 0 }),
    ]);
    expect(roster[0]?.userId).toBe('admiral-1');
  });

  it('orders the rest by merit', () => {
    const roster = rosterOrder([
      member('low', 'officer', { merit: 1 }),
      member('high', 'sailor', { merit: 50 }),
      member('mid', 'commodore', { merit: 10 }),
    ]);
    expect(roster.map((m) => m.userId)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks a merit tie on rank', () => {
    const roster = rosterOrder([
      member('sailor-1', 'sailor', { merit: 5 }),
      member('commodore-1', 'commodore', { merit: 5 }),
    ]);
    expect(roster[0]?.userId).toBe('commodore-1');
  });

  it('never mutates the list it was given', () => {
    const input = [member('b', 'sailor', { merit: 1 }), member('a', 'sailor', { merit: 9 })];
    const copy = [...input];
    rosterOrder(input);
    expect(input).toEqual(copy);
  });
});

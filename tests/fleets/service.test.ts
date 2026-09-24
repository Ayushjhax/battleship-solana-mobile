/**
 * The fleet service's rules at the boundary — the half of part-08 §7 that
 * needed the endpoints to exist before it could be written.
 *
 * These drive the REAL service functions against a fake repo, which is the
 * right level for them: what is being tested is "does the service ask the
 * rules the right question", not "does Postgres commit" (that is
 * `server/tests/integration/war-scheduler.test.ts`, which uses real SQL
 * because it tests a transaction property).
 *
 * The one that matters most here is the ranked-integrity rule at the SERVICE
 * boundary: `reinforcementsFor()` is the only function on the server that
 * hands reinforcements to a layout, and it must return nothing for 'ranked'
 * however full the player's slots are.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LayoutContext } from '@engine/fleets';

import {
  __setFleetRepoForTests,
  type FleetRepo,
} from '../../server/src/fleet/repo';
import {
  checkFriendly,
  consumeReinforcements,
  fillRequest,
  postRequest,
  reinforcementsFor,
  setOptIn,
  startWar,
} from '../../server/src/fleet/service';

const ME = 'me';
const MATE = 'mate';
const STRANGER = 'stranger';
const FLEET = 'fleet-1';

interface FakeState {
  members: Record<string, { fleetId: string; role: 'admiral' | 'commodore' | 'officer' | 'sailor' }>;
  held: { id: string; item: string; donorId: string | null; filledAt: number | null }[];
  lastRequestAt: number | null;
  open: { id: string; fleetId: string; requesterId: string; item: string; donorId: string | null }[];
  consumed: { id: string; context: string }[];
  created: unknown[];
  optIns: { userId: string; renown: number; optedIn: boolean }[];
  activeWar: string | null;
  openedWars: unknown[];
}

let state: FakeState;

function fakeRepo(): FleetRepo {
  const nope = () => {
    throw new Error('not used by these tests');
  };
  return {
    async membershipOf(userId) {
      return state.members[userId] ?? null;
    },
    async heldReinforcements() {
      return state.held.map((h) => ({
        id: h.id,
        fleetId: FLEET,
        requesterId: ME,
        item: h.item,
        at: 0,
        donorId: h.donorId,
        filledAt: h.filledAt,
        consumedAt: null,
      }));
    },
    async lastRequestAt() {
      return state.lastRequestAt;
    },
    async createRequest(input) {
      state.created.push(input);
    },
    async openRequests() {
      return state.open.map((o) => ({
        ...o,
        at: 0,
        filledAt: null,
        consumedAt: null,
      }));
    },
    async fillRequest() {
      return 'ok';
    },
    async consumeReinforcement(id, _userId, context) {
      // The SQL's own refusal, mirrored: 'ranked' never consumes.
      if (context === 'ranked') return 'not-in-ranked';
      state.consumed.push({ id, context });
      return 'ok';
    },
    async warOptIns() {
      return state.optIns;
    },
    async activeWarFor() {
      return state.activeWar;
    },
    async openWar(input) {
      state.openedWars.push(input);
    },
    async searchingWars() {
      return [];
    },
    async pairWars() {
      return false;
    },
    async setWarOptIn() {
      /* recorded by the caller's assertion */
    },
    loadFleet: nope as never,
    members: nope as never,
    createFleet: nope as never,
    leaveFleet: nope as never,
    setRole: nope as never,
    removeMember: nope as never,
    postMessage: nope as never,
    recentMessages: nope as never,
    recentBy: nope as never,
    advancePrep: nope as never,
    advanceBattle: nope as never,
    expireSearches: nope as never,
    warsAwaitingSettlement: nope as never,
    settleWar: nope as never,
    loadWar: nope as never,
    warMembers: nope as never,
    warRaids: nope as never,
    setWarHarbour: nope as never,
    recordWarRaid: nope as never,
    recordFlag: nope as never,
    flagWall: nope as never,
    sweep: nope as never,
  };
}

beforeEach(() => {
  process.env.PORT_CITY_FLEETS = '1';
  state = {
    members: {
      [ME]: { fleetId: FLEET, role: 'admiral' },
      [MATE]: { fleetId: FLEET, role: 'sailor' },
      [STRANGER]: { fleetId: 'other-fleet', role: 'sailor' },
    },
    held: [{ id: 'r1', item: 'bomber', donorId: 'd', filledAt: 1_000 }],
    lastRequestAt: null,
    open: [],
    consumed: [],
    created: [],
    optIns: [],
    activeWar: null,
    openedWars: [],
  };
  __setFleetRepoForTests(fakeRepo());
});

afterEach(() => {
  __setFleetRepoForTests(null);
  delete process.env.PORT_CITY_FLEETS;
});

// ===========================================================================
// THE RANKED INTEGRITY RULE, at the service boundary
// ===========================================================================

describe('reinforcementsFor', () => {
  it('returns NOTHING for ranked, however full the slots are', async () => {
    state.held = Array.from({ length: 10 }, (_, n) => ({
      id: `r${n}`,
      item: 'bomber',
      donorId: 'd',
      filledAt: 1,
    }));
    expect(await reinforcementsFor(ME, 'ranked')).toEqual([]);
  });

  it('returns them for raid, war and friendly', async () => {
    for (const context of ['raid', 'war', 'friendly'] as LayoutContext[]) {
      expect((await reinforcementsFor(ME, context)).length, context).toBe(1);
    }
  });

  it('returns nothing when the feature is off, for every context', async () => {
    delete process.env.PORT_CITY_FLEETS;
    for (const context of ['ranked', 'raid', 'war', 'friendly'] as LayoutContext[]) {
      expect(await reinforcementsFor(ME, context), context).toEqual([]);
    }
  });
});

describe('consumeReinforcements', () => {
  it('spends nothing in a ranked match, and records nothing', async () => {
    expect(await consumeReinforcements(ME, ['r1'], 'ranked')).toBe(0);
    expect(state.consumed).toEqual([]);
  });

  it('spends one in a raid', async () => {
    expect(await consumeReinforcements(ME, ['r1'], 'raid')).toBe(1);
    expect(state.consumed).toEqual([{ id: 'r1', context: 'raid' }]);
  });

  it('spends nothing when the feature is off', async () => {
    delete process.env.PORT_CITY_FLEETS;
    expect(await consumeReinforcements(ME, ['r1'], 'raid')).toBe(0);
  });
});

// ===========================================================================
// Donations
// ===========================================================================

describe('postRequest', () => {
  it('refuses a player with no fleet', async () => {
    const out = await postRequest('nobody', 'bomber', 0, { fleetHallLevel: 5 });
    expect(out.ok === false && out.error).toBe('not-in-a-fleet');
  });

  it('refuses inside the 30-minute cooldown', async () => {
    state.lastRequestAt = 1_000;
    const out = await postRequest(ME, 'bomber', 1_000 + 60_000, { fleetHallLevel: 5 });
    expect(out.ok === false && out.error).toBe('on-cooldown');
    expect(state.created).toHaveLength(0);
  });

  it('refuses when the slots cannot hold it', async () => {
    // Fleet Hall 1 holds 20 fuel; a bomber is 30.
    state.held = [];
    const out = await postRequest(ME, 'bomber', 0, { fleetHallLevel: 1 });
    expect(out.ok === false && out.error).toBe('no-room');
  });

  it('refuses a DEFENCE — fleetmates send weapons', async () => {
    const out = await postRequest(ME, 'mine' as never, 0, { fleetHallLevel: 5 });
    expect(out.ok).toBe(false);
  });

  it('creates a request when everything is in order', async () => {
    state.held = [];
    const out = await postRequest(ME, 'bomber', 0, { fleetHallLevel: 5 });
    expect(out.ok).toBe(true);
    expect(state.created).toHaveLength(1);
  });
});

describe('fillRequest', () => {
  beforeEach(() => {
    state.open = [{ id: 'd1', fleetId: FLEET, requesterId: MATE, item: 'bomber', donorId: null }];
  });

  it('refuses a donor who cannot afford the commission', async () => {
    const out = await fillRequest(ME, 'd1', 100);
    expect(out.ok === false && out.error).toBe('insufficient-coins');
  });

  it('refuses filling your own', async () => {
    state.open = [{ id: 'd1', fleetId: FLEET, requesterId: ME, item: 'bomber', donorId: null }];
    expect((await fillRequest(ME, 'd1', 9_999)).ok).toBe(false);
  });

  it('refuses a request that is not in your fleet', async () => {
    const out = await fillRequest(ME, 'not-here', 9_999);
    expect(out.ok === false && out.error).toBe('not-found');
  });

  it('fills one, at the commission price', async () => {
    const out = await fillRequest(ME, 'd1', 9_999);
    expect(out.ok).toBe(true);
    expect(out.ok && out.body.cost).toBe(180);
  });
});

// ===========================================================================
// Wars
// ===========================================================================

describe('startWar', () => {
  const five = Array.from({ length: 5 }, (_, n) => ({
    userId: `m${n}`,
    renown: 800,
    optedIn: true,
  }));

  it('refuses an Officer or a Sailor — §1’s table', async () => {
    state.members[ME] = { fleetId: FLEET, role: 'officer' };
    state.optIns = five;
    const out = await startWar(ME, 5, 0);
    expect(out.ok === false && out.error).toBe('not-allowed');
  });

  it('allows a Commodore', async () => {
    state.members[ME] = { fleetId: FLEET, role: 'commodore' };
    state.optIns = five;
    expect((await startWar(ME, 5, 0)).ok).toBe(true);
  });

  it('refuses when too few have signed the articles', async () => {
    state.optIns = five.slice(0, 3);
    const out = await startWar(ME, 5, 0);
    expect(out.ok === false && out.error).toBe('not-allowed');
    expect(state.openedWars).toHaveLength(0);
  });

  it('does NOT count members who have not opted in', async () => {
    state.optIns = [
      ...five.slice(0, 2),
      ...Array.from({ length: 20 }, (_, n) => ({ userId: `q${n}`, renown: 100, optedIn: false })),
    ];
    expect((await startWar(ME, 5, 0)).ok).toBe(false);
  });

  it('refuses a second war while one is running', async () => {
    state.optIns = five;
    state.activeWar = 'war-1';
    const out = await startWar(ME, 5, 0);
    expect(out.ok === false && out.error).toBe('war-in-progress');
  });

  it('opens a search with the opted-in roster and their rating', async () => {
    state.optIns = [
      { userId: 'a', renown: 1_000, optedIn: true },
      { userId: 'b', renown: 900, optedIn: true },
      { userId: 'c', renown: 800, optedIn: true },
      { userId: 'd', renown: 700, optedIn: true },
      { userId: 'e', renown: 600, optedIn: true },
      { userId: 'weak', renown: 10, optedIn: false },
    ];
    const out = await startWar(ME, 5, 0);
    expect(out.ok).toBe(true);

    const opened = state.openedWars[0] as { rating: number; members: unknown[] };
    // The average of the five who signed, not of all six.
    expect(opened.rating).toBe(800);
    expect(opened.members).toHaveLength(5);
  });
});

describe('opting in', () => {
  it('refuses a player with no fleet', async () => {
    expect((await setOptIn('nobody', true)).ok).toBe(false);
  });

  it('works for a member', async () => {
    expect((await setOptIn(MATE, true)).ok).toBe(true);
  });
});

// ===========================================================================
// Friendly raids (§5)
// ===========================================================================

describe('checkFriendly', () => {
  it('allows a fleetmate', async () => {
    expect((await checkFriendly(ME, MATE)).ok).toBe(true);
  });

  it('refuses someone in another fleet', async () => {
    const out = await checkFriendly(ME, STRANGER);
    expect(out.ok === false && out.error).toBe('not-allowed');
  });

  it('refuses yourself', async () => {
    expect((await checkFriendly(ME, ME)).ok).toBe(false);
  });

  it('refuses when the feature is off', async () => {
    delete process.env.PORT_CITY_FLEETS;
    const out = await checkFriendly(ME, MATE);
    expect(out.ok === false && out.error).toBe('feature-off');
  });
});

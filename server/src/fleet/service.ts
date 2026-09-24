/**
 * The fleet service — part-08 §3, §4, §5.
 *
 * Nothing here decides a rule: `src/engine/fleets` does. This file moves state
 * between the database and the pure rules and turns a typed failure into an
 * HTTP answer, exactly like the city's and the raid's services.
 *
 * The two places it is doing real work rather than plumbing:
 *
 *   startWar()  runs the pairing. It asks the rules for the rating and the
 *               window, and asks the SQL to pair atomically — so two servers
 *               pairing the same two fleets leaves exactly one war.
 *   openWarRaid() and openFriendlyRaid() are the seam between Part 6's raid
 *               engine and Part 8's contexts. They are the ONLY places a
 *               reinforcement is consumed, and neither accepts 'ranked'.
 */
import {
  RAIDS_PER_MEMBER,
  canFill,
  canRaidFriendly,
  canRequest,
  canSearch,
  canStartWar,
  commissionCost,
  fillOutcome,
  findOpponent,
  hasRoomFor,
  raidPolicy,
  searchRating,
  usableReinforcements,
  type LayoutContext,
  type Reinforcement,
  type WarSize,
} from '@engine/fleets';
import type { ArsenalKind } from '@engine/types';

import { isEnabled } from '../features';
import { warSchedule } from './config';
import { fleetRepo } from './repo';

export type FleetApiError =
  | 'feature-off'
  | 'not-in-a-fleet'
  | 'not-allowed'
  | 'on-cooldown'
  | 'no-room'
  | 'already-filled'
  | 'insufficient-coins'
  | 'war-in-progress'
  | 'no-war'
  | 'not-found'
  | 'internal';

export type Outcome<T> =
  | { ok: true; body: T }
  | { ok: false; error: FleetApiError; detail?: string };

const fail = (error: FleetApiError, detail?: string): Outcome<never> => ({
  ok: false,
  error,
  ...(detail ? { detail } : {}),
});

export function fleetsEnabled(): boolean {
  return isEnabled('portCity.fleets');
}

// ---------------------------------------------------------------------------
// Donations (§3)
// ---------------------------------------------------------------------------

export async function postRequest(
  userId: string,
  item: ArsenalKind,
  now: number,
  context: { fleetHallLevel: number },
): Promise<Outcome<{ requested: true }>> {
  if (!fleetsEnabled()) return fail('feature-off');

  const repo = fleetRepo();
  const membership = await repo.membershipOf(userId);
  if (!membership) return fail('not-in-a-fleet');

  // §3 — one item, once every 30 minutes, and only a kit kind.
  const check = canRequest(item, await repo.lastRequestAt(userId), now);
  if (!check.ok) return fail('on-cooldown', check.reason ?? undefined);

  // ...and only if the slots can hold it when it arrives.
  const held = await repo.heldReinforcements(userId);
  const room = hasRoomFor(
    held.map(toReinforcement),
    item,
    context.fleetHallLevel,
  );
  if (!room.ok) return fail('no-room', room.reason ?? undefined);

  await repo.createRequest({
    id: crypto.randomUUID(),
    fleetId: membership.fleetId,
    userId,
    item,
  });
  return { ok: true, body: { requested: true } };
}

export async function fillRequest(
  donorId: string,
  donationId: string,
  donorCoins: number,
): Promise<Outcome<{ filled: true; cost: number }>> {
  if (!fleetsEnabled()) return fail('feature-off');

  const repo = fleetRepo();
  const membership = await repo.membershipOf(donorId);
  if (!membership) return fail('not-in-a-fleet');

  const open = await repo.openRequests(membership.fleetId);
  const request = open.find((r) => r.id === donationId);
  if (!request) return fail('not-found');

  const check = canFill(request, donorId, donorCoins);
  if (!check.ok) return fail(check.reason?.includes('costs') ? 'insufficient-coins' : 'already-filled', check.reason ?? undefined);

  const outcome = fillOutcome(request.item as ArsenalKind);
  const applied = await repo.fillRequest({
    donationId,
    donorId,
    costCoins: outcome.cost,
    donorSteel: outcome.donorSteel,
    donorMerit: outcome.donorMerit,
  });
  if (applied !== 'ok') {
    return fail(applied === 'insufficient-coins' ? 'insufficient-coins' : 'already-filled');
  }
  return { ok: true, body: { filled: true, cost: outcome.cost } };
}

export async function listRequests(userId: string) {
  const repo = fleetRepo();
  const membership = await repo.membershipOf(userId);
  if (!membership) return { requests: [], held: [], costs: {} as Record<string, number> };

  const [requests, held] = await Promise.all([
    repo.openRequests(membership.fleetId),
    repo.heldReinforcements(userId),
  ]);
  const costs: Record<string, number> = {};
  for (const r of requests) costs[r.item] = commissionCost(r.item as ArsenalKind);
  return { requests, held, costs };
}

/**
 * §3's ranked-integrity rule, at the service boundary.
 *
 * This is the ONLY function on the server that hands reinforcements to a
 * layout, and it refuses 'ranked' by asking the rules rather than by having
 * its own opinion. `donation_consume` refuses it a second time in SQL.
 */
export async function reinforcementsFor(
  userId: string,
  context: LayoutContext,
): Promise<readonly Reinforcement[]> {
  if (!fleetsEnabled()) return [];
  const held = (await fleetRepo().heldReinforcements(userId)).map(toReinforcement);
  return usableReinforcements(context, held);
}

export async function consumeReinforcements(
  userId: string,
  ids: readonly string[],
  context: LayoutContext,
): Promise<number> {
  if (!fleetsEnabled()) return 0;
  // Belt and braces: the rules refuse ranked, and so does the SQL.
  if (usableReinforcements(context, [{ id: 'probe', item: 'x', fuel: 0, donorId: 'd', filledAt: 0 }]).length === 0) {
    return 0;
  }
  let spent = 0;
  for (const id of ids) {
    if ((await fleetRepo().consumeReinforcement(id, userId, context)) === 'ok') spent++;
  }
  return spent;
}

function toReinforcement(row: { id: string; item: string; donorId: string | null; filledAt: number | null }): Reinforcement {
  return {
    id: row.id,
    item: row.item,
    fuel: safeCost(row.item),
    donorId: row.donorId ?? '',
    filledAt: row.filledAt ?? 0,
  };
}

function safeCost(item: string): number {
  try {
    return commissionCost(item as ArsenalKind) / 6;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Wars (§4)
// ---------------------------------------------------------------------------

export async function startWar(
  userId: string,
  size: WarSize,
  now: number,
): Promise<Outcome<{ warId: string; paired: boolean }>> {
  if (!fleetsEnabled()) return fail('feature-off');

  const repo = fleetRepo();
  const membership = await repo.membershipOf(userId);
  if (!membership) return fail('not-in-a-fleet');

  const permission = canStartWar(membership.role);
  if (!permission.ok) return fail('not-allowed', permission.reason ?? undefined);

  if (await repo.activeWarFor(membership.fleetId)) return fail('war-in-progress');

  // §4 — "average renown of the OPTED-IN members". The roster comes back with
  // each member's opt-in flag and their live renown, and `searchRating` is
  // what decides which of them actually sail.
  const roster = await repo.warOptIns(membership.fleetId);

  const check = canSearch(roster, size);
  if (!check.ok) return fail('not-allowed', check.reason ?? undefined);

  const rating = searchRating(roster, size);
  if (!rating) return fail('not-allowed', 'Not enough captains have signed the articles.');

  const warId = crypto.randomUUID();
  await repo.openWar({
    warId,
    fleetId: membership.fleetId,
    size,
    rating: rating.rating,
    members: rating.roster.map((m) => ({ userId: m.userId, renown: m.renown })),
  });

  // Try to pair at once; the scheduler's tick keeps trying afterwards.
  const paired = await tryPair(warId, membership.fleetId, size, rating.rating, now);
  return { ok: true, body: { warId, paired } };
}

/**
 * One pairing attempt. Shared by `startWar` and the scheduler, so a fleet that
 * arrives second is paired immediately and one that arrives first is paired on
 * the next tick — both through the same atomic `war_pair`.
 */
export async function tryPair(
  warId: string,
  fleetId: string,
  size: WarSize,
  rating: number,
  now: number,
): Promise<boolean> {
  const repo = fleetRepo();
  const queue = await repo.searchingWars(size);
  const me = { fleetId, size, rating, startedAt: now };

  const opponent = findOpponent(
    me,
    queue.filter((w) => w.warId !== warId).map((w) => ({
      fleetId: w.fleetId,
      size,
      rating: w.rating,
      startedAt: w.startedAt,
    })),
    now,
  );
  if (!opponent) return false;

  const other = queue.find((w) => w.fleetId === opponent.fleetId);
  if (!other) return false;

  const schedule = warSchedule(now);
  return repo.pairWars({
    warId,
    otherWarId: other.warId,
    prepEndsAt: schedule.prepEndsAt,
    battleEndsAt: schedule.battleEndsAt,
  });
}

export async function setWarHarbour(
  userId: string,
  layout: unknown,
): Promise<Outcome<{ saved: true }>> {
  if (!fleetsEnabled()) return fail('feature-off');
  const repo = fleetRepo();
  const membership = await repo.membershipOf(userId);
  if (!membership) return fail('not-in-a-fleet');

  const warId = await repo.activeWarFor(membership.fleetId);
  if (!warId) return fail('no-war');

  const war = await repo.loadWar(warId);
  // §4 — the war harbour is set during PREP. Once the battle day starts the
  // enemy is already firing at it, and editing it then would be cheating.
  if (!war || war.state !== 'prep') return fail('not-allowed', 'The prep day is over.');

  await repo.setWarHarbour(warId, userId, layout);
  return { ok: true, body: { saved: true } };
}

/** §4 — records one war raid, spending one of the member's two. */
export async function recordWarRaid(
  userId: string,
  input: { raidId: string; targetUserId: string; stars: number; destruction: number },
): Promise<Outcome<{ recorded: boolean; raidsLeft: number }>> {
  if (!fleetsEnabled()) return fail('feature-off');

  const repo = fleetRepo();
  const membership = await repo.membershipOf(userId);
  if (!membership) return fail('not-in-a-fleet');

  const warId = await repo.activeWarFor(membership.fleetId);
  if (!warId) return fail('no-war');

  const recorded = await repo.recordWarRaid({ warId, ...input, attackerId: userId });
  const members = await repo.warMembers(warId);
  const me = members.find((m) => m.userId === userId);

  // A war raid takes no loot and moves no renown — the policy says so, and
  // the raid settlement asks the policy rather than having its own opinion.
  void raidPolicy('war');

  return {
    ok: true,
    body: { recorded, raidsLeft: Math.max(0, RAIDS_PER_MEMBER - (me?.raidsUsed ?? 0)) },
  };
}

export async function setOptIn(userId: string, optIn: boolean): Promise<Outcome<{ optIn: boolean }>> {
  if (!fleetsEnabled()) return fail('feature-off');
  const repo = fleetRepo();
  if (!(await repo.membershipOf(userId))) return fail('not-in-a-fleet');
  await repo.setWarOptIn(userId, optIn);
  return { ok: true, body: { optIn } };
}

// ---------------------------------------------------------------------------
// Friendly raids (§5)
// ---------------------------------------------------------------------------

export async function checkFriendly(
  attackerId: string,
  defenderId: string,
): Promise<Outcome<{ allowed: true }>> {
  if (!fleetsEnabled()) return fail('feature-off');
  const repo = fleetRepo();
  const [mine, theirs] = await Promise.all([
    repo.membershipOf(attackerId),
    repo.membershipOf(defenderId),
  ]);
  const check = canRaidFriendly(
    mine?.fleetId ?? null,
    theirs?.fleetId ?? null,
    attackerId,
    defenderId,
  );
  return check.ok ? { ok: true, body: { allowed: true } } : fail('not-allowed', check.reason ?? undefined);
}

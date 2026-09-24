/**
 * The fleet's data-access seam — the same shape as the city's and the raid's.
 *
 * Everything the service and the scheduler need is behind this interface, so
 * the tests drive the REAL scheduler against a real Postgres (PGlite running
 * the real 0017) instead of a hand-written fake. That matters more here than
 * anywhere else in the package: "settling twice pays once" is a TRANSACTION
 * property, and a fake cannot prove it.
 */
import type {
  ChatMessage,
  DonationRequest,
  Fleet,
  FleetMember,
  FleetRole,
  MemberReward,
  War,
  WarMember,
  WarRaid,
  WarWinner,
} from '@engine/fleets';

import { db } from '../db';

export interface WarSettlementInput {
  readonly warId: string;
  readonly winner: WarWinner;
  readonly starsA: number;
  readonly starsB: number;
  readonly destructionA: number;
  readonly destructionB: number;
  readonly rewards: readonly MemberReward[];
}

export interface WarSettlementResult {
  readonly paid: boolean;
  readonly reason?: string;
  readonly members: number;
  readonly skipped: number;
}

export interface FleetRepo {
  // ---- fleets -------------------------------------------------------------
  loadFleet(fleetId: string): Promise<Fleet | null>;
  members(fleetId: string): Promise<readonly FleetMember[]>;
  membershipOf(userId: string): Promise<{ fleetId: string; role: FleetRole } | null>;
  createFleet(input: {
    fleetId: string;
    userId: string;
    name: string;
    description: string;
    badge: number;
    tint: number;
    policy: string;
    minRenown: number;
    costCoins: number;
  }): Promise<string>;
  leaveFleet(userId: string, successorId: string | null): Promise<string>;
  setRole(fleetId: string, userId: string, role: FleetRole): Promise<void>;
  removeMember(fleetId: string, userId: string): Promise<void>;

  // ---- chat ---------------------------------------------------------------
  postMessage(message: Omit<ChatMessage, 'at'> & { at: number }): Promise<void>;
  recentMessages(fleetId: string, limit: number): Promise<readonly ChatMessage[]>;
  recentBy(fleetId: string, userId: string, sinceMs: number): Promise<readonly number[]>;

  // ---- donations ----------------------------------------------------------
  openRequests(fleetId: string): Promise<readonly DonationRequest[]>;
  lastRequestAt(userId: string): Promise<number | null>;
  createRequest(input: { id: string; fleetId: string; userId: string; item: string }): Promise<void>;
  fillRequest(input: {
    donationId: string;
    donorId: string;
    costCoins: number;
    donorSteel: number;
    donorMerit: number;
  }): Promise<string>;
  heldReinforcements(userId: string): Promise<readonly DonationRequest[]>;
  consumeReinforcement(donationId: string, userId: string, context: string): Promise<string>;

  // ---- wars: the scheduler's four steps ------------------------------------
  advancePrep(): Promise<number>;
  advanceBattle(): Promise<number>;
  expireSearches(giveUpMs: number): Promise<number>;
  warsAwaitingSettlement(): Promise<readonly string[]>;
  settleWar(input: WarSettlementInput): Promise<WarSettlementResult>;

  // ---- wars: starting and fighting -----------------------------------------
  /** The queue of fleets currently searching, for the pairing. */
  searchingWars(size: number): Promise<readonly { warId: string; fleetId: string; rating: number; startedAt: number }[]>;
  openWar(input: {
    warId: string;
    fleetId: string;
    size: number;
    rating: number;
    members: readonly { userId: string; renown: number }[];
  }): Promise<void>;
  /** Pairs two searching wars into one. Returns false if either moved first. */
  pairWars(input: {
    warId: string;
    otherWarId: string;
    prepEndsAt: number;
    battleEndsAt: number;
  }): Promise<boolean>;
  activeWarFor(fleetId: string): Promise<string | null>;
  setWarHarbour(warId: string, userId: string, layout: unknown): Promise<void>;
  recordWarRaid(input: {
    warId: string;
    raidId: string;
    attackerId: string;
    targetUserId: string;
    stars: number;
    destruction: number;
  }): Promise<boolean>;
  setWarOptIn(userId: string, optIn: boolean): Promise<void>;
  /** §4 — the roster with each member's opt-in flag and live renown. */
  warOptIns(fleetId: string): Promise<readonly { userId: string; renown: number; optedIn: boolean }[]>;

  // ---- wars: reads ---------------------------------------------------------
  loadWar(warId: string): Promise<War | null>;
  warMembers(warId: string): Promise<readonly WarMember[]>;
  warRaids(warId: string): Promise<readonly WarRaid[]>;

  // ---- the Flag Hall -------------------------------------------------------
  recordFlag(userId: string, countryCode: string): Promise<boolean>;
  flagWall(userId: string): Promise<readonly { countryCode: string; firstAt: string }[]>;

  sweep(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

/** Same narrow seam as the city's and the raid's. Delete after regenerating. */
type LooseRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(): LooseRpc {
  const client = db();
  return client.rpc.bind(client) as unknown as LooseRpc;
}

async function call(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await rpc()(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

/**
 * `database.types.ts` is generated from the live schema and does not know
 * 0017's tables, so `.from('fleet')` types every column as `never` and a write
 * will not compile. This is the same narrow seam the city and raid repos
 * carry, widened to cover writes; it goes when the types are regenerated.
 */
interface LooseTable {
  select: (columns?: string) => LooseQuery;
  insert: (values: Record<string, unknown> | Record<string, unknown>[]) => Promise<unknown>;
  update: (values: Record<string, unknown>) => LooseQuery;
  delete: () => LooseQuery;
}

interface LooseQuery extends PromiseLike<{ data: unknown; error: unknown }> {
  eq: (column: string, value: unknown) => LooseQuery;
  is: (column: string, value: unknown) => LooseQuery;
  not: (column: string, op: string, value: unknown) => LooseQuery;
  gte: (column: string, value: unknown) => LooseQuery;
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery;
  limit: (n: number) => LooseQuery;
  maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
}

function table(name: string): LooseTable {
  return db().from(name as never) as unknown as LooseTable;
}

export const supabaseFleetRepo: FleetRepo = {
  async loadFleet(fleetId) {
    const { data } = await table('fleet').select('*').eq('id', fleetId).maybeSingle();
    return data ? toFleet(data as Record<string, unknown>) : null;
  },

  async members(fleetId) {
    const { data } = await table('fleet_member').select('*').eq('fleet_id', fleetId);
    return ((data as Record<string, unknown>[] | null) ?? []).map(toMember);
  },

  async membershipOf(userId) {
    const { data } = await table('fleet_member')
      .select('fleet_id, role')
      .eq('user_id', userId)
      .maybeSingle();
    const row = data as { fleet_id?: string; role?: string } | null;
    return row?.fleet_id ? { fleetId: row.fleet_id, role: row.role as FleetRole } : null;
  },

  async createFleet(input) {
    return String(
      await call('fleet_create', {
        p_fleet_id: input.fleetId,
        p_user_id: input.userId,
        p_name: input.name,
        p_description: input.description,
        p_badge: input.badge,
        p_tint: input.tint,
        p_policy: input.policy,
        p_min_renown: input.minRenown,
        p_cost_coins: input.costCoins,
      }),
    );
  },

  async leaveFleet(userId, successorId) {
    return String(await call('fleet_leave', { p_user_id: userId, p_successor_id: successorId }));
  },

  async setRole(fleetId, userId, role) {
    await table('fleet_member').update({ role }).eq('fleet_id', fleetId).eq('user_id', userId);
  },

  async removeMember(fleetId, userId) {
    await table('fleet_member').delete().eq('fleet_id', fleetId).eq('user_id', userId);
  },

  async postMessage(message) {
    await table('fleet_message').insert({
      fleet_id: message.fleetId,
      user_id: message.userId,
      kind: message.kind,
      code: message.code,
    });
  },

  async recentMessages(fleetId, limit) {
    const { data } = await table('fleet_message')
      .select('*')
      .eq('fleet_id', fleetId)
      .order('at', { ascending: false })
      .limit(limit);
    return ((data as Record<string, unknown>[] | null) ?? []).map(toMessage);
  },

  async recentBy(fleetId, userId, sinceMs) {
    const since = new Date(Date.now() - sinceMs).toISOString();
    const { data } = await table('fleet_message')
      .select('at')
      .eq('fleet_id', fleetId)
      .eq('user_id', userId)
      .gte('at', since)
      .order('at', { ascending: false });
    return ((data as { at: string }[] | null) ?? []).map((r) => Date.parse(r.at));
  },

  async openRequests(fleetId) {
    const { data } = await table('donation')
      .select('*')
      .eq('fleet_id', fleetId)
      .is('donor_id', null)
      .order('at', { ascending: false });
    return ((data as Record<string, unknown>[] | null) ?? []).map(toDonation);
  },

  async lastRequestAt(userId) {
    const { data } = await table('donation')
      .select('at')
      .eq('requester_id', userId)
      .order('at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as { at?: string } | null;
    return row?.at ? Date.parse(row.at) : null;
  },

  async createRequest(input) {
    await table('donation').insert({
      id: input.id,
      fleet_id: input.fleetId,
      requester_id: input.userId,
      item: input.item,
    });
  },

  async fillRequest(input) {
    return String(
      await call('donation_fill', {
        p_donation_id: input.donationId,
        p_donor_id: input.donorId,
        p_cost_coins: input.costCoins,
        p_donor_steel: input.donorSteel,
        p_donor_merit: input.donorMerit,
      }),
    );
  },

  async heldReinforcements(userId) {
    const { data } = await table('donation')
      .select('*')
      .eq('requester_id', userId)
      .not('filled_at', 'is', null)
      .is('consumed_at', null);
    return ((data as Record<string, unknown>[] | null) ?? []).map(toDonation);
  },

  async consumeReinforcement(donationId, userId, context) {
    return String(
      await call('donation_consume', {
        p_donation_id: donationId,
        p_user_id: userId,
        p_context: context,
      }),
    );
  },

  async advancePrep() {
    return Number(await call('war_advance_prep'));
  },

  async advanceBattle() {
    return Number(await call('war_advance_battle'));
  },

  async expireSearches(giveUpMs) {
    return Number(await call('war_expire_searches', { p_give_up_ms: giveUpMs }));
  },

  async warsAwaitingSettlement() {
    const { data } = await table('war').select('id').eq('state', 'settling');
    return ((data as { id: string }[] | null) ?? []).map((r) => r.id);
  },

  async settleWar(input) {
    const data = await call('settle_war', {
      p_war_id: input.warId,
      p_winner: input.winner,
      p_stars_a: input.starsA,
      p_stars_b: input.starsB,
      p_destruction_a: input.destructionA,
      p_destruction_b: input.destructionB,
      p_rewards: input.rewards,
    });
    const row = (data ?? {}) as { paid?: boolean; reason?: string; members?: number; skipped?: number };
    return {
      paid: row.paid === true,
      ...(row.reason ? { reason: row.reason } : {}),
      members: row.members ?? 0,
      skipped: row.skipped ?? 0,
    };
  },

  async searchingWars(size) {
    const { data } = await table('war')
      .select('id, fleet_a, rating, search_started_at')
      .eq('state', 'searching')
      .eq('size', size);
    return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
      warId: String(r.id),
      fleetId: String(r.fleet_a),
      rating: Number(r.rating ?? 0),
      startedAt: ms(r.search_started_at),
    }));
  },

  async openWar(input) {
    await call('war_open_search', {
      p_war_id: input.warId,
      p_fleet_id: input.fleetId,
      p_size: input.size,
      p_rating: input.rating,
      p_members: input.members,
    });
  },

  async pairWars(input) {
    return (
      (await call('war_pair', {
        p_war_id: input.warId,
        p_other_war_id: input.otherWarId,
        p_prep_ends_at: new Date(input.prepEndsAt).toISOString(),
        p_battle_ends_at: new Date(input.battleEndsAt).toISOString(),
      })) === true
    );
  },

  async activeWarFor(fleetId) {
    const data = await call('war_active_for', { p_fleet_id: fleetId });
    return data === null || data === undefined ? null : String(data);
  },

  async setWarHarbour(warId, userId, layout) {
    await table('war_member')
      .update({ harbour: layout })
      .eq('war_id', warId)
      .eq('user_id', userId);
  },

  async recordWarRaid(input) {
    return (
      (await call('war_record_raid', {
        p_war_id: input.warId,
        p_raid_id: input.raidId,
        p_attacker_id: input.attackerId,
        p_target_user_id: input.targetUserId,
        p_stars: input.stars,
        p_destruction: input.destruction,
      })) === true
    );
  },

  async setWarOptIn(userId, optIn) {
    await table('fleet_member').update({ war_opt_in: optIn }).eq('user_id', userId);
  },

  async warOptIns(fleetId) {
    const data = await call('fleet_war_roster', { p_fleet_id: fleetId });
    return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
      userId: String(r.user_id),
      renown: Number(r.renown ?? 0),
      optedIn: r.war_opt_in === true,
    }));
  },

  async loadWar(warId) {
    const { data } = await table('war').select('*').eq('id', warId).maybeSingle();
    return data ? toWar(data as Record<string, unknown>) : null;
  },

  async warMembers(warId) {
    const { data } = await table('war_member').select('*').eq('war_id', warId);
    return ((data as Record<string, unknown>[] | null) ?? []).map(toWarMember);
  },

  async warRaids(warId) {
    const { data } = await table('war_raid').select('*').eq('war_id', warId);
    return ((data as Record<string, unknown>[] | null) ?? []).map(toWarRaid);
  },

  async recordFlag(userId, countryCode) {
    return (await call('flag_record', { p_user_id: userId, p_country_code: countryCode })) === true;
  },

  async flagWall(userId) {
    const data = await call('flag_wall', { p_user_id: userId });
    return ((data as { country_code: string; first_at: string }[] | null) ?? []).map((r) => ({
      countryCode: r.country_code,
      firstAt: r.first_at,
    }));
  },

  async sweep() {
    await call('fleet_sweep_messages');
  },
};

// ---------------------------------------------------------------------------
// Row mappers — the SQL speaks snake_case, the rules speak camelCase
// ---------------------------------------------------------------------------

const ms = (v: unknown): number => (v ? Date.parse(String(v)) : 0);
const msOrNull = (v: unknown): number | null => (v ? Date.parse(String(v)) : null);

export function toFleet(r: Record<string, unknown>): Fleet {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description ?? ''),
    emblemBadge: Number(r.emblem_badge ?? 0),
    emblemTint: Number(r.emblem_tint ?? 0),
    policy: String(r.policy) as Fleet['policy'],
    minRenown: Number(r.min_renown ?? 0),
    createdAt: ms(r.created_at),
    archived: r.archived === true,
  };
}

export function toMember(r: Record<string, unknown>): FleetMember {
  return {
    userId: String(r.user_id),
    role: String(r.role) as FleetRole,
    joinedAt: ms(r.joined_at),
    merit: Number(r.merit ?? 0),
  };
}

export function toMessage(r: Record<string, unknown>): ChatMessage {
  return {
    fleetId: String(r.fleet_id),
    userId: String(r.user_id),
    kind: String(r.kind) as ChatMessage['kind'],
    code: String(r.code),
    at: ms(r.at),
  };
}

export function toDonation(r: Record<string, unknown>): DonationRequest {
  return {
    id: String(r.id),
    fleetId: String(r.fleet_id),
    requesterId: String(r.requester_id),
    item: String(r.item),
    at: ms(r.at),
    donorId: r.donor_id === null || r.donor_id === undefined ? null : String(r.donor_id),
    filledAt: msOrNull(r.filled_at),
    consumedAt: msOrNull(r.consumed_at),
  };
}

export function toWar(r: Record<string, unknown>): War {
  return {
    id: String(r.id),
    fleetA: String(r.fleet_a),
    fleetB: r.fleet_b === null || r.fleet_b === undefined ? null : String(r.fleet_b),
    size: Number(r.size) as War['size'],
    state: String(r.state) as War['state'],
    searchStartedAt: ms(r.search_started_at),
    prepEndsAt: msOrNull(r.prep_ends_at),
    battleEndsAt: msOrNull(r.battle_ends_at),
    settledAt: msOrNull(r.settled_at),
    starsA: Number(r.stars_a ?? 0),
    starsB: Number(r.stars_b ?? 0),
  };
}

export function toWarMember(r: Record<string, unknown>): WarMember {
  return {
    warId: String(r.war_id),
    userId: String(r.user_id),
    fleetId: String(r.fleet_id),
    renown: Number(r.renown ?? 0),
    raidsUsed: Number(r.raids_used ?? 0),
  };
}

export function toWarRaid(r: Record<string, unknown>): WarRaid {
  return {
    warId: String(r.war_id),
    raidId: String(r.raid_id),
    attackerId: String(r.attacker_id),
    targetUserId: String(r.target_user_id),
    stars: Number(r.stars ?? 0),
    destruction: Number(r.destruction ?? 0),
    finishedAt: ms(r.finished_at),
  };
}

// ---------------------------------------------------------------------------
// The injection hook, following the convention in auth.ts / city / raid.
// ---------------------------------------------------------------------------

let active: FleetRepo = supabaseFleetRepo;

export function fleetRepo(): FleetRepo {
  return active;
}

export function __setFleetRepoForTests(repo: FleetRepo | null): void {
  active = repo ?? supabaseFleetRepo;
}

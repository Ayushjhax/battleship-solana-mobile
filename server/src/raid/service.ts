/**
 * The raid service — part-06 §5, §6, §7.
 *
 * Nothing here decides what a raid is worth: src/engine/raid does. This file
 * moves state between the database and the pure rules, and turns a typed error
 * into an HTTP answer.
 *
 * THE THREE HARD RULES, and where each one is kept:
 *
 *   the layout never leaves the server   every response is built from
 *                                        session.view(), which is raidView()
 *   rank points are untouched            nothing here reads or writes
 *                                        rank_points; settle_raid does not
 *                                        mention the column
 *   renown is a separate ladder          settleRenown() in the engine, applied
 *                                        by settle_raid into public.renown
 *   below Admiralty 3, neither side      searchTargets() refuses the caller and
 *                                        raid_search filters the candidates
 */
import {
  RAID_MIN_ADMIRALTY,
  allocateLoss,
  coveLevelFor,
  covePool,
  generateCoveHarbour,
  generateDefaultHarbour,
  lootEarned,
  lootPool,
  renownOffer,
  renownWindow,
  searchCost,
  settleRenown,
  shieldHours,
  validateHarbour,
  validateKit,
  type HarbourLayout,
  type KitCounts,
} from '@engine/raid';
import type { RaidView } from '@engine/raid';
import { terrainForSea } from '@engine/terrain';

import { isEnabled } from '../features';
import { RAID_ENGINE_VERSION, raidConfig, raidLimits } from './config';
import { buildReplay } from './replay';
import { raidRepo, type DefenceLogRow, type DefenderSnapshot, type DrainEntry, type TargetRow } from './repo';
import {
  RaidSession,
  dropSession,
  getSession,
  putSession,
  sessionForAttacker,
  staleSessions,
  type SessionTarget,
} from './session';

export type RaidApiError =
  | 'feature-off'
  | 'no-profile'
  | 'needs-admiralty'
  | 'no-harbour'
  | 'bad-harbour'
  | 'bad-kit'
  | 'insufficient-coins'
  | 'target-locked'
  | 'raid-in-progress'
  | 'no-session'
  | 'not-found'
  | 'rate-limited'
  | 'internal';

const STATUS: Record<RaidApiError, number> = {
  'feature-off': 409,
  'no-profile': 404,
  'needs-admiralty': 409,
  'no-harbour': 409,
  'bad-harbour': 409,
  'bad-kit': 409,
  'insufficient-coins': 409,
  'target-locked': 409,
  'raid-in-progress': 409,
  'no-session': 409,
  'not-found': 404,
  'rate-limited': 409,
  internal: 503,
};

export function statusFor(error: RaidApiError): number {
  return STATUS[error] ?? 409;
}

export type Outcome<T> = { ok: true; body: T } | { ok: false; error: RaidApiError; detail?: string };

function fail(error: RaidApiError, detail?: string): Outcome<never> {
  return { ok: false, error, ...(detail ? { detail } : {}) };
}

export function raidsEnabled(): boolean {
  return isEnabled('portCity.raids');
}

// ---------------------------------------------------------------------------
// The harbour (§3)
// ---------------------------------------------------------------------------

export interface HarbourContextInput {
  readonly admiraltyLevel: number;
  readonly coastalCommandLevel: number;
  readonly unlocks: readonly string[];
  /** Part 10B — the Lighthouse level, which gates the seas a harbour may use. */
  readonly lighthouseLevel: number;
}

export async function saveHarbour(
  userId: string,
  layout: HarbourLayout,
  context: HarbourContextInput,
): Promise<Outcome<{ fuelUsed: number }>> {
  if (!raidsEnabled()) return fail('feature-off');

  const check = validateHarbour(layout, context);
  if (!check.ok) {
    // §10 — "an invalid harbour is refused, and the last valid one keeps
    // defending". Refusing is literally not writing: the stored row stands.
    return check.error === 'needs-admiralty'
      ? fail('needs-admiralty', check.detail)
      : fail('bad-harbour', check.detail);
  }

  await raidRepo().saveHarbour(userId, layout, check.fuelUsed);
  return { ok: true, body: { fuelUsed: check.fuelUsed } };
}

/**
 * §3 — "when raids unlock, the server generates a legal default harbour ... so
 * nobody is ever raidable with an empty board". Called on first read, so a
 * defender always has something, and never overwrites a saved one.
 */
export async function ensureHarbour(
  userId: string,
  context: HarbourContextInput,
  seed: number,
): Promise<HarbourLayout | null> {
  const stored = await raidRepo().loadHarbour(userId);
  if (stored && stored.valid) return stored.layout;
  if (context.admiraltyLevel < RAID_MIN_ADMIRALTY) return null;

  const generated = generateDefaultHarbour(seed, context);
  const check = validateHarbour(generated, context);
  if (!check.ok) return null;
  await raidRepo().saveHarbour(userId, generated, check.fuelUsed);
  return generated;
}

// ---------------------------------------------------------------------------
// The search (§5)
// ---------------------------------------------------------------------------

export interface TargetCard {
  readonly kind: 'player' | 'cove';
  readonly userId: string | null;
  readonly coveSeed: number | null;
  readonly name: string;
  readonly avatarId: number;
  readonly avatarColor: string;
  readonly countryCode: string | null;
  readonly admiraltyLevel: number;
  readonly renown: number;
  readonly loot: { coins: number; steel: number };
  /** "+X for 3 stars / -Y for 0" (§5). A cove advertises 0/0, honestly. */
  readonly renownOffer: { best: number; worst: number };
  readonly costCoins: number;
}

export interface SearchInput {
  readonly userId: string;
  readonly admiraltyLevel: number;
  readonly renown: number;
  readonly searchesThisSession: number;
  /** Injected by tests and by the sweeper; random in production. */
  readonly coveSeed?: number;
}

/**
 * §5's eligibility, in the doc's order. Widening is done by RE-QUERYING with a
 * wider window rather than fetching everything and filtering in memory: the
 * index is on renown, and a popular server should never scan the table.
 */
export async function searchTargets(input: SearchInput): Promise<Outcome<{ card: TargetCard }>> {
  if (!raidsEnabled()) return fail('feature-off');
  if (input.admiraltyLevel < RAID_MIN_ADMIRALTY) {
    return fail('needs-admiralty', `raids unlock at Admiralty ${RAID_MIN_ADMIRALTY}`);
  }

  const limits = raidLimits();
  const repo = raidRepo();
  await repo.sweep();

  // Widen from where this session already is, then keep widening, then uncap.
  for (let step = input.searchesThisSession; step <= 8; step++) {
    const window = renownWindow(step);
    const rows = await repo.search({
      userId: input.userId,
      renown: input.renown,
      window,
      minAdmiralty: RAID_MIN_ADMIRALTY,
      repeatHours: limits.repeatHours,
      limit: limits.searchCandidates,
    });
    if (rows.length > 0) {
      const chosen = rows[0] as TargetRow;
      const defender = await repo.loadDefender(chosen.userId);
      const pool = defender
        ? lootPool({
            coins: defender.coins,
            steel: defender.steel,
            storedCoins: defender.storedCoins,
            storedSteel: defender.storedSteel,
            scrapPile: defender.scrapPile,
            admiraltyLevel: defender.admiraltyLevel,
          })
        : { coins: 0, steel: 0 };

      return {
        ok: true,
        body: {
          card: {
            kind: 'player',
            userId: chosen.userId,
            coveSeed: null,
            name: chosen.name,
            avatarId: chosen.avatarId,
            avatarColor: chosen.avatarColor,
            countryCode: chosen.countryCode,
            admiraltyLevel: chosen.admiraltyLevel,
            renown: chosen.renown,
            loot: pool,
            renownOffer: renownOffer(input.renown, chosen.renown),
            costCoins: searchCost(input.admiraltyLevel),
          },
        },
      };
    }
    if (window === null) break; // already uncapped: nobody is out there
  }

  // §5.4 — "if nothing fits after the widening, return a Pirate cove."
  return { ok: true, body: { card: coveCard(input) } };
}

/** §5 — labelled as a pirate cove, never disguised as a person. */
export function coveCard(input: SearchInput): TargetCard {
  const seed = input.coveSeed ?? Math.floor(Math.random() * 2 ** 31);
  return {
    kind: 'cove',
    userId: null,
    coveSeed: seed,
    name: 'Pirate cove',
    avatarId: 0,
    avatarColor: 'charcoal',
    countryCode: null,
    admiraltyLevel: coveLevelFor(input.renown),
    renown: 0,
    loot: covePool(input.renown),
    // Honest: a cove moves no renown, and the card says so.
    renownOffer: { best: 0, worst: 0 },
    costCoins: searchCost(input.admiraltyLevel),
  };
}

// ---------------------------------------------------------------------------
// Opening a raid (§5, §6)
// ---------------------------------------------------------------------------

export interface OpenInput {
  readonly attackerId: string;
  readonly raidId: string;
  readonly card: TargetCard;
  readonly kit: KitCounts;
  readonly armoryLevel: number;
  readonly admiraltyLevel: number;
  readonly unlocks: readonly string[];
  readonly renown: number;
  readonly dropShield: boolean;
  readonly requestId?: string;
  readonly now: number;
}

export interface OpenBody {
  readonly raidId: string;
  readonly target: SessionTarget;
  readonly view: RaidView;
  readonly serverNow: number;
}

export async function openRaid(input: OpenInput): Promise<Outcome<OpenBody>> {
  if (!raidsEnabled()) return fail('feature-off');
  if (input.admiraltyLevel < RAID_MIN_ADMIRALTY) return fail('needs-admiralty');

  const kitCheck = validateKit(input.kit, {
    armoryLevel: input.armoryLevel,
    unlocks: input.unlocks,
  });
  if (!kitCheck.ok) return fail('bad-kit', kitCheck.detail);

  // A card is what /raid/search returned, not a claim to be trusted. The
  // server refuses a target the search would never deal (yourself, or a cove
  // with no seed) and re-derives the price rather than believing the body.
  if (input.card.kind === 'cove') {
    if (input.card.coveSeed === null || input.card.coveSeed === undefined) return fail('not-found');
  } else if (!input.card.userId || input.card.userId === input.attackerId) {
    return fail('not-found');
  }

  if (sessionForAttacker(input.attackerId)) return fail('raid-in-progress');

  const repo = raidRepo();
  const limits = raidLimits();

  // The layout is read HERE and never again: §11's concurrency case is "a
  // defender editing their harbour mid-raid does not change the raid".
  let layout: HarbourLayout;
  if (input.card.kind === 'cove') {
    layout = generateCoveHarbour(input.card.coveSeed ?? 0, input.renown);
  } else {
    const stored = await repo.loadHarbour(input.card.userId ?? '');
    if (!stored || !stored.valid) return fail('no-harbour');
    layout = stored.layout;
  }

  // Part 10B — the defender's sea is snapshotted into the raid config, so a
  // replay uses the terrain the raid actually ran on.
  const config = { ...raidConfig(), terrain: terrainForSea(layout.sea ?? 'open') };

  const opened = await repo.open({
    raidId: input.raidId,
    attackerId: input.attackerId,
    defenderId: input.card.kind === 'cove' ? null : input.card.userId,
    coveSeed: input.card.kind === 'cove' ? input.card.coveSeed : null,
    costCoins: searchCost(input.admiraltyLevel),
    lockMinutes: limits.lockMinutes,
    dropShield: input.dropShield,
    layout,
    kit: input.kit,
    config,
    engineVersion: RAID_ENGINE_VERSION,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    response: { raidId: input.raidId },
  });

  if (opened === 'target-locked') return fail('target-locked');
  if (opened === 'insufficient-coins') return fail('insufficient-coins');
  if (opened === 'raid-in-progress') return fail('raid-in-progress');
  // 'replay': the coins were already taken for this requestId. The raid row
  // exists; the session may not, if the process restarted. Either way the
  // caller must not be charged twice, so this is not an error.

  const target: SessionTarget = {
    kind: input.card.kind,
    defenderId: input.card.kind === 'cove' ? null : input.card.userId,
    coveSeed: input.card.coveSeed,
    name: input.card.name,
    admiraltyLevel: input.card.admiraltyLevel,
    // A cove's pool scales with the SEARCHER's renown, which is server-side.
    // Believing the card here would let a client inflate its own payout.
    renown: input.card.kind === 'cove' ? input.renown : input.card.renown,
  };

  const session = new RaidSession({
    raidId: input.raidId,
    attackerId: input.attackerId,
    target,
    layout,
    kit: input.kit,
    config,
    now: input.now,
    limits,
  });
  putSession(session);

  return {
    ok: true,
    body: { raidId: session.raidId, target, view: session.view(input.now), serverNow: input.now },
  };
}

// ---------------------------------------------------------------------------
// Settlement (§7)
// ---------------------------------------------------------------------------

export interface SettlementBody {
  readonly raidId: string;
  readonly stars: number;
  readonly destruction: number;
  readonly endReason: string;
  readonly earned: { coins: number; steel: number; starBonusSteel: number };
  readonly taken: { coins: number; steel: number };
  readonly renown: { before: number; after: number; delta: number };
  readonly shieldHours: number;
  /** §8 — the full layout, but only now that it is over. */
  readonly reveal: unknown;
  readonly view: RaidView;
}

/**
 * §7.5 — "everything above happens in ONE transaction". Everything this
 * function does before calling repo.settle() is arithmetic; the single write
 * is settle_raid, which is also what makes settling twice credit once.
 */
export async function settle(
  raidId: string,
  attackerId: string,
  now: number,
  reason?: 'time' | 'disconnect',
): Promise<Outcome<SettlementBody>> {
  if (!raidsEnabled()) return fail('feature-off');

  const session = getSession(raidId, attackerId);
  if (!session) return fail('no-session');

  const repo = raidRepo();
  const final = session.close(now, reason);
  const isCove = session.target.kind === 'cove';

  const defender: DefenderSnapshot | null =
    isCove || !session.target.defenderId ? null : await repo.loadDefender(session.target.defenderId);

  const pool = isCove
    ? covePool(session.target.renown)
    : defender
      ? lootPool({
          coins: defender.coins,
          steel: defender.steel,
          storedCoins: defender.storedCoins,
          storedSteel: defender.storedSteel,
          scrapPile: defender.scrapPile,
          admiraltyLevel: defender.admiraltyLevel,
        })
      : { coins: 0, steel: 0 };

  const loot = lootEarned(pool, final, { cove: isCove });

  // Where the defender's loss actually comes from, and in what order (§7.2).
  const allocation = defender
    ? allocateLoss(
        {
          coins: defender.coins,
          steel: defender.steel,
          storedCoins: defender.storedCoins,
          storedSteel: defender.storedSteel,
          scrapPile: defender.scrapPile,
        },
        loot,
      )
    : null;

  const drain: DrainEntry[] = [];
  if (defender && allocation) {
    spread(drain, defender.coinBuildings, allocation.fromStoredCoins, 'coins');
    spread(drain, defender.steelBuildings, allocation.fromStoredSteel, 'steel');
    if (allocation.fromScrap > 0) {
      drain.push({ building: 'scrap', resource: 'steel', amount: allocation.fromScrap });
    }
  }

  const attackerRenownBefore = await currentRenown(attackerId);
  const renown = settleRenown(
    attackerRenownBefore,
    defender?.renown ?? 0,
    final.stars,
    { cove: isCove },
  );

  const shield = isCove ? 0 : shieldHours(final.destruction);

  const applied = await repo.settle({
    raidId,
    stars: final.stars,
    destruction: round4(final.destruction),
    shellsLeft: final.shellsLeft,
    endReason: final.endReason,
    earnedCoins: loot.earnedCoins,
    earnedSteel: loot.earnedSteel,
    drain,
    walletCoins: allocation?.fromCoins ?? 0,
    walletSteel: allocation?.fromSteel ?? 0,
    renownAttacker: renown.attacker.after,
    renownDefender: renown.defender.after,
    shieldHours: shield,
    actions: session.actions,
    results: session.results,
  });

  dropSession(raidId);

  // §11 Concurrency — "a raid settling twice credits once". The second call
  // gets applied:false from the SQL and returns the same shape with zeros, so
  // a retrying client is never told the raid failed.
  const taken = applied.applied
    ? { coins: applied.takenCoins, steel: applied.takenSteel }
    : { coins: 0, steel: 0 };

  return {
    ok: true,
    body: {
      raidId,
      stars: final.stars,
      destruction: final.destruction,
      endReason: final.endReason,
      earned: {
        coins: applied.applied ? loot.earnedCoins : 0,
        steel: applied.applied ? loot.earnedSteel : 0,
        starBonusSteel: loot.starBonusSteel,
      },
      taken,
      renown: renown.attacker,
      shieldHours: shield,
      reveal: session.finalReveal(),
      view: session.view(now),
    },
  };
}

/** Drains buildings in order, largest store first — fewest touched. */
function spread(
  out: DrainEntry[],
  buildings: readonly { id: string; stored: number }[],
  total: number,
  resource: 'coins' | 'steel',
): void {
  let left = total;
  const ordered = [...buildings].sort((a, b) => b.stored - a.stored);
  for (const building of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, building.stored);
    if (take <= 0) continue;
    out.push({ building: building.id, resource, amount: take });
    left -= take;
  }
}

/**
 * The attacker's own renown, read at SETTLE time rather than carried from the
 * search: a raider may have lost renown elsewhere in the four minutes, and the
 * ladder has to move from where they actually are.
 *
 * `loadDefender` is a snapshot of any user, not only a defender; the name is
 * about where it is used, not who it may be called on.
 */
async function currentRenown(userId: string): Promise<number> {
  const row = await raidRepo().loadDefender(userId);
  return row?.renown ?? 0;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * §6 — the sweeper. A raid whose clock ran out, or whose attacker has been
 * gone for more than 60 s, settles with what it had. Called on a timer and
 * opportunistically from the routes, so a single-process deployment needs no
 * extra machinery.
 */
export async function sweepRaids(now: number): Promise<number> {
  if (!raidsEnabled()) return 0;
  let settled = 0;
  for (const session of staleSessions(now)) {
    const reason = session.over ? undefined : session.expired(now) ? 'time' : 'disconnect';
    const out = await settle(session.raidId, session.attackerId, now, reason);
    if (out.ok) settled++;
    else dropSession(session.raidId);
  }
  return settled;
}


// ---------------------------------------------------------------------------
// The defence log and the replay — part-07 §4, §5
// ---------------------------------------------------------------------------

/** §4 — "Keep the last 30." */
export const DEFENCE_LOG_LIMIT = 30;

export async function defenceLog(
  userId: string,
): Promise<Outcome<{ entries: readonly DefenceLogRow[] }>> {
  if (!raidsEnabled()) return fail('feature-off');
  return { ok: true, body: { entries: await raidRepo().defenceLog(userId, DEFENCE_LOG_LIMIT) } };
}

export async function markDefenceLogRead(
  userId: string,
  raidIds: readonly string[],
): Promise<Outcome<{ marked: number }>> {
  if (!raidsEnabled()) return fail('feature-off');
  return { ok: true, body: { marked: await raidRepo().markLogRead(userId, raidIds) } };
}

/**
 * §8.6 — the server half of "exactly once per incoming raid". An atomic
 * `update ... where revenge_taken = false` returning whether it moved a row,
 * so two taps in flight cannot both win.
 */
export async function claimRevenge(
  userId: string,
  raidId: string,
): Promise<Outcome<{ free: boolean }>> {
  if (!raidsEnabled()) return fail('feature-off');
  return { ok: true, body: { free: await raidRepo().claimRevenge(userId, raidId) } };
}

/**
 * §5 — the replay. The SQL already refuses a raid the caller was not part of,
 * so a `null` here is either "no such raid" or "not yours", and both answer
 * `not-found`: telling a stranger which of the two it is would leak that a
 * raid exists.
 */
export async function raidReplay(
  raidId: string,
  userId: string,
): Promise<Outcome<Record<string, unknown>>> {
  if (!raidsEnabled()) return fail('feature-off');

  const stored = await raidRepo().loadReplay(raidId, userId);
  if (!stored) return fail('not-found');

  const built = buildReplay(stored, userId);
  if (!built.ok) {
    return fail(built.error === 'still-running' ? 'no-session' : 'not-found');
  }

  const { replay } = built;
  return {
    ok: true,
    body: {
      raidId: replay.raidId,
      mode: replay.mode,
      viewer: replay.viewer,
      actions: replay.actions,
      ...(replay.results ? { results: replay.results } : {}),
      stars: replay.stars,
      destruction: replay.destruction,
      endReason: replay.endReason,
      layout: replay.layout,
      kit: stored.kit,
      config: stored.config,
    },
  };
}

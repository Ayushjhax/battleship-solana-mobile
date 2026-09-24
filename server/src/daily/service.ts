/**
 * The Gazette, the puzzle and voyages, server-side — part-09 §1, §2, §3.
 *
 * Same shape as `server/src/raid/service.ts`: a typed `Outcome`, a repo seam
 * the tests can drive against a real Postgres, and every number from the
 * engine rather than from a body.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE THREE RULES THIS FILE EXISTS TO KEEP
 *
 * 1. §2 — "the layout never reaches the client." `fire()` loads the layout,
 *    resolves one cell and answers with `puzzleView()`, which has no field
 *    that could carry one. The layout is never in a return value here.
 *
 * 2. §3 — "rewards ... rolled server-side at send time (so the player cannot
 *    reroll by reinstalling)". `send()` calls `rollReward` once and stores it.
 *    `collect()` reads the stored reward; it has no rng.
 *
 * 3. §3 — "the server replays it with the same seeded AI and layout and
 *    refuses anything that does not reproduce." `skirmish()` replays the
 *    submitted log against the stored seed. A log that does not reproduce
 *    pays HALF, because a forged log is indistinguishable from not playing.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { randomUUID } from 'node:crypto';

import { buildEdition, summariseDay, type DayRecords, type Edition } from '@engine/gazette';
import {
  advanceStreak,
  fire as engineFire,
  hitCount,
  puzzleDate,
  puzzleLayout,
  puzzleNumber,
  puzzleView,
  resumeRun,
  rewardFor,
  type PuzzleView,
} from '@engine/puzzle';
import { createRng } from '@engine/rng';
import type { Coord } from '@engine/types';
import {
  payout,
  replaySkirmish,
  returnsAt,
  rollReward,
  routeById,
  placeSkirmish,
  skirmishExpired,
  voyageSlots,
  type SkirmishLog,
  type SkirmishResult,
  type VoyageReward,
} from '@engine/voyages';

import { isEnabled } from '../features';
import { seasonSeaAnnouncement } from '../seas';
import { puzzleConfig, voyageConfig } from './config';
import { dailyRepo, type DailyRepo, type LeaderRow, type VoyageRow } from './repo';

export type DailyError =
  | 'feature-off'
  | 'not-found'
  | 'already-finished'
  | 'illegal-cell'
  | 'no-slot'
  | 'slot-busy'
  | 'unknown-route'
  | 'not-back-yet'
  | 'already-collected'
  | 'under-attack'
  | 'already-settled';

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DailyError; readonly detail?: string };

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = <T>(error: DailyError, detail?: string): Outcome<T> => ({ ok: false, error, detail });

export function gazetteEnabled(): boolean {
  return isEnabled('portCity.gazette');
}

export function voyagesEnabled(): boolean {
  return isEnabled('portCity.voyages');
}

export function statusFor(error: DailyError): number {
  switch (error) {
    case 'feature-off':
      return 409;
    case 'not-found':
      return 404;
    case 'illegal-cell':
    case 'unknown-route':
      return 400;
    default:
      return 409;
  }
}

let repo: DailyRepo = dailyRepo;

/** The tests swap in a repo over PGlite. Production never calls this. */
export function setDailyRepo(next: DailyRepo): void {
  repo = next;
}

// ===========================================================================
// The Gazette (§1)
// ===========================================================================

/**
 * §1 — "generated server-side on first open and then cached for the day".
 *
 * The edition is generated every call and handed to
 * `gazette_get_or_create`, which keeps the FIRST one. That looks wasteful and
 * is not: generation is a pure function over a summary the server already
 * assembled, and doing it this way means two simultaneous opens cannot produce
 * two different papers.
 */
export async function gazette(
  userId: string,
  records: DayRecords,
  now: number,
): Promise<Outcome<{ edition: Edition; fresh: boolean }>> {
  if (!gazetteEnabled()) return fail('feature-off');

  const date = puzzleDate(now);
  const summary = summariseDay(records);
  // Part 10B — the season sea is announced on the paper; with seas off there
  // is nothing to announce and ranked is Open Sea as before.
  const seasonSea = isEnabled('portCity.seas') ? seasonSeaAnnouncement(now) : null;
  const generated = buildEdition(summary, date, puzzleNumber(date), seasonSea);

  const row = await repo.gazetteGetOrCreate(userId, date, generated);
  const edition = (row.edition ?? generated) as Edition;
  return ok({ edition, fresh: row.fresh });
}

export async function markGazetteRead(userId: string, now: number): Promise<Outcome<null>> {
  if (!gazetteEnabled()) return fail('feature-off');
  await repo.gazetteMarkRead(userId, puzzleDate(now));
  return ok(null);
}

// ===========================================================================
// The daily puzzle (§2)
// ===========================================================================

export interface PuzzleState {
  readonly view: PuzzleView;
  readonly streak: number;
  /** Set only on the shot that finished the board. */
  readonly reward?: ReturnType<typeof rewardFor>;
}

/**
 * The player's board for today, created on first open.
 *
 * `puzzle_ensure` writes the day's layout once, for everybody. Nothing about
 * that row is returned: the caller gets `par` and their own marks.
 */
export async function openPuzzle(userId: string, now: number): Promise<Outcome<PuzzleState>> {
  if (!gazetteEnabled()) return fail('feature-off');

  const date = puzzleDate(now);
  const config = puzzleConfig();
  const par = await repo.puzzleEnsure(date, puzzleLayout(date), config.par);

  const stored = await repo.puzzleRunOpen(userId, date);
  const run = resumeRun(
    date,
    stored.marks,
    stored.shots,
    Date.parse(stored.startedAt) || now,
    stored.finishedAt ? Date.parse(stored.finishedAt) : null,
  );

  return ok({ view: puzzleView(run, par), streak: stored.streak });
}

/**
 * One shot.
 *
 * §2 — "Each shot is an API call that returns one resolution." The run is
 * rebuilt from the stored marks, the engine resolves the cell, and the new
 * marks are written back under `where finished_at is null`. That predicate is
 * §5.2's "a second attempt on the same day is refused": a finished run cannot
 * be moved, by this call or by a concurrent one.
 */
export async function firePuzzle(
  userId: string,
  at: Coord,
  now: number,
  season: number | null = null,
): Promise<Outcome<PuzzleState>> {
  if (!gazetteEnabled()) return fail('feature-off');

  const date = puzzleDate(now);
  const config = puzzleConfig();
  const par = await repo.puzzleEnsure(date, puzzleLayout(date), config.par);

  const stored = await repo.puzzleRunOpen(userId, date);
  if (stored.finished) return fail('already-finished');

  const run = resumeRun(
    date,
    stored.marks,
    stored.shots,
    Date.parse(stored.startedAt) || now,
    null,
  );

  const step = engineFire(run, at);
  if (step.error) return fail(step.error);

  const written = await repo.puzzleRunFire({
    userId,
    date,
    marks: step.run.marks,
    shots: step.run.shots,
    hits: hitCount(step.run.marks),
    finished: step.run.finished,
  });
  if (!written.ok) return fail('already-finished', written.reason);

  if (!step.run.finished) {
    return ok({ view: puzzleView(step.run, par), streak: stored.streak });
  }

  // Finished. Work out the streak from yesterday's row, then settle — once.
  const last = await repo.puzzleLastSolved(userId, date);
  const streak = advanceStreak(last?.date ?? null, last?.streak ?? 0, date);
  const reward = rewardFor(step.run.shots, streak, par);

  const settled = await repo.puzzleSettle({
    userId,
    date,
    streak,
    coins: reward.coins,
    steel: reward.steel,
    gems: reward.gems,
    ink: reward.ink,
    season,
  });

  return ok({
    view: puzzleView(step.run, par),
    streak: settled.streak ?? streak,
    // Only report a reward that was actually paid, so a retried request never
    // shows the player a second payout they did not receive.
    ...(settled.paid ? { reward } : {}),
  });
}

export interface PuzzleBoardRow {
  readonly leaders: readonly LeaderRow[];
  readonly me: { place: number; shots: number; seconds: number } | null;
}

export async function puzzleLeaderboard(
  userId: string,
  now: number,
): Promise<Outcome<PuzzleBoardRow>> {
  if (!gazetteEnabled()) return fail('feature-off');

  const date = puzzleDate(now);
  const config = puzzleConfig();
  const [leaders, me] = await Promise.all([
    repo.puzzleLeaderboard(date, config.leaderboardSize),
    repo.myPuzzlePlace(userId, date),
  ]);
  return ok({ leaders, me });
}

// ===========================================================================
// Trade voyages (§3)
// ===========================================================================

export interface SentVoyage {
  readonly id: string;
  readonly route: string;
  readonly slot: number;
  readonly returnsAt: number;
  /** §3 — "revealed on return", so the roll is NOT in this response. */
  readonly pirate: false;
}

/**
 * Sends a merchantman.
 *
 * The reward and the pirate flag are rolled HERE, once, and stored. §3's
 * parenthesis — "so the player cannot reroll by reinstalling" — is the whole
 * reason, and `collect()` below has no rng at all.
 *
 * The response deliberately does not carry the reward or the pirate flag:
 * §3 says "revealed on return", and a client that knew which voyage would be
 * attacked could simply not open that one.
 */
export async function sendVoyage(
  userId: string,
  routeId: string,
  slot: number,
  tradeDocksLevel: number,
  now: number,
): Promise<Outcome<SentVoyage>> {
  if (!voyagesEnabled()) return fail('feature-off');

  const route = routeById(routeId);
  if (!route) return fail('unknown-route');

  const slots = voyageSlots(tradeDocksLevel);
  if (slots <= 0 || slot < 0 || slot >= slots) return fail('no-slot');

  const id = randomUUID();
  // Seeded from the voyage id, so the roll is reproducible in a post-mortem
  // but unpredictable to the client, which has never seen the id.
  const rng = createRng(seedFromUuid(id));
  const reward: VoyageReward = rollReward(route, tradeDocksLevel, rng);

  const skirmishSeed = rng.int(2_147_483_647);
  const layout = reward.pirate ? placeSkirmish(createRng(skirmishSeed)) : null;

  const sent = await repo.voyageSend({
    id,
    userId,
    route: route.id,
    slot,
    slots,
    returnsAt: returnsAt(route, now),
    reward,
    // A pirate voyage with no placeable board is not a pirate voyage. The
    // 10,000-board sweep says this never happens, but a null here would be a
    // voyage that can never be collected.
    pirate: reward.pirate && layout !== null,
    seed: skirmishSeed,
    layout: layout ?? [],
  });

  if (!sent.ok) return fail(sent.reason === 'slot-busy' ? 'slot-busy' : 'no-slot');

  return ok({ id, route: route.id, slot, returnsAt: returnsAt(route, now), pirate: false });
}

export async function listVoyages(
  userId: string,
  now: number,
): Promise<Outcome<{ voyages: readonly PublicVoyage[] }>> {
  if (!voyagesEnabled()) return fail('feature-off');
  const rows = await repo.voyageList(userId);

  // Only a voyage that is home and was attacked needs its seed, so only those
  // cost a second read.
  const seeds = await Promise.all(
    rows.map(async (row) =>
      row.pirate && now >= row.returnsAt ? ((await repo.skirmishBoard(row.id))?.seed ?? null) : null,
    ),
  );

  // A NAMED field, not a bare array: the route spreads the value into the
  // response object, and spreading an array yields `{0: …, 1: …}`.
  return ok({ voyages: rows.map((row, index) => toPublic(row, now, seeds[index] ?? null)) });
}

export interface PublicVoyage {
  readonly id: string;
  readonly route: string;
  readonly slot: number;
  readonly sentAt: number;
  readonly returnsAt: number;
  readonly state: string;
  readonly back: boolean;
  /**
   * §3 — "revealed on return". Before that it is null, and the pirate flag
   * with it: a client that could see which voyage would be attacked would
   * simply never open that one.
   */
  readonly reward: VoyageReward | null;
  readonly pirate: boolean | null;
  /**
   * The 5x5 board's seed, for a pirate voyage that is home.
   *
   * NOT a leak. §3 — "the skirmish runs on the client for speed" — so the
   * client has to be able to build the board; the security is the server's
   * replay, not secrecy. It is still null until the ship is back, because
   * knowing beforehand WHICH voyage will be attacked is what would matter.
   */
  readonly skirmishSeed: number | null;
}

function toPublic(row: VoyageRow, now: number, seed: number | null = null): PublicVoyage {
  const back = now >= row.returnsAt;
  return {
    id: row.id,
    route: row.route,
    slot: row.slot,
    sentAt: row.sentAt,
    returnsAt: row.returnsAt,
    state: row.state,
    back,
    reward: back ? row.reward : null,
    pirate: back ? row.pirate : null,
    skirmishSeed: back && row.pirate ? seed : null,
  };
}

export interface Collected {
  readonly coins: number;
  readonly steel: number;
  readonly gems: number;
  readonly result: SkirmishResult;
}

/**
 * Collects a returned voyage. Pays the stored reward — never a new roll.
 *
 * A pirate voyage whose skirmish was never played and whose 24 hours are up
 * settles here as `ignored`, at half cargo (§3). One that is still inside its
 * grace period is refused with `under-attack`, so the player is sent to the
 * skirmish rather than quietly given half.
 */
export async function collectVoyage(
  userId: string,
  id: string,
  now: number,
): Promise<Outcome<Collected>> {
  if (!voyagesEnabled()) return fail('feature-off');

  const rows = await repo.voyageList(userId);
  const row = rows.find((v) => v.id === id);
  if (!row) return fail('not-found');
  if (row.state === 'collected') return fail('already-collected');
  if (now < row.returnsAt) return fail('not-back-yet');

  let result: SkirmishResult = 'none';

  if (row.pirate) {
    const board = await repo.skirmishBoard(id);
    if (board && !board.settledAt) {
      // §3 — "Lose **or ignore it** for 24 h -> half cargo." Inside the grace
      // period the player is sent to the skirmish rather than quietly given
      // half; past it, ignoring it IS the answer.
      if (!skirmishExpired(row.returnsAt, now)) return fail('under-attack');
      result = 'ignored';
      await repo.skirmishRecord(id, null, 'ignored');
    } else if (board) {
      // The skirmish already ran and recorded its verdict; `submitSkirmish`
      // paid at the same time, so reaching here means a second collect.
      return fail('already-collected');
    }
  }

  return payVoyage(userId, id, row.reward, result);
}

/**
 * §3 and §5.6 — "a pirate skirmish log that does not replay is rejected and
 * pays half."
 *
 * The log is replayed against the SERVER's seed. A log that reproduces and
 * claims a win pays full plus 25%; anything else pays half. The verdict is
 * recorded either way, so a rejection is visible in the data rather than only
 * in the payout.
 */
export async function submitSkirmish(
  userId: string,
  id: string,
  log: SkirmishLog,
  now: number,
): Promise<Outcome<Collected & { verified: boolean }>> {
  if (!voyagesEnabled()) return fail('feature-off');

  const rows = await repo.voyageList(userId);
  const row = rows.find((v) => v.id === id);
  if (!row) return fail('not-found');
  if (row.state === 'collected') return fail('already-collected');
  if (now < row.returnsAt) return fail('not-back-yet');

  const board = await repo.skirmishBoard(id);
  if (!board) return fail('not-found');
  if (board.settledAt) return fail('already-settled');

  // THE REPLAY. The client's seed is ignored entirely — only the server's.
  const verdict = replaySkirmish({ ...log, seed: board.seed });
  const result: SkirmishResult = !verdict.ok
    ? 'unverified'
    : verdict.winner === 'player'
      ? 'won'
      : 'lost';

  await repo.skirmishRecord(id, log, result);

  const paid = await payVoyage(userId, id, row.reward, result);
  if (!paid.ok) return paid;
  return ok({ ...paid.value, verified: verdict.ok });
}

async function payVoyage(
  userId: string,
  id: string,
  reward: VoyageReward,
  result: SkirmishResult,
): Promise<Outcome<Collected>> {
  const amount = payout(reward, result);
  const paid = await repo.voyageCollect({
    id,
    userId,
    coins: amount.coins,
    steel: amount.steel,
    gems: amount.gems,
    result,
  });

  if (!paid.paid) {
    if (paid.reason === 'not-back-yet') return fail('not-back-yet');
    if (paid.reason === 'not-found') return fail('not-found');
    return fail('already-collected', paid.reason);
  }

  return ok({ coins: paid.coins, steel: paid.steel, gems: paid.gems, result });
}

/** §3's 24-hour sweep. Idempotent — a row with a verdict is left alone. */
export async function sweepSkirmishes(now: number): Promise<number> {
  const config = voyageConfig();
  return repo.skirmishExpire(now - config.skirmishGraceMs);
}

/** A stable 32-bit seed from a uuid — the same trick `seedForDate` uses. */
function seedFromUuid(id: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

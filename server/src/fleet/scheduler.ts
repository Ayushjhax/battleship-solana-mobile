/**
 * THE WAR SCHEDULER — part-08 §6. The only cron in this package.
 *
 * §6: "it moves wars prep → battle → ended, settles rewards, and must be
 * **idempotent and restart-safe** (a crashed worker must not pay twice). Use a
 * state machine with a `settled_at` marker rather than a timer in memory."
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS IDEMPOTENT
 *
 * Every transition is one SQL statement with the CURRENT state in its WHERE
 * clause, so a second run matches zero rows:
 *
 *     update war set state='battle' where state='prep' and prep_ends_at <= now()
 *
 * Settlement is the one that pays, so it has two independent guards, both in
 * `public.settle_war` (0017):
 *
 *   1. THE CLAIM — `set settled_at = now() where state='settling' and
 *      settled_at is null`, the first statement in the function. One winner,
 *      ever. Two workers arriving together serialise on the row lock.
 *   2. THE BACKSTOP — `war_reward` is unique on (war_id, user_id) and every
 *      insert is `on conflict do nothing`, and the wallet only moves for rows
 *      that were actually inserted.
 *
 * WHY IT IS RESTART-SAFE
 *
 * Because it holds NO TIMERS. There is no `setTimeout(settle, prepEndsAt)`
 * anywhere; there is a `setInterval` that re-reads the table. A process that
 * has been down for six hours catches up on its first tick, because every
 * condition is `<= now()` rather than "did it fire while I was watching".
 *
 * A worker killed mid-settlement rolls back the claim WITH the payment (a
 * plpgsql function is one transaction), so the war returns to `settling` and
 * the next tick legitimately retries. There is no state in which the claim is
 * committed and the payment is not.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `warTick()` is exported and does one full pass, so the TESTS CALL IT
 * DIRECTLY rather than waiting on an interval. That is deliberate: a
 * scheduler you can only test by sleeping is a scheduler nobody tests.
 */
import {
  SEARCH_GIVE_UP_MS,
  memberRewards,
  sideScore,
  warResult,
  type WarRaid,
  type WarSize,
} from '@engine/fleets';

import { isEnabled } from '../features';
import { fleetRepo, type WarSettlementInput } from './repo';

export interface TickResult {
  readonly startedBattle: number;
  readonly startedSettling: number;
  readonly cancelledSearches: number;
  readonly settled: number;
  /** Wars that were already settled when this tick reached them. */
  readonly alreadySettled: number;
  readonly errors: number;
}

const EMPTY: TickResult = {
  startedBattle: 0,
  startedSettling: 0,
  cancelledSearches: 0,
  settled: 0,
  alreadySettled: 0,
  errors: 0,
};

export function fleetsEnabled(): boolean {
  return isEnabled('portCity.fleets');
}

/**
 * One full pass. Safe to call at any frequency, from any number of workers,
 * at any time — including twice in the same millisecond.
 */
export async function warTick(): Promise<TickResult> {
  if (!fleetsEnabled()) return EMPTY;

  const repo = fleetRepo();

  // Steps 1, 2 and 4: pure state moves, each idempotent by its WHERE clause.
  const startedBattle = await repo.advancePrep();
  const startedSettling = await repo.advanceBattle();
  const cancelledSearches = await repo.expireSearches(SEARCH_GIVE_UP_MS);

  // Step 3: settlement. Each war is settled in its own transaction, so one
  // failing war cannot roll back another's payment.
  let settled = 0;
  let alreadySettled = 0;
  let errors = 0;

  for (const warId of await repo.warsAwaitingSettlement()) {
    try {
      const outcome = await settleOneWar(warId);
      if (outcome === 'paid') settled++;
      else if (outcome === 'already') alreadySettled++;
    } catch {
      // A war that throws is left in `settling` and retried next tick. It is
      // NOT marked settled, so the money is still owed and will still be paid.
      errors++;
    }
  }

  return { startedBattle, startedSettling, cancelledSearches, settled, alreadySettled, errors };
}

export type SettleOutcome = 'paid' | 'already' | 'not-due';

/**
 * Settles one war. Everything before `repo.settleWar()` is arithmetic over
 * rows already written; the single write is the SQL function, which is where
 * exactly-once lives.
 *
 * Exported so the tests can drive one war without the sweep around it.
 */
export async function settleOneWar(warId: string): Promise<SettleOutcome> {
  const repo = fleetRepo();
  const war = await repo.loadWar(warId);
  if (!war || war.state !== 'settling') return 'not-due';

  const members = await repo.warMembers(warId);
  const raids = await repo.warRaids(warId);

  const sideA = members.filter((m) => m.fleetId === war.fleetA);
  const sideB = members.filter((m) => m.fleetId === war.fleetB);
  const targetsA = sideA.map((m) => m.userId);
  const targetsB = sideB.map((m) => m.userId);

  const idsA = new Set(targetsA);
  const raidsByA: WarRaid[] = raids.filter((r) => idsA.has(r.attackerId));
  const raidsByB: WarRaid[] = raids.filter((r) => !idsA.has(r.attackerId));

  const result = warResult(targetsA, raidsByA, targetsB, raidsByB);
  const draw = result.winner === 'draw';

  const size = war.size as WarSize;
  const rewardsA = memberRewards(sideA, size, result.a.stars, result.winner === 'a', draw);
  const rewardsB = memberRewards(sideB, size, result.b.stars, result.winner === 'b', draw);

  const input: WarSettlementInput = {
    warId,
    winner: result.winner,
    starsA: result.a.stars,
    starsB: result.b.stars,
    destructionA: round4(result.a.destruction),
    destructionB: round4(result.b.destruction),
    rewards: [...rewardsA, ...rewardsB],
  };

  const applied = await repo.settleWar(input);
  return applied.paid ? 'paid' : 'already';
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** The live scoreboard, for the war screen. Same function the settlement uses. */
export async function warScoreboard(warId: string) {
  const repo = fleetRepo();
  const war = await repo.loadWar(warId);
  if (!war) return null;

  const members = await repo.warMembers(warId);
  const raids = await repo.warRaids(warId);
  const sideA = members.filter((m) => m.fleetId === war.fleetA);
  const idsA = new Set(sideA.map((m) => m.userId));
  const sideB = members.filter((m) => m.fleetId === war.fleetB);

  return {
    a: sideScore(sideB.map((m) => m.userId), raids.filter((r) => idsA.has(r.attackerId))),
    b: sideScore(sideA.map((m) => m.userId), raids.filter((r) => !idsA.has(r.attackerId))),
  };
}

// ---------------------------------------------------------------------------
// The interval
// ---------------------------------------------------------------------------

/**
 * How often a tick runs. A war's clock is measured in hours, so a minute of
 * slack costs nothing and a tighter loop would only add database traffic.
 */
export const TICK_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the loop. Idempotent: calling it twice does not create two loops,
 * which matters because `index.ts` may be imported by a test that also boots
 * the app.
 *
 * There is nothing to restore on boot. That is the point.
 */
export function startWarScheduler(log?: (result: TickResult) => void): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    void warTick()
      .then((result) => {
        const moved =
          result.startedBattle + result.startedSettling + result.cancelledSearches + result.settled;
        if (moved > 0 && log) log(result);
      })
      .catch(() => {
        /* the next tick retries; nothing is lost because nothing is in memory */
      });
  }, TICK_MS);
  // Never hold the process open for a timer that only polls.
  timer.unref?.();
}

export function stopWarScheduler(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

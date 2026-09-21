/**
 * Supabase access from the server, using the SECRET key. This key must never
 * appear in the app bundle — the app uses the publishable key (see
 * .env.example). The secret key bypasses RLS entirely, which is exactly what
 * lets this process write scores that supabase/migrations/0001_profiles.sql
 * forbids any client JWT from touching.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { GameOverReason, MatchEvent, MatchMode } from '@engine/types';
import type { Database, Json } from '../../src/net/database.types';
import type { OpponentSummary } from './protocol';
import type { TrustedPrivyAccount } from './privy';

/** The fixed system profile from supabase/migrations/0006_bots.sql. */
export const BOT_PLAYER_ID = 'b0000000-0000-4000-8000-000000000001';

let client: SupabaseClient<Database> | null = null;

export function db(): SupabaseClient<Database> {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.example)');
  }

  client = createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** PostgREST's answer when the schema is behind the code calling it. */
function isMissingFunction(error: { code?: string; message: string }): boolean {
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message);
}

function missingMigration(fn: string, file: string): Error {
  return new Error(
    `Supabase is missing public.${fn}. Apply supabase/migrations/${file} ` +
      '(npx supabase db push), then reload the PostgREST schema cache.',
  );
}

/**
 * Fail fast when the backend cannot reach the required production schema.
 *
 * The table probes catch a missing migration wholesale; the RPC probe catches
 * the nastier case of a schema one migration behind, where everything starts
 * cleanly and only the call made at the end of a match fails. It is
 * read-only: no hold carries this request id, so the function returns before
 * it writes anything (and raises on the unknown profile, which still proves
 * the function is there).
 */
/**
 * Result of one readiness probe. Deliberately non-throwing: a readiness report
 * that dies on the first failure hides every later problem, and the whole point
 * of this probe is to show all of them at once.
 */
export interface ReadinessCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string | null;
}

/**
 * Proves the secret key can actually drive Supabase Auth admin.
 *
 * `verifyDatabaseConnection` only reads gameplay tables, which the publishable
 * key can also do. That is why a server whose SUPABASE_SECRET_KEY lacks admin
 * rights still logged "database connected" while every sign-in failed inside
 * `bootstrapPrivySession`. Listing users with perPage=1 is the cheapest call
 * that exercises the same service-role path as createUser/generateLink.
 */
export async function verifyAuthAdminAccess(): Promise<ReadinessCheck> {
  try {
    const { error } = await db().auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) {
      return { name: 'supabase_auth_admin', ok: false, detail: error.message };
    }
    return { name: 'supabase_auth_admin', ok: true, detail: null };
  } catch (error) {
    return {
      name: 'supabase_auth_admin',
      ok: false,
      detail: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

/** Non-throwing wrapper around the schema probe, for the readiness report. */
export async function checkDatabaseSchema(): Promise<ReadinessCheck> {
  try {
    await verifyDatabaseConnection();
    return { name: 'supabase_schema', ok: true, detail: null };
  } catch (error) {
    return {
      name: 'supabase_schema',
      ok: false,
      detail: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

export async function verifyDatabaseConnection(): Promise<void> {
  const checks = await Promise.all([
    db().from('profiles').select('id', { head: true, count: 'exact' }),
    db().from('privy_accounts').select('profile_id', { head: true, count: 'exact' }),
    db().from('point_accounts').select('privy_user_id', { head: true, count: 'exact' }),
  ]);
  const failed = checks.find((result) => result.error)?.error;
  if (failed) throw new Error(`Supabase schema readiness check failed: ${failed.message}`);

  const unused = '00000000-0000-4000-8000-000000000000';
  const probe = await db().rpc('settle_offline_wager', {
    p_profile_id: unused,
    p_request_id: unused,
    p_won: false,
  });
  if (probe.error && isMissingFunction(probe.error)) {
    throw missingMigration('settle_offline_wager', '0012_offline_wagers.sql');
  }

  // No match carries this id, so the function returns false without writing.
  const abandonProbe = await db().rpc('abandon_match', { p_match_id: unused });
  if (abandonProbe.error && isMissingFunction(abandonProbe.error)) {
    throw missingMigration('abandon_match', '0013_abandoned_matches.sql');
  }
}

/** For matchmaking's rank window and the `matched` message's player cards. */
export async function fetchOpponentSummary(userId: string): Promise<OpponentSummary> {
  const { data, error } = await db()
    .from('profiles')
    .select('id,name,avatar_id,avatar_color,country_code,rank_points,is_bot')
    .eq('id', userId)
    .maybeSingle<{
      id: string;
      name: string;
      avatar_id: number;
      avatar_color: string;
      country_code: string | null;
      rank_points: number;
      is_bot: boolean;
    }>();

  if (error || !data) {
    if (error) console.warn(`[db] fetchOpponentSummary(${userId}) failed:`, error.message);
    // A player with no row yet (trigger lag, or a token for a deleted user)
    // still gets a match — degrade to a bland default rather than blocking play.
    return {
      id: userId,
      name: 'Sailor',
      avatarId: 1,
      avatarColor: 'violet',
      countryCode: null,
      rankPoints: 0,
      isBot: userId === BOT_PLAYER_ID,
    };
  }

  return {
    id: data.id,
    name: data.name,
    avatarId: data.avatar_id,
    avatarColor: data.avatar_color,
    countryCode: data.country_code,
    rankPoints: data.rank_points,
    isBot: data.is_bot ?? userId === BOT_PLAYER_ID,
  };
}

export interface InsertMatchInput {
  readonly id: string;
  readonly mode: MatchMode;
  readonly playerA: string;
  readonly playerB: string;
  readonly seed: number;
  readonly isBot: boolean;
}

export interface WagerHoldInput {
  readonly profileId: string;
  readonly requestId: string;
}

export async function insertMatch(input: InsertMatchInput): Promise<void> {
  // `mode` is a CHECK constraint, not a Postgres enum, so gen-types widens
  // it to `string` — the migration already enforces 'classic' | 'advanced'.
  const { error } = await db().from('matches').insert({
    id: input.id,
    mode: input.mode,
    player_a: input.playerA,
    player_b: input.playerB,
    seed: input.seed,
    is_bot: input.isBot,
  });
  if (error) throw new Error(`insertMatch(${input.id}): ${error.message}`);
}

export async function insertWageredMatch(
  input: InsertMatchInput,
  holdA: WagerHoldInput,
  holdB: WagerHoldInput | null,
): Promise<void> {
  const { error } = await db().rpc('create_wagered_match', {
    p_match_id: input.id,
    p_mode: input.mode,
    p_player_a: input.playerA,
    p_player_b: input.playerB,
    p_seed: input.seed,
    p_is_bot: input.isBot,
    p_hold_a: holdA.requestId,
    p_hold_b: holdB?.requestId ?? null,
  });
  if (error) throw new Error(`create_wagered_match(${input.id}): ${error.message}`);
}

/**
 * Closes a match nobody stayed for (0013): no winner, no profile movement, and
 * the stakes stay forfeited. Idempotent, and it will never overwrite a match
 * that already has a real result.
 */
export async function abandonMatch(matchId: string): Promise<boolean> {
  const { data, error } = await db().rpc('abandon_match', { p_match_id: matchId });
  if (error && isMissingFunction(error)) {
    throw missingMigration('abandon_match', '0013_abandoned_matches.sql');
  }
  if (error) throw new Error(`abandonMatch(${matchId}): ${error.message}`);
  return data === true;
}

export type DbEndReason = 'victory' | 'resign' | 'timeout' | 'disconnect';

export function dbEndReason(reason: GameOverReason): DbEndReason {
  return reason === 'fleet' ? 'victory' : reason === 'forfeit' ? 'timeout' : 'resign';
}

/**
 * Settles a match: the matches row and both players' totals in ONE
 * transaction (public.apply_match_result, 0008). Idempotent — a retry
 * returns false and moves nothing — so a room may call it without fear.
 * Rewards are passed in so src/engine/ranks.ts stays the source of truth.
 * The bot's row is never touched (the function checks is_bot).
 */
export async function applyMatchResult(
  matchId: string,
  winnerId: string,
  endReason: DbEndReason,
  reward: { win: { points: number; coins: number }; loss: { points: number; coins: number } },
): Promise<boolean> {
  const { data, error } = await db().rpc('apply_match_result', {
    p_match_id: matchId,
    p_winner: winnerId,
    p_end_reason: endReason,
    p_win_points: reward.win.points,
    p_win_coins: reward.win.coins,
    p_loss_points: reward.loss.points,
    p_loss_coins: reward.loss.coins,
  });
  if (error) throw new Error(`applyMatchResult(${matchId}): ${error.message}`);
  return data === true;
}

/** One row per reduce() cycle — `payload` holds every event that cycle produced. */
export async function appendMatchEvent(matchId: string, seq: number, events: readonly MatchEvent[]): Promise<void> {
  if (events.length === 0) return;
  const { error } = await db()
    .from('match_events')
    .insert({ match_id: matchId, seq, payload: { events } as unknown as Json });
  // A duplicate seq (23505, a retried action) is expected and harmless — the
  // unique constraint is what makes this log idempotent.
  if (error && error.code !== '23505') console.warn(`[db] appendMatchEvent(${matchId}, ${seq}) failed:`, error.message);
}

export interface OfflineResultInput {
  readonly id: string;
  readonly mode: 'ai' | 'hotseat';
  readonly won: boolean;
  readonly completedAt: string;
}

/** Atomic and idempotent via public.apply_offline_result (0007). */
export async function applyOfflineResult(
  userId: string,
  result: OfflineResultInput,
): Promise<void> {
  const { error } = await db().rpc('apply_offline_result', {
    p_id: result.id,
    p_user_id: userId,
    p_mode: result.mode,
    p_won: result.won,
    p_completed_at: result.completedAt,
  });
  if (error) throw new Error(`apply_offline_result(${result.id}): ${error.message}`);
}

export interface ProfileRewardTotals {
  readonly rankPoints: number;
  readonly battlesPlayed: number;
  readonly battlesWon: number;
  readonly coins: number;
}

export async function fetchProfileRewardTotals(userId: string): Promise<ProfileRewardTotals> {
  const { data, error } = await db()
    .from('profiles')
    .select('rank_points,battles_played,battles_won,coins')
    .eq('id', userId)
    .single<{
      rank_points: number;
      battles_played: number;
      battles_won: number;
      coins: number;
    }>();
  if (error) throw new Error(`profile totals(${userId}): ${error.message}`);
  return {
    rankPoints: data.rank_points,
    battlesPlayed: data.battles_played,
    battlesWon: data.battles_won,
    coins: data.coins,
  };
}

export interface SyncedPrivyAccountResult extends TrustedPrivyAccount {
  readonly pointBalance: number;
  readonly welcomeAwarded: boolean;
}

/** Server-only upsert after both the Supabase and Privy tokens are verified. */
export async function upsertPrivyAccount(
  profileId: string,
  account: TrustedPrivyAccount,
): Promise<SyncedPrivyAccountResult> {
  const { error } = await db().rpc('sync_privy_account', {
    p_profile_id: profileId,
    p_privy_user_id: account.privyUserId,
    p_email: account.email,
    p_display_name: account.displayName,
    p_auth_provider: account.authProvider,
    p_solana_wallet_address: account.solanaWalletAddress,
    p_solana_wallet_id: account.solanaWalletId,
    p_linked_accounts: account.linkedAccounts,
    p_privy_created_at: account.privyCreatedAt,
  });
  if (error) throw new Error(`privy account upsert(${profileId}): ${error.message}`);
  const { data: pointRows, error: pointError } = await db().rpc('ensure_point_account', {
    p_profile_id: profileId,
    p_privy_user_id: account.privyUserId,
  });
  const point = pointRows?.[0];
  if (pointError || !point) {
    throw new Error(`point account init(${profileId}): ${pointError?.message ?? 'no result'}`);
  }
  return {
    ...account,
    pointBalance: Number(point.balance),
    welcomeAwarded: point.welcome_awarded,
  };
}

export async function fetchPointBalance(profileId: string): Promise<number> {
  const { data, error } = await db().rpc('get_point_balance', { p_profile_id: profileId });
  if (error || data === null) {
    throw new Error(`point balance(${profileId}): ${error?.message ?? 'not found'}`);
  }
  return Number(data);
}

export async function fetchVerifiedWalletAddress(profileId: string): Promise<string> {
  const { data, error } = await db()
    .from('privy_accounts')
    .select('solana_wallet_address')
    .eq('profile_id', profileId)
    .single<{ solana_wallet_address: string | null }>();
  if (error || !data.solana_wallet_address) {
    throw new Error(`verified Solana wallet(${profileId}): ${error?.message ?? 'not available'}`);
  }
  return data.solana_wallet_address;
}

export interface WagerReservation {
  readonly ok: boolean;
  readonly requestId: string;
  readonly balance: number;
  readonly reason: string | null;
}

export async function reservePointWager(
  profileId: string,
  requestId: string,
): Promise<WagerReservation> {
  const { data, error } = await db().rpc('reserve_point_wager', {
    p_profile_id: profileId,
    p_request_id: requestId,
    p_stake: 50,
  });
  const row = data?.[0];
  if (error || !row) throw new Error(`reserve wager(${profileId}): ${error?.message ?? 'no result'}`);
  return {
    ok: row.ok,
    requestId: row.hold_id,
    balance: Number(row.balance),
    reason: row.reason,
  };
}

export interface OfflineWagerSettlement {
  readonly balance: number;
  /** False when the hold was already settled, refunded, or belongs to a room. */
  readonly settled: boolean;
}

/**
 * Settles a wager played against the device's own AI (0012). There is no
 * matches row to go through, so the hold itself is the idempotency key and a
 * retried settlement pays the prize exactly once.
 */
export async function settleOfflineWager(
  profileId: string,
  requestId: string,
  won: boolean,
): Promise<OfflineWagerSettlement> {
  const { data, error } = await db().rpc('settle_offline_wager', {
    p_profile_id: profileId,
    p_request_id: requestId,
    p_won: won,
  });
  const row = data?.[0];
  if (error && isMissingFunction(error)) {
    throw missingMigration('settle_offline_wager', '0012_offline_wagers.sql');
  }
  if (error || !row) {
    throw new Error(`settle offline wager(${requestId}): ${error?.message ?? 'no result'}`);
  }
  return { balance: Number(row.balance), settled: row.settled };
}

export async function refundPointWager(profileId: string, requestId: string): Promise<number> {
  const { data, error } = await db().rpc('refund_point_wager', {
    p_profile_id: profileId,
    p_request_id: requestId,
  });
  if (error || data === null) throw new Error(`refund wager(${requestId}): ${error?.message ?? 'no result'}`);
  return Number(data);
}

export interface CancelledWagerBalance {
  readonly profileId: string;
  readonly balance: number;
}

export async function cancelWageredMatchBeforeStart(
  matchId: string,
  cancelledBy: string,
): Promise<readonly CancelledWagerBalance[]> {
  const { data, error } = await db().rpc('cancel_wagered_match_before_start', {
    p_match_id: matchId,
    p_cancelled_by: cancelledBy,
  });
  if (error) throw new Error(`cancel wager match(${matchId}): ${error.message}`);
  return (data ?? []).map((row) => ({
    profileId: row.cancelled_profile_id,
    balance: Number(row.balance),
  }));
}

export async function completePointBuy(
  profileId: string,
  requestId: string,
  signature: string,
  points: number,
  lamports: number,
): Promise<number> {
  const { data, error } = await db().rpc('complete_point_buy', {
    p_profile_id: profileId,
    p_request_id: requestId,
    p_signature: signature,
    p_points: points,
    p_lamports: lamports,
  });
  if (error || data === null) throw new Error(`complete point buy(${requestId}): ${error?.message ?? 'no result'}`);
  return Number(data);
}

export interface PointSellStart {
  readonly ok: boolean;
  readonly balance: number;
  readonly status: string;
  readonly reason: string | null;
}

export async function beginPointSell(
  profileId: string,
  requestId: string,
  points: number,
  lamports: number,
): Promise<PointSellStart> {
  const { data, error } = await db().rpc('begin_point_sell', {
    p_profile_id: profileId,
    p_request_id: requestId,
    p_points: points,
    p_lamports: lamports,
  });
  const row = data?.[0];
  if (error || !row) throw new Error(`begin point sell(${requestId}): ${error?.message ?? 'no result'}`);
  return { ok: row.ok, balance: Number(row.balance), status: row.status, reason: row.reason };
}

export type PointTradeRow = Database['public']['Tables']['point_trades']['Row'];

export async function fetchPointTrade(requestId: string): Promise<PointTradeRow | null> {
  const { data, error } = await db()
    .from('point_trades')
    .select('*')
    .eq('request_id', requestId)
    .maybeSingle<PointTradeRow>();
  if (error) throw new Error(`point trade(${requestId}): ${error.message}`);
  return data;
}

export async function markPointSellBroadcast(
  requestId: string,
  input: {
    signature: string;
    signedTransaction: string;
    blockhash: string;
    lastValidBlockHeight: number;
  },
): Promise<void> {
  const { error } = await db().rpc('mark_point_sell_broadcast', {
    p_request_id: requestId,
    p_signature: input.signature,
    p_signed_transaction: input.signedTransaction,
    p_blockhash: input.blockhash,
    p_last_valid_block_height: input.lastValidBlockHeight,
  });
  if (error) throw new Error(`mark point sell broadcast(${requestId}): ${error.message}`);
}

export async function completePointSell(requestId: string, signature: string): Promise<number> {
  const { data, error } = await db().rpc('complete_point_sell', {
    p_request_id: requestId,
    p_signature: signature,
  });
  if (error || data === null) throw new Error(`complete point sell(${requestId}): ${error?.message ?? 'no result'}`);
  return Number(data);
}

export async function refundPointSell(requestId: string, reason: string): Promise<number> {
  const { data, error } = await db().rpc('refund_point_sell', {
    p_request_id: requestId,
    p_error: reason,
  });
  if (error || data === null) throw new Error(`refund point sell(${requestId}): ${error?.message ?? 'no result'}`);
  return Number(data);
}

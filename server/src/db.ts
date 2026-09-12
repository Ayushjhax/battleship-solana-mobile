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
  if (error) console.warn(`[db] insertMatch(${input.id}) failed:`, error.message);
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
  if (error) {
    console.warn(`[db] applyMatchResult(${matchId}) failed:`, error.message);
    return false;
  }
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

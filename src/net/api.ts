/**
 * The app's network boundary. Every function returns a Result — nothing throws
 * across the wire — and every response is validated with zod before it
 * touches app state. Only the publishable key is in play here; the secret
 * key lives on the match server (server/src/db.ts) and never in this bundle.
 *
 * What a client may write is exactly what RLS allows (0001_profiles.sql):
 * name, avatar_id, avatar_color, country_code, has_completed_tutorial on its
 * own row. Scores are the match server's to write.
 */
import { z } from 'zod';

import { isForcedOffline } from '@/state/demo';
import type { Database } from './database.types';
import { isSupabaseConfigured, supabase } from './supabase';

type ProfileRowUpdate = Database['public']['Tables']['profiles']['Update'];

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'unconfigured'
  | 'offline'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'unknown';

export interface ApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(code: ApiErrorCode, message: string): Result<T> => ({
  ok: false,
  error: { code, message },
});

interface PostgrestLikeError {
  code?: string;
  message: string;
  status?: number;
}

function classify(error: PostgrestLikeError): ApiError {
  const code = error.code ?? '';
  if (code === '42501' || error.status === 403)
    return { code: 'forbidden', message: error.message };
  if (code === 'PGRST116' || error.status === 404)
    return { code: 'not_found', message: error.message };
  if (error.status === 401) return { code: 'unauthenticated', message: error.message };
  if (code === '23514' || code === '22P02') return { code: 'invalid', message: error.message };
  if (/network|fetch|timeout|ECONN/i.test(error.message))
    return { code: 'offline', message: error.message };
  return { code: 'unknown', message: error.message };
}

/** Wraps a call: unconfigured / thrown network errors / zod failures all become Results. */
async function guard<T>(run: () => Promise<Result<T>>): Promise<Result<T>> {
  if (!isSupabaseConfigured) return fail('unconfigured', 'Supabase keys are not set (.env)');
  if (isForcedOffline()) return fail('offline', 'offline (demo menu: hard offline is on)');
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(/network|fetch|timeout|ECONN/i.test(message) ? 'offline' : 'unknown', message);
  }
}

function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): Result<T> {
  const parsed = schema.safeParse(data);
  return parsed.success
    ? ok(parsed.data)
    : fail('invalid', `${what}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
}

// ---------------------------------------------------------------------------
// Schemas — the wire shapes, validated
// ---------------------------------------------------------------------------

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(14),
  avatar_id: z.number().int(),
  avatar_color: z.string(),
  country_code: z.string().nullable(),
  rank_points: z.number().int(),
  battles_played: z.number().int(),
  battles_won: z.number().int(),
  coins: z.number().int(),
  gems: z.number().int(),
  buildings: z.number().int(),
  has_completed_tutorial: z.boolean(),
  updated_at: z.string().nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const LeaderboardEntrySchema = z.object({
  name: z.string(),
  avatar_id: z.number().int(),
  avatar_color: z.string(),
  country_code: z.string().nullable(),
  rank_points: z.number().int(),
  battles_won: z.number().int(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

/** public.my_leaderboard_row() (0008): the caller's 1-based ladder position, no id. */
export const MyLeaderboardRowSchema = LeaderboardEntrySchema.extend({
  rank_position: z.number().int().min(1),
});
export type MyLeaderboardRow = z.infer<typeof MyLeaderboardRowSchema>;

export const MatchSummarySchema = z.object({
  id: z.string().uuid(),
  mode: z.enum(['classic', 'advanced']),
  player_a: z.string().uuid().nullable(),
  player_b: z.string().uuid().nullable(),
  winner: z.string().uuid().nullable(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  end_reason: z.enum(['victory', 'resign', 'timeout', 'disconnect']).nullable(),
});
export type MatchSummary = z.infer<typeof MatchSummarySchema>;

const PROFILE_COLUMNS =
  'id,name,avatar_id,avatar_color,country_code,rank_points,battles_played,battles_won,coins,gems,buildings,has_completed_tutorial,updated_at';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** The current session's user id, or null. Local — no network. */
export async function getSessionUserId(): Promise<Result<string | null>> {
  return guard(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) return fail('unknown', error.message);
    return ok(data.session?.user.id ?? null);
  });
}

/**
 * The current session's access token (JWT) — what the match server verifies
 * against the project JWKS on `hello` (server/src/auth.ts). Refreshes through
 * the client if it's about to expire, so a reconnect never sends a stale one.
 */
export async function getAccessToken(): Promise<Result<string>> {
  return guard(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) return fail('unknown', error.message);
    const token = data.session?.access_token;
    return token ? ok(token) : fail('unauthenticated', 'no session');
  });
}

/** Anonymous sign-in: a real auth.users row, no login screen ever. */
export async function signInAnonymously(): Promise<Result<{ userId: string }>> {
  return guard(async () => {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error)
      return fail(classify({ message: error.message, status: error.status }).code, error.message);
    const userId = data.user?.id;
    return userId ? ok({ userId }) : fail('unknown', 'sign-in returned no user');
  });
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function getProfile(userId: string): Promise<Result<Profile | null>> {
  return guard(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
    if (error) return fail(classify(error).code, error.message);
    if (!data) return ok(null);
    return parse(ProfileSchema, data, 'profile');
  });
}

/** The columns RLS lets a player change on their own row. */
export interface ProfileUpdate {
  name?: string;
  avatarId?: number;
  avatarColor?: string;
  countryCode?: string | null;
  hasCompletedTutorial?: boolean;
}

export async function updateProfile(
  userId: string,
  patch: ProfileUpdate,
): Promise<Result<Profile>> {
  return guard(async () => {
    const row: ProfileRowUpdate = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length < 1 || name.length > 14)
        return fail('invalid', 'name must be 1-14 characters');
      row.name = name;
    }
    if (patch.avatarId !== undefined) row.avatar_id = patch.avatarId;
    if (patch.avatarColor !== undefined) row.avatar_color = patch.avatarColor;
    if (patch.countryCode !== undefined) row.country_code = patch.countryCode;
    if (patch.hasCompletedTutorial !== undefined)
      row.has_completed_tutorial = patch.hasCompletedTutorial;
    if (Object.keys(row).length === 0) return fail('invalid', 'nothing to update');

    const { data, error } = await supabase
      .from('profiles')
      .update(row)
      .eq('id', userId)
      .select(PROFILE_COLUMNS)
      .single();
    if (error) return fail(classify(error).code, error.message);
    return parse(ProfileSchema, data, 'profile');
  });
}

// ---------------------------------------------------------------------------
// Leaderboard and history
// ---------------------------------------------------------------------------

export async function getLeaderboard(): Promise<Result<LeaderboardEntry[]>> {
  return guard(async () => {
    const { data, error } = await supabase.from('leaderboard').select('*');
    if (error) return fail(classify(error).code, error.message);
    return parse(z.array(LeaderboardEntrySchema), data ?? [], 'leaderboard');
  });
}

/**
 * The caller's own position on the ladder — same ordering as the view, so
 * `rank_position <= 100` means row `rank_position - 1` of the leaderboard is
 * them. Null when there is no session (or no profile row yet).
 */
export async function getMyLeaderboardRow(): Promise<Result<MyLeaderboardRow | null>> {
  return guard(async () => {
    const { data, error } = await supabase.rpc('my_leaderboard_row');
    if (error) return fail(classify(error).code, error.message);
    const row = data?.[0];
    if (!row) return ok(null);
    return parse(MyLeaderboardRowSchema, row, 'my leaderboard row');
  });
}

export async function getMatchHistory(userId: string, limit = 20): Promise<Result<MatchSummary[]>> {
  return guard(async () => {
    const { data, error } = await supabase
      .from('matches')
      .select('id,mode,player_a,player_b,winner,started_at,ended_at,end_reason')
      .or(`player_a.eq.${userId},player_b.eq.${userId}`)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) return fail(classify(error).code, error.message);
    return parse(z.array(MatchSummarySchema), data ?? [], 'match history');
  });
}

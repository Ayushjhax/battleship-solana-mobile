/**
 * Supabase access from the server, using the SECRET key. This key must never
 * appear in the app bundle — the app uses the publishable key (see .env.example).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.example)');
  }

  client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** TODO(P11/P15): write the finished match, award points and coins. */
export async function recordMatchResult(_matchId: string, _winnerId: string): Promise<void> {
  throw new Error('recordMatchResult is implemented in P15');
}

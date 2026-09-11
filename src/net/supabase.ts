/**
 * The single Supabase client for the app.
 *
 * Current Expo guidance (docs/brief.md 4.4):
 *  - `expo-sqlite/localStorage/install` installs a real localStorage global, and
 *    that is what the auth session is persisted into. Import it first.
 *  - `detectSessionInUrl: false` — a mobile app has no URL to read a session from.
 *  - Do NOT install react-native-url-polyfill; Expo already provides a URL global.
 *  - Do NOT use AsyncStorage.
 *  - The app only ever holds the PUBLISHABLE key. The secret key lives on the
 *    match server (see server/src/db.ts).
 */
import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isSupabaseConfigured = url.length > 0 && publishableKey.length > 0;

if (!isSupabaseConfigured) {
  // Fail at call time with an obvious network error rather than crashing the
  // bundle at import time, so the app still boots before P11 lands the keys.
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY are unset. ' +
      'Copy .env.example to .env and fill them in (P11).',
  );
}

export const supabase = createClient(
  isSupabaseConfigured ? url : 'http://localhost:54321',
  isSupabaseConfigured ? publishableKey : 'unset-publishable-key',
  {
    auth: {
      storage: localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

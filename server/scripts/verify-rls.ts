/**
 * Live acceptance for supabase/migrations against a real project. Run from
 * the repo root with the keys in .env:
 *
 *   npm run --prefix server verify:rls
 *
 * It creates two throwaway anonymous users (deleted at the end), so run it
 * against a dev project. Checks:
 *   1. user A cannot UPDATE user B's rank_points
 *   2. user A cannot UPDATE their OWN rank_points
 *   3. user A can update their own name
 *   4. the secret key can write scores
 *   5. the leaderboard exposes only public columns
 *   6. subscribing to match:{id} for a match you are not in fails
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of ['.env', '../.env']) {
    try {
      for (const line of readFileSync(resolve(process.cwd(), file), 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && m[1] && m[2] !== undefined && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch {
      /* try the next */
    }
  }
  return { ...out, ...(process.env as Record<string, string>) };
}

const env = loadEnv();
const url = env.SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL;
const publishable = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = env.SUPABASE_SECRET_KEY;
if (!url || !publishable || !secret) {
  console.error('need SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in .env');
  process.exit(2);
}

let fails = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) fails++;
  console.log((ok ? 'ok   ' : 'FAIL ') + msg);
};

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const client = () => createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });

async function anonUser() {
  const c = client();
  const { data, error } = await c.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`anonymous sign-in failed: ${error?.message} (is it enabled in Auth settings?)`);
  return { c, id: data.user.id };
}

const created: string[] = [];
try {
  const A = await anonUser();
  const B = await anonUser();
  created.push(A.id, B.id);
  // the sign-up trigger needs a moment on some projects
  await new Promise((r) => setTimeout(r, 500));

  // 1. A -> B's score
  const r1 = await A.c.from('profiles').update({ rank_points: 9999 }).eq('id', B.id).select('id');
  check(!!r1.error || (r1.data ?? []).length === 0, "A cannot update B's rank_points");

  // 2. A -> own score
  const r2 = await A.c.from('profiles').update({ rank_points: 9999 }).eq('id', A.id).select('id');
  check(!!r2.error && /match server|42501|permission/i.test(r2.error.message), `A cannot update own rank_points (${r2.error?.message ?? 'no error!'})`);

  // 3. A -> own name
  const r3 = await A.c.from('profiles').update({ name: 'Tester A' }).eq('id', A.id).select('name').single();
  check(!r3.error && r3.data?.name === 'Tester A', 'A can update own name');

  // 4. secret key writes scores
  const r4 = await admin.from('profiles').update({ rank_points: 139, battles_played: 1, battles_won: 1 }).eq('id', A.id).select('rank_points').single();
  check(!r4.error && r4.data?.rank_points === 139, 'the secret key writes scores');

  // 5. leaderboard
  const r5 = await A.c.from('leaderboard').select('*').limit(5);
  const cols = r5.data?.[0] ? Object.keys(r5.data[0]).sort().join() : '';
  check(!r5.error && cols === 'avatar_color,avatar_id,battles_won,country_code,name,rank_points', `leaderboard columns: ${cols || r5.error?.message}`);

  // 6. realtime: a match between B and B's ghost, A tries to join
  const m = await admin.from('matches').insert({ mode: 'classic', player_a: B.id, player_b: B.id, seed: 7 }).select('id').single();
  check(!m.error && !!m.data, `secret key creates a match (${m.error?.message ?? m.data?.id})`);
  if (m.data) {
    const status = await new Promise<string>((resolveStatus) => {
      const ch = A.c.channel(`match:${m.data.id}`, { config: { private: true } });
      const t = setTimeout(() => resolveStatus('TIMED_OUT'), 8000);
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          clearTimeout(t);
          resolveStatus(s);
          void A.c.removeChannel(ch);
        }
      });
    });
    check(status !== 'SUBSCRIBED', `A subscribing to a match they are not in: ${status}`);
    const statusB = await new Promise<string>((resolveStatus) => {
      const ch = B.c.channel(`match:${m.data.id}`, { config: { private: true } });
      const t = setTimeout(() => resolveStatus('TIMED_OUT'), 8000);
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          clearTimeout(t);
          resolveStatus(s);
          void B.c.removeChannel(ch);
        }
      });
    });
    check(statusB === 'SUBSCRIBED', `B (a player) subscribing to their match: ${statusB}`);
    await admin.from('matches').delete().eq('id', m.data.id);
  }
} catch (error) {
  fails++;
  console.error('FAIL', error instanceof Error ? error.message : error);
} finally {
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
}

console.log(fails ? `\n${fails} FAILED` : '\nall live checks passed');
process.exit(fails ? 1 : 0);

/**
 * Pre-seeds Supabase for the stage demo (docs/DEMO.md) so the menu, the
 * leaderboard and the match history are not empty on a fresh project:
 *
 *   - a crew of eight named captains with plausible ranks (real auth users,
 *     created through the admin API, so the profiles trigger runs for them)
 *   - YOUR profile bumped to a good rank, with a run of finished matches
 *     against the crew (wins and losses, spread over the last two weeks)
 *
 * Idempotent: crew members are found by email; your bump only happens once
 * (it is skipped when you are already at or above the target). Uses the
 * secret key — run it from server/ with .env in place:
 *
 *   npm run seed:demo -- <your-user-id>          (the demo menu shows it)
 *   npm run seed:demo -- --name "Ayush"          (or look yourself up by name)
 *   npm run seed:demo -- <id> --points 1450      (a different target rank)
 */
import { createClient } from '@supabase/supabase-js';

try {
  process.loadEnvFile();
} catch {
  /* env comes from the shell */
}

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (server/.env)');
  process.exit(1);
}
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const byName = flag('--name');
const targetPoints = Number(flag('--points') ?? 1120); // Chief Ship Petty Officer, a bar half full
const explicitId = args.find((a) => /^[0-9a-f-]{36}$/i.test(a));

interface Crew {
  readonly slug: string;
  readonly name: string;
  readonly avatar: number;
  readonly color: string;
  readonly country: string;
  readonly points: number;
  readonly won: number;
  readonly played: number;
}

/** Spread across the ladder so the leaderboard reads like a real one. */
const CREW: readonly Crew[] = [
  { slug: 'valeria', name: 'Valeria', avatar: 2, color: '#A62B36', country: 'BR', points: 3480, won: 61, played: 88 },
  { slug: 'ken', name: 'Ken', avatar: 3, color: '#2A5FA6', country: 'JP', points: 2210, won: 44, played: 70 },
  { slug: 'amara', name: 'Amara', avatar: 1, color: '#2E7D6B', country: 'NG', points: 1640, won: 33, played: 52 },
  { slug: 'sofie', name: 'Sofie', avatar: 4, color: '#93357A', country: 'DK', points: 1275, won: 27, played: 44 },
  { slug: 'marco', name: 'Marco', avatar: 2, color: '#B4532A', country: 'IT', points: 980, won: 20, played: 36 },
  { slug: 'priya', name: 'Priya', avatar: 1, color: '#3E2FB8', country: 'IN', points: 640, won: 14, played: 27 },
  { slug: 'tomasz', name: 'Tomasz', avatar: 3, color: '#3A3A3A', country: 'PL', points: 355, won: 8, played: 17 },
  { slug: 'lena', name: 'Lena', avatar: 4, color: '#8A5A2B', country: 'DE', points: 120, won: 3, played: 8 },
];

async function ensureCrew(member: Crew): Promise<string> {
  const email = `crew-${member.slug}@demo.empireofbits.invalid`;
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  let id = list?.users.find((u) => u.email === email)?.id;
  if (!id) {
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true, password: `demo-${member.slug}-${Date.now()}` });
    if (error || !data.user) throw new Error(`create ${member.name}: ${error?.message}`);
    id = data.user.id;
  }
  // Scores go through the secret key (RLS trigger only blocks user JWTs).
  const { error } = await db
    .from('profiles')
    .update({
      name: member.name,
      avatar_id: member.avatar,
      avatar_color: member.color,
      country_code: member.country,
      rank_points: member.points,
      battles_played: member.played,
      battles_won: member.won,
      coins: member.won * 50 + (member.played - member.won) * 10,
      has_completed_tutorial: true,
    })
    .eq('id', id);
  if (error) throw new Error(`profile ${member.name}: ${error.message}`);
  return id;
}

async function findMe(): Promise<string> {
  if (explicitId) return explicitId;
  if (byName) {
    const { data } = await db.from('profiles').select('id,updated_at').eq('name', byName).order('updated_at', { ascending: false }).limit(1);
    const id = data?.[0]?.id;
    if (id) return id;
    throw new Error(`no profile named "${byName}"`);
  }
  throw new Error('pass your user id (the demo menu shows it) or --name "<your name>"');
}

async function main(): Promise<void> {
  const me = await findMe();
  const { data: mine } = await db.from('profiles').select('name,rank_points,battles_played,battles_won,coins').eq('id', me).single();
  if (!mine) throw new Error(`no profile for ${me}`);
  console.log(`you: ${mine.name} (${me}) — ${mine.rank_points} pts, ${mine.battles_won}/${mine.battles_played}`);

  const crewIds: string[] = [];
  for (const member of CREW) {
    crewIds.push(await ensureCrew(member));
    console.log(`crew ${member.name.padEnd(8)} ${String(member.points).padStart(5)} pts`);
  }

  // History: a run of finished matches against the crew over the last 14 days.
  const { count } = await db.from('matches').select('*', { count: 'exact', head: true }).or(`player_a.eq.${me},player_b.eq.${me}`).not('ended_at', 'is', null);
  if ((count ?? 0) < 8) {
    const rows = [];
    for (let i = 0; i < 12; i++) {
      const opp = crewIds[i % crewIds.length]!;
      const won = i % 3 !== 2; // two wins in three
      const start = new Date(Date.now() - (14 - i) * 86_400_000 - i * 3_600_000);
      const end = new Date(start.getTime() + 6 * 60_000 + i * 20_000);
      rows.push({
        mode: i % 2 === 0 ? 'advanced' : 'classic',
        player_a: i % 2 === 0 ? me : opp,
        player_b: i % 2 === 0 ? opp : me,
        winner: won ? me : opp,
        seed: 1000 + i,
        started_at: start.toISOString(),
        ended_at: end.toISOString(),
        end_reason: won ? 'victory' : i % 4 === 3 ? 'resign' : 'victory',
      });
    }
    const { error } = await db.from('matches').insert(rows);
    if (error) throw new Error(`matches: ${error.message}`);
    console.log(`history: ${rows.length} finished matches written`);
  } else {
    console.log(`history: ${count} finished matches already there, skipped`);
  }

  if (mine.rank_points < targetPoints) {
    const { error } = await db
      .from('profiles')
      .update({
        rank_points: targetPoints,
        battles_played: Math.max(mine.battles_played, 31),
        battles_won: Math.max(mine.battles_won, 19),
        coins: Math.max(mine.coins, 1240),
      })
      .eq('id', me);
    if (error) throw new Error(`bump: ${error.message}`);
    console.log(`you are now at ${targetPoints} pts (Chief Ship Petty Officer at 1000, Captain at 3000)`);
  } else {
    console.log(`you already have ${mine.rank_points} pts (target ${targetPoints}), not touched`);
  }

  const { data: ladder } = await db.from('profiles').select('name,rank_points').eq('is_bot', false).order('rank_points', { ascending: false }).limit(10);
  console.log('\nladder:');
  for (const [i, row] of (ladder ?? []).entries()) console.log(`  ${String(i + 1).padStart(2)}. ${row.name.padEnd(10)} ${row.rank_points}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

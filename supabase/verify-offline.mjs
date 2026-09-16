import { PGlite } from '@electric-sql/pglite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const db = new PGlite();
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + msg); };
const q = (sql, params) => db.query(sql, params);
const fails_with = async (sql, params, codeOrText) => {
  try { await q(sql, params); return false; } catch (e) { return String(e.code ?? '') === codeOrText || String(e.message).includes(codeOrText); }
};

// ---- Supabase stand-ins: the parts of auth.* and realtime.* the migrations touch ----
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key, instance_id uuid, aud text, role text, email text,
    is_anonymous boolean not null default false,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid $$;
  create schema realtime;
  create table realtime.messages (id bigserial primary key, topic text not null, extension text not null, payload jsonb, inserted_at timestamptz default now());
  -- Real Supabase projects ship this table with RLS already on, and you don't
  -- own it there (0005 relies on that and only adds policies). This stub
  -- table is ours, though, so turn RLS on ourselves or every policy below is
  -- inert and every query silently bypasses them.
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
  grant usage on schema public, auth, realtime to anon, authenticated, service_role;
  grant select, insert on realtime.messages to authenticated;
  grant usage, select on all sequences in schema realtime to authenticated;
`);

// ---- apply every migration, in order, twice (idempotency) ----
const files = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
for (const pass of [1, 2]) {
  for (const f of files) {
    try { await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8')); }
    catch (e) {
      fails++;
      const at = e.position ? ` at character ${e.position}` : '';
      console.log(`FAIL pass ${pass} ${f}: ${e.message}${at}`);
    }
  }
  console.log(`ok    pass ${pass}: ${files.join(', ')} applied`);
}

// ---- sign-up trigger ----
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
await q(`insert into auth.users (id, email) values ($1, null), ($2, null), ($3, null)`, [A, B, C]);
// The bot's row (0006) is seeded before this and renamed away from the
// generated pattern on purpose, so check only the three fresh sign-ups.
const names = (await q(`select id, name, gems, avatar_color from public.profiles where id in ($1, $2, $3) order by id`, [A, B, C])).rows;
check(names.length === 3 && names.every((r) => /^Sailor \d{4}$/.test(r.name)), `sign-up trigger made profiles with generated names: ${names.map((r) => r.name).join(', ')}`);
check(names.every((r) => r.gems === 10 && r.avatar_color === 'violet'), 'defaults: gems 10, avatar_color violet');

const asUser = async (id) => { await db.exec(`set role authenticated`); await q(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'authenticated', sub: id })]); };
const asServer = async () => { await db.exec(`reset role`); await q(`select set_config('request.jwt.claims', '', false)`); };

// ---- RLS + guard ----
await asUser(A);
let r = await q(`update public.profiles set rank_points = 9999 where id = $1`, [B]);
check(r.affectedRows === 0, "user A updating user B's rank_points touches 0 rows (RLS)");
r = await q(`update public.profiles set name = 'Hacked' where id = $1`, [B]);
check(r.affectedRows === 0, "user A updating user B's name touches 0 rows (RLS)");
check(await fails_with(`update public.profiles set rank_points = 9999 where id = $1`, [A], '42501'), 'user A updating THEIR OWN rank_points is rejected (42501)');
check(await fails_with(`update public.profiles set coins = coins + 1 where id = $1`, [A], '42501'), 'user A updating their own coins is rejected');
check(await fails_with(`update public.profiles set battles_won = 1 where id = $1`, [A], '42501'), 'user A updating their own battles_won is rejected');
r = await q(`update public.profiles set name = 'Ayush', avatar_id = 2, avatar_color = '#8A5A2B', country_code = 'IN', has_completed_tutorial = true where id = $1`, [A]);
check(r.affectedRows === 1, 'user A updating own name/avatar/colour/country/tutorial flag works');
check(await fails_with(`update public.profiles set name = '' where id = $1`, [A], '23514'), 'empty name violates the 1-14 check');
check(await fails_with(`update public.profiles set name = 'fifteen chars!!' where id = $1`, [A], '23514'), '15-char name violates the check');
check(await fails_with(`insert into public.profiles (id, name) values ($1, 'X')`, [C], '42501'), "user A cannot insert a row with someone else's id");
// 3 fresh sign-ups plus the fixed bot profile seeded by 0006.
const seen = (await q(`select count(*)::int as n from public.profiles`)).rows[0].n;
check(seen === 4, 'authenticated users can read every profile (opponent cards, leaderboard)');

await asServer();
r = await q(`update public.profiles set rank_points = 139, battles_played = 1, battles_won = 1, coins = 50 where id = $1`, [A]);
check(r.affectedRows === 1 && (await q(`select rank_points from public.profiles where id = $1`, [A])).rows[0].rank_points === 139, 'the server (no user JWT) writes scores');

// ---- matches / events ----
const m = (await q(`insert into public.matches (mode, player_a, player_b, seed) values ('classic', $1, $2, 42) returning id`, [B, C])).rows[0].id;
await q(`insert into public.match_events (match_id, seq, payload) values ($1, 1, '{"type":"MATCH_STARTED"}'), ($1, 2, '{"type":"HIT"}')`, [m]);
check(await fails_with(`insert into public.match_events (match_id, seq, payload) values ($1, 2, '{}')`, [m], '23505'), 'duplicate (match_id, seq) is rejected');
await asUser(A);
check((await q(`select count(*)::int as n from public.matches`)).rows[0].n === 0, "user A (not in the match) sees 0 matches");
check((await q(`select count(*)::int as n from public.match_events`)).rows[0].n === 0, 'user A sees 0 match events');
check(await fails_with(`insert into public.matches (mode, player_a, player_b, seed) values ('classic', $1, $2, 1)`, [A, B], '42501'), 'user A cannot insert a match');
await asUser(B);
check((await q(`select count(*)::int as n from public.matches`)).rows[0].n === 1, 'user B (player_a) sees their match');
check((await q(`select count(*)::int as n from public.match_events`)).rows[0].n === 2, 'user B reads the replay log of their match');

// ---- ranks + leaderboard ----
const ranks = (await q(`select id, name, points_required from public.ranks order by id`)).rows;
check(ranks.length === 6 && ranks[5].name === 'Vice-admiral' && ranks[5].points_required === 10000 && ranks[1].points_required === 100, 'ranks seeded per the brief');
const lb = await q(`select * from public.leaderboard`);
check(lb.rows.length === 3 && lb.rows[0].name === 'Ayush' && lb.rows[0].rank_points === 139, 'leaderboard orders by rank_points');
check(!('id' in lb.rows[0]) && !('email' in lb.rows[0]) && Object.keys(lb.rows[0]).sort().join() === 'avatar_color,avatar_id,battles_won,country_code,name,rank_points', `leaderboard exposes only the public columns: ${Object.keys(lb.rows[0]).join(', ')}`);

// ---- realtime policies ----
const topic = async (t) => q(`select set_config('realtime.topic', $1, false)`, [t]);
await asUser(A); await topic(`match:${m}`);
check(await fails_with(`insert into realtime.messages (topic, extension, payload) values ($1, 'broadcast', '{"emote":1}')`, [`match:${m}`], '42501'), "user A cannot broadcast on match:{id} of a match they're not in");
await topic('lobby:classic');
r = await q(`insert into realtime.messages (topic, extension, payload) values ('lobby:classic', 'presence', '{}')`);
check(r.affectedRows === 1, 'user A can join lobby:classic presence');
await asUser(B); await topic(`match:${m}`);
r = await q(`insert into realtime.messages (topic, extension, payload) values ($1, 'broadcast', '{"emote":2}')`, [`match:${m}`]);
check(r.affectedRows === 1, "user B (in the match) can broadcast on match:{id}");
check(await fails_with(`insert into realtime.messages (topic, extension, payload) values ($1, 'presence', '{}')`, [`match:${m}`], '42501'), 'presence on a match topic is not allowed (broadcast only)');
await asServer();
const visibleToB = await (async () => { await asUser(B); await topic(`match:${m}`); const n = (await q(`select count(*)::int as n from realtime.messages where topic = $1`, [`match:${m}`])).rows[0].n; await asServer(); return n; })();
check(visibleToB === 1, 'user B reads the broadcast on their match topic');

// ---- the matchmaking bot (0006) ----
const BOT = 'b0000000-0000-4000-8000-000000000001';
const bot = (await q(`select name, is_bot from public.profiles where id = $1`, [BOT])).rows[0];
check(!!bot && bot.name === 'Berhan' && bot.is_bot === true, `the fixed bot profile exists and is flagged (${JSON.stringify(bot)})`);
// A is not the bot, so RLS's USING clause already excludes the row — same
// silent 0-row shape as updating any other stranger's profile. (The block
// above left the session as the server role — switch back to a client.)
await asUser(A);
r = await q(`update public.profiles set rank_points = 1 where id = $1`, [BOT]);
check(r.affectedRows === 0, "a client cannot touch the bot's row either (RLS: not their own)");

await asServer();
const botMatch = (await q(`insert into public.matches (mode, player_a, player_b, seed, is_bot) values ('classic', $1, $2, 1, true) returning id`, [A, BOT])).rows[0].id;
await asUser(A);
const seenBotMatch = (await q(`select is_bot from public.matches where id = $1`, [botMatch])).rows[0];
check(seenBotMatch?.is_bot === true, 'a player can see their own match is flagged is_bot');

const lbNoBot = await q(`select name from public.leaderboard`);
check(!lbNoBot.rows.some((r) => r.name === 'Berhan'), 'the bot never appears on the leaderboard');

// ---- settling a match in one transaction (0008) ----
await asServer();
const settled = (await q(`insert into public.matches (mode, player_a, player_b, seed) values ('classic', $1, $2, 7) returning id`, [A, B])).rows[0].id;
const before = async (id) => (await q(`select rank_points, coins, battles_played, battles_won from public.profiles where id = $1`, [id])).rows[0];
const a0 = await before(A); const b0 = await before(B);
r = await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as ok`, [settled, A]);
check(r.rows[0].ok === true, 'apply_match_result settles an open match');
const a1 = await before(A); const b1 = await before(B);
check(a1.rank_points === a0.rank_points + 25 && a1.coins === a0.coins + 50 && a1.battles_played === a0.battles_played + 1 && a1.battles_won === a0.battles_won + 1, 'the winner gets +25 points, +50 coins, +1 played, +1 won');
check(b1.rank_points === b0.rank_points + 5 && b1.coins === b0.coins + 10 && b1.battles_played === b0.battles_played + 1 && b1.battles_won === b0.battles_won, 'the loser gets +5 points, +10 coins, +1 played, +0 won');
const closed = (await q(`select winner, end_reason, ended_at from public.matches where id = $1`, [settled])).rows[0];
check(closed.winner === A && closed.end_reason === 'victory' && closed.ended_at !== null, 'the matches row is closed with winner and reason');
r = await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as ok`, [settled, A]);
const a2 = await before(A);
check(r.rows[0].ok === false && a2.rank_points === a1.rank_points, 'a second call is a no-op (idempotent: returns false, nothing moves)');
const open2 = (await q(`insert into public.matches (mode, player_a, player_b, seed) values ('classic', $1, $2, 8) returning id`, [A, B])).rows[0].id;
check(await fails_with(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10)`, [open2, C], 'P0001'), 'a winner who is not in the match is rejected, and nothing is written');
const stillOpen = (await q(`select ended_at from public.matches where id = $1`, [open2])).rows[0];
check(stillOpen.ended_at === null, '…the match stays open after the rejected call (one transaction)');
r = await q(`select public.apply_match_result($1, $2, 'timeout', 25, 50, 5, 10) as ok`, [botMatch, A]);
const botAfter = (await q(`select rank_points, battles_played from public.profiles where id = $1`, [BOT])).rows[0];
check(r.rows[0].ok === true && botAfter.rank_points === 0 && botAfter.battles_played === 0, "settling a bot match never touches the bot's row");
await asUser(A);
check(await fails_with(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10)`, [open2, A], '42501'), 'a client JWT cannot call apply_match_result');

// ---- the leaderboard knows "you" without exposing ids (0008) ----
await asUser(A);
const ladder8 = await q(`select * from public.leaderboard`);
check(ladder8.rows.length > 0 && !('id' in ladder8.rows[0]) && !('is_me' in ladder8.rows[0]), `leaderboard columns unchanged: ${Object.keys(ladder8.rows[0] ?? {}).join(',')}`);
const mine = (await q(`select * from public.my_leaderboard_row()`)).rows;
check(mine.length === 1 && mine[0].rank_position === 1 && !('id' in mine[0]), `my_leaderboard_row gives A position 1 with no id (${JSON.stringify(mine[0])})`);
const meRow = ladder8.rows[mine[0].rank_position - 1];
check(meRow?.name === mine[0].name && meRow?.rank_points === mine[0].rank_points, 'position indexes the same ordering as the view (row position-1 is "you")');
await asUser(C);
const mineC = (await q(`select * from public.my_leaderboard_row()`)).rows;
check(mineC.length === 1 && mineC[0].rank_position === 3, `user C (no games) is position 3 (${mineC[0]?.rank_position})`);
await asServer();
check((await q(`select * from public.my_leaderboard_row()`)).rows.length === 0, 'my_leaderboard_row without a session returns no rows');

// ---- verified Privy account boundary (0009) ----
const syncPrivy = (did, email) => q(
  `select public.sync_privy_account($1, $2, $3, $4, 'google', $5, $6, $7::jsonb, $8::timestamptz)`,
  [A, did, email, 'Captain Ada', 'SolanaAddress', 'wallet-1', '[{"type":"google_oauth"}]', '2023-11-14T22:13:20.000Z'],
);
await syncPrivy('did:privy:captain', 'captain@gmail.com');
let privyRow = (await q(`select * from public.privy_accounts where profile_id = $1`, [A])).rows[0];
check(privyRow?.privy_user_id === 'did:privy:captain' && privyRow?.solana_wallet_address === 'SolanaAddress', 'server stores the verified Privy DID and embedded Solana wallet');
await syncPrivy('did:privy:captain', 'new@gmail.com');
privyRow = (await q(`select email from public.privy_accounts where profile_id = $1`, [A])).rows[0];
check(privyRow?.email === 'new@gmail.com', 'the same Privy user can refresh trusted account fields');
check(await fails_with(
  `select public.sync_privy_account($1, 'did:privy:attacker', 'x@example.com', null, 'email', null, null, '[]'::jsonb, now())`,
  [A],
  '23505',
), 'a different Privy user cannot take over an existing gameplay profile');
await asUser(A);
check(await fails_with(`select * from public.privy_accounts`, [], '42501'), 'clients cannot read verified Privy account rows');
check(await fails_with(
  `select public.sync_privy_account($1, 'did:privy:client', null, null, 'email', null, null, '[]'::jsonb, now())`,
  [A],
  '42501',
), 'clients cannot invoke the Privy sync function');

// ---- universal points, wagers, and replay-safe trades (0010) ----
await asServer();
await q(
  `select public.sync_privy_account($1, 'did:privy:challenger', 'b@example.com', 'Challenger', 'email', 'SolanaB', 'wallet-b', '[]'::jsonb, now())`,
  [B],
);
let pointInit = (await q(`select * from public.ensure_point_account($1, 'did:privy:captain')`, [A])).rows[0];
check(Number(pointInit.balance) === 100 && pointInit.welcome_awarded === true, 'a verified Privy user receives the one-time 100-point welcome award');
pointInit = (await q(`select * from public.ensure_point_account($1, 'did:privy:captain')`, [A])).rows[0];
check(Number(pointInit.balance) === 100 && pointInit.welcome_awarded === false, 're-syncing the same Privy user never repeats the welcome award');
await q(`select * from public.ensure_point_account($1, 'did:privy:challenger')`, [B]);

const HOLD_CANCEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
let hold = (await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, HOLD_CANCEL])).rows[0];
check(hold.ok === true && Number(hold.balance) === 50, 'reserving a wager atomically deducts 50 points');
hold = (await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, HOLD_CANCEL])).rows[0];
check(hold.ok === true && Number(hold.balance) === 50, 'replaying the same wager reservation never deducts twice');
let pointBalance = (await q(`select public.refund_point_wager($1, $2) as balance`, [A, HOLD_CANCEL])).rows[0].balance;
check(Number(pointBalance) === 100, 'cancelling matchmaking restores the wager stake');
pointBalance = (await q(`select public.refund_point_wager($1, $2) as balance`, [A, HOLD_CANCEL])).rows[0].balance;
check(Number(pointBalance) === 100, 'replaying a wager refund never credits twice');

const HOLD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const HOLD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const WAGER_MATCH = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, HOLD_A]);
await q(`select * from public.reserve_point_wager($1, $2, 50)`, [B, HOLD_B]);
await q(`select public.create_wagered_match($1, 'classic', $2, $3, 99, false, $4, $5)`, [WAGER_MATCH, A, B, HOLD_A, HOLD_B]);
r = await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as ok`, [WAGER_MATCH, A]);
const wagerBalances = (await q(`select privy_user_id, balance from public.point_accounts order by privy_user_id`)).rows;
check(r.rows[0].ok === true && Number(wagerBalances.find((x) => x.privy_user_id === 'did:privy:captain')?.balance) === 150 && Number(wagerBalances.find((x) => x.privy_user_id === 'did:privy:challenger')?.balance) === 50, 'PvP wager settlement pays the 100-point pot to the winner exactly once');
r = await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as ok`, [WAGER_MATCH, A]);
check(r.rows[0].ok === false && Number((await q(`select public.get_point_balance($1) as balance`, [A])).rows[0].balance) === 150, 'replaying match settlement cannot pay the wager twice');

const BOT_HOLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const BOT_WAGER_MATCH = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, BOT_HOLD]);
await q(`select public.create_wagered_match($1, 'advanced', $2, $3, 100, true, $4, null)`, [BOT_WAGER_MATCH, A, BOT, BOT_HOLD]);
await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10)`, [BOT_WAGER_MATCH, A]);
check(Number((await q(`select public.get_point_balance($1) as balance`, [A])).rows[0].balance) === 200, 'winning a bot wager returns 100 points for a net 50-point profit');

// ---- 0012: uint32 seeds, and wagers that settle without a match row ----
// Every block below is balance-neutral overall, so the point trade checks
// that follow still read against A's 200.
const balanceOf = async (id) => Number((await q(`select public.get_point_balance($1) as balance`, [id])).rows[0].balance);

// The match server's seeds are uint32; matches.seed is bigint (0002) but
// 0010 declared the parameter `integer`, so half of them never inserted.
const BIG_SEED_HOLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const BIG_SEED_MATCH = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';
await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, BIG_SEED_HOLD]);
await q(`select public.create_wagered_match($1, 'advanced', $2, $3, 2696002283, true, $4, null)`, [BIG_SEED_MATCH, A, BOT, BIG_SEED_HOLD]);
check(Number((await q(`select seed from public.matches where id = $1`, [BIG_SEED_MATCH])).rows[0].seed) === 2696002283, 'a wagered match accepts a uint32 seed above the int4 ceiling');
await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10)`, [BIG_SEED_MATCH, BOT]);

// An offline wager is played against the device's own AI: no match row, one
// hold, and the hold's status is the only idempotency key there is.
const OFFLINE_WIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const OFFLINE_LOSS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
const staked = await balanceOf(A);
await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, OFFLINE_WIN]);
r = (await q(`select * from public.settle_offline_wager($1, $2, true)`, [A, OFFLINE_WIN])).rows[0];
check(r.settled === true && Number(r.balance) === staked + 50, 'winning an offline wager pays 100 for a net 50-point profit');
r = (await q(`select * from public.settle_offline_wager($1, $2, true)`, [A, OFFLINE_WIN])).rows[0];
check(r.settled === false && (await balanceOf(A)) === staked + 50, 'replaying an offline settlement never pays twice');
await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, OFFLINE_LOSS]);
r = (await q(`select * from public.settle_offline_wager($1, $2, false)`, [A, OFFLINE_LOSS])).rows[0];
check(r.settled === true && Number(r.balance) === staked, 'losing an offline wager keeps the 50-point stake');

const ROOM_HOLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
const ROOM_MATCH = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';
await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, ROOM_HOLD]);
r = (await q(`select * from public.settle_offline_wager($1, $2, true)`, [B, ROOM_HOLD])).rows[0];
check(r.settled === false && (await balanceOf(A)) === staked - 50, 'another profile cannot settle a wager it does not own');
await q(`select public.create_wagered_match($1, 'classic', $2, $3, 7, true, $4, null)`, [ROOM_MATCH, A, BOT, ROOM_HOLD]);
r = (await q(`select * from public.settle_offline_wager($1, $2, true)`, [A, ROOM_HOLD])).rows[0];
check(r.settled === false, 'a hold owned by a server room is never settled as an offline wager');
await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10)`, [ROOM_MATCH, A]);
check((await balanceOf(A)) === 200, 'the offline wager checks left A’s balance where they found it');

const BUY_REQUEST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const BUY_REPLAY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
const BUY_SIGNATURE = 'confirmed-solana-signature-0000000000000001';
pointBalance = (await q(`select public.complete_point_buy($1, $2, $3, 100, 1000000) as balance`, [A, BUY_REQUEST, BUY_SIGNATURE])).rows[0].balance;
check(Number(pointBalance) === 300, 'a backend-verified 0.001 SOL purchase credits 100 points');
pointBalance = (await q(`select public.complete_point_buy($1, $2, $3, 100, 1000000) as balance`, [A, BUY_REQUEST, BUY_SIGNATURE])).rows[0].balance;
check(Number(pointBalance) === 300, 'replaying the same purchase request never credits twice');
check(await fails_with(`select public.complete_point_buy($1, $2, $3, 100, 1000000)`, [A, BUY_REPLAY, BUY_SIGNATURE], '23505'), 'one Solana signature cannot fund two point purchases');

const SELL_REQUEST = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
let sale = (await q(`select * from public.begin_point_sell($1, $2, 100, 1000000)`, [A, SELL_REQUEST])).rows[0];
check(sale.ok === true && Number(sale.balance) === 200, 'starting a sale atomically reserves 100 points');
sale = (await q(`select * from public.begin_point_sell($1, $2, 100, 1000000)`, [A, SELL_REQUEST])).rows[0];
check(Number(sale.balance) === 200, 'replaying a point sale request never deducts twice');
const SELL_SIGNATURE = 'treasury-solana-signature-000000000000001';
await q(`select public.mark_point_sell_broadcast($1, $2, 'signed-transaction', 'blockhash', 12345)`, [SELL_REQUEST, SELL_SIGNATURE]);
pointBalance = (await q(`select public.complete_point_sell($1, $2) as balance`, [SELL_REQUEST, SELL_SIGNATURE])).rows[0].balance;
check(Number(pointBalance) === 200, 'a confirmed treasury payout completes without another balance mutation');

const REFUND_REQUEST = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
await q(`select * from public.begin_point_sell($1, $2, 100, 1000000)`, [A, REFUND_REQUEST]);
pointBalance = (await q(`select public.refund_point_sell($1, 'treasury unavailable') as balance`, [REFUND_REQUEST])).rows[0].balance;
check(Number(pointBalance) === 200, 'a failed treasury payout restores every reserved point');
pointBalance = (await q(`select public.refund_point_sell($1, 'retry') as balance`, [REFUND_REQUEST])).rows[0].balance;
check(Number(pointBalance) === 200, 'replaying a sale refund never credits twice');

await asUser(A);
check(await fails_with(`select * from public.point_accounts`, [], '42501'), 'clients cannot read server-owned point balances directly');
check(await fails_with(`select * from public.reserve_point_wager($1, $2, 50)`, [A, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'], '42501'), 'clients cannot reserve or mutate wager points directly');

console.log(fails ? `\n${fails} FAILED` : '\nall database checks passed');
process.exit(fails ? 1 : 0);

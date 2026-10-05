import { PGlite } from '@electric-sql/pglite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + msg); };

/** A fresh in-process Postgres with the Supabase stand-ins below already in it. */
async function freshDb() {
  const fresh = new PGlite();
  await fresh.exec(STAND_INS);
  return fresh;
}

// ---- Supabase stand-ins: the parts of auth.* and realtime.* the migrations touch ----
const STAND_INS = `
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
`;

const db = await freshDb();
const q = (sql, params) => db.query(sql, params);
const fails_with = async (sql, params, codeOrText) => {
  try { await q(sql, params); return false; } catch (e) { return String(e.code ?? '') === codeOrText || String(e.message).includes(codeOrText); }
};

// ---- apply every migration, in order, twice (idempotency) ----
const files = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
async function applyMigrations(target, list, label) {
  for (const f of list) {
    try { await target.exec(fs.readFileSync(path.join(MIG, f), 'utf8')); }
    catch (e) {
      fails++;
      const at = e.position ? ` at character ${e.position}` : '';
      console.log(`FAIL ${label} ${f}: ${e.message}${at}`);
    }
  }
}
for (const pass of [1, 2]) {
  await applyMigrations(db, files, `pass ${pass}`);
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

// ---- universal points, wagers, and replay-safe trades (0010, 0014) ----
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

// 0014: welcome points are play money. They can be staked and won with, but
// never sold, and that has to survive every way points move between accounts.
const pointsOf = async (id) => {
  try {
    const row = (await q(`select * from public.get_point_balances($1)`, [id])).rows[0];
    return { balance: Number(row.balance), locked: Number(row.locked), sellable: Number(row.sellable) };
  } catch (e) {
    // Reported as failed checks, so one missing function can't hide the rest.
    return { balance: NaN, locked: NaN, sellable: NaN, error: e.message };
  }
};
let pts = await pointsOf(A);
check(pts.balance === 100 && pts.locked === 100 && pts.sellable === 0, `the welcome award is locked: playable, not sellable (${JSON.stringify(pts)})`);
const WELCOME_SALE = 'ffffffff-ffff-4fff-8fff-fffffffffff0';
let sale = (await q(`select * from public.begin_point_sell($1, $2, 100, 1000000)`, [A, WELCOME_SALE])).rows[0];
check(sale.ok === false && sale.reason === 'locked_points' && Number(sale.balance) === 100, 'welcome points cannot be sold for SOL');
check((await q(`select count(*)::int as n from public.point_trades where request_id = $1`, [WELCOME_SALE])).rows[0].n === 0, '…and the refused sale leaves no trade behind');

const HOLD_CANCEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
let hold = (await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, HOLD_CANCEL])).rows[0];
check(hold.ok === true && Number(hold.balance) === 50, 'reserving a wager atomically deducts 50 points');
check((await pointsOf(A)).locked === 50, 'a stake is drawn from welcome points first');
hold = (await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, HOLD_CANCEL])).rows[0];
check(hold.ok === true && Number(hold.balance) === 50, 'replaying the same wager reservation never deducts twice');
let pointBalance = (await q(`select public.refund_point_wager($1, $2) as balance`, [A, HOLD_CANCEL])).rows[0].balance;
check(Number(pointBalance) === 100, 'cancelling matchmaking restores the wager stake');
check((await pointsOf(A)).locked === 100, 'a refunded stake comes back as the welcome points it was');
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
check((await pointsOf(A)).locked === 150 && (await pointsOf(B)).locked === 50, 'a pot staked from welcome points is paid as welcome points (no laundering them through a wager)');
r = await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as ok`, [WAGER_MATCH, A]);
check(r.rows[0].ok === false && Number((await q(`select public.get_point_balance($1) as balance`, [A])).rows[0].balance) === 150, 'replaying match settlement cannot pay the wager twice');

const BOT_HOLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const BOT_WAGER_MATCH = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, BOT_HOLD]);
await q(`select public.create_wagered_match($1, 'advanced', $2, $3, 100, true, $4, null)`, [BOT_WAGER_MATCH, A, BOT, BOT_HOLD]);
await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10)`, [BOT_WAGER_MATCH, A]);
check(Number((await q(`select public.get_point_balance($1) as balance`, [A])).rows[0].balance) === 200, 'winning a bot wager returns 100 points for a net 50-point profit');
check((await pointsOf(A)).locked === 200, "beating the bot with welcome points pays welcome points (the house matches the stake's kind)");

// ---- 0012: uint32 seeds; 0014: no offline wagers ----
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

// Only a match the server ran from start to finish can carry a stake. The
// device-reported settlement for a wager against the phone's own AI is gone.
check((await q(`select to_regprocedure('public.settle_offline_wager(uuid,uuid,boolean)') as fn`)).rows[0].fn === null, 'there is no offline-wager settlement left to call');

const ROOM_HOLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
const ROOM_MATCH = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';
await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, ROOM_HOLD]);
await q(`select public.create_wagered_match($1, 'classic', $2, $3, 7, true, $4, null)`, [ROOM_MATCH, A, BOT, ROOM_HOLD]);
await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10)`, [ROOM_MATCH, A]);
check((await balanceOf(A)) === 200, 'the seed and bot-room checks left A’s balance where they found it');

// 0013 - both captains walked out: nobody wins, and no stake comes back.
const ABANDON_HOLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8';
const ABANDON_MATCH = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5';
await q(`select * from public.reserve_point_wager($1, $2, 50)`, [A, ABANDON_HOLD]);
await q(`select public.create_wagered_match($1, 'classic', $2, $3, 11, true, $4, null)`, [ABANDON_MATCH, A, BOT, ABANDON_HOLD]);
const beforeAbandon = { balance: await balanceOf(A), points: Number((await q(`select rank_points from public.profiles where id = $1`, [A])).rows[0].rank_points) };
r = (await q(`select public.abandon_match($1) as ok`, [ABANDON_MATCH])).rows[0];
const abandoned = (await q(`select winner, ended_at, end_reason from public.matches where id = $1`, [ABANDON_MATCH])).rows[0];
check(r.ok === true && abandoned.winner === null && abandoned.ended_at !== null, 'abandoning closes the match with no winner');
check((await balanceOf(A)) === beforeAbandon.balance, 'an abandoned wager returns nothing to either captain');
check(Number((await q(`select rank_points from public.profiles where id = $1`, [A])).rows[0].rank_points) === beforeAbandon.points, 'an abandoned match moves no rank points');
check((await q(`select count(*)::int as n from public.point_wager_holds where match_id = $1 and status = 'settled'`, [ABANDON_MATCH])).rows[0].n === 1, 'the abandoned stake is settled, not left held');
check((await q(`select public.abandon_match($1) as ok`, [ABANDON_MATCH])).rows[0].ok === false, 'abandoning twice changes nothing');
check((await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as ok`, [ABANDON_MATCH, A])).rows[0].ok === false, 'an abandoned match can never be settled for a winner afterwards');
// That stake is gone for good, which is the point. Put it back by hand (it
// was welcome points) so the point-trade checks below can keep asserting
// absolute balances.
await q(`update public.point_accounts set balance = balance + 50, locked_points = locked_points + 50 where privy_user_id = public.point_identity_for_profile($1)`, [A]);
check((await balanceOf(A)) === 200, 'the abandonment checks left A’s balance where they found it');

const BUY_REQUEST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const BUY_REPLAY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
const BUY_SIGNATURE = 'confirmed-solana-signature-0000000000000001';
pointBalance = (await q(`select public.complete_point_buy($1, $2, $3, 100, 1000000) as balance`, [A, BUY_REQUEST, BUY_SIGNATURE])).rows[0].balance;
check(Number(pointBalance) === 300, 'a backend-verified 0.001 SOL purchase credits 100 points');
pts = await pointsOf(A);
check(pts.locked === 200 && pts.sellable === 100, `points bought with SOL are sellable; welcome points stay locked (${JSON.stringify(pts)})`);
pointBalance = (await q(`select public.complete_point_buy($1, $2, $3, 100, 1000000) as balance`, [A, BUY_REQUEST, BUY_SIGNATURE])).rows[0].balance;
check(Number(pointBalance) === 300, 'replaying the same purchase request never credits twice');
check(await fails_with(`select public.complete_point_buy($1, $2, $3, 100, 1000000)`, [A, BUY_REPLAY, BUY_SIGNATURE], '23505'), 'one Solana signature cannot fund two point purchases');

const SELL_REQUEST = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
sale = (await q(`select * from public.begin_point_sell($1, $2, 100, 1000000)`, [A, SELL_REQUEST])).rows[0];
check(sale.ok === true && Number(sale.balance) === 200, 'starting a sale atomically reserves 100 points');
sale = (await q(`select * from public.begin_point_sell($1, $2, 100, 1000000)`, [A, SELL_REQUEST])).rows[0];
check(Number(sale.balance) === 200, 'replaying a point sale request never deducts twice');
const SELL_SIGNATURE = 'treasury-solana-signature-000000000000001';
await q(`select public.mark_point_sell_broadcast($1, $2, 'signed-transaction', 'blockhash', 12345)`, [SELL_REQUEST, SELL_SIGNATURE]);
pointBalance = (await q(`select public.complete_point_sell($1, $2) as balance`, [SELL_REQUEST, SELL_SIGNATURE])).rows[0].balance;
check(Number(pointBalance) === 200, 'a confirmed treasury payout completes without another balance mutation');
const DIP_SALE = 'ffffffff-ffff-4fff-8fff-fffffffffff3';
sale = (await q(`select * from public.begin_point_sell($1, $2, 100, 1000000)`, [A, DIP_SALE])).rows[0];
check(sale.ok === false && sale.reason === 'locked_points' && (await balanceOf(A)) === 200, 'a sale never dips into welcome points, however many are held');

// A second purchase funds the refund path.
await q(`select public.complete_point_buy($1, $2, $3, 100, 1000000)`, [A, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 'confirmed-solana-signature-0000000000000003']);
const REFUND_REQUEST = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
await q(`select * from public.begin_point_sell($1, $2, 100, 1000000)`, [A, REFUND_REQUEST]);
pointBalance = (await q(`select public.refund_point_sell($1, 'treasury unavailable') as balance`, [REFUND_REQUEST])).rows[0].balance;
check(Number(pointBalance) === 300, 'a failed treasury payout restores every reserved point');
check((await pointsOf(A)).sellable === 100, '…as sellable points, the kind that was reserved');
pointBalance = (await q(`select public.refund_point_sell($1, 'retry') as balance`, [REFUND_REQUEST])).rows[0].balance;
check(Number(pointBalance) === 300, 'replaying a sale refund never credits twice');

await asUser(A);
check(await fails_with(`select * from public.point_accounts`, [], '42501'), 'clients cannot read server-owned point balances directly');
check(await fails_with(`select * from public.get_point_balances($1)`, [A], '42501'), 'clients cannot read the locked/sellable split directly either');
check(await fails_with(`select * from public.reserve_point_wager($1, $2, 50)`, [A, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'], '42501'), 'clients cannot reserve or mutate wager points directly');

// ---- 0016: a match cancelled before it started closes with no result ----
{
  await asServer();
  const scores = async () => (await q(`select id, rank_points, coins, battles_played, battles_won from public.profiles where id in ($1, $2) order by id`, [A, B])).rows;
  const before16 = JSON.stringify(await scores());
  const CANCELLED = (await q(`insert into public.matches (mode, player_a, player_b, seed) values ('classic', $1, $2, 16) returning id`, [A, B])).rows[0].id;
  let ok = await q(`select public.cancel_match_before_start($1, $2) as ok`, [CANCELLED, A]).then((x) => x.rows[0].ok, (e) => `error: ${e.message}`);
  const row = (await q(`select winner, ended_at, end_reason from public.matches where id = $1`, [CANCELLED])).rows[0];
  check(ok === true && row.winner === null && row.ended_at !== null && row.end_reason === 'cancelled', `a pre-start cancel closes the match with no result (${ok}, ${row?.end_reason})`);
  check(JSON.stringify(await scores()) === before16, '…and moves no rank, coins or battles for either captain');
  ok = await q(`select public.cancel_match_before_start($1, $2) as ok`, [CANCELLED, A]).then((x) => x.rows[0].ok, (e) => `error: ${e.message}`);
  check(ok === false, 'cancelling twice changes nothing');
  check((await q(`select public.apply_match_result($1, $2, 'victory', 25, 50, 5, 10) as ok`, [CANCELLED, B])).rows[0].ok === false, 'a cancelled match can never be settled for a winner afterwards');
  const OPEN = (await q(`insert into public.matches (mode, player_a, player_b, seed) values ('classic', $1, $2, 17) returning id`, [A, B])).rows[0].id;
  check(await fails_with(`select public.cancel_match_before_start($1, $2)`, [OPEN, C], '42501'), 'only a player in the match can cancel it');
  await asUser(A);
  check(await fails_with(`select public.cancel_match_before_start($1, $2)`, [OPEN, A], '42501'), 'clients cannot call it directly');
  await asServer();
}

// ---- 0015: offline and hot-seat results never touch the ladder ----
// The device reports these itself, so they pay coins (cosmetics) and nothing
// the leaderboard ranks by: no rank points, no battles played or won.
{
  await asServer();
  const ladder = async (id) => (await q(`select rank_points, coins, battles_played, battles_won from public.profiles where id = $1`, [id])).rows[0];
  const c0 = await ladder(C);
  let ok = await q(`select public.apply_offline_result('hotseat-farm-1', $1, 'hotseat', true, now(), 50, 10) as ok`, [C]).then((x) => x.rows[0].ok, (e) => `error: ${e.message}`);
  const c1 = await ladder(C);
  check(ok === true && c1.coins === c0.coins + 50, `an offline win still pays its coins (${ok})`);
  check(c1.rank_points === c0.rank_points && c1.battles_played === c0.battles_played && c1.battles_won === c0.battles_won, 'an offline win moves nothing the ladder ranks by');
  ok = await q(`select public.apply_offline_result('hotseat-farm-1', $1, 'hotseat', true, now(), 50, 10) as ok`, [C]).then((x) => x.rows[0].ok, (e) => `error: ${e.message}`);
  check(ok === false && (await ladder(C)).coins === c1.coins, 'replaying an offline result never pays twice');
  ok = await q(`select public.apply_offline_result('ai-loss-1', $1, 'ai', false, now(), 50, 10) as ok`, [C]).then((x) => x.rows[0].ok, (e) => `error: ${e.message}`);
  check(ok === true && (await ladder(C)).coins === c1.coins + 10, 'an offline loss pays the loss coins the server passes in');
  check((await q(`select to_regprocedure('public.apply_offline_result(text,uuid,text,boolean,timestamptz)') as fn`)).rows[0].fn === null, 'the old offline settlement that paid ladder points is gone');
  const marked = await q(`select ladder_points from public.offline_results where id = 'hotseat-farm-1'`).then((x) => x.rows[0]?.ladder_points, (e) => `error: ${e.message}`);
  check(marked === 0, `a result paid under the new rules is marked as counting 0 ladder points (${marked})`);
  await asUser(C);
  check(await fails_with(`select public.apply_offline_result('client-call', $1, 'ai', true, now(), 50, 10)`, [C], '42501'), 'clients still cannot report their own offline results');
  check(await fails_with(`select * from public.offline_ladder_corrections`, [], '42501'), 'clients cannot read the ladder correction log (0017)');
  await asServer();
}

// ---- 0014 backfill: balances that existed when welcome points were locked ----
// A separate database, so these legacy captains can't disturb the counts and
// the ladder checked above. Every history below was legal under 0010-0013.
{
  const legacy = await freshDb();
  const lq = (sql, params) => legacy.query(sql, params);
  await applyMigrations(legacy, files.filter((f) => f < '0014'), 'legacy, before 0014:');

  const L = {
    welcome: '44444444-4444-4444-8444-444444444401', // never did anything
    bought: '44444444-4444-4444-8444-444444444402', // bought 100 on top
    relapsed: '44444444-4444-4444-8444-444444444403', // lost the welcome, then bought 100
    offline: '44444444-4444-4444-8444-444444444404', // three self-reported offline wins
    sold: '44444444-4444-4444-8444-444444444405', // already sold the welcome, then bought 100
    inflight: '44444444-4444-4444-8444-444444444406', // a stake still held at migration time
  };
  let n = 0;
  for (const [key, id] of Object.entries(L)) {
    n += 1;
    await lq(`insert into auth.users (id, email) values ($1, null)`, [id]);
    await lq(
      `select public.sync_privy_account($1, $2, null, null, 'email', $3, $4, '[]'::jsonb, now())`,
      [id, `did:privy:legacy-${key}`, `SolanaLegacy${n}`, `wallet-legacy-${n}`],
    );
    await lq(`select * from public.ensure_point_account($1, $2)`, [id, `did:privy:legacy-${key}`]);
  }
  const hold = (k) => `cccccccc-cccc-4ccc-8ccc-${String(k).padStart(12, '0')}`;
  const buy = (id, k) => lq(`select public.complete_point_buy($1, $2, $3, 100, 1000000)`, [id, hold(900 + k), `legacy-confirmed-signature-${String(k).padStart(20, '0')}`]);
  const offlineWager = async (id, k, won) => {
    await lq(`select * from public.reserve_point_wager($1, $2, 50)`, [id, hold(k)]);
    await lq(`select * from public.settle_offline_wager($1, $2, $3)`, [id, hold(k), won]);
  };
  await buy(L.bought, 1);
  await offlineWager(L.relapsed, 1, false);
  await offlineWager(L.relapsed, 2, false);
  await buy(L.relapsed, 2);
  await offlineWager(L.offline, 3, true);
  await offlineWager(L.offline, 4, true);
  await offlineWager(L.offline, 5, true);
  await lq(`select * from public.begin_point_sell($1, $2, 100, 1000000)`, [L.sold, hold(6)]);
  await lq(`select public.mark_point_sell_broadcast($1, 'legacy-payout-signature-000000000000000001', 'tx', 'bh', 1)`, [hold(6)]);
  await lq(`select public.complete_point_sell($1, 'legacy-payout-signature-000000000000000001')`, [hold(6)]);
  await buy(L.sold, 3);
  const INFLIGHT_HOLD = hold(7);
  await lq(`select * from public.reserve_point_wager($1, $2, 50)`, [L.inflight, INFLIGHT_HOLD]);

  // The BUG-001 audit (supabase/audits) reads only tables that predate 0014,
  // so it must find the same accounts whether it runs before or after.
  const AUDIT = fs.readFileSync(fileURLToPath(new URL('./audits/bug-001-offline-wagers-and-welcome-sales.sql', import.meta.url)), 'utf8');
  const audit = async () => {
    try {
      return JSON.stringify((await lq(AUDIT)).rows, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
    } catch (e) {
      return `error: ${e.message}`;
    }
  };
  const auditBefore = await audit();

  await applyMigrations(legacy, files.filter((f) => f >= '0014'), 'legacy, 0014 onwards:');
  const auditAfter = await audit();
  const flagged = auditBefore.startsWith('[') ? JSON.parse(auditBefore).map((row) => row.privy_user_id).sort().join(', ') : auditBefore;
  check(flagged === 'did:privy:legacy-offline, did:privy:legacy-relapsed, did:privy:legacy-sold', `audit: flags the offline wagerers and the welcome seller (${flagged})`);
  check(auditBefore === auditAfter, 'audit: reads the same before and after the migrations');
  const soldRow = auditBefore.startsWith('[') ? JSON.parse(auditBefore).find((row) => row.privy_user_id === 'did:privy:legacy-sold') : null;
  check(String(soldRow?.unbacked_points_sold) === '100', `audit: a welcome sold before buying counts, though purchases covered it later (${soldRow?.unbacked_points_sold})`);
  const split = async (id) => {
    try {
      const row = (await lq(`select * from public.get_point_balances($1)`, [id])).rows[0];
      return `${Number(row.balance)}/${Number(row.locked)}/${Number(row.sellable)}`;
    } catch (e) {
      return `error: ${e.message}`;
    }
  };
  // balance/locked/sellable
  check((await split(L.welcome)) === '100/100/0', `backfill: an untouched welcome award is locked (${await split(L.welcome)})`);
  check((await split(L.bought)) === '200/100/100', `backfill: points bought on top stay sellable (${await split(L.bought)})`);
  check((await split(L.relapsed)) === '100/0/100', `backfill: points bought after the welcome was spent are never locked (${await split(L.relapsed)})`);
  check((await split(L.offline)) === '250/250/0', `backfill: self-reported offline winnings are locked with the welcome (${await split(L.offline)})`);
  check((await split(L.sold)) === '100/0/100', `backfill: a welcome already sold is not clawed back from later purchases (${await split(L.sold)})`);
  check((await split(L.inflight)) === '50/50/0', `backfill: an in-flight stake keeps its welcome share outside the balance (${await split(L.inflight)})`);
  const inflightHold = (await lq(`select locked_stake from public.point_wager_holds where request_id = $1`, [INFLIGHT_HOLD]).catch(() => ({ rows: [] }))).rows[0];
  check(Number(inflightHold?.locked_stake) === 50, 'backfill: the held stake itself is marked as welcome points');
  await lq(`select public.refund_point_wager($1, $2)`, [L.inflight, INFLIGHT_HOLD]);
  check((await split(L.inflight)) === '100/100/0', `backfill: refunding that stake returns locked points, not sellable ones (${await split(L.inflight)})`);

  // Re-applying every migration must leave the backfill alone.
  await buy(L.welcome, 4);
  await applyMigrations(legacy, files, 'legacy, re-applied:');
  check((await split(L.welcome)) === '200/100/100', `backfill runs once: re-applying the migrations recomputes nothing (${await split(L.welcome)})`);
}

// ---- 0017: the ladder points offline results earned before 0015 ----
// Another separate database: everything up to 0014, so the old settlement
// that paid ladder points is still there; three captains play the old way;
// then the rest is applied. 0007 paid 25 a win and 5 a loss, plus a battle
// played (and won) each.
{
  const legacy = await freshDb();
  const lq = (sql, params) => legacy.query(sql, params);
  await applyMigrations(legacy, files.filter((f) => f < '0015'), 'ladder, before 0015:');

  const P = {
    farmer: '55555555-5555-4555-8555-555555555501', // a real online record, plus four offline results
    low: '55555555-5555-4555-8555-555555555502', // has fewer points now than offline paid
    clean: '55555555-5555-4555-8555-555555555503', // never played offline
  };
  for (const id of Object.values(P)) await lq(`insert into auth.users (id, email) values ($1, null)`, [id]);
  const oldResult = (id, key, won) => lq(`select public.apply_offline_result($1, $2, 'hotseat', $3, now())`, [key, id, won]);
  await lq(`update public.profiles set rank_points = 200, battles_played = 10, battles_won = 6, coins = 500 where id = $1`, [P.farmer]);
  await oldResult(P.farmer, 'farm-1', true);
  await oldResult(P.farmer, 'farm-2', true);
  await oldResult(P.farmer, 'farm-3', true);
  await oldResult(P.farmer, 'farm-4', false);
  await oldResult(P.low, 'low-1', true);
  await lq(`update public.profiles set rank_points = 10 where id = $1`, [P.low]);
  await lq(`update public.profiles set rank_points = 120, battles_played = 4, battles_won = 2, coins = 90 where id = $1`, [P.clean]);

  await applyMigrations(legacy, files.filter((f) => f >= '0015'), 'ladder, 0015 onwards:');
  const totals = async (id) => {
    const r = (await lq(`select rank_points, battles_played, battles_won, coins from public.profiles where id = $1`, [id])).rows[0];
    return `${r.rank_points}/${r.battles_played}/${r.battles_won}/${r.coins}`;
  };
  const taken = async (id) => {
    try {
      const r = (await lq(`select results, rank_points, battles_played, battles_won from public.offline_ladder_corrections where user_id = $1`, [id])).rows[0];
      return r ? `${r.results}:${r.rank_points}/${r.battles_played}/${r.battles_won}` : 'none';
    } catch (e) {
      return `error: ${e.message}`;
    }
  };
  // rank points / battles played / battles won / coins
  check((await totals(P.farmer)) === '200/10/6/660', `correction: offline results give back their ladder points, battles and wins, and keep their coins (${await totals(P.farmer)})`);
  check((await taken(P.farmer)) === '4:80/4/3', `correction: what was taken is logged per captain (${await taken(P.farmer)})`);
  check((await totals(P.low)) === '0/0/0/50', `correction: never takes a captain below zero (${await totals(P.low)})`);
  check((await taken(P.low)) === '1:10/1/1', `correction: the log holds what was actually taken, not what was owed (${await taken(P.low)})`);
  check((await totals(P.clean)) === '120/4/2/90' && (await taken(P.clean)) === 'none', 'correction: a captain who never played offline is untouched');
  const unmarked = await lq(`select count(*)::int as n from public.offline_results where ladder_points is distinct from 0`).then((x) => x.rows[0].n, (e) => `error: ${e.message}`);
  check(unmarked === 0, `correction: every offline result now counts 0 ladder points (${unmarked} left)`);

  // A result paid under the new rules, then every migration again.
  await lq(`select public.apply_offline_result('farm-5', $1, 'ai', true, now(), 50, 10)`, [P.farmer]);
  await applyMigrations(legacy, files, 'ladder, re-applied:');
  check((await totals(P.farmer)) === '200/10/6/710', `correction runs once: re-applying takes nothing twice, and a coins-only result is never reverted (${await totals(P.farmer)})`);
  check((await taken(P.farmer)) === '4:80/4/3', `correction runs once: the log is unchanged (${await taken(P.farmer)})`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall database checks passed');
process.exit(fails ? 1 : 0);

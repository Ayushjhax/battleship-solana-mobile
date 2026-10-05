-- 0017 - take back the ladder points offline results earned before 0015.
--
-- Until 0015 an offline AI or hot-seat result paid rank points on the
-- device's word — 25 for a win, 5 for a loss, 0007's hard-coded rates — and
-- counted as a battle played (and won). 0015 stopped that for new results;
-- this removes what the old ones put on the ladder, once. Every result 0015
-- left unmarked (ladder_points is null) was paid under the old rules: its
-- rank points, battle and win come off the captain's profile, never below
-- zero, and the row is marked as counting 0. The coins those results paid
-- stay: offline games still pay coins.
--
-- What was taken from each captain is logged in offline_ladder_corrections —
-- the amount actually taken, after the floor at zero — so the correction can
-- be checked and, if it ever has to be, given back. Re-running this file finds
-- no unmarked rows and changes nothing.

create table if not exists public.offline_ladder_corrections (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  results        integer not null,
  rank_points    integer not null,
  battles_played integer not null,
  battles_won    integer not null,
  corrected_at   timestamptz not null default now()
);

alter table public.offline_ladder_corrections enable row level security;
-- No policies and no grants: the match server's secret key and the SQL editor only.
revoke all on public.offline_ladder_corrections from public, anon, authenticated;

-- One statement, so every part sees the same rows: the unmarked results, the
-- profiles before the update, and the profiles after it.
with legacy as (
  select user_id,
         count(*)::integer as results,
         sum(case when won then 25 else 5 end)::integer as rank_points,
         count(*) filter (where won)::integer as battles_won
    from public.offline_results
   where ladder_points is null
   group by user_id
),
before as (
  select p.id, p.rank_points, p.battles_played, p.battles_won
    from public.profiles p
    join legacy l on l.user_id = p.id
),
corrected as (
  update public.profiles p
     set rank_points = greatest(0, p.rank_points - l.rank_points),
         battles_played = greatest(0, p.battles_played - l.results),
         battles_won = greatest(0, p.battles_won - l.battles_won)
    from legacy l
   where p.id = l.user_id
  returning p.id, p.rank_points, p.battles_played, p.battles_won
),
logged as (
  insert into public.offline_ladder_corrections as c
         (user_id, results, rank_points, battles_played, battles_won)
  select b.id,
         l.results,
         b.rank_points - k.rank_points,
         b.battles_played - k.battles_played,
         b.battles_won - k.battles_won
    from before b
    join corrected k on k.id = b.id
    join legacy l on l.user_id = b.id
  on conflict (user_id) do update
     set results = c.results + excluded.results,
         rank_points = c.rank_points + excluded.rank_points,
         battles_played = c.battles_played + excluded.battles_played,
         battles_won = c.battles_won + excluded.battles_won,
         corrected_at = now()
)
update public.offline_results
   set ladder_points = 0
 where ladder_points is null;

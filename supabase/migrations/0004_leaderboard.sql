-- 0004 — the leaderboard view: top 100 by rank_points, and ONLY the public
-- columns. No ids, no emails. security_invoker keeps the profiles RLS in
-- force (authenticated users may read everyone).

create or replace view public.leaderboard
with (security_invoker = true)
as
  select
    name,
    avatar_id,
    avatar_color,
    country_code,
    rank_points,
    battles_won
  from public.profiles
  order by rank_points desc, battles_won desc, created_at asc
  limit 100;

grant select on public.leaderboard to authenticated;

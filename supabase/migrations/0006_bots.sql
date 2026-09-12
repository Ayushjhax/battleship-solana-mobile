-- 0006 — the matchmaking bot.
--
-- docs/prompts.md P12: if a player waits 45s with no human available, the
-- matchmaker offers a bot match driven by src/engine/ai.ts server-side. The
-- client cannot tell the difference; only the database marks it.
--
-- The bot needs a real profiles row (matches.player_a/b references profiles,
-- which references auth.users), so it gets one fixed system auth.users row.
-- It is excluded from the leaderboard.

alter table public.profiles add column if not exists is_bot boolean not null default false;
alter table public.matches add column if not exists is_bot boolean not null default false;

-- A fixed, well-known id the match server can pair against without a lookup.
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at)
values ('b0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now())
on conflict (id) do nothing;

-- The sign-up trigger already created a profile with a generated name; give it
-- the bot's fixed identity instead.
update public.profiles
set name = 'Berhan',
    avatar_id = 4,
    avatar_color = 'charcoal',
    country_code = 'RU',
    is_bot = true
where id = 'b0000000-0000-4000-8000-000000000001';

-- Leaderboard: real players only.
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
  where is_bot = false
  order by rank_points desc, battles_won desc, created_at asc
  limit 100;

grant select on public.leaderboard to authenticated;

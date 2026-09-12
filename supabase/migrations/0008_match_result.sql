-- 0008 — settling a match in ONE transaction, and a leaderboard that can
-- point at "you" without ever exposing a user id.

-- ---------------------------------------------------------------------------
-- (a) apply_match_result — the matches row and both players' totals, atomic
--     and idempotent. A plpgsql function is a single transaction: either the
--     row is closed AND both profiles move, or nothing happens. The row lock
--     (for update) plus the `ended_at is null` guard make a retried call a
--     no-op that returns false, so the server may call it as often as it
--     likes. Rewards come in as arguments: src/engine/ranks.ts's REWARD stays
--     the single source of truth, this never hard-codes 25/50/5/10.
--     The bot's profile (0006) is never touched.
-- ---------------------------------------------------------------------------

create or replace function public.apply_match_result(
  p_match_id   uuid,
  p_winner     uuid,
  p_end_reason text,
  p_win_points integer,
  p_win_coins  integer,
  p_loss_points integer,
  p_loss_coins integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
begin
  select player_a, player_b into v_a, v_b
    from public.matches
   where id = p_match_id and ended_at is null
     for update;
  if not found then
    return false; -- already settled: a retry, a duplicate finish, a replay
  end if;
  if p_winner is distinct from v_a and p_winner is distinct from v_b then
    raise exception 'winner % is not a player of match %', p_winner, p_match_id;
  end if;

  update public.matches
     set winner = p_winner, ended_at = now(), end_reason = p_end_reason
   where id = p_match_id;

  update public.profiles p
     set rank_points    = p.rank_points + case when p.id = p_winner then p_win_points else p_loss_points end,
         coins          = p.coins       + case when p.id = p_winner then p_win_coins  else p_loss_coins  end,
         battles_played = p.battles_played + 1,
         battles_won    = p.battles_won + case when p.id = p_winner then 1 else 0 end
   where p.id in (v_a, v_b)
     and p.is_bot = false;

  return true;
end;
$$;

revoke all on function public.apply_match_result(uuid, uuid, text, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.apply_match_result(uuid, uuid, text, integer, integer, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- (b) The view's ORDER BY as an index, so the top 100 is an index walk rather
--     than a sort — the leaderboard screen has a 400 ms budget. The view
--     itself (0004/0006) is untouched: it still exposes no id, and the app
--     finds "you" by position (below), never by a column.
-- ---------------------------------------------------------------------------

create index if not exists profiles_ladder_idx
  on public.profiles (rank_points desc, battles_won desc, created_at asc)
  where is_bot = false;

-- ---------------------------------------------------------------------------
-- (c) my_leaderboard_row — the caller's own 1-based ladder position (the
--     same ordering as the view, so position <= 100 means "row position-1 of
--     the leaderboard is you") and their public columns, for pinning them to
--     the bottom when they are outside the top 100. Returns no rows when
--     there is no session. security_invoker (the default), so RLS still
--     applies; auth.uid() is the only key — no id goes in or comes out.
-- ---------------------------------------------------------------------------

create or replace function public.my_leaderboard_row()
returns table (
  rank_position integer,
  name         text,
  avatar_id    smallint,
  avatar_color text,
  country_code text,
  rank_points  integer,
  battles_won  integer
)
language sql
stable
set search_path = public
as $$
  select ladder.rank_position, ladder.name, ladder.avatar_id, ladder.avatar_color,
         ladder.country_code, ladder.rank_points, ladder.battles_won
    from (
      select id,
             row_number() over (order by rank_points desc, battles_won desc, created_at asc)::integer as rank_position,
             name, avatar_id, avatar_color, country_code, rank_points, battles_won
        from public.profiles
       where is_bot = false
    ) as ladder
   where ladder.id = auth.uid();
$$;

revoke all on function public.my_leaderboard_row() from public, anon;
grant execute on function public.my_leaderboard_row() to authenticated;

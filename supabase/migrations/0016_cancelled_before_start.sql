-- 0016 - a match cancelled before it started closes with no result.
--
-- A Cancel tapped on the matchmaking screen can cross the `matched` frame.
-- Wagered rooms already treated that as a pre-game cancel (0011: both stakes
-- refunded, the never-started match removed). Unwagered rooms had nothing:
-- the cancelling player's app left and the room forfeited them 45 seconds
-- later — a loss on their record, with the opponent waiting it out.
--
-- cancel_match_before_start closes an unwagered match with winner null and
-- end_reason 'cancelled': no win, no loss, no rank or coin movement. The match
-- server only calls it while the engine is still in placement.

alter table public.matches drop constraint if exists matches_end_reason_check;
alter table public.matches add constraint matches_end_reason_check
  check (end_reason in ('victory', 'resign', 'timeout', 'disconnect', 'cancelled'));

create or replace function public.cancel_match_before_start(
  p_match_id uuid,
  p_cancelled_by uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
begin
  select * into v_match
    from public.matches
   where id = p_match_id
   for update;

  -- Never existed, or already over: idempotent, and never overwrites a result.
  if not found or v_match.ended_at is not null then
    return false;
  end if;
  if v_match.wagered then
    raise exception 'a wagered match is cancelled with cancel_wagered_match_before_start'
      using errcode = 'P0001';
  end if;
  if p_cancelled_by is distinct from v_match.player_a
     and p_cancelled_by is distinct from v_match.player_b then
    raise exception 'player is not in match' using errcode = '42501';
  end if;

  update public.matches
     set winner = null, ended_at = now(), end_reason = 'cancelled'
   where id = p_match_id;
  return true;
end;
$$;

revoke all on function public.cancel_match_before_start(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_match_before_start(uuid, uuid) to service_role;

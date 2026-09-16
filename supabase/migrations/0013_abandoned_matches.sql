-- 0013 - a match both captains walked out of.
--
-- apply_match_result always has a winner, because every other way a match ends
-- produces one. When BOTH sides disconnect mid-match and neither comes back,
-- there is nobody to award: the row closes with winner null, no profile moves,
-- and neither stake is returned. Walking away from a live wager forfeits it —
-- refunding here would make "both quit" the cheapest way out of a losing
-- position, which is exactly the behaviour a wager exists to discourage.

create or replace function public.abandon_match(p_match_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wagered boolean;
begin
  select wagered into v_wagered
    from public.matches
   where id = p_match_id and ended_at is null
   for update;
  -- Already settled (or never existed): idempotent, and never overwrites a
  -- real result with an abandonment.
  if not found then return false; end if;

  update public.matches
     set winner = null,
         ended_at = now(),
         end_reason = 'disconnect',
         wager_settled_at = case when v_wagered then now() else wager_settled_at end
   where id = p_match_id;

  -- Settled, not refunded: the stakes stay where the reservation put them.
  update public.point_wager_holds
     set status = 'settled', updated_at = now()
   where match_id = p_match_id and status = 'held';

  return true;
end;
$$;

revoke all on function public.abandon_match(uuid) from public, anon, authenticated;
grant execute on function public.abandon_match(uuid) to service_role;

-- 0011 - atomically cancel a wagered room while it is still in placement.
-- The match server is the only caller and checks the in-memory engine phase
-- before invoking this function. Postgres moves every held stake back and
-- removes the never-started match as one transaction.

create or replace function public.cancel_wagered_match_before_start(
  p_match_id uuid,
  p_cancelled_by uuid
)
returns table (cancelled_profile_id uuid, balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_hold public.point_wager_holds%rowtype;
  v_balance bigint;
  v_expected integer;
  v_count integer;
begin
  select * into v_match
    from public.matches
   where id = p_match_id
   for update;

  if not found then
    return;
  end if;
  if not v_match.wagered or v_match.ended_at is not null then
    raise exception 'wager match already started or settled' using errcode = 'P0001';
  end if;
  if p_cancelled_by is distinct from v_match.player_a
     and p_cancelled_by is distinct from v_match.player_b then
    raise exception 'player is not in wager match' using errcode = '42501';
  end if;

  v_expected := case when v_match.is_bot then 1 else 2 end;
  select count(*)::integer into v_count
    from public.point_wager_holds h
   where h.match_id = p_match_id and h.status = 'held';
  if v_count <> v_expected then
    raise exception 'wager holds are not refundable' using errcode = 'P0001';
  end if;

  for v_hold in
    select h.*
      from public.point_wager_holds h
     where h.match_id = p_match_id and h.status = 'held'
     for update
  loop
    update public.point_accounts a
       set balance = a.balance + v_hold.stake, updated_at = now()
     where a.privy_user_id = v_hold.privy_user_id
     returning a.balance into v_balance;

    update public.point_wager_holds h
       set status = 'refunded', match_id = null, updated_at = now()
     where h.request_id = v_hold.request_id;

    insert into public.point_ledger (
      privy_user_id, delta, balance_after, reason, reference_id
    ) values (
      v_hold.privy_user_id, v_hold.stake, v_balance,
      'wager_refund', v_hold.request_id::text
    ) on conflict do nothing;

    cancelled_profile_id := v_hold.profile_id;
    balance := v_balance;
    return next;
  end loop;

  delete from public.matches where id = p_match_id;
end;
$$;

revoke all on function public.cancel_wagered_match_before_start(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_wagered_match_before_start(uuid, uuid)
  to service_role;

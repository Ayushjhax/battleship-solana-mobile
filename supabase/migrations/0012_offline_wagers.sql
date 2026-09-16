-- 0012 - offline wagers, and the seed type that kept wagered matches from
-- starting at all.
--
-- 1. public.matches.seed is bigint (0002), but 0010 declared
--    create_wagered_match(p_seed integer). The match server's seeds are
--    uint32, so every seed above 2147483647 -- about half of them -- failed
--    with "value ... is out of range for type integer" and the room never
--    opened. The parameter is widened to match the column it writes.
--
-- 2. An offline wager is played against the device's own AI. There is no
--    matches row and no second hold, so it cannot go through
--    apply_match_result; it settles against the hold alone. The hold's own
--    status is the idempotency key, so a retried settlement pays once.

drop function if exists public.create_wagered_match(
  uuid, text, uuid, uuid, integer, boolean, uuid, uuid
);

create or replace function public.create_wagered_match(
  p_match_id uuid,
  p_mode text,
  p_player_a uuid,
  p_player_b uuid,
  p_seed bigint,
  p_is_bot boolean,
  p_hold_a uuid,
  p_hold_b uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected integer := case when p_is_bot then 1 else 2 end;
  v_found integer;
begin
  if p_is_bot and p_hold_b is not null then
    raise exception 'bot wager must have one human hold' using errcode = '22023';
  end if;
  if not p_is_bot and p_hold_b is null then
    raise exception 'player wager must have two holds' using errcode = '22023';
  end if;

  select count(*)::integer into v_found
    from public.point_wager_holds h
   where h.request_id in (p_hold_a, p_hold_b)
     and h.status = 'held' and h.match_id is null
     and ((h.request_id = p_hold_a and h.profile_id = p_player_a)
       or (h.request_id = p_hold_b and h.profile_id = p_player_b));
  if v_found <> v_expected then
    raise exception 'wager hold is missing or already used' using errcode = 'P0001';
  end if;

  insert into public.matches (
    id, mode, player_a, player_b, seed, is_bot, wagered, wager_points
  ) values (
    p_match_id, p_mode, p_player_a, p_player_b, p_seed, p_is_bot, true, 50
  );
  update public.point_wager_holds
     set match_id = p_match_id, updated_at = now()
   where request_id in (p_hold_a, p_hold_b);
end;
$$;

revoke all on function public.create_wagered_match(uuid, text, uuid, uuid, bigint, boolean, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_wagered_match(uuid, text, uuid, uuid, bigint, boolean, uuid, uuid)
  to service_role;

-- Settles a wager that has no match row: the stake was already taken at
-- reserve time, so a win pays stake * 2 and a loss simply keeps it. A hold
-- carrying a match_id belongs to a server-run room and is never touched here.
create or replace function public.settle_offline_wager(
  p_profile_id uuid,
  p_request_id uuid,
  p_won boolean
)
returns table (balance bigint, settled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.point_wager_holds%rowtype;
  v_balance bigint;
begin
  select * into v_hold from public.point_wager_holds
   where request_id = p_request_id for update;
  if not found or v_hold.profile_id is distinct from p_profile_id then
    return query select public.get_point_balance(p_profile_id), false;
    return;
  end if;
  -- Already settled or refunded, or owned by a room: report, change nothing.
  if v_hold.status <> 'held' or v_hold.match_id is not null then
    return query select public.get_point_balance(p_profile_id), false;
    return;
  end if;

  update public.point_wager_holds
     set status = 'settled', updated_at = now()
   where request_id = p_request_id;

  if not p_won then
    return query select public.get_point_balance(p_profile_id), true;
    return;
  end if;

  -- Aliased because this function's OUT column is also called `balance`.
  update public.point_accounts a
     set balance = a.balance + v_hold.stake * 2, updated_at = now()
   where a.privy_user_id = v_hold.privy_user_id
   returning a.balance into v_balance;
  insert into public.point_ledger (
    privy_user_id, delta, balance_after, reason, reference_id, metadata
  ) values (
    v_hold.privy_user_id, v_hold.stake * 2, v_balance, 'wager_prize',
    p_request_id::text, jsonb_build_object('stake', v_hold.stake, 'offline', true)
  ) on conflict do nothing;

  return query select v_balance, true;
end;
$$;

revoke all on function public.settle_offline_wager(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.settle_offline_wager(uuid, uuid, boolean) to service_role;

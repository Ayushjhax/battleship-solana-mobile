-- 0014 - only a match the server observes can carry a stake, and welcome
-- points are play money.
--
-- 1. Offline wagers are gone. settle_offline_wager (0012) paid out on the
--    device's word, so anyone could reserve a stake, report a "win" without
--    playing, and sell the points for treasury SOL. A wager now settles only
--    through apply_match_result, for a room the match server ran from start to
--    finish (a human opponent or the server's own bot).
--
-- 2. Welcome points are locked: they can be staked and won with, never sold.
--    point_accounts.locked_points is the unsellable part of `balance`, and
--    sellable = balance - locked_points. A stake draws on locked points first
--    and remembers how many it took (point_wager_holds.locked_stake), so a
--    refund hands back the same kind and a pot pays out in the kinds that went
--    in: a player match gives the winner both stakes' locked shares as locked
--    points, and against the house bot the house matches the human's stake
--    kind for kind. Points bought with SOL stay sellable. Without that rule two
--    throwaway accounts could launder their welcome points into SOL by
--    throwing a wager to each other.
--
-- 3. Existing balances are split once, when the column first appears:
--      locked = least(effective balance,
--                     welcome + net self-reported offline winnings - points sold,
--                     effective balance - points ever bought)
--    where the effective balance includes stakes still held. Bought points are
--    never locked (they count as spent last), a welcome already sold is not
--    clawed back, and offline winnings, which no server ever saw, are locked
--    along with the welcome. Held stakes take their locked share first.

drop function if exists public.settle_offline_wager(uuid, uuid, boolean);

alter table public.point_wager_holds
  add column if not exists locked_stake integer not null default 0;
alter table public.point_wager_holds drop constraint if exists point_wager_holds_locked_stake_check;
alter table public.point_wager_holds add constraint point_wager_holds_locked_stake_check
  check (locked_stake >= 0 and locked_stake <= stake);

do $$
declare
  v_account record;
  v_hold record;
  v_remaining bigint;
  v_take integer;
begin
  -- The split is computed exactly once. Re-running this file must never
  -- recompute it from balances that have moved since.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'point_accounts'
       and column_name = 'locked_points'
  ) then
    return;
  end if;

  alter table public.point_accounts add column locked_points bigint not null default 0;

  for v_account in
    with ledger as (
      select l.privy_user_id,
             coalesce(sum(l.delta) filter (where l.reason = 'welcome'), 0) as welcome,
             coalesce(sum(l.delta) filter (where l.reason = 'buy'), 0) as bought,
             coalesce(sum(-l.delta) filter (where l.reason = 'sell_reserve'), 0)
               - coalesce(sum(l.delta) filter (where l.reason = 'sell_refund'), 0) as sold,
             coalesce(sum(l.delta) filter (
               where l.reason = 'wager_prize' and l.metadata ->> 'offline' = 'true'
             ), 0) as offline_prizes
        from public.point_ledger l
       group by l.privy_user_id
    ), offline_stakes as (
      -- 0012 settled offline holds without ever attaching a match.
      select h.privy_user_id, sum(h.stake) as staked
        from public.point_wager_holds h
       where h.match_id is null and h.status = 'settled'
       group by h.privy_user_id
    ), held as (
      select h.privy_user_id, sum(h.stake) as held
        from public.point_wager_holds h
       where h.status = 'held'
       group by h.privy_user_id
    )
    select a.privy_user_id,
           greatest(0::bigint, least(
             a.balance + coalesce(held.held, 0),
             coalesce(ledger.welcome, 0)
               + greatest(0, coalesce(ledger.offline_prizes, 0) - coalesce(offline_stakes.staked, 0))
               - coalesce(ledger.sold, 0),
             a.balance + coalesce(held.held, 0) - coalesce(ledger.bought, 0)
           )) as locked_total
      from public.point_accounts a
      left join ledger on ledger.privy_user_id = a.privy_user_id
      left join offline_stakes on offline_stakes.privy_user_id = a.privy_user_id
      left join held on held.privy_user_id = a.privy_user_id
  loop
    v_remaining := v_account.locked_total;
    for v_hold in
      select h.request_id, h.stake
        from public.point_wager_holds h
       where h.privy_user_id = v_account.privy_user_id and h.status = 'held'
       order by h.created_at, h.request_id
    loop
      v_take := least(v_hold.stake::bigint, v_remaining)::integer;
      update public.point_wager_holds set locked_stake = v_take where request_id = v_hold.request_id;
      v_remaining := v_remaining - v_take;
    end loop;
    update public.point_accounts a
       set locked_points = least(a.balance, v_remaining)
     where a.privy_user_id = v_account.privy_user_id;
  end loop;
end;
$$;

alter table public.point_accounts drop constraint if exists point_accounts_locked_points_check;
alter table public.point_accounts add constraint point_accounts_locked_points_check
  check (locked_points >= 0 and locked_points <= balance);

-- The welcome award arrives locked.
create or replace function public.ensure_point_account(
  p_profile_id uuid,
  p_privy_user_id text
)
returns table (balance bigint, welcome_awarded boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if public.point_identity_for_profile(p_profile_id) is distinct from p_privy_user_id then
    raise exception 'Privy identity does not match profile' using errcode = 'P0001';
  end if;

  insert into public.point_accounts (privy_user_id, balance, locked_points)
  values (p_privy_user_id, 100, 100)
  on conflict (privy_user_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    insert into public.point_ledger (
      privy_user_id, delta, balance_after, reason, reference_id, metadata
    ) values (
      p_privy_user_id, 100, 100, 'welcome', p_privy_user_id, jsonb_build_object('locked', 100)
    );
  end if;

  return query
    select a.balance, v_inserted = 1
      from public.point_accounts a
     where a.privy_user_id = p_privy_user_id;
end;
$$;

revoke all on function public.ensure_point_account(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ensure_point_account(uuid, text) to service_role;

-- The balance and how much of it may be sold.
create or replace function public.get_point_balances(p_profile_id uuid)
returns table (balance bigint, locked bigint, sellable bigint)
language sql
security definer
stable
set search_path = public
as $$
  select a.balance, a.locked_points, a.balance - a.locked_points
    from public.point_accounts a
   where a.privy_user_id = public.point_identity_for_profile(p_profile_id);
$$;

revoke all on function public.get_point_balances(uuid) from public, anon, authenticated;
grant execute on function public.get_point_balances(uuid) to service_role;

-- A stake draws on welcome points first, and the hold remembers how many.
create or replace function public.reserve_point_wager(
  p_profile_id uuid,
  p_request_id uuid,
  p_stake integer default 50
)
returns table (ok boolean, hold_id uuid, balance bigint, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privy_user_id text;
  v_balance bigint;
  v_locked bigint;
  v_take integer;
  v_existing public.point_wager_holds%rowtype;
begin
  if p_stake <> 50 then
    raise exception 'unsupported wager stake' using errcode = '22023';
  end if;
  v_privy_user_id := public.point_identity_for_profile(p_profile_id);

  select * into v_existing from public.point_wager_holds where request_id = p_request_id;
  if found then
    if v_existing.profile_id is distinct from p_profile_id then
      raise exception 'wager request belongs to another profile' using errcode = '42501';
    end if;
    select a.balance into v_balance from public.point_accounts a
     where a.privy_user_id = v_privy_user_id;
    return query select v_existing.status <> 'refunded', p_request_id, v_balance,
      case when v_existing.status = 'refunded' then 'refunded' else null::text end;
    return;
  end if;

  select h.* into v_existing
    from public.point_wager_holds h
   where h.profile_id = p_profile_id and h.status = 'held' and h.match_id is null
   for update;
  if found then
    select a.balance into v_balance from public.point_accounts a
     where a.privy_user_id = v_privy_user_id;
    return query select true, v_existing.request_id, v_balance, 'existing_hold'::text;
    return;
  end if;

  select a.balance, a.locked_points into v_balance, v_locked
    from public.point_accounts a
   where a.privy_user_id = v_privy_user_id
   for update;
  if v_balance is null then
    raise exception 'point account is not initialized' using errcode = 'P0001';
  end if;
  if v_balance < p_stake then
    return query select false, p_request_id, v_balance, 'insufficient_points'::text;
    return;
  end if;

  v_take := least(p_stake::bigint, v_locked)::integer;
  v_balance := v_balance - p_stake;
  update public.point_accounts a
     set balance = v_balance, locked_points = a.locked_points - v_take, updated_at = now()
   where a.privy_user_id = v_privy_user_id;
  insert into public.point_wager_holds (
    request_id, profile_id, privy_user_id, stake, locked_stake
  ) values (p_request_id, p_profile_id, v_privy_user_id, p_stake, v_take);
  insert into public.point_ledger (
    privy_user_id, delta, balance_after, reason, reference_id, metadata
  ) values (
    v_privy_user_id, -p_stake, v_balance, 'wager_entry', p_request_id::text,
    jsonb_build_object('locked', v_take)
  );

  return query select true, p_request_id, v_balance, null::text;
end;
$$;

revoke all on function public.reserve_point_wager(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_point_wager(uuid, uuid, integer) to service_role;

-- A refund hands back the kind of points the stake took.
create or replace function public.refund_point_wager(
  p_profile_id uuid,
  p_request_id uuid
)
returns bigint
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
    return public.get_point_balance(p_profile_id);
  end if;
  if v_hold.status = 'held' and v_hold.match_id is null then
    update public.point_accounts a
       set balance = a.balance + v_hold.stake,
           locked_points = a.locked_points + v_hold.locked_stake,
           updated_at = now()
     where a.privy_user_id = v_hold.privy_user_id
     returning a.balance into v_balance;
    update public.point_wager_holds
       set status = 'refunded', updated_at = now()
     where request_id = p_request_id;
    insert into public.point_ledger (
      privy_user_id, delta, balance_after, reason, reference_id, metadata
    ) values (
      v_hold.privy_user_id, v_hold.stake, v_balance,
      'wager_refund', p_request_id::text, jsonb_build_object('locked', v_hold.locked_stake)
    ) on conflict do nothing;
    return v_balance;
  end if;
  return public.get_point_balance(p_profile_id);
end;
$$;

revoke all on function public.refund_point_wager(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_point_wager(uuid, uuid) to service_role;

-- 0011's pre-start cancel, now returning each stake in its own kind.
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
       set balance = a.balance + v_hold.stake,
           locked_points = a.locked_points + v_hold.locked_stake,
           updated_at = now()
     where a.privy_user_id = v_hold.privy_user_id
     returning a.balance into v_balance;

    update public.point_wager_holds h
       set status = 'refunded', match_id = null, updated_at = now()
     where h.request_id = v_hold.request_id;

    insert into public.point_ledger (
      privy_user_id, delta, balance_after, reason, reference_id, metadata
    ) values (
      v_hold.privy_user_id, v_hold.stake, v_balance,
      'wager_refund', v_hold.request_id::text, jsonb_build_object('locked', v_hold.locked_stake)
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

-- 0010's settlement, with the pot paid out in the kinds that went in.
create or replace function public.apply_match_result(
  p_match_id uuid,
  p_winner uuid,
  p_end_reason text,
  p_win_points integer,
  p_win_coins integer,
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
  v_is_bot boolean;
  v_wagered boolean;
  v_stake integer;
  v_holds integer;
  v_locked_pot bigint := 0;
  v_prize bigint;
  v_prize_locked bigint;
  v_winner_privy text;
  v_balance bigint;
begin
  select player_a, player_b, is_bot, wagered, wager_points
    into v_a, v_b, v_is_bot, v_wagered, v_stake
    from public.matches
   where id = p_match_id and ended_at is null
   for update;
  if not found then return false; end if;
  if p_winner is distinct from v_a and p_winner is distinct from v_b then
    raise exception 'winner % is not a player of match %', p_winner, p_match_id;
  end if;

  if v_wagered then
    select count(*)::integer, coalesce(sum(locked_stake), 0)
      into v_holds, v_locked_pot
      from public.point_wager_holds
     where match_id = p_match_id and status = 'held';
    if v_holds <> (case when v_is_bot then 1 else 2 end) then
      raise exception 'match % does not have the required wager holds', p_match_id;
    end if;
  end if;

  update public.matches
     set winner = p_winner, ended_at = now(), end_reason = p_end_reason,
         wager_settled_at = case when v_wagered then now() else wager_settled_at end
   where id = p_match_id;

  update public.profiles p
     set rank_points = p.rank_points + case when p.id = p_winner then p_win_points else p_loss_points end,
         coins = p.coins + case when p.id = p_winner then p_win_coins else p_loss_coins end,
         battles_played = p.battles_played + 1,
         battles_won = p.battles_won + case when p.id = p_winner then 1 else 0 end
   where p.id in (v_a, v_b) and p.is_bot = false;

  if v_wagered then
    update public.point_wager_holds
       set status = 'settled', updated_at = now()
     where match_id = p_match_id and status = 'held';

    if not exists (select 1 from public.profiles where id = p_winner and is_bot) then
      v_winner_privy := public.point_identity_for_profile(p_winner);
      v_prize := v_stake * 2;
      -- Against the bot the house's half of the pot matches the human's
      -- stake kind for kind; in a player match both stakes went in already.
      v_prize_locked := case when v_is_bot then v_locked_pot * 2 else v_locked_pot end;
      update public.point_accounts
         set balance = balance + v_prize,
             locked_points = locked_points + v_prize_locked,
             updated_at = now()
       where privy_user_id = v_winner_privy
       returning point_accounts.balance into v_balance;
      insert into public.point_ledger (
        privy_user_id, delta, balance_after, reason, reference_id,
        metadata
      ) values (
        v_winner_privy, v_prize, v_balance, 'wager_prize', p_match_id::text,
        jsonb_build_object('stake', v_stake, 'bot_match', v_is_bot, 'locked', v_prize_locked)
      );
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.apply_match_result(uuid, uuid, text, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.apply_match_result(uuid, uuid, text, integer, integer, integer, integer)
  to service_role;

-- A sale may only spend points that were bought (or won from bought stakes).
create or replace function public.begin_point_sell(
  p_profile_id uuid,
  p_request_id uuid,
  p_points integer,
  p_lamports bigint
)
returns table (ok boolean, balance bigint, status text, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privy_user_id text := public.point_identity_for_profile(p_profile_id);
  v_trade public.point_trades%rowtype;
  v_balance bigint;
  v_locked bigint;
begin
  if p_points <> 100 or p_lamports <> 1000000 then
    raise exception 'unsupported point sale' using errcode = '22023';
  end if;
  select * into v_trade from public.point_trades where request_id = p_request_id;
  if found then
    if v_trade.profile_id is distinct from p_profile_id or v_trade.kind <> 'sell' then
      raise exception 'sale request conflicts with an existing trade' using errcode = '23505';
    end if;
    return query select v_trade.status <> 'refunded', public.get_point_balance(p_profile_id),
      v_trade.status, v_trade.error;
    return;
  end if;

  select a.balance, a.locked_points into v_balance, v_locked from public.point_accounts a
   where a.privy_user_id = v_privy_user_id for update;
  if v_balance - v_locked < p_points then
    return query select false, v_balance, 'rejected'::text,
      case when v_balance >= p_points then 'locked_points' else 'insufficient_points' end::text;
    return;
  end if;
  v_balance := v_balance - p_points;
  insert into public.point_trades (
    request_id, profile_id, privy_user_id, kind, points, lamports, status
  ) values (
    p_request_id, p_profile_id, v_privy_user_id, 'sell', p_points,
    p_lamports, 'processing'
  );
  update public.point_accounts set balance = v_balance, updated_at = now()
   where privy_user_id = v_privy_user_id;
  insert into public.point_ledger (
    privy_user_id, delta, balance_after, reason, reference_id
  ) values (
    v_privy_user_id, -p_points, v_balance, 'sell_reserve', p_request_id::text
  );
  return query select true, v_balance, 'processing'::text, null::text;
end;
$$;

revoke all on function public.begin_point_sell(uuid, uuid, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.begin_point_sell(uuid, uuid, integer, bigint)
  to service_role;

-- 0010 - server-authoritative points, wagers, and SOL point trades.
--
-- Point balances belong to a verified Privy identity, rather than a device's
-- anonymous Supabase profile. This prevents welcome-credit farming by
-- reinstalling while still letting an existing Privy user keep one balance.
-- Every mutation is represented in point_ledger and all public functions are
-- service-role-only. The mobile client can never write a balance directly.

alter table public.matches
  add column if not exists wagered boolean not null default false,
  add column if not exists wager_points integer not null default 0,
  add column if not exists wager_settled_at timestamptz;

alter table public.matches drop constraint if exists matches_wager_points_check;
alter table public.matches add constraint matches_wager_points_check
  check ((wagered and wager_points = 50) or (not wagered and wager_points = 0));

create table if not exists public.point_accounts (
  privy_user_id       text primary key,
  balance             bigint not null default 0 check (balance >= 0),
  welcome_awarded_at  timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.point_ledger (
  id             bigint generated always as identity primary key,
  privy_user_id  text not null references public.point_accounts (privy_user_id) on delete restrict,
  delta          bigint not null check (delta <> 0),
  balance_after  bigint not null check (balance_after >= 0),
  reason         text not null check (reason in (
    'welcome', 'wager_entry', 'wager_refund', 'wager_prize',
    'buy', 'sell_reserve', 'sell_refund'
  )),
  reference_id   text not null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (privy_user_id, reason, reference_id)
);

create index if not exists point_ledger_account_time_idx
  on public.point_ledger (privy_user_id, created_at desc);

create table if not exists public.point_wager_holds (
  request_id     uuid primary key,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  privy_user_id  text not null references public.point_accounts (privy_user_id) on delete restrict,
  match_id       uuid references public.matches (id) on delete restrict,
  stake          integer not null check (stake = 50),
  status         text not null default 'held' check (status in ('held', 'refunded', 'settled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (match_id, profile_id)
);

create unique index if not exists point_wager_one_unmatched_hold_idx
  on public.point_wager_holds (profile_id)
  where status = 'held' and match_id is null;

create table if not exists public.point_trades (
  request_id               uuid primary key,
  profile_id               uuid not null references public.profiles (id) on delete cascade,
  privy_user_id            text not null references public.point_accounts (privy_user_id) on delete restrict,
  kind                     text not null check (kind in ('buy', 'sell')),
  points                   integer not null check (points = 100),
  lamports                 bigint not null check (lamports = 1000000),
  status                   text not null check (status in ('processing', 'broadcasting', 'confirmed', 'refunded')),
  signature                text unique,
  signed_transaction       text,
  blockhash                text,
  last_valid_block_height  bigint,
  error                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.point_accounts enable row level security;
alter table public.point_ledger enable row level security;
alter table public.point_wager_holds enable row level security;
alter table public.point_trades enable row level security;

revoke all on public.point_accounts, public.point_ledger,
  public.point_wager_holds, public.point_trades from anon, authenticated;

create or replace function public.point_identity_for_profile(p_profile_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privy_user_id text;
begin
  select privy_user_id into v_privy_user_id
    from public.privy_accounts
   where profile_id = p_profile_id;
  if v_privy_user_id is null then
    raise exception 'profile has no verified Privy account' using errcode = 'P0001';
  end if;
  return v_privy_user_id;
end;
$$;

revoke all on function public.point_identity_for_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.point_identity_for_profile(uuid) to service_role;

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

  insert into public.point_accounts (privy_user_id, balance)
  values (p_privy_user_id, 100)
  on conflict (privy_user_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    insert into public.point_ledger (
      privy_user_id, delta, balance_after, reason, reference_id
    ) values (p_privy_user_id, 100, 100, 'welcome', p_privy_user_id);
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

create or replace function public.get_point_balance(p_profile_id uuid)
returns bigint
language sql
security definer
stable
set search_path = public
as $$
  select a.balance
    from public.point_accounts a
   where a.privy_user_id = public.point_identity_for_profile(p_profile_id);
$$;

revoke all on function public.get_point_balance(uuid)
  from public, anon, authenticated;
grant execute on function public.get_point_balance(uuid) to service_role;

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

  select a.balance into v_balance
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

  v_balance := v_balance - p_stake;
  update public.point_accounts
     set balance = v_balance, updated_at = now()
   where privy_user_id = v_privy_user_id;
  insert into public.point_wager_holds (
    request_id, profile_id, privy_user_id, stake
  ) values (p_request_id, p_profile_id, v_privy_user_id, p_stake);
  insert into public.point_ledger (
    privy_user_id, delta, balance_after, reason, reference_id
  ) values (v_privy_user_id, -p_stake, v_balance, 'wager_entry', p_request_id::text);

  return query select true, p_request_id, v_balance, null::text;
end;
$$;

revoke all on function public.reserve_point_wager(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_point_wager(uuid, uuid, integer) to service_role;

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
    update public.point_accounts
       set balance = balance + v_hold.stake, updated_at = now()
     where privy_user_id = v_hold.privy_user_id
     returning point_accounts.balance into v_balance;
    update public.point_wager_holds
       set status = 'refunded', updated_at = now()
     where request_id = p_request_id;
    insert into public.point_ledger (
      privy_user_id, delta, balance_after, reason, reference_id
    ) values (
      v_hold.privy_user_id, v_hold.stake, v_balance,
      'wager_refund', p_request_id::text
    ) on conflict do nothing;
    return v_balance;
  end if;
  return public.get_point_balance(p_profile_id);
end;
$$;

revoke all on function public.refund_point_wager(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_point_wager(uuid, uuid) to service_role;

create or replace function public.create_wagered_match(
  p_match_id uuid,
  p_mode text,
  p_player_a uuid,
  p_player_b uuid,
  p_seed integer,
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

revoke all on function public.create_wagered_match(uuid, text, uuid, uuid, integer, boolean, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_wagered_match(uuid, text, uuid, uuid, integer, boolean, uuid, uuid)
  to service_role;

-- Replace 0008's function with wager settlement in the same transaction.
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
  v_prize bigint;
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
    select count(*)::integer into v_holds
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
      update public.point_accounts
         set balance = balance + v_prize, updated_at = now()
       where privy_user_id = v_winner_privy
       returning point_accounts.balance into v_balance;
      insert into public.point_ledger (
        privy_user_id, delta, balance_after, reason, reference_id,
        metadata
      ) values (
        v_winner_privy, v_prize, v_balance, 'wager_prize', p_match_id::text,
        jsonb_build_object('stake', v_stake, 'bot_match', v_is_bot)
      );
    end if;
  end if;

  return true;
end;
$$;

create or replace function public.complete_point_buy(
  p_profile_id uuid,
  p_request_id uuid,
  p_signature text,
  p_points integer,
  p_lamports bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privy_user_id text := public.point_identity_for_profile(p_profile_id);
  v_trade public.point_trades%rowtype;
  v_balance bigint;
begin
  if p_points <> 100 or p_lamports <> 1000000 or char_length(p_signature) < 32 then
    raise exception 'unsupported point purchase' using errcode = '22023';
  end if;
  select * into v_trade from public.point_trades where request_id = p_request_id;
  if found then
    if v_trade.profile_id is distinct from p_profile_id
      or v_trade.kind <> 'buy' or v_trade.signature is distinct from p_signature then
      raise exception 'purchase request conflicts with an existing trade' using errcode = '23505';
    end if;
    return public.get_point_balance(p_profile_id);
  end if;

  if exists (select 1 from public.point_trades where signature = p_signature) then
    raise exception 'transaction was already credited' using errcode = '23505';
  end if;
  select balance into v_balance from public.point_accounts
   where privy_user_id = v_privy_user_id for update;
  v_balance := v_balance + p_points;
  insert into public.point_trades (
    request_id, profile_id, privy_user_id, kind, points, lamports,
    status, signature
  ) values (
    p_request_id, p_profile_id, v_privy_user_id, 'buy', p_points,
    p_lamports, 'confirmed', p_signature
  );
  update public.point_accounts set balance = v_balance, updated_at = now()
   where privy_user_id = v_privy_user_id;
  insert into public.point_ledger (
    privy_user_id, delta, balance_after, reason, reference_id,
    metadata
  ) values (
    v_privy_user_id, p_points, v_balance, 'buy', p_request_id::text,
    jsonb_build_object('signature', p_signature, 'lamports', p_lamports)
  );
  return v_balance;
end;
$$;

revoke all on function public.complete_point_buy(uuid, uuid, text, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.complete_point_buy(uuid, uuid, text, integer, bigint)
  to service_role;

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

  select a.balance into v_balance from public.point_accounts a
   where a.privy_user_id = v_privy_user_id for update;
  if v_balance < p_points then
    return query select false, v_balance, 'rejected'::text, 'insufficient_points'::text;
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

create or replace function public.mark_point_sell_broadcast(
  p_request_id uuid,
  p_signature text,
  p_signed_transaction text,
  p_blockhash text,
  p_last_valid_block_height bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.point_trades
     set status = 'broadcasting', signature = p_signature,
         signed_transaction = p_signed_transaction, blockhash = p_blockhash,
         last_valid_block_height = p_last_valid_block_height, updated_at = now()
   where request_id = p_request_id and kind = 'sell'
     and status in ('processing', 'broadcasting')
     and (signature is null or signature = p_signature);
  if not found then
    raise exception 'sale is not available for broadcast' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.mark_point_sell_broadcast(uuid, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.mark_point_sell_broadcast(uuid, text, text, text, bigint)
  to service_role;

create or replace function public.complete_point_sell(
  p_request_id uuid,
  p_signature text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade public.point_trades%rowtype;
begin
  select * into v_trade from public.point_trades where request_id = p_request_id for update;
  if not found or v_trade.kind <> 'sell' or v_trade.signature is distinct from p_signature then
    raise exception 'sale confirmation does not match' using errcode = 'P0001';
  end if;
  if v_trade.status = 'refunded' then
    raise exception 'sale was already refunded' using errcode = 'P0001';
  end if;
  update public.point_trades set status = 'confirmed', updated_at = now()
   where request_id = p_request_id and status <> 'confirmed';
  return public.get_point_balance(v_trade.profile_id);
end;
$$;

revoke all on function public.complete_point_sell(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_point_sell(uuid, text) to service_role;

create or replace function public.refund_point_sell(
  p_request_id uuid,
  p_error text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade public.point_trades%rowtype;
  v_balance bigint;
begin
  select * into v_trade from public.point_trades where request_id = p_request_id for update;
  if not found or v_trade.kind <> 'sell' then
    raise exception 'sale was not found' using errcode = 'P0001';
  end if;
  if v_trade.status in ('processing', 'broadcasting') then
    update public.point_accounts set balance = balance + v_trade.points, updated_at = now()
     where privy_user_id = v_trade.privy_user_id returning point_accounts.balance into v_balance;
    update public.point_trades set status = 'refunded', error = left(p_error, 240), updated_at = now()
     where request_id = p_request_id;
    insert into public.point_ledger (
      privy_user_id, delta, balance_after, reason, reference_id, metadata
    ) values (
      v_trade.privy_user_id, v_trade.points, v_balance, 'sell_refund',
      p_request_id::text, jsonb_build_object('error', left(p_error, 240))
    ) on conflict do nothing;
    return v_balance;
  end if;
  return public.get_point_balance(v_trade.profile_id);
end;
$$;

revoke all on function public.refund_point_sell(uuid, text)
  from public, anon, authenticated;
grant execute on function public.refund_point_sell(uuid, text) to service_role;

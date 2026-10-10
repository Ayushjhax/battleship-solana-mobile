-- 0018 - payment wallets: which verified wallet pays for points, and which one
-- a sale's SOL goes to.
--
-- Until now the treasury knew one wallet per account: the Privy embedded wallet
-- in privy_accounts.solana_wallet_address. An account can also hold external
-- Solana wallets, signed in with or linked through Privy's Sign In With Solana,
-- which Privy verifies on its own server. The match server reads the account's
-- wallets from Privy (never from the app) on every sync and records them here.
--
--   verified_wallets     every wallet Privy has verified for an identity:
--                        'embedded' (Privy holds the key) or 'external' (the
--                        player's own wallet app). An address belongs to one
--                        identity at a time. Another identity reporting it is a
--                        conflict, not a transfer. When Privy stops reporting it
--                        for its owner (unlinked), it is released; only then can
--                        another identity claim it. Balances never move with it.
--   point_accounts.payment_wallet_address
--                        the wallet the identity chose for payments. Unset, the
--                        embedded wallet pays, or else the only external wallet.
--                        A chosen wallet that is no longer verified does NOT fall
--                        back: payments refuse until the player chooses again, so
--                        money never goes through a wallet they did not pick.
--   point_trades         a buy can now be an order made before payment, holding
--                        its payer and an expiry; a sale holds its destination,
--                        fixed when its points are reserved. Neither ever changes
--                        afterwards, whatever the player selects later.
--
-- The 0010/0014 functions stay as they were, so a server that predates this
-- migration, and the APKs that call it, keep working until both are updated.

create table if not exists public.verified_wallets (
  address         text primary key,
  privy_user_id   text not null references public.point_accounts (privy_user_id) on delete cascade,
  profile_id      uuid references public.profiles (id) on delete set null,
  kind            text not null check (kind in ('embedded', 'external')),
  wallet_client   text,
  connector_type  text,
  verified_at     timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  released_at     timestamptz
);

create index if not exists verified_wallets_owner_idx
  on public.verified_wallets (privy_user_id);

alter table public.verified_wallets enable row level security;
revoke all on public.verified_wallets from public, anon, authenticated;

alter table public.point_accounts add column if not exists payment_wallet_address text;

alter table public.point_trades add column if not exists payer_address text;
alter table public.point_trades add column if not exists destination_address text;
alter table public.point_trades add column if not exists expires_at timestamptz;

-- 'awaiting_payment': a buy order made, its transfer not yet seen.
alter table public.point_trades drop constraint if exists point_trades_status_check;
alter table public.point_trades add constraint point_trades_status_check
  check (status in ('awaiting_payment', 'processing', 'broadcasting', 'confirmed', 'refunded'));

create index if not exists point_trades_owner_created_idx
  on public.point_trades (privy_user_id, created_at desc);

-- One-time backfill: the embedded wallets every existing account already pays
-- with, and the external ones Privy had reported, so nobody's payments stop at
-- deploy. Existing rows are never touched, so re-running changes nothing.
insert into public.verified_wallets (address, privy_user_id, profile_id, kind)
select distinct on (p.solana_wallet_address)
       p.solana_wallet_address, p.privy_user_id, p.profile_id, 'embedded'
  from public.privy_accounts p
  join public.point_accounts a on a.privy_user_id = p.privy_user_id
 where p.solana_wallet_address is not null
 order by p.solana_wallet_address, p.updated_at desc
on conflict (address) do nothing;

insert into public.verified_wallets (address, privy_user_id, profile_id, kind, wallet_client, connector_type)
select distinct on (w ->> 'address')
       w ->> 'address', p.privy_user_id, p.profile_id, 'external',
       w ->> 'walletClient', w ->> 'connectorType'
  from public.privy_accounts p
  join public.point_accounts a on a.privy_user_id = p.privy_user_id
  cross join lateral jsonb_array_elements(p.linked_accounts) as w
 where w ->> 'type' = 'wallet'
   and w ->> 'chainType' = 'solana'
   and coalesce(w ->> 'connectorType', '') <> 'embedded'
   and coalesce(w ->> 'walletClient', '') <> 'privy'
   and coalesce(w ->> 'address', '') <> ''
 order by w ->> 'address', p.updated_at desc
on conflict (address) do nothing;

-- Records the wallets Privy reports for an identity, as the match server read
-- them from Privy. Returns each address with 'verified' or 'conflict'; wallets
-- of this identity that Privy no longer reports are released.
create or replace function public.sync_verified_wallets(
  p_profile_id uuid,
  p_privy_user_id text,
  p_wallets jsonb
)
returns table (wallet_address text, wallet_kind text, wallet_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_address text;
  v_kind text;
  v_row public.verified_wallets%rowtype;
  v_reported text[] := array[]::text[];
begin
  if public.point_identity_for_profile(p_profile_id) is distinct from p_privy_user_id then
    raise exception 'Privy identity does not match profile' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_wallets, '[]'::jsonb)) loop
    v_address := nullif(trim(v_item ->> 'address'), '');
    v_kind := v_item ->> 'kind';
    if v_address is null or v_kind is null or v_kind not in ('embedded', 'external') then
      continue;
    end if;
    v_reported := array_append(v_reported, v_address);

    insert into public.verified_wallets (
      address, privy_user_id, profile_id, kind, wallet_client, connector_type
    ) values (
      v_address, p_privy_user_id, p_profile_id, v_kind,
      v_item ->> 'walletClient', v_item ->> 'connectorType'
    ) on conflict (address) do nothing;

    select * into v_row from public.verified_wallets w where w.address = v_address for update;
    if v_row.privy_user_id = p_privy_user_id or v_row.released_at is not null then
      update public.verified_wallets w
         set privy_user_id = p_privy_user_id,
             profile_id = p_profile_id,
             kind = v_kind,
             wallet_client = v_item ->> 'walletClient',
             connector_type = v_item ->> 'connectorType',
             verified_at = case when w.privy_user_id = p_privy_user_id then w.verified_at else now() end,
             last_seen_at = now(),
             released_at = null
       where w.address = v_address;
      wallet_address := v_address;
      wallet_kind := v_kind;
      wallet_status := 'verified';
    else
      wallet_address := v_address;
      wallet_kind := v_kind;
      wallet_status := 'conflict';
    end if;
    return next;
  end loop;

  update public.verified_wallets w
     set released_at = now()
   where w.privy_user_id = p_privy_user_id
     and w.released_at is null
     and not (w.address = any (v_reported));
end;
$$;

revoke all on function public.sync_verified_wallets(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_verified_wallets(uuid, text, jsonb) to service_role;

-- The wallet that pays and gets paid. `problem` is set, and `wallet_address`
-- may be null, when no wallet can be used: 'payment_wallet_unavailable' (the
-- chosen one is no longer verified), 'payment_wallet_not_chosen' (several
-- external wallets and no choice), 'no_payment_wallet'.
create or replace function public.payment_wallet_for(p_profile_id uuid)
returns table (wallet_address text, wallet_kind text, chosen boolean, problem text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privy_user_id text := public.point_identity_for_profile(p_profile_id);
  v_chosen text;
  v_row public.verified_wallets%rowtype;
  v_external integer;
begin
  select a.payment_wallet_address into v_chosen
    from public.point_accounts a where a.privy_user_id = v_privy_user_id;

  if v_chosen is not null then
    select * into v_row from public.verified_wallets w
     where w.address = v_chosen and w.privy_user_id = v_privy_user_id and w.released_at is null;
    if found then
      return query select v_row.address, v_row.kind, true, null::text;
    else
      return query select v_chosen, null::text, true, 'payment_wallet_unavailable'::text;
    end if;
    return;
  end if;

  select * into v_row from public.verified_wallets w
   where w.privy_user_id = v_privy_user_id and w.released_at is null and w.kind = 'embedded'
   order by w.verified_at
   limit 1;
  if found then
    return query select v_row.address, v_row.kind, false, null::text;
    return;
  end if;

  select count(*) into v_external from public.verified_wallets w
   where w.privy_user_id = v_privy_user_id and w.released_at is null and w.kind = 'external';
  if v_external = 1 then
    select * into v_row from public.verified_wallets w
     where w.privy_user_id = v_privy_user_id and w.released_at is null and w.kind = 'external';
    return query select v_row.address, v_row.kind, false, null::text;
    return;
  end if;

  return query select null::text, null::text, false,
    case when v_external > 1 then 'payment_wallet_not_chosen' else 'no_payment_wallet' end::text;
end;
$$;

revoke all on function public.payment_wallet_for(uuid) from public, anon, authenticated;
grant execute on function public.payment_wallet_for(uuid) to service_role;

-- Chooses the payment wallet: one of this identity's verified wallets, or null
-- to go back to the default. A wallet owned by another identity is a conflict
-- (23505); one this identity does not hold is refused (42501).
create or replace function public.select_payment_wallet(p_profile_id uuid, p_address text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privy_user_id text := public.point_identity_for_profile(p_profile_id);
  v_row public.verified_wallets%rowtype;
begin
  if p_address is null then
    update public.point_accounts set payment_wallet_address = null, updated_at = now()
     where privy_user_id = v_privy_user_id;
    return null;
  end if;

  select * into v_row from public.verified_wallets w where w.address = p_address;
  if found and v_row.privy_user_id <> v_privy_user_id and v_row.released_at is null then
    raise exception 'wallet belongs to another account' using errcode = '23505';
  end if;
  if not found or v_row.privy_user_id <> v_privy_user_id or v_row.released_at is not null then
    raise exception 'wallet is not verified for this account' using errcode = '42501';
  end if;

  update public.point_accounts set payment_wallet_address = p_address, updated_at = now()
   where privy_user_id = v_privy_user_id;
  return v_row.kind;
end;
$$;

revoke all on function public.select_payment_wallet(uuid, text) from public, anon, authenticated;
grant execute on function public.select_payment_wallet(uuid, text) to service_role;

-- A buy order, made before the player pays: its payer is fixed here and its
-- expiry tells the app when to stop offering it. Idempotent per request id —
-- a retry returns the order as first made, payer unchanged.
create or replace function public.create_point_buy_order(
  p_profile_id uuid,
  p_request_id uuid,
  p_payer text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privy_user_id text := public.point_identity_for_profile(p_profile_id);
  v_trade public.point_trades%rowtype;
begin
  select * into v_trade from public.point_trades t where t.request_id = p_request_id for update;
  if found then
    if v_trade.profile_id is distinct from p_profile_id or v_trade.kind <> 'buy' then
      raise exception 'purchase request conflicts with an existing trade' using errcode = '23505';
    end if;
    return;
  end if;

  if not exists (
    select 1 from public.verified_wallets w
     where w.address = p_payer and w.privy_user_id = v_privy_user_id and w.released_at is null
  ) then
    raise exception 'wallet is not verified for this account' using errcode = '42501';
  end if;

  insert into public.point_trades (
    request_id, profile_id, privy_user_id, kind, points, lamports, status,
    payer_address, expires_at
  ) values (
    p_request_id, p_profile_id, v_privy_user_id, 'buy', 100, 1000000, 'awaiting_payment',
    p_payer, p_expires_at
  );
end;
$$;

revoke all on function public.create_point_buy_order(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_point_buy_order(uuid, uuid, text, timestamptz)
  to service_role;

-- Credits a buy order once, for a transfer the match server has already read
-- on chain: `p_payer` is the transfer's source, and must be the order's payer.
-- The same signature repeated is idempotent; any other second credit — of the
-- order, or of the signature for any trade — is refused.
create or replace function public.credit_point_buy_order(
  p_profile_id uuid,
  p_request_id uuid,
  p_signature text,
  p_payer text
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
  if char_length(coalesce(p_signature, '')) < 32 then
    raise exception 'unsupported point purchase' using errcode = '22023';
  end if;
  select * into v_trade from public.point_trades t where t.request_id = p_request_id for update;
  if not found or v_trade.kind <> 'buy' or v_trade.profile_id is distinct from p_profile_id then
    raise exception 'purchase order was not found' using errcode = 'P0001';
  end if;
  if v_trade.status = 'confirmed' then
    if v_trade.signature = p_signature then
      return public.get_point_balance(p_profile_id);
    end if;
    raise exception 'purchase order was already paid' using errcode = '23505';
  end if;
  if v_trade.status <> 'awaiting_payment' then
    raise exception 'purchase order cannot be credited' using errcode = 'P0001';
  end if;
  if v_trade.payer_address is distinct from p_payer then
    raise exception 'payment came from another wallet' using errcode = '22023';
  end if;
  if exists (select 1 from public.point_trades t where t.signature = p_signature) then
    raise exception 'transaction was already credited' using errcode = '23505';
  end if;

  select a.balance into v_balance from public.point_accounts a
   where a.privy_user_id = v_trade.privy_user_id for update;
  v_balance := v_balance + v_trade.points;
  update public.point_trades
     set status = 'confirmed', signature = p_signature, updated_at = now()
   where request_id = p_request_id;
  update public.point_accounts set balance = v_balance, updated_at = now()
   where privy_user_id = v_trade.privy_user_id;
  insert into public.point_ledger (
    privy_user_id, delta, balance_after, reason, reference_id, metadata
  ) values (
    v_trade.privy_user_id, v_trade.points, v_balance, 'buy', p_request_id::text,
    jsonb_build_object('signature', p_signature, 'lamports', v_trade.lamports, 'payer', p_payer)
  );
  return v_balance;
end;
$$;

revoke all on function public.credit_point_buy_order(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.credit_point_buy_order(uuid, uuid, text, text)
  to service_role;

-- 0014's begin_point_sell, with the payout's destination fixed on the trade
-- when the points are reserved. The destination must be one of the identity's
-- verified wallets; a retry of the same request returns the trade as it was
-- made, destination unchanged.
create or replace function public.begin_point_sell_to(
  p_profile_id uuid,
  p_request_id uuid,
  p_points integer,
  p_lamports bigint,
  p_destination text
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
  select * into v_trade from public.point_trades t where t.request_id = p_request_id;
  if found then
    if v_trade.profile_id is distinct from p_profile_id or v_trade.kind <> 'sell' then
      raise exception 'sale request conflicts with an existing trade' using errcode = '23505';
    end if;
    return query select v_trade.status <> 'refunded', public.get_point_balance(p_profile_id),
      v_trade.status, v_trade.error;
    return;
  end if;

  if not exists (
    select 1 from public.verified_wallets w
     where w.address = p_destination and w.privy_user_id = v_privy_user_id and w.released_at is null
  ) then
    raise exception 'wallet is not verified for this account' using errcode = '42501';
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
    request_id, profile_id, privy_user_id, kind, points, lamports, status, destination_address
  ) values (
    p_request_id, p_profile_id, v_privy_user_id, 'sell', p_points, p_lamports, 'processing',
    p_destination
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

revoke all on function public.begin_point_sell_to(uuid, uuid, integer, bigint, text)
  from public, anon, authenticated;
grant execute on function public.begin_point_sell_to(uuid, uuid, integer, bigint, text)
  to service_role;

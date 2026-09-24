-- 0019 — The Bounty Board and the Captain's Log (part-04).
--
-- THE BLOCKER THIS OPENS WITH. `public.credit_salvage` (0014) both CHECKS the
-- offline daily cap and INCREMENTS its counter, in one call. Part 4 needs the
-- same decision — "does this offline match count today?" — for contracts and
-- for ink (§1: "Hot-seat and offline matches count toward contracts only under
-- the same daily cap as salvage"), and three consumers each calling
-- credit_salvage would burn three slots for one match.
--
-- So the decision is split out: `offline_slot_take` decides and increments,
-- ONCE per settlement, and everything else is handed the answer. credit_salvage
-- keeps working exactly as before for callers that do not care.
--
-- Idempotent: safe to run on a database that already has it.

-- ---------------------------------------------------------------------------
-- (a) The split
-- ---------------------------------------------------------------------------

/**
 * Takes one of today's offline reward slots, or reports that they are gone.
 *
 * Called ONCE per offline settlement, before anything that depends on the
 * answer. Returns true when the match counts (salvage, contracts and ink all
 * apply) and false when the cap is already spent (the match still pays coins
 * and points — §5's "the 11th offline match still pays coins").
 */
create or replace function public.offline_slot_take(
  p_user_id uuid,
  p_cap     integer,
  p_now     bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
  v_day text := to_char(to_timestamp(p_now / 1000.0) at time zone 'utc', 'YYYY-MM-DD');
  v_counter_day text;
  v_count integer;
begin
  insert into public.city (user_id, state, version, city_version)
  values (p_user_id, public.city_default_state(p_now), 1, 0)
  on conflict (user_id) do nothing;

  select state into v_state from public.city where user_id = p_user_id for update;
  if v_state is null then return false; end if;

  v_counter_day := v_state->'offlineRewardsToday'->>'day';
  v_count := coalesce((v_state->'offlineRewardsToday'->>'count')::integer, 0);
  if v_counter_day is distinct from v_day then v_count := 0; end if;

  if v_count >= p_cap then return false; end if;

  update public.city
     set state = jsonb_set(v_state, '{offlineRewardsToday}',
           jsonb_build_object('day', v_day, 'count', v_count + 1)),
         updated_at = now()
   where user_id = p_user_id;

  return true;
end;
$$;

/**
 * Reads the counter WITHOUT spending a slot — for the HUD's "3 of 10 left".
 *
 * A player who has never opened the city has no row, and a scalar SQL
 * function whose body matches nothing returns NULL — which a caller reads as
 * ZERO SLOTS LEFT, the exact opposite of the truth. So the whole expression is
 * coalesced to the full cap: no row means nothing has been spent.
 */
create or replace function public.offline_slots_left(p_user_id uuid, p_cap integer, p_now bigint)
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select greatest(0, p_cap - case
        when c.state->'offlineRewardsToday'->>'day'
             is distinct from to_char(to_timestamp(p_now / 1000.0) at time zone 'utc', 'YYYY-MM-DD')
        then 0
        else coalesce((c.state->'offlineRewardsToday'->>'count')::integer, 0)
      end)
      from public.city c where c.user_id = p_user_id),
    p_cap);
$$;

-- ---------------------------------------------------------------------------
-- (b) Contracts (§3)
-- ---------------------------------------------------------------------------

create table if not exists public.contracts (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  slot        smallint not null,
  contract_id text not null,
  progress    integer not null default 0 check (progress >= 0),
  target      integer not null check (target > 0),
  state       text not null default 'active' check (state in ('active', 'done', 'claimed')),
  scope       text not null check (scope in ('daily', 'weekly')),
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  primary key (user_id, slot)
);

/** §1 — "One free reroll per day; more cost 10 gems." */
create table if not exists public.contract_rerolls (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day     date not null,
  used    integer not null default 0,
  primary key (user_id, day)
);

create table if not exists public.season (
  id                integer primary key,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  catalogue_version integer not null default 1
);

create table if not exists public.season_progress (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  season_id     integer not null references public.season (id) on delete cascade,
  ink           integer not null default 0 check (ink >= 0),
  premium       boolean not null default false,
  claimed_pages integer[] not null default '{}'::integer[],
  primary key (user_id, season_id)
);

alter table public.contracts        enable row level security;
alter table public.contract_rerolls enable row level security;
alter table public.season           enable row level security;
alter table public.season_progress  enable row level security;

revoke all on public.contracts, public.contract_rerolls, public.season, public.season_progress
  from anon, authenticated;

create index if not exists contracts_expiry_idx on public.contracts (expires_at);
create index if not exists season_progress_season_idx on public.season_progress (season_id);

-- ---------------------------------------------------------------------------
-- (c) Progress — server-side only (§3: "Progress is never accepted from the
--     client"). There is no function here that takes a progress VALUE; there
--     is one that takes a DELTA the server computed from the match, and it
--     clamps at the target.
-- ---------------------------------------------------------------------------

create or replace function public.contracts_advance(
  p_user_id uuid,
  p_deltas  jsonb   -- [{ "contractId": "win-3", "delta": 1 }]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_n integer := 0;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) loop
    update public.contracts
       set progress = least(target, progress + greatest(0, coalesce((v_row ->> 'delta')::integer, 0))),
           state = case
             when least(target, progress + greatest(0, coalesce((v_row ->> 'delta')::integer, 0))) >= target
             then 'done' else state end
     where user_id = p_user_id
       and contract_id = v_row ->> 'contractId'
       and state = 'active'
       and expires_at > now();
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;

/**
 * §5.4 — "Claim is idempotent; double claim credits once."
 *
 * The claim is the CLAW: `state = 'done'` in the WHERE, moving to 'claimed'.
 * A second call matches zero rows and pays nothing. Same shape as the raid
 * settlement and the war settlement.
 */
create or replace function public.contract_claim(
  p_user_id uuid,
  p_slot    smallint,
  p_coins   integer,
  p_steel   integer,
  p_gems    integer,
  p_ink     integer,
  p_season  integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.contracts set state = 'claimed'
   where user_id = p_user_id and slot = p_slot and state = 'done';
  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'not-claimable');
  end if;

  update public.profiles
     set coins = coins + greatest(p_coins, 0),
         steel = steel + greatest(p_steel, 0),
         gems  = gems  + greatest(p_gems, 0)
   where id = p_user_id;

  insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
  values (p_user_id, 'contract_claim', p_slot::text,
          greatest(p_coins, 0), greatest(p_steel, 0), greatest(p_gems, 0));

  if p_ink > 0 and p_season is not null then
    insert into public.season_progress (user_id, season_id, ink)
    values (p_user_id, p_season, p_ink)
    on conflict (user_id, season_id) do update
      set ink = public.season_progress.ink + p_ink;
  end if;

  return jsonb_build_object('claimed', true);
end;
$$;

/** §1 — the reroll counter. Returns how many have been used today. */
create or replace function public.contract_reroll_take(p_user_id uuid, p_day date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_used integer;
begin
  insert into public.contract_rerolls (user_id, day, used)
  values (p_user_id, p_day, 1)
  on conflict (user_id, day) do update set used = public.contract_rerolls.used + 1
  returning used into v_used;
  return v_used;
end;
$$;

create or replace function public.contracts_issue(
  p_user_id uuid,
  p_rows    jsonb    -- [{slot, contractId, target, scope, expiresAt}]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_n integer := 0;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.contracts (user_id, slot, contract_id, progress, target, state, scope, expires_at)
    values (p_user_id,
            (v_row ->> 'slot')::smallint,
            v_row ->> 'contractId',
            0,
            (v_row ->> 'target')::integer,
            'active',
            v_row ->> 'scope',
            (v_row ->> 'expiresAt')::timestamptz)
    on conflict (user_id, slot) do update
      set contract_id = excluded.contract_id,
          progress = 0,
          target = excluded.target,
          state = 'active',
          scope = excluded.scope,
          issued_at = now(),
          expires_at = excluded.expires_at;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- (d) The Captain's Log (§2)
-- ---------------------------------------------------------------------------

create or replace function public.season_add_ink(p_user_id uuid, p_season integer, p_ink integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_ink integer;
begin
  if p_ink <= 0 then
    select ink into v_ink from public.season_progress
     where user_id = p_user_id and season_id = p_season;
    return coalesce(v_ink, 0);
  end if;

  insert into public.season_progress (user_id, season_id, ink)
  values (p_user_id, p_season, p_ink)
  on conflict (user_id, season_id) do update
    set ink = public.season_progress.ink + p_ink
  returning ink into v_ink;
  return v_ink;
end;
$$;

/**
 * §5.6 — "auto-claim job pays every unclaimed page exactly once (run it twice
 * in the test)".
 *
 * The claim is the array membership test: a page already in `claimed_pages`
 * cannot be added again, and the wallet moves only for pages this call
 * actually appended. Same two-mechanism shape as settle_war.
 */
create or replace function public.season_claim_pages(
  p_user_id uuid,
  p_season  integer,
  p_pages   integer[],
  p_coins   integer,
  p_steel   integer,
  p_gems    integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed integer[];
  v_new integer[];
begin
  select claimed_pages into v_claimed
    from public.season_progress
   where user_id = p_user_id and season_id = p_season
   for update;
  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'no-progress', 'pages', 0);
  end if;

  select coalesce(array_agg(page), '{}'::integer[]) into v_new
    from unnest(p_pages) as page
   where page <> all(coalesce(v_claimed, '{}'::integer[]));

  if array_length(v_new, 1) is null then
    return jsonb_build_object('claimed', false, 'reason', 'already-claimed', 'pages', 0);
  end if;

  update public.season_progress
     set claimed_pages = coalesce(claimed_pages, '{}'::integer[]) || v_new
   where user_id = p_user_id and season_id = p_season;

  update public.profiles
     set coins = coins + greatest(p_coins, 0),
         steel = steel + greatest(p_steel, 0),
         gems  = gems  + greatest(p_gems, 0)
   where id = p_user_id;

  insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
  values (p_user_id, 'season_claim', p_season::text,
          greatest(p_coins, 0), greatest(p_steel, 0), greatest(p_gems, 0));

  return jsonb_build_object('claimed', true, 'pages', array_length(v_new, 1));
end;
$$;

/** §2 — "Buying the premium track retroactively unlocks every page already earned." */
create or replace function public.season_buy_premium(
  p_user_id uuid,
  p_season  integer,
  p_gems    integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.season_progress
     where user_id = p_user_id and season_id = p_season and premium
  ) then
    return 'already-premium';
  end if;

  update public.profiles set gems = gems - p_gems
   where id = p_user_id and gems >= p_gems;
  if not found then return 'insufficient-gems'; end if;

  insert into public.season_progress (user_id, season_id, premium)
  values (p_user_id, p_season, true)
  on conflict (user_id, season_id) do update set premium = true;

  insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
  values (p_user_id, 'season_premium', p_season::text, 0, 0, -p_gems);

  return 'ok';
end;
$$;

revoke all on function public.offline_slot_take(uuid, integer, bigint) from anon, authenticated;
revoke all on function public.offline_slots_left(uuid, integer, bigint) from anon, authenticated;
revoke all on function public.contracts_advance(uuid, jsonb) from anon, authenticated;
revoke all on function public.contract_claim(uuid, smallint, integer, integer, integer, integer, integer)
  from anon, authenticated;
revoke all on function public.contract_reroll_take(uuid, date) from anon, authenticated;
revoke all on function public.contracts_issue(uuid, jsonb) from anon, authenticated;
revoke all on function public.season_add_ink(uuid, integer, integer) from anon, authenticated;
revoke all on function public.season_claim_pages(uuid, integer, integer[], integer, integer, integer)
  from anon, authenticated;
revoke all on function public.season_buy_premium(uuid, integer, integer) from anon, authenticated;

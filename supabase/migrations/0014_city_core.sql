-- 0014 — Port City core (docs/port-city/part-01-city-core.md).
--
-- The rules live in TypeScript (src/engine/city), shared by the app and the
-- match server exactly like the match engine. This migration is the
-- transactional store underneath them:
--
--   city               one row per player: the CityState JSON plus the
--                      optimistic-concurrency version and the migration marker
--   economy_ledger     append-only, one row per currency movement
--   city_request_log   the newest 50 responses per user, for requestId replay
--   profiles.steel     the new currency, guarded like every other score column
--
-- Writes go through public.city_apply, which commits the city row, the wallet,
-- the ledger rows and the request-log row in ONE statement under a version
-- check. The catalogue is never duplicated here: city_apply is handed the
-- already-computed next state and the deltas.
--
-- The one exception is salvage, which must land inside the same transaction
-- that settles a match (part-01 §4). public.credit_salvage therefore knows the
-- Scrapyard bonus percentages and the offline daily cap. Both are pinned
-- against src/engine/city by server/tests/regression/city-sql-catalogue-pin.test.ts.
--
-- Idempotent: safe to run on a database that already has it.

-- ---------------------------------------------------------------------------
-- (a) profiles.steel — and the guard that keeps clients out of it
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists steel integer not null default 0;

-- 0001's trigger rejects any client-JWT write to a score column. `steel` must
-- join that list or it ships client-writable, silently.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
as $$
begin
  if public.jwt_role() in ('authenticated', 'anon') then
    if new.id             is distinct from old.id
    or new.rank_points    is distinct from old.rank_points
    or new.coins          is distinct from old.coins
    or new.gems           is distinct from old.gems
    or new.steel          is distinct from old.steel
    or new.battles_played is distinct from old.battles_played
    or new.battles_won    is distinct from old.battles_won
    or new.buildings      is distinct from old.buildings
    or new.created_at     is distinct from old.created_at
    then
      raise exception 'profile scores are written by the match server only'
        using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute procedure public.guard_profile_update();

-- ---------------------------------------------------------------------------
-- (b) Tables. RLS on, no end-user policies and no grants: the secret key is
--     the only writer, exactly like offline_results (0007) and privy_accounts.
-- ---------------------------------------------------------------------------

create table if not exists public.city (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  state        jsonb   not null,
  version      integer not null default 1,
  city_version integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.economy_ledger (
  id       bigserial primary key,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  at       timestamptz not null default now(),
  reason   text not null,
  ref      text,
  d_coins  integer not null default 0,
  d_steel  integer not null default 0,
  d_gems   integer not null default 0
);

create index if not exists economy_ledger_user_idx
  on public.economy_ledger (user_id, at desc, id desc);

create table if not exists public.city_request_log (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  request_id uuid not null,
  at         timestamptz not null default now(),
  response   jsonb not null,
  primary key (user_id, request_id)
);

create index if not exists city_request_log_trim_idx
  on public.city_request_log (user_id, at desc);

alter table public.city             enable row level security;
alter table public.economy_ledger   enable row level security;
alter table public.city_request_log enable row level security;

revoke all on public.city, public.economy_ledger, public.city_request_log
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (c) The default CityState, in ONE place.
--
--     A match can settle salvage before the player has ever opened the city,
--     so credit_salvage may have to create the row. That needs a default state
--     here, which duplicates newCity() in src/engine/city/actions.ts —
--     server/tests/integration/city-db.test.ts pins the two together.
--
--     city_version stays 0 so the TypeScript v1 migration still runs on the
--     first GET /city and still pays the grants.
-- ---------------------------------------------------------------------------

create or replace function public.city_default_state(p_now bigint)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'version', 1,
    'cityVersion', 0,
    'workers', 2,
    'scrapPile', 0,
    'updatedAt', p_now,
    'offlineRewardsToday', jsonb_build_object(
      'day', to_char(to_timestamp(p_now / 1000.0) at time zone 'utc', 'YYYY-MM-DD'),
      'count', 0
    ),
    'buildings', (
      select jsonb_object_agg(
        id,
        jsonb_build_object(
          'level', case when id in ('admiralty', 'scrapyard') then 1 else 0 end,
          'stored', 0,
          'lastAccrualAt', p_now,
          'carry', 0
        )
      )
      from unnest(array[
        'admiralty', 'scrapyard', 'fish_market', 'foundry', 'shipyard',
        'stationery', 'harbour_office', 'naval_academy', 'coastal_command',
        'armory', 'fleet_hall', 'newsstand', 'trade_docks', 'officers_club',
        'lighthouse'
      ]) as id
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- (d) Reads
-- ---------------------------------------------------------------------------

/** The city row, creating an empty one if the player has never had it. */
-- A later migration (0018) widens this function's RETURN TYPE, and Postgres
-- will not `create or replace` a new column into a `returns table`. Dropping
-- first makes THIS file re-runnable after 0018 has already run — the migration
-- suite applies every file twice to prove exactly that.
drop function if exists public.city_load(uuid, bigint);

create or replace function public.city_load(p_user_id uuid, p_now bigint)
returns table (state jsonb, version integer, city_version integer,
               coins integer, steel integer, gems integer, rank_points integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.city (user_id, state, version, city_version)
  values (p_user_id, public.city_default_state(p_now), 1, 0)
  on conflict (user_id) do nothing;

  return query
    select c.state, c.version, c.city_version,
           p.coins, p.steel, p.gems, p.rank_points
      from public.city c
      join public.profiles p on p.id = c.user_id
     where c.user_id = p_user_id;
end;
$$;

/** A stored response for a requestId already seen, or null. */
create or replace function public.city_request_lookup(p_user_id uuid, p_request_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select response from public.city_request_log
   where user_id = p_user_id and request_id = p_request_id;
$$;

-- ---------------------------------------------------------------------------
-- (e) The write. City + wallet + ledger + request log, atomically, under an
--     optimistic version check. Returns the new version, or null on conflict.
-- ---------------------------------------------------------------------------

create or replace function public.city_apply(
  p_user_id          uuid,
  p_expected_version integer,
  p_state            jsonb,
  p_city_version     integer,
  p_d_coins          integer,
  p_d_steel          integer,
  p_d_gems           integer,
  p_ledger           jsonb,          -- array of {reason, ref, dCoins, dSteel, dGems}
  p_request_id       uuid default null,
  p_response         jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_version integer;
  v_row jsonb;
begin
  update public.city
     set state = p_state,
         city_version = p_city_version,
         version = version + 1,
         updated_at = now()
   where user_id = p_user_id
     and version = p_expected_version
  returning version into v_new_version;

  if not found then
    return null;  -- version conflict: the caller re-reads and retries once
  end if;

  if p_d_coins <> 0 or p_d_steel <> 0 or p_d_gems <> 0 then
    update public.profiles
       set coins = coins + p_d_coins,
           steel = steel + p_d_steel,
           gems  = gems  + p_d_gems
     where id = p_user_id;

    -- §2.1: no balance may go below zero. The rules refuse first; this is the
    -- backstop that turns a rules bug into a failed transaction, not a debt.
    if exists (
      select 1 from public.profiles
       where id = p_user_id and (coins < 0 or steel < 0 or gems < 0)
    ) then
      raise exception 'city_apply would drive a balance negative for %', p_user_id
        using errcode = 'P0001';
    end if;
  end if;

  if p_ledger is not null then
    for v_row in select * from jsonb_array_elements(p_ledger) loop
      insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
      values (
        p_user_id,
        v_row->>'reason',
        nullif(v_row->>'ref', ''),
        coalesce((v_row->>'dCoins')::integer, 0),
        coalesce((v_row->>'dSteel')::integer, 0),
        coalesce((v_row->>'dGems')::integer, 0)
      );
    end loop;
  end if;

  if p_request_id is not null and p_response is not null then
    insert into public.city_request_log (user_id, request_id, response)
    values (p_user_id, p_request_id, p_response)
    on conflict (user_id, request_id) do nothing;

    -- Keep the newest 50 per user (part-01 §3, DECISIONS D6).
    delete from public.city_request_log
     where user_id = p_user_id
       and request_id not in (
         select request_id from public.city_request_log
          where user_id = p_user_id
          order by at desc, request_id desc
          limit 50
       );
  end if;

  return v_new_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- (f) Salvage, inside whatever transaction is settling the match.
--
--     p_base is 5 x (cells of every enemy ship this player sank), computed in
--     TypeScript from SALVAGE_PER_CELL. The Scrapyard bonus and the offline
--     daily cap are applied here because the row has to be locked anyway.
-- ---------------------------------------------------------------------------

create or replace function public.credit_salvage(
  p_user_id uuid,
  p_base    integer,
  p_ref     text,
  p_limited boolean,          -- true for ai / hotseat, false for online
  p_cap     integer,
  p_now     bigint
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
  v_level integer;
  v_bonus integer;
  v_amount integer;
  v_day text := to_char(to_timestamp(p_now / 1000.0) at time zone 'utc', 'YYYY-MM-DD');
  v_counter_day text;
  v_counter_count integer;
begin
  if p_base <= 0 then return 0; end if;

  -- A match can settle before the player has ever opened the city.
  insert into public.city (user_id, state, version, city_version)
  values (p_user_id, public.city_default_state(p_now), 1, 0)
  on conflict (user_id) do nothing;

  select state into v_state from public.city where user_id = p_user_id for update;
  if v_state is null then return 0; end if;

  if p_limited then
    v_counter_day := v_state->'offlineRewardsToday'->>'day';
    v_counter_count := coalesce((v_state->'offlineRewardsToday'->>'count')::integer, 0);
    if v_counter_day is distinct from v_day then
      v_counter_count := 0;
    end if;
    if v_counter_count >= p_cap then
      return 0;                                  -- capped: coins/points untouched
    end if;
    v_state := jsonb_set(v_state, '{offlineRewardsToday}',
      jsonb_build_object('day', v_day, 'count', v_counter_count + 1));
  end if;

  -- The Scrapyard bonus. Mirrors CITY_CATALOGUE.scrapyard[].value and is
  -- pinned against it by a test.
  v_level := coalesce((v_state->'buildings'->'scrapyard'->>'level')::integer, 0);
  v_bonus := case v_level
    when 1 then 0 when 2 then 5 when 3 then 10
    when 4 then 15 when 5 then 20 when 6 then 25
    else 0 end;

  v_amount := floor((p_base * (100 + v_bonus)) / 100.0)::integer;

  v_state := jsonb_set(v_state, '{scrapPile}',
    to_jsonb(coalesce((v_state->>'scrapPile')::integer, 0) + v_amount));

  update public.city
     set state = v_state, version = version + 1, updated_at = now()
   where user_id = p_user_id;

  insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
  values (p_user_id, 'salvage', p_ref, 0, 0, 0);

  return v_amount;
end;
$$;

-- ---------------------------------------------------------------------------
-- (g) apply_match_result gains salvage.
--
--     A signature change, so the exact 7-argument version from 0010 is
--     dropped first — create or replace cannot widen a parameter list. The new
--     parameters default, so a 7-argument call still binds here and an
--     in-flight deploy does not break. Naming the old arity exactly keeps this
--     migration re-runnable: on a second pass it is already gone.
-- ---------------------------------------------------------------------------

drop function if exists public.apply_match_result(
  uuid, uuid, text, integer, integer, integer, integer
);

create or replace function public.apply_match_result(
  p_match_id uuid,
  p_winner uuid,
  p_end_reason text,
  p_win_points integer,
  p_win_coins integer,
  p_loss_points integer,
  p_loss_coins integer,
  p_salvage_a integer default 0,
  p_salvage_b integer default 0,
  p_now bigint default null
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
  v_now bigint := coalesce(p_now, (extract(epoch from now()) * 1000)::bigint);
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

  -- Salvage, in this same transaction (part-01 §4). Online matches are never
  -- capped (DECISIONS D8), and the bot's row is never touched.
  if p_salvage_a > 0 and not exists (select 1 from public.profiles where id = v_a and is_bot) then
    perform public.credit_salvage(v_a, p_salvage_a, p_match_id::text, false, 0, v_now);
  end if;
  if p_salvage_b > 0 and not exists (select 1 from public.profiles where id = v_b and is_bot) then
    perform public.credit_salvage(v_b, p_salvage_b, p_match_id::text, false, 0, v_now);
  end if;

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
        privy_user_id, delta, balance_after, reason, reference_id, metadata
      ) values (
        v_winner_privy, v_prize, v_balance, 'wager_prize', p_match_id::text,
        jsonb_build_object('stake', v_stake, 'bot_match', v_is_bot)
      );
    end if;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- (h) apply_offline_result gains salvage and the daily cap.
--
--     Rewards stay hard-coded here as they were in 0007 — changing that is not
--     this part's job — but salvage is capped per UTC day (§2.2) and the cap
--     is passed in so src/engine/city stays the source of the number.
-- ---------------------------------------------------------------------------

drop function if exists public.apply_offline_result(
  text, uuid, text, boolean, timestamptz
);

create or replace function public.apply_offline_result(
  p_id text,
  p_user_id uuid,
  p_mode text,
  p_won boolean,
  p_completed_at timestamptz,
  p_salvage_base integer default 0,
  p_offline_cap integer default 10,
  p_now bigint default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
  v_now bigint := coalesce(p_now, (extract(epoch from now()) * 1000)::bigint);
begin
  insert into public.offline_results (id, user_id, mode, won, completed_at)
  values (p_id, p_user_id, p_mode, p_won, p_completed_at)
  on conflict (id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    return -1;  -- already applied; a retry moves nothing
  end if;

  update public.profiles
  set rank_points = rank_points + case when p_won then 25 else 5 end,
      coins = coins + case when p_won then 50 else 10 end,
      battles_played = battles_played + 1,
      battles_won = battles_won + case when p_won then 1 else 0 end
  where id = p_user_id;

  -- Coins and rank points above are untouched by the cap, on purpose (§2.2).
  return public.credit_salvage(
    p_user_id, p_salvage_base, p_id, true, p_offline_cap, v_now
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- (i) Grants. Every function here is service-role only: these are the writes
--     that a client JWT must never be able to reach.
-- ---------------------------------------------------------------------------

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.city_default_state(bigint)',
    'public.city_load(uuid, bigint)',
    'public.city_request_lookup(uuid, uuid)',
    'public.city_apply(uuid, integer, jsonb, integer, integer, integer, integer, jsonb, uuid, jsonb)',
    'public.credit_salvage(uuid, integer, text, boolean, integer, bigint)',
    'public.apply_match_result(uuid, uuid, text, integer, integer, integer, integer, integer, integer, bigint)',
    'public.apply_offline_result(text, uuid, text, boolean, timestamptz, integer, integer, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

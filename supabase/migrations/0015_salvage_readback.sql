-- 0015 — salvage read-back and the Scrapyard's wrecks.
--
-- Two gaps left open at the end of Part 2, both for the same reason: the
-- server credited salvage but never told anyone how much, so the client had no
-- server-sourced number to render and could only have guessed.
--
--   1. apply_match_result returned a bare boolean. It now returns
--      {settled, salvage_a, salvage_b}, so room.ts can put the real credited
--      amount into the `over` frame and the Result screen can show
--      "Salvaged 70 steel -> Scrapyard" without computing anything.
--
--   2. The Scrapyard held a number, not a fleet. credit_salvage now also
--      records WHICH ship classes were sunk, so part-02 §6's "the Scrapyard
--      draws the wrecks of your last battles" has something true to draw.
--      Collecting the pile clears them, exactly as it clears the steel.
--
-- Idempotent: safe to run on a database that already has it.

-- ---------------------------------------------------------------------------
-- (a) The default state gains scrapWrecks, in step with src/engine/city.
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
    'scrapWrecks', '[]'::jsonb,
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
-- (b) credit_salvage records the wrecks alongside the steel.
--
--     Display slots by Scrapyard level (DECISIONS D19): 2 + level, so L1 shows
--     three wrecks and L6 shows eight. Oldest fall off the end.
-- ---------------------------------------------------------------------------

drop function if exists public.credit_salvage(uuid, integer, text, boolean, integer, bigint);

create or replace function public.credit_salvage(
  p_user_id uuid,
  p_base    integer,
  p_ref     text,
  p_limited boolean,
  p_cap     integer,
  p_now     bigint,
  p_wrecks  jsonb default '[]'::jsonb
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
  v_slots integer;
  v_wrecks jsonb;
  v_day text := to_char(to_timestamp(p_now / 1000.0) at time zone 'utc', 'YYYY-MM-DD');
  v_counter_day text;
  v_counter_count integer;
begin
  if p_base <= 0 then return 0; end if;

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
      return 0;
    end if;
    v_state := jsonb_set(v_state, '{offlineRewardsToday}',
      jsonb_build_object('day', v_day, 'count', v_counter_count + 1));
  end if;

  v_level := coalesce((v_state->'buildings'->'scrapyard'->>'level')::integer, 0);
  v_bonus := case v_level
    when 1 then 0 when 2 then 5 when 3 then 10
    when 4 then 15 when 5 then 20 when 6 then 25
    else 0 end;

  v_amount := floor((p_base * (100 + v_bonus)) / 100.0)::integer;

  v_state := jsonb_set(v_state, '{scrapPile}',
    to_jsonb(coalesce((v_state->>'scrapPile')::integer, 0) + v_amount));

  -- The wrecks, newest first, trimmed to the level's display slots.
  v_slots := greatest(1, 2 + v_level);
  v_wrecks := coalesce(v_state->'scrapWrecks', '[]'::jsonb);
  if jsonb_typeof(p_wrecks) = 'array' and jsonb_array_length(p_wrecks) > 0 then
    select coalesce(jsonb_agg(value), '[]'::jsonb) into v_wrecks
      from (
        select value from jsonb_array_elements(p_wrecks || v_wrecks) limit v_slots
      ) as trimmed;
  end if;
  v_state := jsonb_set(v_state, '{scrapWrecks}', v_wrecks);

  update public.city
     set state = v_state, version = version + 1, updated_at = now()
   where user_id = p_user_id;

  insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
  values (p_user_id, 'salvage', p_ref, 0, 0, 0);

  return v_amount;
end;
$$;

-- ---------------------------------------------------------------------------
-- (c) apply_match_result reports what it credited.
--
--     A return-type change, so the 10-argument version from 0014 is dropped
--     first. The new parameters default, so an older caller still binds here.
-- ---------------------------------------------------------------------------

drop function if exists public.apply_match_result(
  uuid, uuid, text, integer, integer, integer, integer, integer, integer, bigint
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
  p_now bigint default null,
  p_wrecks_a jsonb default '[]'::jsonb,
  p_wrecks_b jsonb default '[]'::jsonb
)
returns jsonb
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
  v_credited_a integer := 0;
  v_credited_b integer := 0;
begin
  select player_a, player_b, is_bot, wagered, wager_points
    into v_a, v_b, v_is_bot, v_wagered, v_stake
    from public.matches
   where id = p_match_id and ended_at is null
   for update;
  if not found then
    return jsonb_build_object('settled', false, 'salvage_a', 0, 'salvage_b', 0);
  end if;
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

  if p_salvage_a > 0 and not exists (select 1 from public.profiles where id = v_a and is_bot) then
    v_credited_a := public.credit_salvage(v_a, p_salvage_a, p_match_id::text, false, 0, v_now, p_wrecks_a);
  end if;
  if p_salvage_b > 0 and not exists (select 1 from public.profiles where id = v_b and is_bot) then
    v_credited_b := public.credit_salvage(v_b, p_salvage_b, p_match_id::text, false, 0, v_now, p_wrecks_b);
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

  return jsonb_build_object(
    'settled', true, 'salvage_a', v_credited_a, 'salvage_b', v_credited_b
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- (d) apply_offline_result passes its wrecks through too.
-- ---------------------------------------------------------------------------

drop function if exists public.apply_offline_result(
  text, uuid, text, boolean, timestamptz, integer, integer, bigint
);

create or replace function public.apply_offline_result(
  p_id text,
  p_user_id uuid,
  p_mode text,
  p_won boolean,
  p_completed_at timestamptz,
  p_salvage_base integer default 0,
  p_offline_cap integer default 10,
  p_now bigint default null,
  p_wrecks jsonb default '[]'::jsonb
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
    return -1;
  end if;

  update public.profiles
  set rank_points = rank_points + case when p_won then 25 else 5 end,
      coins = coins + case when p_won then 50 else 10 end,
      battles_played = battles_played + 1,
      battles_won = battles_won + case when p_won then 1 else 0 end
  where id = p_user_id;

  return public.credit_salvage(
    p_user_id, p_salvage_base, p_id, true, p_offline_cap, v_now, p_wrecks
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- (e) Grants for the new signatures. Service-role only, as in 0014.
-- ---------------------------------------------------------------------------

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.city_default_state(bigint)',
    'public.credit_salvage(uuid, integer, text, boolean, integer, bigint, jsonb)',
    'public.apply_match_result(uuid, uuid, text, integer, integer, integer, integer, integer, integer, bigint, jsonb, jsonb)',
    'public.apply_offline_result(text, uuid, text, boolean, timestamptz, integer, integer, bigint, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- (f) Backfill: every existing city row gains an empty wreck list, so the
--     engine never has to cope with the field being absent.
-- ---------------------------------------------------------------------------

update public.city
   set state = jsonb_set(state, '{scrapWrecks}', '[]'::jsonb)
 where state->'scrapWrecks' is null;

-- 0016 — Harbour raids (docs/port-city/part-06-raids-engine.md).
--
-- The rules live in TypeScript (src/engine/raid), shared by the app and the
-- match server exactly like the match engine and the city. This migration is
-- the transactional store underneath them, and the tables are §9's, verbatim:
--
--   harbour     one row per defender: the layout JSON the raid engine runs on
--   raid        one row per raid, closed exactly once
--   raid_log    the replay: actions + per-action results + engine version
--   raid_lock   a 6-minute hold on a defender, so two attackers cannot share
--   shield      a defender's grace period after being hurt
--   renown      the raid ladder — SEPARATE from rank_points, and it can fall
--
-- THREE HARD RULES, enforced here and not only in the service:
--
--   1. The layout never leaves the server. `harbour` has no RLS policy and no
--      grant, so a client JWT cannot select it at all. Only the secret key can.
--   2. rank_points and match rewards are untouched. Nothing in this file writes
--      profiles.rank_points, battles_played or battles_won. Renown lives in its
--      own table so the two ladders cannot be confused by a future join.
--   3. Below Admiralty 3 a player can neither raid nor be raided. The search
--      function filters on it, and raid_open refuses it.
--
-- Idempotent: safe to run on a database that already has it.

-- ---------------------------------------------------------------------------
-- (a) Tables. RLS on, no end-user policies and no grants: the secret key is
--     the only reader and the only writer, exactly like city (0014).
-- ---------------------------------------------------------------------------

create table if not exists public.harbour (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  layout     jsonb   not null,
  fuel_used  integer not null default 0,
  valid      boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.renown (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  value      integer not null default 0 check (value >= 0),
  best       integer not null default 0 check (best >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.shield (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  until   timestamptz not null,
  reason  text not null default 'raided'
);

create table if not exists public.raid (
  id               uuid primary key,
  attacker_id      uuid not null references public.profiles (id) on delete cascade,
  -- null for a pirate cove: there is nobody on the other side (§5).
  defender_id      uuid references public.profiles (id) on delete set null,
  cove_seed        bigint,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  stars            smallint not null default 0 check (stars between 0 and 3),
  destruction      numeric(5, 4) not null default 0 check (destruction between 0 and 1),
  shells_left      integer not null default 0,
  loot_coins       integer not null default 0,
  loot_steel       integer not null default 0,
  taken_coins      integer not null default 0,
  taken_steel      integer not null default 0,
  renown_attacker  integer not null default 0,
  renown_defender  integer not null default 0,
  end_reason       text,
  -- §5: a cove has no defender, so exactly one of the two must be set.
  constraint raid_target_ck check (
    (defender_id is not null and cove_seed is null)
    or (defender_id is null and cove_seed is not null)
  )
);

create table if not exists public.raid_log (
  raid_id        uuid primary key references public.raid (id) on delete cascade,
  layout         jsonb not null,
  kit            jsonb not null default '{}'::jsonb,
  actions        jsonb not null default '[]'::jsonb,
  results        jsonb not null default '[]'::jsonb,
  config         jsonb not null default '{}'::jsonb,
  engine_version text  not null
);

create table if not exists public.raid_lock (
  defender_id uuid primary key references public.profiles (id) on delete cascade,
  raid_id     uuid not null,
  attacker_id uuid not null references public.profiles (id) on delete cascade,
  expires_at  timestamptz not null
);

alter table public.harbour   enable row level security;
alter table public.renown    enable row level security;
alter table public.shield    enable row level security;
alter table public.raid      enable row level security;
alter table public.raid_log  enable row level security;
alter table public.raid_lock enable row level security;

revoke all on public.harbour, public.renown, public.shield,
              public.raid, public.raid_log, public.raid_lock
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- (b) Indexes for the search (§9: "(renown) where not shielded and not locked
--     and admiralty >= 3").
--
--     A partial index cannot reference another table, so the shield and lock
--     halves are anti-joins against their own small, expiring indexes and the
--     renown ordering is the one that has to scale.
-- ---------------------------------------------------------------------------

create index if not exists renown_value_idx on public.renown (value);

create index if not exists shield_until_idx on public.shield (until);

create index if not exists raid_lock_expiry_idx on public.raid_lock (expires_at);

-- The Admiralty level lives inside the city JSON. The expression is immutable,
-- so it can be indexed, and the search's `>= 3` becomes an index condition.
create index if not exists city_admiralty_idx
  on public.city ((((state -> 'buildings' -> 'admiralty' ->> 'level'))::integer))
  where state -> 'buildings' -> 'admiralty' ->> 'level' is not null;

-- §5.3 — "not raided by you in the last 24 h".
create index if not exists raid_repeat_idx
  on public.raid (attacker_id, defender_id, started_at desc);

create index if not exists raid_attacker_idx on public.raid (attacker_id, started_at desc);
create index if not exists raid_defender_idx on public.raid (defender_id, started_at desc);

-- An attacker may hold only one unfinished raid at a time.
create unique index if not exists raid_one_open_per_attacker_idx
  on public.raid (attacker_id) where ended_at is null;

-- ---------------------------------------------------------------------------
-- (c) The harbour: saved only when TypeScript has already validated it.
--     §10 — "an invalid harbour is refused, and the last valid one keeps
--     defending", which is why this is an upsert and never a delete.
-- ---------------------------------------------------------------------------

create or replace function public.harbour_save(
  p_user_id   uuid,
  p_layout    jsonb,
  p_fuel_used integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.harbour (user_id, layout, fuel_used, valid)
  values (p_user_id, p_layout, p_fuel_used, true)
  on conflict (user_id) do update
    set layout = excluded.layout,
        fuel_used = excluded.fuel_used,
        valid = true,
        updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- (d) The search (§5).
--
--     Eligibility, in the doc's order. The renown window comes from TypeScript
--     (renownWindow()); p_window null means "uncapped", which is what happens
--     after eight searches in a session.
--
--     This function READS. It never charges, never locks and never picks: the
--     service charges the coins, picks one row and takes the lock, so that a
--     replayed requestId can return the same card without paying twice.
-- ---------------------------------------------------------------------------

create or replace function public.raid_search(
  p_user_id       uuid,
  p_renown        integer,
  p_window        integer,        -- null = uncapped
  p_min_admiralty integer default 3,
  p_repeat_hours  integer default 24,
  p_limit         integer default 20
)
returns table (
  user_id         uuid,
  name            text,
  avatar_id       integer,
  avatar_color    text,
  country_code    text,
  admiralty_level integer,
  renown          integer
)
language sql
security definer
set search_path = public
as $$
  select p.id,
         p.name,
         p.avatar_id::integer,
         p.avatar_color,
         p.country_code,
         ((c.state -> 'buildings' -> 'admiralty' ->> 'level'))::integer as admiralty_level,
         coalesce(r.value, 0) as renown
    from public.profiles p
    join public.city    c on c.user_id = p.id
    join public.harbour h on h.user_id = p.id and h.valid
    left join public.renown r on r.user_id = p.id
   where p.id <> p_user_id
     and coalesce(p.is_bot, false) = false
     -- 1. Admiralty >= 3, has a valid harbour (joined above)
     and ((c.state -> 'buildings' -> 'admiralty' ->> 'level'))::integer >= p_min_admiralty
     -- 1. not shielded
     and not exists (
       select 1 from public.shield s where s.user_id = p.id and s.until > now()
     )
     -- 1. not raid-locked
     and not exists (
       select 1 from public.raid_lock l where l.defender_id = p.id and l.expires_at > now()
     )
     -- 2. renown within the window
     and (p_window is null or abs(coalesce(r.value, 0) - p_renown) <= p_window)
     -- 3. not raided by this attacker in the last 24 h
     and not exists (
       select 1 from public.raid rd
        where rd.attacker_id = p_user_id
          and rd.defender_id = p.id
          and rd.started_at > now() - make_interval(hours => p_repeat_hours)
     )
   order by abs(coalesce(r.value, 0) - p_renown), p.id
   limit greatest(1, p_limit);
$$;

-- ---------------------------------------------------------------------------
-- (d2) The defender's wealth at raid START (§7.2).
--
--      It returns every building's uncollected `stored` value RAW. It does not
--      say which building produces coins and which produces steel, because
--      that is catalogue knowledge and src/engine/city owns it; a second copy
--      in plpgsql is a second thing to keep in step. TypeScript classifies.
-- ---------------------------------------------------------------------------

create or replace function public.raid_defender_snapshot(p_user_id uuid)
returns table (
  coins           integer,
  steel           integer,
  scrap_pile      integer,
  admiralty_level integer,
  renown          integer,
  stores          jsonb
)
language sql
security definer
set search_path = public
as $$
  select p.coins,
         p.steel,
         coalesce((c.state ->> 'scrapPile')::integer, 0),
         coalesce(((c.state -> 'buildings' -> 'admiralty' ->> 'level'))::integer, 0),
         coalesce(r.value, 0),
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'id', b.key,
                     'stored', coalesce((b.value ->> 'stored')::integer, 0)))
              from jsonb_each(coalesce(c.state -> 'buildings', '{}'::jsonb)) b
             where coalesce((b.value ->> 'stored')::integer, 0) > 0),
           '[]'::jsonb)
    from public.profiles p
    left join public.city   c on c.user_id = p.id
    left join public.renown r on r.user_id = p.id
   where p.id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- (e) Taking a card: charge, lock and open the raid, in one transaction.
--
--     The lock is the concurrency test in §11: two attackers cannot lock the
--     same defender. `insert ... on conflict do nothing` after clearing the
--     expired row makes that a single atomic statement rather than a
--     check-then-act.
-- ---------------------------------------------------------------------------

create or replace function public.raid_open(
  p_raid_id       uuid,
  p_attacker_id   uuid,
  p_defender_id   uuid,          -- null for a cove
  p_cove_seed     bigint,        -- null for a real defender
  p_cost_coins    integer,
  p_lock_minutes  integer default 6,
  p_drop_shield   boolean default false,
  p_layout        jsonb default '{}'::jsonb,
  p_kit           jsonb default '{}'::jsonb,
  p_config        jsonb default '{}'::jsonb,
  p_engine_version text default 'unknown',
  p_request_id    uuid default null,
  p_response      jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coins integer;
begin
  -- §11 Search — "charges the coins once even if the caller retries with the
  -- same requestId". The replay check has to be INSIDE the transaction that
  -- takes the money, or a crash between a successful charge and a separate
  -- 'remember' leaves the retry free to charge again. It reuses
  -- city_request_log (0014): the table is named after its first caller, but
  -- the mechanism is the app's, not the city's.
  if p_request_id is not null then
    if exists (
      select 1 from public.city_request_log
       where user_id = p_attacker_id and request_id = p_request_id
    ) then
      return 'replay';
    end if;
  end if;

  -- An attacker runs one raid at a time.
  if exists (select 1 from public.raid where attacker_id = p_attacker_id and ended_at is null) then
    return 'raid-in-progress';
  end if;

  if p_defender_id is not null then
    -- Clear an expired hold first, so a stale lock never blocks a live search.
    delete from public.raid_lock where defender_id = p_defender_id and expires_at <= now();

    insert into public.raid_lock (defender_id, raid_id, attacker_id, expires_at)
    values (p_defender_id, p_raid_id, p_attacker_id,
            now() + make_interval(mins => p_lock_minutes))
    on conflict (defender_id) do nothing;

    if not found then
      return 'target-locked';
    end if;
  end if;

  -- §5 — the search costs coins. Charged here, with the lock, so a caller who
  -- loses the race to the lock is not charged for a target they never got.
  if p_cost_coins > 0 then
    update public.profiles set coins = coins - p_cost_coins
     where id = p_attacker_id and coins >= p_cost_coins
    returning coins into v_coins;

    if not found then
      delete from public.raid_lock where raid_id = p_raid_id;
      return 'insufficient-coins';
    end if;

    insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
    values (p_attacker_id, 'raid_search', p_raid_id::text, -p_cost_coins, 0, 0);
  end if;

  -- §7.4 — "raiding while shielded drops your own shield". The confirmation
  -- happens in the client; the server is told the answer.
  if p_drop_shield then
    delete from public.shield where user_id = p_attacker_id;
  end if;

  insert into public.raid (id, attacker_id, defender_id, cove_seed)
  values (p_raid_id, p_attacker_id, p_defender_id, p_cove_seed);

  -- §8 — the replay snapshot is stored at OPEN, not at settle: a defender who
  -- edits their harbour mid-raid must not change the raid that is running.
  insert into public.raid_log (raid_id, layout, kit, config, engine_version)
  values (p_raid_id, p_layout, p_kit, p_config, p_engine_version)
  on conflict (raid_id) do nothing;

  if p_request_id is not null then
    insert into public.city_request_log (user_id, request_id, response)
    values (p_attacker_id, p_request_id, coalesce(p_response, '{}'::jsonb))
    on conflict (user_id, request_id) do nothing;

    delete from public.city_request_log
     where user_id = p_attacker_id
       and request_id not in (
         select request_id from public.city_request_log
          where user_id = p_attacker_id
          order by at desc, request_id desc
          limit 50
       );
  end if;

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- (f) Settlement — §7.5, "everything above happens in ONE transaction with
--     ledger rows for both sides, and a raid row plus a raid_log".
--
--     Everything that is a RULE was computed in TypeScript and is passed in.
--     What this function owns is atomicity, the once-only guarantee, and the
--     clamping: it never drives a balance negative and never takes from a
--     defender more than they still have.
--
--     p_drain is the ordered list TypeScript built from the city snapshot:
--       [{ "building": "fish_market", "resource": "coins", "amount": 200 },
--        { "building": "foundry",     "resource": "steel", "amount": 400 },
--        { "building": "scrap",       "resource": "steel", "amount": 100 }]
--     Each is clamped to what is actually there right now, so a defender who
--     collected mid-raid simply has less to lose. The shortfall is NOT taken
--     from their wallet beyond the wallet amounts also listed here, and it is
--     NOT deducted from the attacker: the house covers the gap, exactly as it
--     covers the star bonus. See DECISIONS.md D21.
-- ---------------------------------------------------------------------------

create or replace function public.settle_raid(
  p_raid_id         uuid,
  p_stars           smallint,
  p_destruction     numeric,
  p_shells_left     integer,
  p_end_reason      text,
  p_earned_coins    integer,      -- what the ATTACKER is paid
  p_earned_steel    integer,
  p_drain           jsonb,        -- ordered store drains for the defender
  p_wallet_coins    integer,      -- wallet part of the defender's loss
  p_wallet_steel    integer,
  p_renown_attacker integer,      -- already floored by settleRenown()
  p_renown_defender integer,
  p_shield_hours    integer,
  p_actions         jsonb,
  p_results         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raid        public.raid%rowtype;
  v_entry       jsonb;
  v_building    text;
  v_want        integer;
  v_have        integer;
  v_take        integer;
  v_state       jsonb;
  v_resource    text;
  v_took_coins  integer := 0;
  v_took_steel  integer := 0;
  v_have_coins  integer;
  v_have_steel  integer;
  v_city_ver    integer;
begin
  -- Settling twice credits once (§11, Concurrency). The row is the lock.
  select * into v_raid from public.raid where id = p_raid_id for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'no-such-raid');
  end if;
  if v_raid.ended_at is not null then
    return jsonb_build_object('applied', false, 'reason', 'already-settled');
  end if;

  -- ---- the defender's loss -------------------------------------------------
  if v_raid.defender_id is not null then
    select state, version into v_state, v_city_ver
      from public.city where user_id = v_raid.defender_id for update;

    if v_state is not null and p_drain is not null then
      for v_entry in select * from jsonb_array_elements(p_drain) loop
        v_building := v_entry ->> 'building';
        v_resource := coalesce(v_entry ->> 'resource', 'steel');
        v_want := greatest(coalesce((v_entry ->> 'amount')::integer, 0), 0);

        if v_building = 'scrap' then
          v_have := greatest(coalesce((v_state ->> 'scrapPile')::integer, 0), 0);
          v_take := least(v_want, v_have);
          if v_take > 0 then
            v_state := jsonb_set(v_state, '{scrapPile}', to_jsonb(v_have - v_take));
            -- The wrecks go with the steel: a looted Scrapyard is an empty one.
            if v_have - v_take = 0 then
              v_state := jsonb_set(v_state, '{scrapWrecks}', '[]'::jsonb);
            end if;
            v_took_steel := v_took_steel + v_take;
          end if;

        elsif v_state -> 'buildings' ? v_building then
          v_have := greatest(
            coalesce((v_state -> 'buildings' -> v_building ->> 'stored')::integer, 0), 0);
          v_take := least(v_want, v_have);
          if v_take > 0 then
            v_state := jsonb_set(
              v_state,
              array['buildings', v_building, 'stored'],
              to_jsonb(v_have - v_take)
            );
            if v_resource = 'coins' then
              v_took_coins := v_took_coins + v_take;
            else
              v_took_steel := v_took_steel + v_take;
            end if;
          end if;
        end if;
      end loop;

      update public.city
         set state = v_state,
             version = version + 1,
             updated_at = now()
       where user_id = v_raid.defender_id;
    end if;

    -- ...then the wallet, never below zero.
    --
    -- The balances are read under the row lock FIRST, because an UPDATE's
    -- RETURNING gives the new value and what the ledger needs is the amount
    -- actually removed. Reading, clamping, then writing the exact figure is
    -- the only version of this that cannot report a loss that did not happen.
    if p_wallet_coins > 0 or p_wallet_steel > 0 then
      select coins, steel into v_have_coins, v_have_steel
        from public.profiles where id = v_raid.defender_id for update;

      v_have_coins := least(greatest(p_wallet_coins, 0), greatest(coalesce(v_have_coins, 0), 0));
      v_have_steel := least(greatest(p_wallet_steel, 0), greatest(coalesce(v_have_steel, 0), 0));

      if v_have_coins > 0 or v_have_steel > 0 then
        update public.profiles
           set coins = coins - v_have_coins,
               steel = steel - v_have_steel
         where id = v_raid.defender_id;

        v_took_coins := v_took_coins + v_have_coins;
        v_took_steel := v_took_steel + v_have_steel;
      end if;
    end if;

    if v_took_coins > 0 or v_took_steel > 0 then
      insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
      values (v_raid.defender_id, 'raid_looted', p_raid_id::text,
              -v_took_coins, -v_took_steel, 0);
    end if;

    -- ---- the defender's renown and shield ---------------------------------
    insert into public.renown (user_id, value, best)
    values (v_raid.defender_id, greatest(0, p_renown_defender), greatest(0, p_renown_defender))
    on conflict (user_id) do update
      set value = greatest(0, excluded.value),
          best = greatest(public.renown.best, excluded.value),
          updated_at = now();

    if p_shield_hours > 0 then
      insert into public.shield (user_id, until, reason)
      values (v_raid.defender_id, now() + make_interval(hours => p_shield_hours), 'raided')
      on conflict (user_id) do update
        set until = greatest(public.shield.until, excluded.until),
            reason = excluded.reason;
    end if;
  end if;

  -- ---- the attacker's pay --------------------------------------------------
  if p_earned_coins <> 0 or p_earned_steel <> 0 then
    update public.profiles
       set coins = coins + greatest(p_earned_coins, 0),
           steel = steel + greatest(p_earned_steel, 0)
     where id = v_raid.attacker_id;

    insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
    values (v_raid.attacker_id, 'raid_loot', p_raid_id::text,
            greatest(p_earned_coins, 0), greatest(p_earned_steel, 0), 0);
  end if;

  -- A cove moves no renown at all (§5): the service passes the unchanged value.
  insert into public.renown (user_id, value, best)
  values (v_raid.attacker_id, greatest(0, p_renown_attacker), greatest(0, p_renown_attacker))
  on conflict (user_id) do update
    set value = greatest(0, excluded.value),
        best = greatest(public.renown.best, excluded.value),
        updated_at = now();

  -- ---- close the raid ------------------------------------------------------
  update public.raid
     set ended_at = now(),
         stars = p_stars,
         destruction = p_destruction,
         shells_left = p_shells_left,
         end_reason = p_end_reason,
         loot_coins = greatest(p_earned_coins, 0),
         loot_steel = greatest(p_earned_steel, 0),
         taken_coins = v_took_coins,
         taken_steel = v_took_steel,
         renown_attacker = p_renown_attacker,
         renown_defender = p_renown_defender
   where id = p_raid_id;

  update public.raid_log
     set actions = coalesce(p_actions, '[]'::jsonb),
         results = coalesce(p_results, '[]'::jsonb)
   where raid_id = p_raid_id;

  delete from public.raid_lock where raid_id = p_raid_id;

  return jsonb_build_object(
    'applied', true,
    'takenCoins', v_took_coins,
    'takenSteel', v_took_steel
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- (f2) The defence log and the replay — part-07 §4, §5.
--
--      Both are READS of rows settle_raid already wrote. The log is the last
--      30 raids against this player; `read` is a per-row flag the client sets
--      when it opens the log, and `revenge_taken` is what makes §8.6's
--      "exactly once" survive a reinstall.
-- ---------------------------------------------------------------------------

alter table public.raid
  add column if not exists defender_read boolean not null default false,
  add column if not exists revenge_taken boolean not null default false;

create or replace function public.raid_defence_log(p_user_id uuid, p_limit integer default 30)
returns table (
  raid_id       uuid,
  attacker_id   uuid,
  attacker_name text,
  avatar_id     integer,
  avatar_color  text,
  country_code  text,
  at            timestamptz,
  stars         smallint,
  destruction   numeric,
  taken_coins   integer,
  taken_steel   integer,
  renown_delta  integer,
  read          boolean,
  revenge_available boolean
)
language sql
security definer
set search_path = public
as $$
  select r.id,
         r.attacker_id,
         coalesce(p.name, 'A raider'),
         coalesce(p.avatar_id, 0)::integer,
         coalesce(p.avatar_color, 'violet'),
         p.country_code,
         coalesce(r.ended_at, r.started_at),
         r.stars,
         r.destruction,
         r.taken_coins,
         r.taken_steel,
         r.renown_defender,
         r.defender_read,
         -- A cove has no attacker to answer to, so revenge needs one.
         (r.revenge_taken = false and r.attacker_id is not null)
    from public.raid r
    left join public.profiles p on p.id = r.attacker_id
   where r.defender_id = p_user_id
     and r.ended_at is not null
   order by r.ended_at desc
   limit greatest(1, p_limit);
$$;

create or replace function public.raid_log_mark_read(p_user_id uuid, p_raid_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update public.raid
     set defender_read = true
   where defender_id = p_user_id
     and id = any(p_raid_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

/**
 * part-07 §8.6 — "revenge skips the search cost exactly once per incoming
 * raid". This is the server half: an atomic claim. The client half is the
 * in-session guard in src/raid/ui/defenceLog.ts, which covers a slow refetch;
 * this one covers a reinstall.
 */
create or replace function public.raid_claim_revenge(p_user_id uuid, p_raid_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.raid
     set revenge_taken = true
   where id = p_raid_id
     and defender_id = p_user_id
     and revenge_taken = false
     and attacker_id is not null;
  return found;
end;
$$;

-- §5 — the replay's stored snapshot, for either side of the raid.
create or replace function public.raid_replay(p_raid_id uuid, p_user_id uuid)
returns table (
  raid_id        uuid,
  attacker_id    uuid,
  defender_id    uuid,
  cove_seed      bigint,
  ended_at       timestamptz,
  stars          smallint,
  destruction    numeric,
  end_reason     text,
  layout         jsonb,
  kit            jsonb,
  config         jsonb,
  actions        jsonb,
  results        jsonb,
  engine_version text
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.attacker_id, r.defender_id, r.cove_seed, r.ended_at,
         r.stars, r.destruction, r.end_reason,
         l.layout, l.kit, l.config, l.actions, l.results, l.engine_version
    from public.raid r
    join public.raid_log l on l.raid_id = r.id
   -- The ONLY two people who may see a layout: the two who were there (§8).
   where r.id = p_raid_id
     and (r.attacker_id = p_user_id or r.defender_id = p_user_id);
$$;

revoke all on function public.raid_defence_log(uuid, integer) from anon, authenticated;
revoke all on function public.raid_log_mark_read(uuid, uuid[]) from anon, authenticated;
revoke all on function public.raid_claim_revenge(uuid, uuid) from anon, authenticated;
revoke all on function public.raid_replay(uuid, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- (g) Housekeeping the service calls opportunistically.
-- ---------------------------------------------------------------------------

create or replace function public.raid_sweep_expired()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  delete from public.raid_lock where expires_at <= now();
  get diagnostics v_n = row_count;
  delete from public.shield where until <= now();
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- (h) Grants. Same posture as 0014: the secret key only.
-- ---------------------------------------------------------------------------

revoke all on function public.harbour_save(uuid, jsonb, integer) from anon, authenticated;
revoke all on function public.raid_search(uuid, integer, integer, integer, integer, integer)
  from anon, authenticated;
revoke all on function public.raid_defender_snapshot(uuid) from anon, authenticated;
revoke all on function public.raid_open(uuid, uuid, uuid, bigint, integer, integer, boolean,
                                        jsonb, jsonb, jsonb, text, uuid, jsonb)
  from anon, authenticated;
revoke all on function public.settle_raid(uuid, smallint, numeric, integer, text, integer,
                                          integer, jsonb, integer, integer, integer, integer,
                                          integer, jsonb, jsonb) from anon, authenticated;
revoke all on function public.raid_sweep_expired() from anon, authenticated;

-- 0017 — Fleets, donations, wars, visits and the Flag Hall (part-08).
--
-- The rules live in TypeScript (src/engine/fleets), shared by the app and the
-- match server exactly like the city and the raid. This migration is §6's data
-- model verbatim, plus two things §6 implies but does not list:
--
--   war_reward   one row per member per war, UNIQUE on (war_id, user_id).
--                The independent backstop under the scheduler's exactly-once
--                guarantee — see settle_war below.
--   flags        §5's Flag Hall, one row per (user, country) ever beaten.
--
-- THE ONE THING IN THIS FILE THAT CAN LOSE MONEY is public.settle_war. Read
-- its header before changing it.
--
-- Idempotent: safe to run on a database that already has it.

-- ---------------------------------------------------------------------------
-- (a) Tables. RLS on, no end-user policies and no grants: the secret key is
--     the only writer, exactly like city (0014) and raid (0016).
-- ---------------------------------------------------------------------------

create table if not exists public.fleet (
  id           uuid primary key,
  name         text not null,
  description  text not null default '',
  emblem_badge smallint not null default 0,
  emblem_tint  smallint not null default 0,
  policy       text not null default 'request' check (policy in ('open', 'request', 'closed')),
  min_renown   integer not null default 0,
  created_at   timestamptz not null default now(),
  archived     boolean not null default false,
  constraint fleet_name_len check (char_length(name) between 3 and 16),
  constraint fleet_desc_len check (char_length(description) <= 120)
);

-- A player is in at most one fleet, which is why user_id is the primary key
-- and not half of a composite: "leave before you join" is a rule, not a race.
create table if not exists public.fleet_member (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  fleet_id  uuid not null references public.fleet (id) on delete cascade,
  role      text not null default 'sailor'
            check (role in ('admiral', 'commodore', 'officer', 'sailor')),
  joined_at timestamptz not null default now(),
  merit     integer not null default 0 check (merit >= 0),
  /** §4 — war opt-in lives on the membership, not on the war: a member opts
      in once and stays opted in until they say otherwise. */
  war_opt_in boolean not null default false
);

create table if not exists public.fleet_request (
  fleet_id uuid not null references public.fleet (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  at       timestamptz not null default now(),
  state    text not null default 'open' check (state in ('open', 'accepted', 'rejected')),
  primary key (fleet_id, user_id)
);

create table if not exists public.fleet_message (
  id       bigserial primary key,
  fleet_id uuid not null references public.fleet (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  -- §2 — 'phrase' or 'sticker'. There is NO 'text'. Free text does not ship.
  kind     text not null check (kind in ('phrase', 'sticker')),
  code     text not null check (char_length(code) <= 16),
  at       timestamptz not null default now()
);

create table if not exists public.donation (
  id           uuid primary key,
  fleet_id     uuid not null references public.fleet (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  item         text not null,
  at           timestamptz not null default now(),
  donor_id     uuid references public.profiles (id) on delete set null,
  filled_at    timestamptz,
  consumed_at  timestamptz
);

create table if not exists public.war (
  id                uuid primary key,
  fleet_a           uuid not null references public.fleet (id) on delete cascade,
  fleet_b           uuid references public.fleet (id) on delete cascade,
  size              smallint not null check (size in (5, 10, 15)),
  state             text not null default 'searching'
                    check (state in ('searching', 'prep', 'battle', 'settling', 'ended', 'cancelled')),
  rating            integer not null default 0,
  search_started_at timestamptz not null default now(),
  prep_ends_at      timestamptz,
  battle_ends_at    timestamptz,
  -- §6 — "Use a state machine with a `settled_at` marker". THIS IS THE MARKER.
  settled_at        timestamptz,
  winner            text check (winner in ('a', 'b', 'draw')),
  stars_a           integer not null default 0,
  stars_b           integer not null default 0,
  destruction_a     numeric(8, 4) not null default 0,
  destruction_b     numeric(8, 4) not null default 0
);

create table if not exists public.war_member (
  war_id     uuid not null references public.war (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  fleet_id   uuid not null references public.fleet (id) on delete cascade,
  renown     integer not null default 0,
  -- The war harbour: separate from the home harbour (§4).
  harbour    jsonb,
  raids_used smallint not null default 0,
  primary key (war_id, user_id)
);

create table if not exists public.war_raid (
  war_id         uuid not null references public.war (id) on delete cascade,
  raid_id        uuid not null,
  attacker_id    uuid not null references public.profiles (id) on delete cascade,
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  stars          smallint not null default 0 check (stars between 0 and 3),
  destruction    numeric(5, 4) not null default 0,
  finished_at    timestamptz not null default now(),
  primary key (war_id, raid_id)
);

-- THE BACKSTOP. One row per member per war, and nothing may write a second.
create table if not exists public.war_reward (
  war_id  uuid not null references public.war (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  steel   integer not null default 0,
  coins   integer not null default 0,
  gems    integer not null default 0,
  no_show boolean not null default false,
  paid_at timestamptz not null default now(),
  primary key (war_id, user_id)
);

-- §5 — the Flag Hall. One row the first time you beat a captain from a country.
create table if not exists public.flags (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  country_code text not null check (char_length(country_code) = 2),
  first_at     timestamptz not null default now(),
  primary key (user_id, country_code)
);

alter table public.fleet         enable row level security;
alter table public.fleet_member  enable row level security;
alter table public.fleet_request enable row level security;
alter table public.fleet_message enable row level security;
alter table public.donation      enable row level security;
alter table public.war           enable row level security;
alter table public.war_member    enable row level security;
alter table public.war_raid      enable row level security;
alter table public.war_reward    enable row level security;
alter table public.flags         enable row level security;

revoke all on public.fleet, public.fleet_member, public.fleet_request,
              public.fleet_message, public.donation, public.war,
              public.war_member, public.war_raid, public.war_reward, public.flags
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- (b) Indexes
-- ---------------------------------------------------------------------------

create index if not exists fleet_member_fleet_idx on public.fleet_member (fleet_id);
create index if not exists fleet_request_fleet_idx on public.fleet_request (fleet_id, state);
create index if not exists fleet_message_recent_idx on public.fleet_message (fleet_id, at desc);
create index if not exists donation_open_idx
  on public.donation (fleet_id, at desc) where donor_id is null;
create index if not exists donation_held_idx
  on public.donation (requester_id) where filled_at is not null and consumed_at is null;

-- The scheduler's three sweeps. Each is a partial index on the state it moves,
-- so a tick touches only the rows that are actually due.
create index if not exists war_searching_idx
  on public.war (search_started_at) where state = 'searching';
create index if not exists war_prep_idx on public.war (prep_ends_at) where state = 'prep';
create index if not exists war_battle_idx on public.war (battle_ends_at) where state = 'battle';
create index if not exists war_settling_idx on public.war (id) where state = 'settling';

create index if not exists war_raid_target_idx on public.war_raid (war_id, target_user_id);
create index if not exists war_member_fleet_idx on public.war_member (war_id, fleet_id);

-- ---------------------------------------------------------------------------
-- (c) Fleet membership
-- ---------------------------------------------------------------------------

create or replace function public.fleet_create(
  p_fleet_id uuid,
  p_user_id  uuid,
  p_name     text,
  p_description text,
  p_badge    smallint,
  p_tint     smallint,
  p_policy   text,
  p_min_renown integer,
  p_cost_coins integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.fleet_member where user_id = p_user_id) then
    return 'already-in-a-fleet';
  end if;

  update public.profiles set coins = coins - p_cost_coins
   where id = p_user_id and coins >= p_cost_coins;
  if not found then return 'insufficient-coins'; end if;

  insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
  values (p_user_id, 'fleet_create', p_fleet_id::text, -p_cost_coins, 0, 0);

  insert into public.fleet (id, name, description, emblem_badge, emblem_tint, policy, min_renown)
  values (p_fleet_id, p_name, p_description, p_badge, p_tint, p_policy, p_min_renown);

  insert into public.fleet_member (user_id, fleet_id, role)
  values (p_user_id, p_fleet_id, 'admiral');

  return 'ok';
end;
$$;

/**
 * §1 — "Leaving is always allowed. An Admiral who leaves passes the flag to
 * the highest-ranked active member; if the fleet empties it is archived."
 *
 * The successor is chosen in TypeScript (successorFor) and passed in, so the
 * ordering rule has one implementation. This function only applies it.
 */
create or replace function public.fleet_leave(
  p_user_id      uuid,
  p_successor_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fleet uuid;
  v_role  text;
  v_left  integer;
begin
  select fleet_id, role into v_fleet, v_role
    from public.fleet_member where user_id = p_user_id;
  if not found then return 'not-in-a-fleet'; end if;

  delete from public.fleet_member where user_id = p_user_id;

  select count(*) into v_left from public.fleet_member where fleet_id = v_fleet;

  if v_left = 0 then
    update public.fleet set archived = true where id = v_fleet;
    return 'archived';
  end if;

  if v_role = 'admiral' and p_successor_id is not null then
    update public.fleet_member set role = 'admiral'
     where user_id = p_successor_id and fleet_id = v_fleet;
    return 'succeeded';
  end if;

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- (d) Donations (§3)
-- ---------------------------------------------------------------------------

create or replace function public.donation_fill(
  p_donation_id uuid,
  p_donor_id    uuid,
  p_cost_coins  integer,
  p_donor_steel integer,
  p_donor_merit integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fleet uuid;
begin
  -- The claim: only one donor can fill a request, and only once.
  update public.donation
     set donor_id = p_donor_id, filled_at = now()
   where id = p_donation_id and donor_id is null and requester_id <> p_donor_id
  returning fleet_id into v_fleet;
  if not found then return 'already-filled'; end if;

  update public.profiles
     set coins = coins - p_cost_coins, steel = steel + p_donor_steel
   where id = p_donor_id and coins >= p_cost_coins;
  if not found then
    -- No coins: undo the claim so somebody else can fill it.
    update public.donation set donor_id = null, filled_at = null where id = p_donation_id;
    return 'insufficient-coins';
  end if;

  update public.fleet_member set merit = merit + p_donor_merit
   where user_id = p_donor_id and fleet_id = v_fleet;

  insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
  values (p_donor_id, 'fleet_donation', p_donation_id::text, -p_cost_coins, p_donor_steel, 0);

  return 'ok';
end;
$$;

/**
 * §3 — a reinforcement is spent when a raid or a war uses it.
 *
 * `p_context` is passed in and checked HERE as well as in TypeScript, because
 * the ranked integrity rule (§8.2, "nothing a fleet gives a player can enter a
 * ranked match") is worth two independent refusals. There is no context value
 * that consumes one for a ranked match, and 'ranked' is rejected explicitly
 * rather than by omission, so the intent is legible.
 */
create or replace function public.donation_consume(
  p_donation_id uuid,
  p_user_id     uuid,
  p_context     text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_context = 'ranked' then
    return 'not-in-ranked';
  end if;
  if p_context not in ('raid', 'war', 'friendly') then
    return 'unknown-context';
  end if;

  update public.donation set consumed_at = now()
   where id = p_donation_id
     and requester_id = p_user_id
     and filled_at is not null
     and consumed_at is null;
  return case when found then 'ok' else 'not-held' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- (e) THE WAR SCHEDULER — part-08 §6
--
--     "it moves wars prep -> battle -> ended, settles rewards, and must be
--      idempotent and restart-safe (a crashed worker must not pay twice)."
--
--     Every transition below is ONE statement with the current state in its
--     WHERE clause, so a second run matches zero rows. Nothing is scheduled in
--     memory, so a process that has been down for six hours catches up on its
--     first tick: the conditions are `<= now()`, not "did it fire while I was
--     watching".
-- ---------------------------------------------------------------------------

create or replace function public.war_advance_prep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  update public.war set state = 'battle'
   where state = 'prep' and prep_ends_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.war_advance_battle()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  update public.war set state = 'settling'
   where state = 'battle' and battle_ends_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.war_expire_searches(p_give_up_ms integer default 1800000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  update public.war set state = 'cancelled'
   where state = 'searching'
     and search_started_at <= now() - make_interval(secs => p_give_up_ms / 1000.0);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

/**
 * SETTLEMENT. The only thing in this package that pays out, and therefore the
 * only thing that must be exactly-once. Two independent mechanisms:
 *
 *   1. THE CLAIM. The first statement is an UPDATE guarded by
 *      `state = 'settling' and settled_at is null`. Only one caller can win
 *      it; the row lock serialises two workers that arrive together. Because a
 *      plpgsql function is ONE TRANSACTION, a worker killed after the claim
 *      but before the payment rolls BOTH back — the war returns to 'settling'
 *      and the next tick legitimately retries. There is no state in which the
 *      claim is committed and the payment is not.
 *
 *   2. THE BACKSTOP. Every war_reward insert is `on conflict do nothing`
 *      against a unique (war_id, user_id). If the claim were ever wrong, the
 *      rewards still cannot double, and the wallets move only for rows that
 *      were actually inserted.
 *
 * p_rewards is the list TypeScript computed (memberRewards in
 * src/engine/fleets/war.ts):
 *   [{ "userId": "...", "steel": 900, "coins": 300, "gems": 10, "noShow": false }]
 */
create or replace function public.settle_war(
  p_war_id      uuid,
  p_winner      text,
  p_stars_a     integer,
  p_stars_b     integer,
  p_destruction_a numeric,
  p_destruction_b numeric,
  p_rewards     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     jsonb;
  v_user    uuid;
  v_steel   integer;
  v_coins   integer;
  v_gems    integer;
  v_paid    integer := 0;
  v_skipped integer := 0;
begin
  -- 1. THE CLAIM.
  update public.war
     set settled_at = now(),
         state = 'ended',
         winner = p_winner,
         stars_a = p_stars_a,
         stars_b = p_stars_b,
         destruction_a = p_destruction_a,
         destruction_b = p_destruction_b
   where id = p_war_id
     and state = 'settling'
     and settled_at is null;

  if not found then
    return jsonb_build_object('paid', false, 'reason', 'already-settled', 'members', 0);
  end if;

  -- 2. THE PAYMENT, in this same transaction.
  for v_row in select * from jsonb_array_elements(coalesce(p_rewards, '[]'::jsonb)) loop
    v_user  := (v_row ->> 'userId')::uuid;
    v_steel := greatest(coalesce((v_row ->> 'steel')::integer, 0), 0);
    v_coins := greatest(coalesce((v_row ->> 'coins')::integer, 0), 0);
    v_gems  := greatest(coalesce((v_row ->> 'gems')::integer, 0), 0);

    insert into public.war_reward (war_id, user_id, steel, coins, gems, no_show)
    values (p_war_id, v_user, v_steel, v_coins, v_gems, coalesce((v_row ->> 'noShow')::boolean, false))
    on conflict (war_id, user_id) do nothing;

    if not found then
      -- The backstop caught it: this member was already paid for this war.
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_steel > 0 or v_coins > 0 or v_gems > 0 then
      update public.profiles
         set steel = steel + v_steel, coins = coins + v_coins, gems = gems + v_gems
       where id = v_user;

      insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
      values (v_user, 'war_reward', p_war_id::text, v_coins, v_steel, v_gems);
    end if;

    v_paid := v_paid + 1;
  end loop;

  return jsonb_build_object('paid', true, 'members', v_paid, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- (e2) Starting and fighting a war (§4)
-- ---------------------------------------------------------------------------

/**
 * Opens a search. The opted-in roster is written NOW, at search time, so the
 * war is fought by the people who signed the articles — not by whoever
 * happens to be in the fleet 22 hours later when prep ends.
 */
/** §4 — the roster with each member's opt-in flag and their LIVE renown. */
create or replace function public.fleet_war_roster(p_fleet_id uuid)
returns table (user_id uuid, renown integer, war_opt_in boolean)
language sql
security definer
set search_path = public
as $$
  select m.user_id, coalesce(r.value, 0), m.war_opt_in
    from public.fleet_member m
    left join public.renown r on r.user_id = m.user_id
   where m.fleet_id = p_fleet_id;
$$;

revoke all on function public.fleet_war_roster(uuid) from anon, authenticated;

create or replace function public.war_open_search(
  p_war_id   uuid,
  p_fleet_id uuid,
  p_size     smallint,
  p_rating   integer,
  p_members  jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_row jsonb;
begin
  if exists (
    select 1 from public.war
     where (fleet_a = p_fleet_id or fleet_b = p_fleet_id)
       and state in ('searching', 'prep', 'battle', 'settling')
  ) then
    return 'war-in-progress';
  end if;

  insert into public.war (id, fleet_a, size, state, rating)
  values (p_war_id, p_fleet_id, p_size, 'searching', p_rating);

  for v_row in select * from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) loop
    insert into public.war_member (war_id, user_id, fleet_id, renown)
    values (p_war_id, (v_row ->> 'userId')::uuid, p_fleet_id,
            coalesce((v_row ->> 'renown')::integer, 0))
    on conflict (war_id, user_id) do nothing;
  end loop;

  return 'ok';
end;
$$;

/**
 * Pairs two searching wars into one.
 *
 * Idempotent in the same shape as everything else here: the UPDATE carries
 * `state = 'searching'` for BOTH rows, so two servers pairing the same two
 * fleets at once leaves exactly one winner and the loser gets `false`.
 * The other war's row is folded into this one and cancelled, so a war has one
 * id from pairing onward.
 */
create or replace function public.war_pair(
  p_war_id        uuid,
  p_other_war_id  uuid,
  p_prep_ends_at  timestamptz,
  p_battle_ends_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other_fleet uuid;
begin
  select fleet_a into v_other_fleet
    from public.war where id = p_other_war_id and state = 'searching'
    for update;
  if not found then return false; end if;

  update public.war
     set state = 'prep',
         fleet_b = v_other_fleet,
         prep_ends_at = p_prep_ends_at,
         battle_ends_at = p_battle_ends_at
   where id = p_war_id and state = 'searching';
  if not found then return false; end if;

  -- The opted-in roster of the other side moves across, then its row closes.
  update public.war_member set war_id = p_war_id where war_id = p_other_war_id;
  update public.war set state = 'cancelled' where id = p_other_war_id;

  return true;
end;
$$;

create or replace function public.war_active_for(p_fleet_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from public.war
   where (fleet_a = p_fleet_id or fleet_b = p_fleet_id)
     and state in ('prep', 'battle', 'settling')
   order by search_started_at desc
   limit 1;
$$;

/**
 * §4 — "Each member gets 2 raids". The limit is enforced HERE, in the same
 * statement that spends it, so two raids opened at once cannot both pass a
 * check-then-act and make three.
 */
create or replace function public.war_record_raid(
  p_war_id         uuid,
  p_raid_id        uuid,
  p_attacker_id    uuid,
  p_target_user_id uuid,
  p_stars          smallint,
  p_destruction    numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only during the battle day.
  if not exists (select 1 from public.war where id = p_war_id and state = 'battle') then
    return false;
  end if;

  -- The claim: spend one of the two, atomically.
  update public.war_member
     set raids_used = raids_used + 1
   where war_id = p_war_id and user_id = p_attacker_id and raids_used < 2;
  if not found then return false; end if;

  insert into public.war_raid
    (war_id, raid_id, attacker_id, target_user_id, stars, destruction)
  values (p_war_id, p_raid_id, p_attacker_id, p_target_user_id, p_stars, p_destruction)
  on conflict (war_id, raid_id) do nothing;

  return true;
end;
$$;

revoke all on function public.war_open_search(uuid, uuid, smallint, integer, jsonb)
  from anon, authenticated;
revoke all on function public.war_pair(uuid, uuid, timestamptz, timestamptz)
  from anon, authenticated;
revoke all on function public.war_active_for(uuid) from anon, authenticated;
revoke all on function public.war_record_raid(uuid, uuid, uuid, uuid, smallint, numeric)
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- (f) The Flag Hall (§5)
-- ---------------------------------------------------------------------------

/**
 * §7.7 — "a beaten captain's flag is recorded once". The primary key does it;
 * `on conflict do nothing` keeps `first_at` as the FIRST time, which is the
 * whole point of the column.
 */
create or replace function public.flag_record(p_user_id uuid, p_country_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_country_code is null or char_length(p_country_code) <> 2 then return false; end if;
  insert into public.flags (user_id, country_code)
  values (p_user_id, upper(p_country_code))
  on conflict (user_id, country_code) do nothing;
  return found;
end;
$$;

create or replace function public.flag_wall(p_user_id uuid)
returns table (country_code text, first_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select f.country_code, f.first_at
    from public.flags f
   where f.user_id = p_user_id
   order by f.first_at;
$$;

-- ---------------------------------------------------------------------------
-- (g) Housekeeping — §2's 7-day message expiry
-- ---------------------------------------------------------------------------

create or replace function public.fleet_sweep_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  delete from public.fleet_message where at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  delete from public.donation
   where donor_id is null and at < now() - interval '24 hours';
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- (h) Grants. Same posture as 0014 and 0016: the secret key only.
-- ---------------------------------------------------------------------------

revoke all on function public.fleet_create(uuid, uuid, text, text, smallint, smallint, text, integer, integer)
  from anon, authenticated;
revoke all on function public.fleet_leave(uuid, uuid) from anon, authenticated;
revoke all on function public.donation_fill(uuid, uuid, integer, integer, integer)
  from anon, authenticated;
revoke all on function public.donation_consume(uuid, uuid, text) from anon, authenticated;
revoke all on function public.war_advance_prep() from anon, authenticated;
revoke all on function public.war_advance_battle() from anon, authenticated;
revoke all on function public.war_expire_searches(integer) from anon, authenticated;
revoke all on function public.settle_war(uuid, text, integer, integer, numeric, numeric, jsonb)
  from anon, authenticated;
revoke all on function public.flag_record(uuid, text) from anon, authenticated;
revoke all on function public.flag_wall(uuid) from anon, authenticated;
revoke all on function public.fleet_sweep_messages() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- (i) Realtime — part-08 §6, "reuse the channel the emote system already uses,
--     one topic per fleet".
--
--     `fleet:{id}` broadcast only, and only for members of that fleet. Same
--     shape as 0005's `match:{id}` policies, with fleet_member in place of
--     matches: a stranger's subscribe fails with CHANNEL_ERROR rather than
--     quietly joining and listening.
--
--     NOTE (from 0005): hosted Supabase already has RLS on realtime.messages
--     and you do not own the table, so policies alone are the whole story.
-- ---------------------------------------------------------------------------

drop policy if exists "fleet: members read broadcast" on realtime.messages;
create policy "fleet: members read broadcast"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() like 'fleet:%'
    and extension = 'broadcast'
    and exists (
      select 1 from public.fleet_member m
      where m.fleet_id::text = split_part(realtime.topic(), ':', 2)
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "fleet: members write broadcast" on realtime.messages;
create policy "fleet: members write broadcast"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.topic() like 'fleet:%'
    and extension = 'broadcast'
    and exists (
      select 1 from public.fleet_member m
      where m.fleet_id::text = split_part(realtime.topic(), ':', 2)
        and m.user_id = auth.uid()
    )
  );

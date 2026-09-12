-- 0001 — profiles.
-- One row per auth user, created by trigger on sign-up (anonymous sign-in
-- included, docs/brief.md 4.5) with a generated name that onboarding overwrites.
--
-- Clients may change name, avatar_id, avatar_color, country_code and the
-- tutorial flag on their own row. Scores (rank_points, coins, gems, battles_*,
-- buildings) are written by the match server only — a BEFORE UPDATE trigger
-- rejects any client attempt. That is the whole point.
--
-- Idempotent: safe to run on a database that already has it.

create table if not exists public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  name                   text not null check (char_length(name) between 1 and 14),
  avatar_id              smallint not null default 0,
  avatar_color           text not null default 'violet',
  country_code           text,
  rank_points            integer not null default 0,
  battles_played         integer not null default 0,
  battles_won            integer not null default 0,
  coins                  integer not null default 0,
  gems                   integer not null default 10,
  -- app extensions (P10 progress screen, P09 tutorial)
  buildings              integer not null default 0,
  has_completed_tutorial boolean not null default false,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

create index if not exists profiles_rank_points_idx on public.profiles (rank_points desc, battles_won desc);

-- ---------------------------------------------------------------------------
-- Sign-up: create the row with a generated name ("Sailor 4821").
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, 'Sailor ' || lpad((floor(random() * 10000))::int::text, 4, '0'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- The score guard. Requests from end users carry a JWT whose role claim is
-- 'authenticated' (or 'anon'); the match server's secret key, migrations and
-- psql do not. Only the latter may touch the score columns.
-- ---------------------------------------------------------------------------

create or replace function public.jwt_role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
$$;

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
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "profiles: authenticated users read everyone" on public.profiles;
create policy "profiles: authenticated users read everyone"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles: players update their own row" on public.profiles;
create policy "profiles: players update their own row"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles: players insert their own row" on public.profiles;
create policy "profiles: players insert their own row"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

grant select, insert, update on public.profiles to authenticated;

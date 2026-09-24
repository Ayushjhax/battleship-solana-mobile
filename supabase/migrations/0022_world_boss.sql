-- Part 11B — durable Great Armada state. All writes are service-role only.
-- The application writer serializes on world_boss_event (SELECT FOR UPDATE),
-- while these unique keys make a duplicate resolution/reward impossible even
-- if a future process bypasses that queue accidentally.

create table if not exists public.world_boss_event (
  id uuid primary key,
  seed bigint not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active_wave integer not null default 1 check (active_wave > 0),
  status text not null default 'active' check (status in ('active','closed'))
);

create table if not exists public.world_boss_wave (
  event_id uuid not null references public.world_boss_event(id) on delete cascade,
  wave integer not null check (wave > 0),
  hidden_layout jsonb not null,
  total_ship_cells integer not null check (total_ship_cells > 0),
  primary key (event_id, wave)
);

create table if not exists public.world_boss_mark (
  event_id uuid not null,
  wave integer not null,
  row integer not null check (row between 0 and 29),
  col integer not null check (col between 0 and 29),
  mark text not null check (mark in ('miss','hit','mine')),
  player_id uuid not null references public.profiles(id),
  resolved_at timestamptz not null default now(),
  primary key (event_id, wave, row, col),
  foreign key (event_id, wave) references public.world_boss_wave(event_id, wave) on delete cascade
);

create table if not exists public.world_boss_participant (
  event_id uuid not null references public.world_boss_event(id) on delete cascade,
  wave integer not null,
  player_id uuid not null references public.profiles(id),
  day date not null,
  shots_used integer not null default 0 check (shots_used between 0 and 10),
  hits integer not null default 0 check (hits >= 0),
  primary key (event_id, wave, player_id, day)
);

create table if not exists public.world_boss_request (
  event_id uuid not null references public.world_boss_event(id) on delete cascade,
  player_id uuid not null references public.profiles(id),
  request_id text not null,
  response jsonb not null,
  primary key (event_id, player_id, request_id)
);

create table if not exists public.world_boss_reward (
  event_id uuid not null references public.world_boss_event(id) on delete cascade,
  wave integer not null,
  player_id uuid not null references public.profiles(id),
  reward_key text not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (event_id, wave, player_id, reward_key)
);

alter table public.world_boss_event enable row level security;
alter table public.world_boss_wave enable row level security;
alter table public.world_boss_mark enable row level security;
alter table public.world_boss_participant enable row level security;
alter table public.world_boss_request enable row level security;
alter table public.world_boss_reward enable row level security;

revoke all on public.world_boss_event, public.world_boss_wave, public.world_boss_mark,
  public.world_boss_participant, public.world_boss_request, public.world_boss_reward
  from anon, authenticated;
grant all on public.world_boss_event, public.world_boss_wave, public.world_boss_mark,
  public.world_boss_participant, public.world_boss_request, public.world_boss_reward
  to service_role;

create index if not exists world_boss_mark_public_idx
  on public.world_boss_mark(event_id, wave, resolved_at);
create index if not exists world_boss_participant_player_idx
  on public.world_boss_participant(player_id, event_id, wave);

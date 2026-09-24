-- Part 11C — PvE-only campaign progress and capped Customs House tribute.
create table if not exists public.empire_progress (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  conquered jsonb not null default '[]'::jsonb,
  stars jsonb not null default '{}'::jsonb,
  last_tribute_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.empire_request (
  player_id uuid not null references public.profiles(id) on delete cascade,
  request_id text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (player_id, request_id)
);
alter table public.empire_progress enable row level security;
alter table public.empire_request enable row level security;
revoke all on public.empire_progress, public.empire_request from anon, authenticated;
grant all on public.empire_progress, public.empire_request to service_role;
create index if not exists empire_request_created_idx on public.empire_request(player_id, created_at desc);


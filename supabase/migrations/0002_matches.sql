-- 0002 — matches and the replay log.
-- The Node match server (secret key) writes these; players only read their own.
-- match_events is the full event log per match: auditable, and any game can be
-- rebuilt by replaying it through the engine.

create table if not exists public.matches (
  id         uuid primary key default gen_random_uuid(),
  mode       text not null check (mode in ('classic', 'advanced')),
  player_a   uuid references public.profiles (id),
  player_b   uuid references public.profiles (id),
  winner     uuid references public.profiles (id),
  seed       bigint not null,
  started_at timestamptz default now(),
  ended_at   timestamptz,
  end_reason text check (end_reason in ('victory', 'resign', 'timeout', 'disconnect'))
);

create index if not exists matches_player_a_idx on public.matches (player_a, started_at desc);
create index if not exists matches_player_b_idx on public.matches (player_b, started_at desc);

create table if not exists public.match_events (
  id       bigserial primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  seq      integer not null,
  payload  jsonb not null,
  unique (match_id, seq)
);

alter table public.matches enable row level security;
alter table public.match_events enable row level security;

drop policy if exists "matches: players read their own" on public.matches;
create policy "matches: players read their own"
  on public.matches for select
  to authenticated
  using (player_a = auth.uid() or player_b = auth.uid());

-- No insert/update/delete policies for authenticated: the service role
-- bypasses RLS, and that is the only writer.

drop policy if exists "match_events: players read their own matches" on public.match_events;
create policy "match_events: players read their own matches"
  on public.match_events for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_events.match_id
        and (m.player_a = auth.uid() or m.player_b = auth.uid())
    )
  );

grant select on public.matches to authenticated;
grant select on public.match_events to authenticated;

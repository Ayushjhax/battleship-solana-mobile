-- 0003 — the rank ladder (docs/brief.md 3.5). Public, read-only.
-- Mirrors src/engine/ranks.ts; the engine is the source of truth in code, this
-- is the copy the leaderboard and the server can join against.

create table if not exists public.ranks (
  id              smallint primary key,
  name            text not null,
  points_required integer not null
);

insert into public.ranks (id, name, points_required) values
  (1, 'Seaman Recruit', 0),
  (2, 'Seaman Apprentice', 100),
  (3, 'Petty Officer Second Class', 400),
  (4, 'Chief Ship Petty Officer', 1000),
  (5, 'Captain', 3000),
  (6, 'Vice-admiral', 10000)
on conflict (id) do update
  set name = excluded.name,
      points_required = excluded.points_required;

alter table public.ranks enable row level security;

drop policy if exists "ranks: public read" on public.ranks;
create policy "ranks: public read"
  on public.ranks for select
  to anon, authenticated
  using (true);

grant select on public.ranks to anon, authenticated;

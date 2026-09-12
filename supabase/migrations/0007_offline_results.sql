-- Idempotent offline/hot-seat result receipts. The app earns rewards locally
-- at once; the match server later calls this function with its secret-key
-- client. One id can affect a profile exactly once, across any retry/crash.

create table if not exists public.offline_results (
  id           text primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  mode         text not null check (mode in ('ai', 'hotseat')),
  won          boolean not null,
  completed_at timestamptz not null,
  synced_at    timestamptz not null default now()
);

create index if not exists offline_results_user_idx
  on public.offline_results (user_id, completed_at desc);

alter table public.offline_results enable row level security;
-- No end-user policies. The match server's secret key is the only writer.

create or replace function public.apply_offline_result(
  p_id text,
  p_user_id uuid,
  p_mode text,
  p_won boolean,
  p_completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.offline_results (id, user_id, mode, won, completed_at)
  values (p_id, p_user_id, p_mode, p_won, p_completed_at)
  on conflict (id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    return false;
  end if;

  update public.profiles
  set rank_points = rank_points + case when p_won then 25 else 5 end,
      coins = coins + case when p_won then 50 else 10 end,
      battles_played = battles_played + 1,
      battles_won = battles_won + case when p_won then 1 else 0 end
  where id = p_user_id;

  return true;
end;
$$;

revoke all on function public.apply_offline_result(text, uuid, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_offline_result(text, uuid, text, boolean, timestamptz)
  to service_role;

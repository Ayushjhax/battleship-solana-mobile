-- 0015 - only matches the server sees count toward the ladder.
--
-- Offline AI and hot-seat games stay playable, but the device reports their
-- results itself and nothing can check them: a hot-seat player could hand
-- themselves a win by resigning as player two, as often as they liked, at the
-- full online rate. From here an offline result pays coins (cosmetics, never
-- ranked) and moves nothing the ladder ranks by: no rank points, and it is not
-- counted as a battle played or won.
--
-- The coin amounts are passed in by the match server, from
-- src/engine/ranks.ts, the way apply_match_result's rewards are, instead of
-- being hard-coded here as 0007 did.

drop function if exists public.apply_offline_result(text, uuid, text, boolean, timestamptz);

create or replace function public.apply_offline_result(
  p_id text,
  p_user_id uuid,
  p_mode text,
  p_won boolean,
  p_completed_at timestamptz,
  p_win_coins integer,
  p_loss_coins integer
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
     set coins = coins + case when p_won then p_win_coins else p_loss_coins end
   where id = p_user_id;

  return true;
end;
$$;

revoke all on function public.apply_offline_result(text, uuid, text, boolean, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.apply_offline_result(text, uuid, text, boolean, timestamptz, integer, integer)
  to service_role;

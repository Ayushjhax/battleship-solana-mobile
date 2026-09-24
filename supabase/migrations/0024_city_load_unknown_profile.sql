-- 0024 — city_load must not invent a city for a profile that does not exist.
--
-- Every /city read and every /visit/:userId goes through city_load, which
-- lazily inserts the caller's city row. For an unknown id that insert hits the
-- profiles FK and raises, so GET /visit/<unknown-uuid> answered 503
-- `internal` instead of the 404 the route already maps (`if (!city)`).
--
-- The guard keeps the lazy-create behaviour for real players and returns no
-- rows otherwise. Idempotent: safe to run on a database that already has it.

create or replace function public.city_load(p_user_id uuid, p_now bigint)
returns table (state jsonb, version integer, city_version integer,
               coins integer, steel integer, gems integer, rank_points integer,
               unlocks text[])
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return;
  end if;

  insert into public.city (user_id, state, version, city_version)
  values (p_user_id, public.city_default_state(p_now), 1, 0)
  on conflict (user_id) do nothing;

  return query
    select c.state, c.version, c.city_version,
           p.coins, p.steel, p.gems, p.rank_points,
           coalesce(c.unlocks, '{}'::text[])
      from public.city c
      join public.profiles p on p.id = c.user_id
     where c.user_id = p_user_id;
end;
$$;

revoke all on function public.city_load(uuid, bigint) from anon, authenticated;

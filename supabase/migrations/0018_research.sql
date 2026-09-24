-- 0018 — The Naval Academy's research queue (part-05 §5).
--
-- Closes DECISIONS.md D23. Parts 6, 7 and 8 all ask "has this player
-- researched the decoy?", and until now the answer was the stand-in "is the
-- Naval Academy built at all?" — strictly looser than the real rule.
--
-- §5: "Unlocks are stored server-side (`unlocks: string[]` on the profile) and
-- the server validates every submitted layout against them: an item you have
-- not researched is a rejected layout, not a silent drop."
--
-- The queue is its OWN, not a dock worker's: one item at a time, and a Fish
-- Market upgrade running in the background does not block it.
--
-- Idempotent: safe to run on a database that already has it.

-- ---------------------------------------------------------------------------
-- (a) The columns. On `city`, not on `profiles`: research is part of the town,
--     it moves with `city_apply`'s version check, and `profiles` is guarded
--     against client writes for score columns only — a new client-writable
--     column there would need the guard extended.
-- ---------------------------------------------------------------------------

alter table public.city
  add column if not exists unlocks text[] not null default '{}'::text[],
  add column if not exists research jsonb;

-- ---------------------------------------------------------------------------
-- (b) Reads and writes
-- ---------------------------------------------------------------------------

create or replace function public.research_load(p_user_id uuid)
returns table (unlocks text[], research jsonb, academy_level integer, coins integer, gems integer)
language sql
security definer
set search_path = public
as $$
  select c.unlocks,
         c.research,
         coalesce(((c.state -> 'buildings' -> 'naval_academy' ->> 'level'))::integer, 0),
         p.coins,
         p.gems
    from public.city c
    join public.profiles p on p.id = c.user_id
   where c.user_id = p_user_id;
$$;

/**
 * Applies a research move that TypeScript already decided
 * (src/engine/city/research.ts). One statement under the city's optimistic
 * version check, exactly like city_apply — so a research start and a building
 * upgrade racing each other cannot both win.
 */
create or replace function public.research_apply(
  p_user_id          uuid,
  p_expected_version integer,
  p_unlocks          text[],
  p_research         jsonb,
  p_d_coins          integer,
  p_d_gems           integer,
  p_reason           text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_version integer;
begin
  update public.city
     set unlocks = p_unlocks,
         research = p_research,
         version = version + 1,
         updated_at = now()
   where user_id = p_user_id and version = p_expected_version
  returning version into v_version;

  if not found then return null; end if;  -- version conflict: caller retries

  if p_d_coins <> 0 or p_d_gems <> 0 then
    update public.profiles
       set coins = coins + p_d_coins, gems = gems + p_d_gems
     where id = p_user_id;

    if exists (select 1 from public.profiles where id = p_user_id and (coins < 0 or gems < 0)) then
      raise exception 'research would drive a balance negative for %', p_user_id
        using errcode = 'P0001';
    end if;

    insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
    values (p_user_id, p_reason, null, p_d_coins, 0, p_d_gems);
  end if;

  return v_version;
end;
$$;

/**
 * The one question Parts 5-8 actually ask. Returning the array rather than a
 * per-item boolean means the caller hands it straight to validateSubmission,
 * validateHarbour and validateKit, which all take `readonly string[]`.
 */
create or replace function public.research_unlocks(p_user_id uuid)
returns text[]
language sql
security definer
set search_path = public
as $$
  select coalesce(unlocks, '{}'::text[]) from public.city where user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- (c) city_load gains the unlocks column.
--
--     Changing a function's RETURN TYPE needs a drop first — Postgres will not
--     `create or replace` a new column into a `returns table`. Same shape as
--     DECISIONS D20's change to apply_match_result, and the same care: the
--     drop and the recreate are in one migration so there is no window where
--     the function is missing.
-- ---------------------------------------------------------------------------

drop function if exists public.city_load(uuid, bigint);

create or replace function public.city_load(p_user_id uuid, p_now bigint)
returns table (state jsonb, version integer, city_version integer,
               coins integer, steel integer, gems integer, rank_points integer,
               unlocks text[])
language plpgsql
security definer
set search_path = public
as $$
begin
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
revoke all on function public.research_load(uuid) from anon, authenticated;
revoke all on function public.research_apply(uuid, integer, text[], jsonb, integer, integer, text)
  from anon, authenticated;
revoke all on function public.research_unlocks(uuid) from anon, authenticated;

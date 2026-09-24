-- 0020 — Cosmetics (part-03 §3, §5).
--
-- §3: "Cosmetics are **bought and equipped server-side**
-- (`cosmetics_owned`, `cosmetics_equipped`). A client that claims to own
-- something it does not is rejected, and the match payload is built from the
-- server's copy."
--
-- Both columns live on `city`, not `profiles`: they move under the same
-- optimistic version check as everything else the player owns, and `profiles`
-- is guarded against client writes for score columns only.
--
-- Idempotent: safe to run on a database that already has it.

alter table public.city
  add column if not exists cosmetics_owned    text[] not null default '{}'::text[],
  add column if not exists cosmetics_equipped jsonb  not null default '{}'::jsonb;

create or replace function public.cosmetics_load(p_user_id uuid)
returns table (
  owned          text[],
  equipped       jsonb,
  coins          integer,
  gems           integer,
  shipyard_level integer,
  stationery_level integer,
  version        integer
)
language sql
security definer
set search_path = public
as $$
  select coalesce(c.cosmetics_owned, '{}'::text[]),
         coalesce(c.cosmetics_equipped, '{}'::jsonb),
         p.coins,
         p.gems,
         coalesce(((c.state -> 'buildings' -> 'shipyard' ->> 'level'))::integer, 0),
         coalesce(((c.state -> 'buildings' -> 'stationery' ->> 'level'))::integer, 0),
         c.version
    from public.city c
    join public.profiles p on p.id = c.user_id
   where c.user_id = p_user_id;
$$;

/**
 * Buys one cosmetic. The CLAIM is `not (p_item = any(cosmetics_owned))` in the
 * WHERE, so a double-tap or a retried request appends nothing and charges
 * nothing — §6.1's "buying twice is refused and refunds nothing".
 *
 * Which currency, and how much, was decided in TypeScript (canBuy); this
 * applies it.
 */
create or replace function public.cosmetics_buy(
  p_user_id uuid,
  p_item    text,
  p_coins   integer,
  p_gems    integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.city
     set cosmetics_owned = coalesce(cosmetics_owned, '{}'::text[]) || p_item,
         version = version + 1,
         updated_at = now()
   where user_id = p_user_id
     and not (p_item = any(coalesce(cosmetics_owned, '{}'::text[])));
  if not found then return 'already-owned'; end if;

  if p_coins > 0 then
    update public.profiles set coins = coins - p_coins
     where id = p_user_id and coins >= p_coins;
    if not found then
      raise exception 'insufficient coins' using errcode = 'P0001';
    end if;
  end if;

  if p_gems > 0 then
    update public.profiles set gems = gems - p_gems
     where id = p_user_id and gems >= p_gems;
    if not found then
      raise exception 'insufficient gems' using errcode = 'P0001';
    end if;
  end if;

  insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
  values (p_user_id, 'cosmetic_buy', p_item, -greatest(p_coins, 0), 0, -greatest(p_gems, 0));

  return 'ok';
end;
$$;

/**
 * Equips one slot. The ownership check is HERE as well as in TypeScript,
 * because §3 is explicit that a forged client payload must be ignored — and
 * the match payload is built from this column, not from what the client sent.
 */
create or replace function public.cosmetics_equip(
  p_user_id uuid,
  p_slot    text,
  p_item    text,
  p_is_default boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not p_is_default and not exists (
    select 1 from public.city
     where user_id = p_user_id
       and p_item = any(coalesce(cosmetics_owned, '{}'::text[]))
  ) then
    return 'not-owned';
  end if;

  update public.city
     set cosmetics_equipped = coalesce(cosmetics_equipped, '{}'::jsonb)
                              || jsonb_build_object(p_slot, p_item),
         version = version + 1,
         updated_at = now()
   where user_id = p_user_id;
  return case when found then 'ok' else 'no-city' end;
end;
$$;

/** The match payload's source of truth — §3, "built from the server's copy". */
create or replace function public.cosmetics_equipped_of(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(cosmetics_equipped, '{}'::jsonb) from public.city where user_id = p_user_id;
$$;

revoke all on function public.cosmetics_load(uuid) from anon, authenticated;
revoke all on function public.cosmetics_buy(uuid, text, integer, integer) from anon, authenticated;
revoke all on function public.cosmetics_equip(uuid, text, text, boolean) from anon, authenticated;
revoke all on function public.cosmetics_equipped_of(uuid) from anon, authenticated;

-- 0026 — the fleet realtime policies must not kill every other channel.
--
-- THE BUG. 0017 added two permissive policies on realtime.messages whose
-- expressions read `public.fleet_member`:
--
--     using (... exists (select 1 from public.fleet_member m ...))
--
-- and the same migration revoked ALL privileges on `fleet_member` from
-- `authenticated`. A policy expression is planned with the CALLING role's
-- privileges, whether or not its branch would match, so from the moment 0017
-- applied every authenticated INSERT or SELECT on realtime.messages failed
-- with `permission denied for table fleet_member`. The blast radius is not
-- fleet chat: lobby presence and match emotes share the table, so every
-- realtime channel was dead for every player. `verify-offline.mjs` reproduces
-- it at "user A can join lobby:classic presence"; the regression test is
-- `server/tests/hardening/realtime-policy-regression.test.ts`.
--
-- THE FIX. A SECURITY DEFINER membership probe — the same pattern the fleet
-- RPCs already use — so the policy never needs a grant on the server-only
-- table. The table stays entirely server-side.
--
-- Idempotent: `create or replace` plus `drop policy if exists`, safe on a
-- database that already has it and safe to run twice.

create or replace function public.is_fleet_member(p_fleet_id text, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.fleet_member m
     where m.fleet_id::text = p_fleet_id
       and m.user_id = p_user_id
  );
$$;

revoke all on function public.is_fleet_member(text, uuid) from public, anon, authenticated;
grant execute on function public.is_fleet_member(text, uuid) to authenticated;

drop policy if exists "fleet: members read broadcast" on realtime.messages;
create policy "fleet: members read broadcast"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() like 'fleet:%'
    and extension = 'broadcast'
    and public.is_fleet_member(split_part(realtime.topic(), ':', 2), auth.uid())
  );

drop policy if exists "fleet: members write broadcast" on realtime.messages;
create policy "fleet: members write broadcast"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.topic() like 'fleet:%'
    and extension = 'broadcast'
    and public.is_fleet_member(split_part(realtime.topic(), ':', 2), auth.uid())
  );

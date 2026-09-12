-- 0005 — private Realtime channels.
--
-- Two topic shapes (docs/brief.md 4.3):
--   lobby:{mode}    presence only — the online count on the menu
--   match:{matchId} broadcast only — chat and emotes. NEVER game state; the
--                   Node server owns that.
--
-- A player may read/write match:{id} only if they are player_a or player_b of
-- that match. realtime.topic() yields the channel name inside a policy.
--
-- MANUAL STEP (not expressible as SQL): Dashboard -> Realtime -> Settings ->
-- turn OFF "Allow public access", so every channel must be private and pass
-- these policies. The client always subscribes with { private: true }.
--
-- NOTE: hosted Supabase already has RLS enabled on realtime.messages (and you
-- don't own that table, so `alter table ... enable row level security` fails
-- with "must be owner of table messages"). Policies alone are enough.

drop policy if exists "lobby: presence read" on realtime.messages;
create policy "lobby: presence read"
  on realtime.messages for select
  to authenticated
  using (realtime.topic() like 'lobby:%' and extension = 'presence');

drop policy if exists "lobby: presence write" on realtime.messages;
create policy "lobby: presence write"
  on realtime.messages for insert
  to authenticated
  with check (realtime.topic() like 'lobby:%' and extension = 'presence');

drop policy if exists "match: players read broadcast" on realtime.messages;
create policy "match: players read broadcast"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() like 'match:%'
    and extension = 'broadcast'
    and exists (
      select 1 from public.matches m
      where m.id::text = split_part(realtime.topic(), ':', 2)
        and (m.player_a = auth.uid() or m.player_b = auth.uid())
    )
  );

drop policy if exists "match: players write broadcast" on realtime.messages;
create policy "match: players write broadcast"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.topic() like 'match:%'
    and extension = 'broadcast'
    and exists (
      select 1 from public.matches m
      where m.id::text = split_part(realtime.topic(), ':', 2)
        and (m.player_a = auth.uid() or m.player_b = auth.uid())
    )
  );

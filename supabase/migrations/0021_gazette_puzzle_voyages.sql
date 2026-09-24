-- 0021 — The Port Gazette, the daily puzzle and trade voyages
-- (docs/port-city/part-09-gazette-puzzle-voyages.md).
--
-- §4's five tables, verbatim:
--
--   gazette     one edition per player per day, generated once and cached
--   puzzle      one board per UTC day, shared by every player — LAYOUT IS
--               SERVER ONLY
--   puzzle_run  one attempt per player per day, resumable
--   voyage      a merchantman at sea; its reward was rolled AT SEND
--   skirmish    the 5x5 pirate fight, with the server's layout and the
--               client's submitted log
--
-- FOUR HARD RULES, enforced here and not only in the service:
--
--   1. The puzzle layout never leaves the server. `puzzle.layout` lives in a
--      table with RLS on and no policy and no grant, exactly like `harbour`
--      (0016) and `city` (0014). A client JWT cannot select it at all.
--   2. One attempt a day, resumable. `puzzle_run` is keyed (user_id, date) and
--      every shot is `... where finished_at is null`, so a finished run stops
--      accepting shots while an interrupted one keeps its marks.
--   3. A voyage's reward is rolled ONCE, at send. `voyage_send` writes
--      `reward`; `voyage_collect` only reads it. Nothing else may update that
--      column — §3: "so the player cannot reroll by reinstalling".
--   4. A collect pays exactly once. `voyage_collect` CLAIMS the row
--      (`where state <> 'collected'`) before it pays, in the same transaction,
--      the same shape `settle_raid` (0016) and `settle_war` (0017) use.
--
-- Idempotent: safe to run on a database that already has it.

-- ---------------------------------------------------------------------------
-- (a) Tables. RLS on, no end-user policies and no grants: the secret key is
--     the only reader and the only writer.
-- ---------------------------------------------------------------------------

create table if not exists public.gazette (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  date       date not null,
  edition    jsonb not null,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- §2 — "One board per UTC day, identical for EVERY player". One row per day,
-- not per player: that is the whole point.
create table if not exists public.puzzle (
  date       date primary key,
  -- SERVER ONLY. No policy, no grant, and no function returns it.
  layout     jsonb   not null,
  par        integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.puzzle_run (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  date        date not null,
  marks       jsonb   not null default '{}'::jsonb,
  shots       integer not null default 0 check (shots >= 0),
  -- D32: recorded so a shared-grid policy is possible later without a
  -- migration. A solve at or near 18 hits in 18 shots is not reachable
  -- without the day's layout. No policy is applied here.
  hits        integer not null default 0 check (hits >= 0),
  finished_at timestamptz,
  streak      integer not null default 0 check (streak >= 0),
  started_at  timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists puzzle_run_leaderboard_idx
  on public.puzzle_run (date, shots asc, finished_at asc)
  where finished_at is not null;

create table if not exists public.voyage (
  id         uuid primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  route      text not null,
  slot       smallint not null check (slot >= 0 and slot < 3),
  sent_at    timestamptz not null default now(),
  returns_at timestamptz not null,
  -- Rolled at send (§3). Never rewritten.
  reward     jsonb not null,
  pirate     boolean not null default false,
  state      text not null default 'sailing'
             check (state in ('sailing', 'attacked', 'collected', 'lost')),
  settled_at timestamptz
);

create index if not exists voyage_user_idx on public.voyage (user_id, state, returns_at);

-- One live voyage per slot. The partial unique index is what enforces §3's
-- "Merchant ships = Trade Docks level (1 / 2 / 3 slots)" against a double-send
-- race; the service checks the count too, but a check is not a constraint.
create unique index if not exists voyage_live_slot_idx
  on public.voyage (user_id, slot)
  where state in ('sailing', 'attacked');

-- NOTE, and it differs from `puzzle`: the SEED here is NOT secret. §3 says the
-- skirmish "runs on the client for speed", so the client must be able to build
-- the same 5x5 board — which it does from this seed. The security is the
-- REPLAY, not secrecy. `layout` is the server's own copy, stored so a
-- verification never depends on anything the client sent.
create table if not exists public.skirmish (
  voyage_id  uuid primary key references public.voyage (id) on delete cascade,
  seed       bigint  not null,
  layout     jsonb   not null,
  log        jsonb,
  result     text    check (result in ('won', 'lost', 'ignored', 'unverified')),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.gazette    enable row level security;
alter table public.puzzle     enable row level security;
alter table public.puzzle_run enable row level security;
alter table public.voyage     enable row level security;
alter table public.skirmish   enable row level security;

revoke all on public.gazette    from anon, authenticated;
revoke all on public.puzzle     from anon, authenticated;
revoke all on public.puzzle_run from anon, authenticated;
revoke all on public.voyage     from anon, authenticated;
revoke all on public.skirmish   from anon, authenticated;

-- ---------------------------------------------------------------------------
-- (b) The Gazette — generated once per player per day (§1)
-- ---------------------------------------------------------------------------

/**
 * §1 — "generated server-side on first open and then cached for the day".
 *
 * The insert is `on conflict do nothing` followed by a read, so two tabs
 * opening at the same moment get the SAME edition rather than two. The caller
 * generates the edition from the day summary; this function only decides
 * whether that generation is kept.
 */
create or replace function public.gazette_get_or_create(
  p_user_id uuid,
  p_date    date,
  p_edition jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.gazette%rowtype;
begin
  insert into public.gazette (user_id, date, edition)
  values (p_user_id, p_date, p_edition)
  on conflict (user_id, date) do nothing;

  select * into v_row from public.gazette
   where user_id = p_user_id and date = p_date;

  return jsonb_build_object(
    'edition', v_row.edition,
    'fresh',   v_row.edition is not distinct from p_edition and v_row.read_at is null,
    'readAt',  v_row.read_at
  );
end;
$$;

create or replace function public.gazette_mark_read(p_user_id uuid, p_date date)
returns void
language sql
security definer
set search_path = public
as $$
  update public.gazette set read_at = coalesce(read_at, now())
   where user_id = p_user_id and date = p_date;
$$;

-- ---------------------------------------------------------------------------
-- (c) The daily puzzle (§2)
-- ---------------------------------------------------------------------------

/**
 * The day's board, created once for everybody.
 *
 * Returns ONLY the par — never the layout. A caller that needs the layout to
 * resolve a shot uses `puzzle_layout_internal`, which is separate so that the
 * grep in the tests ("no function returns a layout to a route") has something
 * unambiguous to check.
 */
create or replace function public.puzzle_ensure(
  p_date   date,
  p_layout jsonb,
  p_par    integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_par integer;
begin
  insert into public.puzzle (date, layout, par)
  values (p_date, p_layout, p_par)
  on conflict (date) do nothing;

  select par into v_par from public.puzzle where date = p_date;
  return v_par;
end;
$$;

/** SERVER ONLY. Called by the service to resolve a shot; never by a route. */
create or replace function public.puzzle_layout_internal(p_date date)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select layout from public.puzzle where date = p_date;
$$;

/**
 * The player's run for a day, created on first open.
 *
 * §2 — "One attempt per day, resumable if the app dies." The row IS the
 * resume: an interrupted run simply still has its marks.
 */
create or replace function public.puzzle_run_open(
  p_user_id uuid,
  p_date    date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.puzzle_run%rowtype;
begin
  insert into public.puzzle_run (user_id, date)
  values (p_user_id, p_date)
  on conflict (user_id, date) do nothing;

  select * into v_row from public.puzzle_run
   where user_id = p_user_id and date = p_date;

  return jsonb_build_object(
    'marks',      v_row.marks,
    'shots',      v_row.shots,
    'hits',       v_row.hits,
    'finished',   v_row.finished_at is not null,
    'finishedAt', v_row.finished_at,
    'streak',     v_row.streak,
    'startedAt',  v_row.started_at
  );
end;
$$;

/**
 * One shot.
 *
 * `where finished_at is null` is §5.2's "a second attempt on the same day is
 * refused", as a predicate rather than a check: a finished run cannot be moved
 * by any number of concurrent calls.
 */
create or replace function public.puzzle_run_fire(
  p_user_id  uuid,
  p_date     date,
  p_marks    jsonb,
  p_shots    integer,
  p_hits     integer,
  p_finished boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.puzzle_run%rowtype;
begin
  update public.puzzle_run
     set marks       = p_marks,
         shots       = p_shots,
         hits        = p_hits,
         finished_at = case when p_finished then now() else null end
   where user_id = p_user_id
     and date    = p_date
     and finished_at is null
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already-finished');
  end if;

  return jsonb_build_object(
    'ok',         true,
    'marks',      v_row.marks,
    'shots',      v_row.shots,
    'hits',       v_row.hits,
    'finished',   v_row.finished_at is not null,
    'finishedAt', v_row.finished_at
  );
end;
$$;

/**
 * Pays a finished run, exactly once.
 *
 * The CLAIM is `where finished_at is not null and streak = 0`: a run that has
 * already been paid carries its streak, so a second call finds nothing and
 * pays nothing. That is the same claim-then-pay shape as `settle_raid` and
 * `settle_war`, and the caller never computes the reward twice because it
 * reads `paid` back.
 */
create or replace function public.puzzle_settle(
  p_user_id uuid,
  p_date    date,
  p_streak  integer,
  p_coins   integer,
  p_steel   integer,
  p_gems    integer,
  p_ink     integer,
  p_season  integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.puzzle_run
     set streak = greatest(p_streak, 1)
   where user_id = p_user_id
     and date    = p_date
     and finished_at is not null
     and streak  = 0;

  if not found then
    return jsonb_build_object('paid', false, 'reason', 'already-settled-or-unfinished');
  end if;

  update public.profiles
     set coins = coins + greatest(p_coins, 0),
         steel = steel + greatest(p_steel, 0),
         gems  = gems  + greatest(p_gems, 0)
   where id = p_user_id;

  insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
  values (p_user_id, 'puzzle', p_date::text,
          greatest(p_coins, 0), greatest(p_steel, 0), greatest(p_gems, 0));

  if p_ink > 0 and p_season is not null then
    insert into public.season_progress (user_id, season_id, ink)
    values (p_user_id, p_season, p_ink)
    on conflict (user_id, season_id) do update
      set ink = public.season_progress.ink + p_ink;
  end if;

  return jsonb_build_object('paid', true, 'streak', greatest(p_streak, 1));
end;
$$;

/** The last day this player finished, for the streak. */
create or replace function public.puzzle_last_solved(p_user_id uuid, p_before date)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('date', date, 'streak', streak)
    from public.puzzle_run
   where user_id = p_user_id
     and date < p_before
     and finished_at is not null
   order by date desc
   limit 1;
$$;

/**
 * §2 — "A per-day leaderboard ... ranked by shots, then by time taken."
 *
 * Returns no user ids, exactly like the match leaderboard view (0004/0006):
 * a name and a place, and nothing that identifies a row to write to.
 */
create or replace function public.puzzle_leaderboard(p_date date, p_limit integer)
returns table (
  place       integer,
  name        text,
  avatar_id   smallint,
  shots       integer,
  seconds     integer
)
language sql
security definer
set search_path = public
as $$
  select row_number() over (
           order by r.shots asc,
                    extract(epoch from (r.finished_at - r.started_at)) asc,
                    r.user_id asc
         )::integer as place,
         p.name,
         p.avatar_id,
         r.shots,
         greatest(0, extract(epoch from (r.finished_at - r.started_at))::integer) as seconds
    from public.puzzle_run r
    join public.profiles p on p.id = r.user_id
   where r.date = p_date
     and r.finished_at is not null
     and coalesce(p.is_bot, false) = false
   order by place
   limit greatest(1, least(coalesce(p_limit, 100), 100));
$$;

/** The caller's own place, by position — the same rule the match ladder uses. */
create or replace function public.my_puzzle_place(p_user_id uuid, p_date date)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('place', place, 'shots', shots, 'seconds', seconds)
    from (
      select row_number() over (
               order by r.shots asc,
                        extract(epoch from (r.finished_at - r.started_at)) asc,
                        r.user_id asc
             )::integer as place,
             r.user_id,
             r.shots,
             greatest(0, extract(epoch from (r.finished_at - r.started_at))::integer) as seconds
        from public.puzzle_run r
        join public.profiles p on p.id = r.user_id
       where r.date = p_date
         and r.finished_at is not null
         and coalesce(p.is_bot, false) = false
    ) ranked
   where ranked.user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- (d) Trade voyages (§3)
-- ---------------------------------------------------------------------------

/**
 * Sends a merchantman. The reward arrives ALREADY ROLLED (§3 — "rolled
 * server-side at send time"), and nothing in this file ever updates it again.
 *
 * The slot check is the partial unique index; this function converts the
 * resulting constraint violation into a clean refusal rather than a 500, so a
 * double-tap on Send is a no-op instead of an error the player has to read.
 */
create or replace function public.voyage_send(
  p_id         uuid,
  p_user_id    uuid,
  p_route      text,
  p_slot       smallint,
  p_slots      integer,
  p_returns_at timestamptz,
  p_reward     jsonb,
  p_pirate     boolean,
  p_seed       bigint,
  p_layout     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live integer;
begin
  if p_slot >= p_slots then
    return jsonb_build_object('ok', false, 'reason', 'no-slot');
  end if;

  select count(*) into v_live from public.voyage
   where user_id = p_user_id and state in ('sailing', 'attacked');

  if v_live >= p_slots then
    return jsonb_build_object('ok', false, 'reason', 'no-slot');
  end if;

  begin
    insert into public.voyage (id, user_id, route, slot, returns_at, reward, pirate)
    values (p_id, p_user_id, p_route, p_slot, p_returns_at, p_reward, p_pirate);
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'slot-busy');
  end;

  -- A pirate voyage gets its board now, from the same roll, so the layout the
  -- server replays against exists before the client has seen anything.
  if p_pirate then
    insert into public.skirmish (voyage_id, seed, layout)
    values (p_id, p_seed, p_layout)
    on conflict (voyage_id) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'returnsAt', p_returns_at);
end;
$$;

create or replace function public.voyage_list(p_user_id uuid)
returns table (
  id         uuid,
  route      text,
  slot       smallint,
  sent_at    timestamptz,
  returns_at timestamptz,
  reward     jsonb,
  pirate     boolean,
  state      text
)
language sql
security definer
set search_path = public
as $$
  select v.id, v.route, v.slot, v.sent_at, v.returns_at, v.reward, v.pirate, v.state
    from public.voyage v
   where v.user_id = p_user_id
     and (v.state in ('sailing', 'attacked') or v.settled_at > now() - interval '1 day')
   order by v.slot;
$$;

/**
 * Collects a returned voyage. PAYS EXACTLY ONCE.
 *
 * The CLAIM is the first statement: `set state = 'collected', settled_at =
 * now() where state <> 'collected' and settled_at is null`. A second call
 * finds nothing and returns `paid: false`. The `economy_ledger` insert carries
 * the voyage id as `ref`, and the unique index below is the independent
 * backstop — the same two-mechanism shape as `settle_raid` and `settle_war`.
 *
 * The amounts arrive already scaled by `payout()` in TypeScript. This function
 * never multiplies anything: the half-cargo rule is a rule, not arithmetic
 * that should live in two places.
 */
create or replace function public.voyage_collect(
  p_id      uuid,
  p_user_id uuid,
  p_coins   integer,
  p_steel   integer,
  p_gems    integer,
  p_result  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voyage public.voyage%rowtype;
begin
  select * into v_voyage from public.voyage
   where id = p_id and user_id = p_user_id
   for update;

  if not found then
    return jsonb_build_object('paid', false, 'reason', 'not-found');
  end if;

  if v_voyage.returns_at > now() then
    return jsonb_build_object('paid', false, 'reason', 'not-back-yet');
  end if;

  -- THE CLAIM.
  update public.voyage
     set state      = 'collected',
         settled_at = now()
   where id = p_id
     and state <> 'collected'
     and settled_at is null;

  if not found then
    return jsonb_build_object('paid', false, 'reason', 'already-collected');
  end if;

  update public.profiles
     set coins = coins + greatest(p_coins, 0),
         steel = steel + greatest(p_steel, 0),
         gems  = gems  + greatest(p_gems, 0)
   where id = p_user_id;

  -- THE BACKSTOP. `voyage_ledger_once_idx` makes a second row impossible even
  -- if the claim above were somehow defeated.
  insert into public.economy_ledger (user_id, reason, ref, d_coins, d_steel, d_gems)
  values (p_user_id, 'voyage', p_id::text,
          greatest(p_coins, 0), greatest(p_steel, 0), greatest(p_gems, 0));

  update public.skirmish
     set result = coalesce(result, nullif(p_result, 'none')), settled_at = now()
   where voyage_id = p_id and settled_at is null;

  return jsonb_build_object(
    'paid',  true,
    'coins', greatest(p_coins, 0),
    'steel', greatest(p_steel, 0),
    'gems',  greatest(p_gems, 0)
  );
end;
$$;

-- One voyage, one payment, forever — independent of the claim above.
create unique index if not exists voyage_ledger_once_idx
  on public.economy_ledger (ref)
  where reason = 'voyage';

/** SERVER ONLY. The layout the submitted log is replayed against. */
create or replace function public.skirmish_internal(p_voyage_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('seed', seed, 'layout', layout, 'settledAt', settled_at)
    from public.skirmish
   where voyage_id = p_voyage_id;
$$;

/** Records the submitted log and the verdict. The payment is `voyage_collect`. */
create or replace function public.skirmish_record(
  p_voyage_id uuid,
  p_log       jsonb,
  p_result    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.skirmish
     set log = p_log, result = p_result
   where voyage_id = p_voyage_id
     and settled_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already-settled');
  end if;

  update public.voyage set state = 'attacked'
   where id = p_voyage_id and state = 'sailing';

  return jsonb_build_object('ok', true, 'result', p_result);
end;
$$;

/**
 * §3 — "or ignore it for 24 h -> half cargo."
 *
 * Marks the skirmishes nobody came back for. Idempotent: a row already carrying
 * a result is left alone, so running this twice changes nothing.
 */
create or replace function public.skirmish_expire(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.skirmish s
       set result = 'ignored'
      from public.voyage v
     where s.voyage_id = v.id
       and s.result is null
       and s.settled_at is null
       and v.returns_at < p_before
    returning s.voyage_id
  )
  select count(*) into v_count from expired;
  return coalesce(v_count, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- (e) The Gazette's day records (§1 — "the player's own last 24 hours ...
--     plus a small global feed")
-- ---------------------------------------------------------------------------

/**
 * Everything the Gazette's templates may look at, for one player, in one
 * round trip.
 *
 * This is a READ. It writes nothing, so it is safe to call on every open, and
 * it returns raw records rather than headlines — `summariseDay()` in
 * src/engine/gazette/facts.ts does the deriving, in TypeScript, where it is
 * tested.
 *
 * Match-level facts (the atomic multi-kill, the run of hits, the planes downed
 * by one gun) come from `match_events`, which 0002 already stores per match.
 * They are returned as the raw event arrays so the engine's own readers —
 * the ones Part 4's contracts use — can extract them, rather than a second
 * implementation of the same loops in SQL.
 */
create or replace function public.gazette_day_records(
  p_user_id uuid,
  p_since   timestamptz
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'name', coalesce((select name from public.profiles where id = p_user_id), ''),

    'matches', coalesce((
      select jsonb_agg(m.summary order by m.ended_at)
        from (
          select mt.ended_at,
                 jsonb_build_object(
                   'won',    mt.winner = p_user_id,
                   'online', coalesce(mt.is_bot, false) = false,
                   'difficulty', null,
                   'shipsAfloat', 0,
                   'events', coalesce((
                     select jsonb_agg(e.payload order by e.seq)
                       from public.match_events e
                      where e.match_id = mt.id
                   ), '[]'::jsonb)
                 ) as summary
            from public.matches mt
           where (mt.player_a = p_user_id or mt.player_b = p_user_id)
             and mt.ended_at is not null
             and mt.ended_at >= p_since
        ) m
    ), '[]'::jsonb),

    'raids', coalesce((
      select jsonb_agg(jsonb_build_object(
               'stars', r.stars,
               'steel', r.taken_steel,
               'defenderName', (select name from public.profiles where id = r.defender_id)
             ) order by r.ended_at)
        from public.raid r
       where r.attacker_id = p_user_id
         and r.ended_at is not null
         and r.ended_at >= p_since
    ), '[]'::jsonb),

    'defences', coalesce((
      select jsonb_agg(jsonb_build_object(
               'destruction', r.destruction,
               'raiderName', coalesce((select name from public.profiles where id = r.attacker_id), ''),
               'steelLost', r.taken_steel
             ) order by r.ended_at)
        from public.raid r
       where r.defender_id = p_user_id
         and r.ended_at is not null
         and r.ended_at >= p_since
    ), '[]'::jsonb),

    'city', jsonb_build_object(
      'upgradesFinished', 0,
      'admiraltyLevel', coalesce((
        select (c.state -> 'buildings' -> 'admiralty' ->> 'level')::integer
          from public.city c where c.user_id = p_user_id
      ), 0),
      'admiraltyUp', false,
      'steelCollected', coalesce((
        select sum(greatest(l.d_steel, 0))::integer from public.economy_ledger l
         where l.user_id = p_user_id and l.at >= p_since and l.reason = 'collect'
      ), 0),
      -- `collect_scrap`, not `scrapyard`: that is the reason string
      -- src/engine/city/actions.ts actually writes (`scrapyard` is its `ref`).
      'scrapCollected', coalesce((
        select count(*)::integer from public.economy_ledger l
         where l.user_id = p_user_id and l.at >= p_since and l.reason = 'collect_scrap'
      ), 0),
      'buildingFinished', null,
      'researchFinished', null
    ),

    'contracts', jsonb_build_object(
      'claimed', coalesce((
        select count(*)::integer from public.contracts
         where user_id = p_user_id and state = 'claimed' and scope = 'daily'
      ), 0),
      'weeklyClaimed', coalesce((
        select count(*)::integer from public.contracts
         where user_id = p_user_id and state = 'claimed' and scope = 'weekly'
      ), 0),
      'inkEarned', 0,
      'logPage', 0
    ),

    'rankedUp', null,

    'fleet', jsonb_build_object(
      'name', (
        select f.name from public.fleet f
          join public.fleet_member fm on fm.fleet_id = f.id
         where fm.user_id = p_user_id
         limit 1
      ),
      'donationsGiven', coalesce((
        select count(*)::integer from public.donation d
         where d.donor_id = p_user_id and d.at >= p_since
      ), 0),
      'warResult', null,
      'warOpponent', null,
      'warStars', 0
    ),

    'puzzle', jsonb_build_object(
      'shots', (
        select shots from public.puzzle_run
         where user_id = p_user_id and finished_at is not null and finished_at >= p_since
         order by date desc limit 1
      ),
      'beatPar', coalesce((
        select r.shots < pz.par from public.puzzle_run r
          join public.puzzle pz on pz.date = r.date
         where r.user_id = p_user_id and r.finished_at is not null and r.finished_at >= p_since
         order by r.date desc limit 1
      ), false),
      'streak', coalesce((
        select streak from public.puzzle_run
         where user_id = p_user_id and finished_at is not null
         order by date desc limit 1
      ), 0)
    ),

    'voyages', jsonb_build_object(
      'returned', coalesce((
        select count(*)::integer from public.voyage
         where user_id = p_user_id and state = 'collected' and settled_at >= p_since
      ), 0),
      'coins', coalesce((
        select sum(greatest(l.d_coins, 0))::integer from public.economy_ledger l
         where l.user_id = p_user_id and l.reason = 'voyage' and l.at >= p_since
      ), 0),
      'pirateWins', coalesce((
        select count(*)::integer from public.skirmish s
          join public.voyage v on v.id = s.voyage_id
         where v.user_id = p_user_id and s.result = 'won' and s.settled_at >= p_since
      ), 0)
    ),

    'global', jsonb_build_object(
      'topCaptain', (
        select name from public.profiles
         where coalesce(is_bot, false) = false
         order by rank_points desc, id asc limit 1
      ),
      'biggestRaidBy', (
        select p.name from public.raid r
          join public.profiles p on p.id = r.attacker_id
         where r.ended_at >= p_since
         order by r.taken_steel desc limit 1
      ),
      'biggestRaidSteel', coalesce((
        select max(taken_steel)::integer from public.raid where ended_at >= p_since
      ), 0),
      'fleetWarWinner', (
        select case when w.winner = 'a' then fa.name when w.winner = 'b' then fb.name else null end
          from public.war w
          left join public.fleet fa on fa.id = w.fleet_a
          left join public.fleet fb on fb.id = w.fleet_b
         where w.settled_at >= p_since
         order by w.settled_at desc limit 1
      )
    )
  );
$$;

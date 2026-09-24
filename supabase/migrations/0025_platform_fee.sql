-- 0025 — the 5% platform fee on completed online human-vs-human wagers.
--
-- The gross award is the pooled pot: both captains stake 50 points at
-- reservation time (wager_entry, -50 each), so the winner would otherwise be
-- credited stake * 2 = 100 points (0010/0015). The platform now keeps 5% of
-- that gross and the winner is credited the rest:
--
--     fee    = floor(gross * 5 / 100)     -- integer division, no fractions
--     payout = gross - fee                -- gross = fee + payout, asserted
--
-- The real pot is fixed at 100 by matches_wager_points_check, so a completed
-- eligible match pays 95 and records a 5-point fee. The rule itself is the
-- shared engine function (src/engine/economy.ts) and tests pin this SQL to it.
--
-- Eligibility is structural, not a client claim:
--   - only v_wagered and NOT v_is_bot matches are charged (bot fallback and
--     explicit bot games pay the full pot, as before);
--   - cancellations, refunds and no-contest abandonments never reach this
--     function, and a match that already has ended_at returns early, so a
--     retry can never charge twice;
--   - historical settled matches are untouched.
--
-- The fee is held in a reserved platform account ('platform:fee') and every
-- movement gets a point_ledger row, so the points are auditable and never
-- simply disappear. The reserved id cannot collide with a Privy DID.
--
-- Idempotent: safe to run on a database that already has it.

-- ---------------------------------------------------------------------------
-- (a) point_ledger learns the new reason.
-- ---------------------------------------------------------------------------

alter table public.point_ledger drop constraint if exists point_ledger_reason_check;
alter table public.point_ledger add constraint point_ledger_reason_check check (reason in (
  'welcome', 'wager_entry', 'wager_refund', 'wager_prize',
  'buy', 'sell_reserve', 'sell_refund',
  'platform_fee'
));

-- ---------------------------------------------------------------------------
-- (b) apply_match_result settles the fee in the same transaction.
--
--     Signature and return type are unchanged from 0015, so this is a plain
--     create-or-replace and an older caller still binds. The returned jsonb
--     gains a `wager` object with the gross/fee/payout actually applied, so
--     the room can tell each client the authoritative numbers.
-- ---------------------------------------------------------------------------

create or replace function public.apply_match_result(
  p_match_id uuid,
  p_winner uuid,
  p_end_reason text,
  p_win_points integer,
  p_win_coins integer,
  p_loss_points integer,
  p_loss_coins integer,
  p_salvage_a integer default 0,
  p_salvage_b integer default 0,
  p_now bigint default null,
  p_wrecks_a jsonb default '[]'::jsonb,
  p_wrecks_b jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
  v_is_bot boolean;
  v_wagered boolean;
  v_stake integer;
  v_holds integer;
  v_gross bigint;
  v_fee bigint := 0;
  v_payout bigint := 0;
  v_winner_privy text;
  v_balance bigint;
  v_platform_balance bigint;
  v_now bigint := coalesce(p_now, (extract(epoch from now()) * 1000)::bigint);
  v_credited_a integer := 0;
  v_credited_b integer := 0;
begin
  select player_a, player_b, is_bot, wagered, wager_points
    into v_a, v_b, v_is_bot, v_wagered, v_stake
    from public.matches
   where id = p_match_id and ended_at is null
   for update;
  if not found then
    return jsonb_build_object('settled', false, 'salvage_a', 0, 'salvage_b', 0, 'wager', null);
  end if;
  if p_winner is distinct from v_a and p_winner is distinct from v_b then
    raise exception 'winner % is not a player of match %', p_winner, p_match_id;
  end if;

  if v_wagered then
    select count(*)::integer into v_holds
      from public.point_wager_holds
     where match_id = p_match_id and status = 'held';
    if v_holds <> (case when v_is_bot then 1 else 2 end) then
      raise exception 'match % does not have the required wager holds', p_match_id;
    end if;
  end if;

  update public.matches
     set winner = p_winner, ended_at = now(), end_reason = p_end_reason,
         wager_settled_at = case when v_wagered then now() else wager_settled_at end
   where id = p_match_id;

  update public.profiles p
     set rank_points = p.rank_points + case when p.id = p_winner then p_win_points else p_loss_points end,
         coins = p.coins + case when p.id = p_winner then p_win_coins else p_loss_coins end,
         battles_played = p.battles_played + 1,
         battles_won = p.battles_won + case when p.id = p_winner then 1 else 0 end
   where p.id in (v_a, v_b) and p.is_bot = false;

  if p_salvage_a > 0 and not exists (select 1 from public.profiles where id = v_a and is_bot) then
    v_credited_a := public.credit_salvage(v_a, p_salvage_a, p_match_id::text, false, 0, v_now, p_wrecks_a);
  end if;
  if p_salvage_b > 0 and not exists (select 1 from public.profiles where id = v_b and is_bot) then
    v_credited_b := public.credit_salvage(v_b, p_salvage_b, p_match_id::text, false, 0, v_now, p_wrecks_b);
  end if;

  if v_wagered then
    update public.point_wager_holds
       set status = 'settled', updated_at = now()
     where match_id = p_match_id and status = 'held';

    -- The gross is the pooled pot. A bot match keeps the established
    -- full-pot payout; only a human-vs-human match carries the fee.
    v_gross := v_stake * 2;
    if v_is_bot then
      v_fee := 0;
    else
      v_fee := (v_gross * 5) / 100;
    end if;
    v_payout := v_gross - v_fee;
    if v_payout + v_fee <> v_gross then
      raise exception 'platform fee invariant broken for match %: gross %, fee %, payout %',
        p_match_id, v_gross, v_fee, v_payout;
    end if;

    if not exists (select 1 from public.profiles where id = p_winner and is_bot) then
      v_winner_privy := public.point_identity_for_profile(p_winner);
      update public.point_accounts
         set balance = balance + v_payout, updated_at = now()
       where privy_user_id = v_winner_privy
       returning point_accounts.balance into v_balance;
      insert into public.point_ledger (
        privy_user_id, delta, balance_after, reason, reference_id, metadata
      ) values (
        v_winner_privy, v_payout, v_balance, 'wager_prize', p_match_id::text,
        jsonb_build_object(
          'stake', v_stake, 'gross', v_gross, 'fee', v_fee, 'payout', v_payout,
          'bot_match', v_is_bot
        )
      );

      if v_fee > 0 then
        insert into public.point_accounts (privy_user_id, balance, welcome_awarded_at)
        values ('platform:fee', 0, now())
        on conflict (privy_user_id) do nothing;
        update public.point_accounts
           set balance = balance + v_fee, updated_at = now()
         where privy_user_id = 'platform:fee'
         returning point_accounts.balance into v_platform_balance;
        insert into public.point_ledger (
          privy_user_id, delta, balance_after, reason, reference_id, metadata
        ) values (
          'platform:fee', v_fee, v_platform_balance, 'platform_fee', p_match_id::text,
          jsonb_build_object('gross', v_gross, 'fee', v_fee, 'stake', v_stake)
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'settled', true,
    'salvage_a', v_credited_a,
    'salvage_b', v_credited_b,
    'wager', case
      when v_wagered then jsonb_build_object('gross', v_gross, 'fee', v_fee, 'payout', v_payout)
      else null
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- (c) Grants. The signature is unchanged, but re-asserting is harmless and
--     keeps the service-role-only boundary explicit.
-- ---------------------------------------------------------------------------

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.apply_match_result(uuid, uuid, text, integer, integer, integer, integer, integer, integer, bigint, jsonb, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

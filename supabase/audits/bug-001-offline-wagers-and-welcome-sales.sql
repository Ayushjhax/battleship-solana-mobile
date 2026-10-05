-- BUG-001 audit: was the points economy exploited before migration 0014?
--
-- READ-ONLY. A single SELECT: it changes nothing and takes no locks beyond an
-- ordinary read. Written for the schema as it stands BEFORE 0014 (it reads only
-- tables from 0009/0010/0012), so it can run before or after that migration.
-- Paste it into the Supabase SQL editor, or run it through psql.
--
-- One row per point account that did either of:
--   used_offline_wagers           settled a wager against the phone's own AI
--                                 (a hold settled with no match attached — only
--                                 settle_offline_wager, 0012, ever did that).
--                                 Every such win was self-reported.
--   sold_welcome_or_offline_points sold more points for SOL than it ever bought
--                                 or won in server-run wagers, so the sales were
--                                 funded by welcome points or offline winnings.
--
-- Columns worth reading first:
--   offline_net_gain   points minted by self-reported offline wins (prizes
--                      minus the stakes on those offline holds)
--   unbacked_points_sold  points sold beyond what purchases and server-run
--                      wager winnings can explain
--   sol_paid           SOL the treasury actually sent this account
-- Ordered so the accounts that took the most SOL come first.

with ledger as (
  select l.privy_user_id,
         coalesce(sum(l.delta) filter (where l.reason = 'welcome'), 0) as welcome,
         coalesce(sum(l.delta) filter (where l.reason = 'buy'), 0) as bought,
         coalesce(sum(-l.delta) filter (where l.reason = 'sell_reserve'), 0)
           - coalesce(sum(l.delta) filter (where l.reason = 'sell_refund'), 0) as points_sold,
         coalesce(sum(l.delta) filter (
           where l.reason = 'wager_prize' and l.metadata ->> 'offline' = 'true'
         ), 0) as offline_prizes,
         count(*) filter (
           where l.reason = 'wager_prize' and l.metadata ->> 'offline' = 'true'
         ) as offline_wins,
         coalesce(sum(l.delta) filter (
           where l.reason = 'wager_prize' and coalesce(l.metadata ->> 'offline', 'false') <> 'true'
         ), 0) as server_wager_prizes,
         min(l.created_at) filter (
           where l.reason = 'wager_prize' and l.metadata ->> 'offline' = 'true'
         ) as first_offline_win,
         max(l.created_at) filter (
           where l.reason = 'wager_prize' and l.metadata ->> 'offline' = 'true'
         ) as last_offline_win
    from public.point_ledger l
   group by l.privy_user_id
), holds as (
  select h.privy_user_id,
         count(*) filter (where h.match_id is null and h.status = 'settled') as offline_wagers,
         coalesce(sum(h.stake) filter (where h.match_id is null and h.status = 'settled'), 0) as offline_staked,
         count(*) filter (where h.match_id is not null and h.status = 'settled') as server_wagers,
         coalesce(sum(h.stake) filter (where h.match_id is not null and h.status = 'settled'), 0) as server_staked
    from public.point_wager_holds h
   group by h.privy_user_id
), sales as (
  select t.privy_user_id,
         count(*) filter (where t.status = 'confirmed') as sales_paid,
         count(*) filter (where t.status in ('processing', 'broadcasting')) as sales_in_flight,
         coalesce(sum(t.lamports) filter (where t.status = 'confirmed'), 0) as lamports_paid
    from public.point_trades t
   where t.kind = 'sell'
   group by t.privy_user_id
), identities as (
  select p.privy_user_id,
         string_agg(p.profile_id::text, ', ' order by p.created_at) as profile_ids,
         string_agg(distinct coalesce(p.email, '—'), ', ') as emails
    from public.privy_accounts p
   group by p.privy_user_id
), summary as (
  select a.privy_user_id,
         identities.profile_ids,
         identities.emails,
         a.balance as current_balance,
         coalesce(ledger.welcome, 0) as welcome,
         coalesce(ledger.bought, 0) as bought,
         coalesce(holds.offline_wagers, 0) as offline_wagers,
         coalesce(ledger.offline_wins, 0) as offline_wins,
         coalesce(ledger.offline_prizes, 0) - coalesce(holds.offline_staked, 0) as offline_net_gain,
         ledger.first_offline_win,
         ledger.last_offline_win,
         coalesce(holds.server_wagers, 0) as server_wagers,
         coalesce(ledger.server_wager_prizes, 0) - coalesce(holds.server_staked, 0) as server_wager_net,
         coalesce(ledger.points_sold, 0) as points_sold,
         coalesce(sales.sales_paid, 0) as sales_paid,
         coalesce(sales.sales_in_flight, 0) as sales_in_flight,
         round(coalesce(sales.lamports_paid, 0) / 1e9, 6) as sol_paid
    from public.point_accounts a
    left join ledger on ledger.privy_user_id = a.privy_user_id
    left join holds on holds.privy_user_id = a.privy_user_id
    left join sales on sales.privy_user_id = a.privy_user_id
    left join identities on identities.privy_user_id = a.privy_user_id
)
select s.*,
       greatest(0, s.points_sold - s.bought - greatest(0, s.server_wager_net)) as unbacked_points_sold,
       s.offline_wagers > 0 as used_offline_wagers,
       s.points_sold > s.bought + greatest(0, s.server_wager_net) as sold_welcome_or_offline_points
  from summary s
 where s.offline_wagers > 0
    or s.points_sold > s.bought + greatest(0, s.server_wager_net)
 order by s.sol_paid desc, s.offline_net_gain desc, s.points_sold desc;

# Port City release readiness

**Prepared:** 2026-09-24  
**Decision:** **NO-GO for an external staged rollout; internal testing with every flag default-off may continue.** The final adversarial server run has 29 failing tests, the analytics sink is not connected, and World Boss/Empire keep authoritative state in process memory. A restart loses those two features' state and two server instances do not share a writer. Keep all production flags off until the server failures and telemetry blocker are cleared; keep `worldBoss` and `empire` off until their services use the SQL repositories/RPCs and the same concurrency suite passes against the database.

## 1. Flag inventory

The server accepts only `1`, `true`, `on`, or `yes` (case-insensitive). An absent, empty, or misspelled value is off. All twelve flags therefore default **OFF**.

| Rollout | Flag / environment | Turns on | Required first |
| ---: | --- | --- | --- |
| 1 | `portCity.core` / `PORT_CITY_CORE` | City snapshot, migration, buildings, workers, collectors, salvage, ledger, city screen | none |
| 2 | `portCity.cosmetics` / `PORT_CITY_COSMETICS` | Shipyard and Stationer's Shop purchase/equip/render hooks | `core` |
| 3 | `portCity.bounties` / `PORT_CITY_BOUNTIES` | Harbour Master's Office, daily/weekly contracts and Captain's Log | `core` |
| 4 | `portCity.gazette` / `PORT_CITY_GAZETTE` | Daily Gazette and shared daily puzzle | `core`; operationally `bounties` for full story/progress inputs |
| 5 | `portCity.voyages` / `PORT_CITY_VOYAGES` | Trade Docks, timed routes, pirate interception and skirmish | `core`, `bounties` |
| 6 | `portCity.academy` / `PORT_CITY_ACADEMY` | Naval Academy research and three Advanced arsenal items; protocol floor 2 | `core`; upgraded client installed |
| 7 | `portCity.captains` / `PORT_CITY_CAPTAINS` | Officers' Club and Advanced-match captain abilities; protocol floor 3 | `core`, `academy`; v3 client |
| 8 | `portCity.seas` / `PORT_CITY_SEAS` | Lighthouse and shared seasonal Advanced-match terrain; protocol floor 3 | `core`, `academy`; v3 client |
| 9 | `portCity.raids` / `PORT_CITY_RAIDS` | Coastal Command, harbour layouts, raid search/battle/replay, shields and renown | `core`, `academy` |
| 10 | `portCity.fleets` / `PORT_CITY_FLEETS` | Fleet Hall, membership/chat/donations and 22 h + 24 h wars | `core`, `raids` |
| 11 | `portCity.empire` / `PORT_CITY_EMPIRE` | 20-port PvE campaign, bosses, flags and Customs House tribute | `core`, `raids`; **persistence blocker** |
| 12 | `portCity.worldBoss` / `PORT_CITY_WORLD_BOSS` | 72-hour shared 30×30 boss, daily shots, waves and rewards | `core`, `raids`; `gazette`/`fleets` only for bonus shots; **persistence blocker** |

Dependencies are an operational invariant, not currently enforced by `featureMap()`: rollout automation must reject a child flag whose prerequisites are off. Ramp each row 1% → 10% → 25% → 50% → 100%, holding at least one full reset/settlement window at each stage and comparing the dashboard below with the simultaneous control cohort. Do not enable a later row while an earlier prerequisite is draining.

## 2. Kill switches and drains

Rollback flags in reverse order. First stop **admission** at the gateway/remote targeting layer; keep the server flag on while existing durable work drains; then switch the environment flag off and restart/roll the server; finally verify `/config` and the feature endpoint return the off state. A raw environment flip alone is not a safe drain mechanism for raids, voyages, or wars because their routes also gate continuation/settlement.

| Flag | Mid-operation behaviour and procedure |
| --- | --- |
| `core` | A build/collector is timestamped and settle-on-read. Stop new city mutations, wait for in-flight requests, then turn off. Mid-build state remains durable and settles on the first read after re-enable; no worker or currency is duplicated. The client returns to the legacy city surface. Keep `core` on until every dependent flag is off/drained. |
| `cosmetics` | Stop purchase/equip, then turn off immediately. Existing ownership remains; the public loadout route resolves the neutral/default presentation while off. No gameplay state changes. |
| `bounties` | Stop rerolls/claims, allow in-flight transactions to commit, then turn off. Progress/claim state remains durable and resumes on re-enable. Avoid crossing the UTC/weekly reset while draining, or explicitly run the normal expiry/auto-claim job first. |
| `gazette` | Safe between individual puzzle shots because each is atomic and resumable. Turn off after in-flight requests. An unfinished daily puzzle cannot be resumed while off and may expire at UTC midnight; therefore drain before rollover or accept that attempt as abandoned and announce it. |
| `voyages` | **Drain required:** reject new sends at ingress but leave the flag on for the longest 12 h voyage plus the 24 h pirate-grace window (36 h worst case), run the overdue-pirate sweep, allow collection, then turn off. A direct flip freezes collection and can change an interception into half cargo while inaccessible. |
| `academy` | Stop new Advanced queue admissions first. Existing match rooms contain snapshotted layouts and finish normally; wait for active rooms and reconnect grace to reach zero, then turn off. Research/build state remains durable. The protocol floor falls from 2 only after drain. |
| `captains` | Stop new queue admissions, drain active Advanced rooms, then turn off. A room already started retains its authoritative captain state; do not flip during the queue→ready interval because ready validation consults the live flag. Protocol floor may fall from 3 after drain. |
| `seas` | Stop new queue admissions and drain active rooms. Existing room sea/config is snapshotted and must be allowed to finish; the next match uses open sea after off. Protocol floor may fall from 3 after drain. |
| `raids` | **Drain required:** block `/raid/search` and `/raid/open`, keep action/reconnect/settle routes available, wait for every raid's snapshotted clock + 10 s grace and the 60 s disconnect grace, run the stale-lock sweeper, then turn off. Mid-raid direct-off returns `feature-off` and strands completion until re-enable, so it is not the runbook. Builds are independent. |
| `fleets` | **Drain required:** stop fleet war search/pairing; keep the scheduler and war raid/settlement routes on for all paired wars. Worst case is 22 h preparation + 24 h battle (46 h), then one scheduler tick. Turn off only when searching, prep and battle counts are zero. Membership/donation rows remain durable. |
| `empire` | PvE battles are local transcripts submitted atomically; stop new battle launches, allow transcript/tribute requests to finish, then turn off. **Do not production-enable yet:** authoritative progress is process memory, so there is no safe restart/multi-instance kill switch. Ticket: wire `0023_empire.sql` to a SQL repository and prove restart/idempotency. |
| `worldBoss` | Stop new event admission/shots, wait for the serialized writer tail to empty, close the event, issue earned milestones, then off. **Do not production-enable yet:** the writer/state are per-process memory, so cross-instance serialization and restart recovery are absent. Ticket: use the `0022_world_boss.sql` locked RPC as the sole writer and rerun the collision tests against it. |

An emergency security/data-integrity stop may bypass a drain: disable admission and the flag immediately, preserve rows/logs, and compensate from the ledger. Never delete or rewrite active rows during rollback.

## 3. Migration verification

The v1 lazy migration was exercised against **100,000 deterministic synthetic production-shaped profiles** (70% concentrated below 1,000 rank points, the remainder spanning the full 0–10,000 ladder, varied account ages and balances). This is not a claim that production PII was copied; no production database was available in this workspace.

Command: `cd server && npx tsx scripts/benchmark-city-v1.ts`

| Pass | Time | Input rows | Migrated rows | Ledger rows |
| --- | ---: | ---: | ---: | ---: |
| first | 288.58 ms | 100,000 | 100,000 | 192,589 |
| second | 24.81 ms | 100,000 | 0 | 0 |

The second result was byte-for-byte identical to the first-pass output. Post-pass totals were 40,000,000 steel and 36,036,350 gems. The database integration suite also applies the migrations twice and passed. Before production, repeat this command with a histogram sampled from production and rehearse `0014_city_core.sql` on a restored, access-controlled database snapshot; record database wall time, locks, and table/index sizes. The implementation is lazy, so rollout capacity must also account for first-open writes rather than assuming the 288.58 ms in-memory benchmark is database latency.

## 4. Protocol gate

`hello` records a client's declared protocol (missing means v1). At `queue`, the server requires v2 while Academy is on and v3 while Captains or Seas is on; otherwise it requires v1. An old client receives the typed `upgrade_required` error **before matchmaking**, so it is never given a layout, mark, captain, or sea it cannot decode.

The client treats that error as terminal, closes the socket, retains no match board, and now renders **Update required** with “New charts available — update to sail” and only **Back to menu**—there is no futile retry. Regression coverage pins the 1/2/3 gate and the terminal presentation. This repair was necessary because the prior screen safely stopped but incorrectly said “No connection” and offered “Try again.”

## 5. Week-one dashboard (15 tiles)

The repository currently has only a fail-open city telemetry stub and no analytics transport. Connecting the sink, event schema, release/cohort dimensions and dashboard alerts is a **launch blocker** for any external percentage. Every tile must split by app version, platform, country, treatment/control and flag set; exclude staff/test accounts and display numerator/denominator.

| # | Tile (definition) | Pull/hold threshold |
| ---: | --- | --- |
| 1 | **Return rate:** D1 and D7 retained installers / eligible new installers | Pull `core` if either is >20% relatively below control after ≥500 eligible users; page owner at >10% |
| 2 | **City opens/session:** distinct city foreground opens / sessions | Hold if <0.20 after discovery exposure or >5 (loop/navigation defect); pull `core` if accompanied by crash/error spike |
| 3 | **Builds started:** users starting ≥1 build / city-open users, plus starts/user/day | Hold if conversion <15%; pull `core` if successful debits do not match starts exactly |
| 4 | **Speed-up gem spend:** gems debited for speed-ups / active city player/day | Pull `core` if p99 daily spend exceeds available legitimate balance, any negative balance occurs, or debit→completion mismatch is non-zero |
| 5 | **Raid funnel:** started, completed and abandoned; completion/started and abandoned/started | Pull `raids` if completion <70%, abandonment >25%, or either moves >20% from canary baseline |
| 6 | **Star distribution:** 0/1/2/3-star share among completed raids | Hold if any bucket drifts >20% relative from simulation; pull `raids` if 0-star >45% or 3-star >35% for 24 h |
| 7 | **Defence shield rate:** shielded defender-hours / eligible defender-hours | Pull `raids` if >60% (target starvation) or <5% (shield award/expiry defect) |
| 8 | **Renown spread:** p10/p50/p90 and Gini by weekly active raider | Hold if p90−p10 grows >20% week over week; pull `raids` for any non-raid renown mutation or impossible negative value |
| 9 | **Salvage/player/day:** credited steel / eligible DAU, with sunk cells alongside | Pull `core` if ledger credit differs from rules-derived salvage at all; hold if median drifts >20% from reference simulation |
| 10 | **Steel sources vs sinks:** daily ledger sums and source/sink ratio | Pull originating flag for reconciliation mismatch; hold economy expansion if 7-day source/sink ratio is outside 0.8–1.2 or >20% off target |
| 11 | **Coin sources vs sinks:** daily ledger sums and source/sink ratio | Same: zero reconciliation tolerance; hold if 7-day ratio is outside 0.8–1.2 or >20% off target |
| 12 | **City-screen crash rate:** fatal city sessions / city sessions | Pull `core` at >1.0% or >2× control; page at >0.5% |
| 13 | **Raid action latency:** server receive→committed response p95, plus p99 | Pull `raids` if p95 >750 ms for 15 min or >2× baseline; emergency stop at >2 s |
| 14 | **Puzzle completion rate:** completed attempts / started attempts | Pull `gazette` if <60%, any hidden layout leaks, or >20% relative below canary baseline |
| 15 | **Offline-cap hits:** collector settlements at cap / offline settlements, by building | Hold economy ramp if >35% or >20% above simulation; pull `core` only if elapsed-time/cap calculation or ledger reconciliation is wrong |

Alert ownership: on-call owns integrity, crash and latency pulls; product/economy owns 24-hour holds; security can pull any flag immediately. Dashboard lag must be under five minutes for errors/crashes/latency and under two hours for economy/retention aggregates.

## 6. Player changelog — from the Captain

### New charts: Port City

Captains,

The harbour gates are opening a little at a time. Battles now bring salvage home, and your Port City can put it to work: raise buildings, collect their stores, and choose which corner of the waterfront to bring to life next. Construction keeps its course while you are away, and every coin, girder and gem remains under the harbourmaster's ledger.

As each dock clears inspection, more will appear. The Shipyard and Stationer's Shop let you fly your own colours without changing the odds of a battle. The Bounty Board records daily and weekly work. The Naval Academy adds new tools and captains to Advanced battles—but every choice still fits the same fuel budget. Classic battles remain Classic.

Coastal Command opens enemy harbours for raids, while shields give battered ports breathing room. Fleet Hall brings crews together for preparations and wars. The Newsstand prints a fresh Gazette and puzzle each day; Trade Docks send voyages beyond the bay. Farther out, seasonal seas, an Empire chart, and a great shared armada wait for their turn on the tide.

We are launching these docks in stages. Some captains will see a new building before others, and a dock may close briefly if its timbers need work. Anything already earned stays in the ledger. If a newer chart is required for fair sailing, the game will ask you to update before joining a battle—it will never drop you onto a board your ship cannot read.

Keep your powder dry, mind the tide, and send word if a line on the chart looks wrong.

— The Captain

## Verification record

- App lint: **pass**.
- Server typecheck: **pass**.
- Earlier server baseline: **32 files, 435 tests passed**, 84.20 s. The five added pure protocol assertions also pass.
- Final expanded server run: **35 files passed, 1 failed; 471 tests passed, 29 failed, 1 expected failure**, 400.10 s. Every failure is in `tests/hardening/port-city-http.test.ts`: city/cosmetics requests returning `503 internal`, research/flag gating, raid readiness/gating, concurrent voyage admission, cosmetic ownership, and fleet membership/visit error semantics. This is a release blocker, not an accepted flaky result.
- Reference suite: `npm install` up to date in 374 ms; **4 files, 80 tests passed**, 448 ms.
- App suite: **74 files / 1,331 tests passed** in the sandbox; 27 loopback-bind tests could not listen there. The exact two socket suites were rerun with binding permission: **2 files, 27 tests passed**, 26.45 s.
- New rollout regressions: client update presentation **1 passed**; protocol minimum matrix **5 passed**.
- Current workspace typecheck caveat: the app-wide rerun is blocked by two unrelated strict-index errors in the pre-existing uncommitted `scripts/hardening-perf.ts` (lines 69 and 77). The rollout UI file itself was previously covered by the green baseline; release must not proceed until the owner fixes or excludes that script and reruns `npm run typecheck`.

### Required tickets before external rollout

1. **P0:** persist World Boss state and serialization in SQL; prove two-instance collision/refund behavior and restart recovery.
2. **P0:** persist Empire progress, tribute idempotency and timestamps in SQL; prove restart recovery.
3. **P0:** triage and fix all 29 adversarial HTTP failures; require the complete server suite to pass twice from clean databases before any canary.
4. **P0:** connect analytics transport and the 15-tile dashboard/alerts.
5. **P1:** add a first-class admission/drain control distinct from route availability for raids, voyages and fleet wars; until then use the gateway drain above.
6. **P1:** rerun the database migration rehearsal on an access-controlled restored production snapshot and archive query/lock timings.

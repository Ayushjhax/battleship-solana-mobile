# Hardening pass — Port City: report

**Scope:** Parts 1–11 of the Port City package, plus the shared match/raid engine and the
server endpoints they introduce. **Method:** every gate run; coverage measured; four
adversarial workstreams (endpoints, secrecy, economy, offline/flags) in parallel; behaviour
changed only where a test proves it wrong.

**Tree note:** this working tree is uncommitted and other workstreams were editing it during
the pass (a platform-fee migration `0025`, a Part 12-era arsenal predicate, Part 11's
`liveWorld`/`empire`). Everything below says which changes are hardening's and which are
concurrent work.

---

## Findings, by severity

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | **Critical** | The fleet realtime policies killed **every** authenticated realtime channel | **Fixed** — migration 0026 + regression test |
| F2 | **High** | `verify-offline.mjs` is red against concurrent `0025_platform_fee.sql` (12 checks) | **Ticketed** — expectations need updating with the fee |
| F3 | **High** | The raid endpoint trusted client-set prices and cove renown | **Fixed** — server re-derives |
| F4 | **Medium** | A forged raid card could open a raid on yourself | **Fixed** |
| F5 | **Medium** | A shielded defender could be opened directly | **Ticketed**, pinned by `it.fails` |
| F6 | **Medium** | Match/offline coin payouts bypass `economy_ledger` (3,700 coins/month unledgered) | **Ticketed** — design call |
| F7 | **Medium** | A date-pinned contract fixture in `bounties-db.test.ts` expired and broke 3 tests | **Fixed** (fixture) |
| F8 | **Low** | `GET /visit/<unknown-uuid>` returned 503 for a missing profile | **Fixed** — migration 0024 |
| F9 | **Low** | Cove card with a null seed surfaced a SQL constraint as 503 | **Fixed** |
| F10 | **Low** | Concurrent `arsenal.test.ts` identity assertion compared the wrong object | **Fixed** (assertion target) |
| F11 | **Low** | `src/city/api.ts` casts unknown codes instead of narrowing them | **Ticketed** |
| F12 | **Low** | `raid_looted` records economy loot, not wallet loss | **Ticketed** — semantics decision |
| F13 | **Low** | Retrying a 503 on endpoints without `requestId` can double-apply | **Ticketed** — pre-existing class, audited |
| F14 | **Low** | Device-only metrics (fps, first paint, network RTT) not measurable here | **Ticketed** |
| — | — | Secrecy sweep: no leaks found | 6 new tests, green |
| — | — | Pacing drift: none over 20% (max 6.5%, stochastic) | Green |

---

## F1 — the fleet realtime policies killed every authenticated channel (Critical, fixed)

**Reproduction**

```bash
cd my-app && node supabase/verify-offline.mjs
# crashed at: ok "user A cannot broadcast on match:{id}..."
# error: permission denied for table fleet_member
```

`0017_fleets.sql` added two permissive RLS policies on `realtime.messages` whose
expressions read `public.fleet_member`, while the same migration revoked all privileges on
that table from `authenticated`. Postgres checks relation privileges for a policy expression
while **planning** the query, whether or not that policy's branch would match — so from
0017 onward every authenticated `INSERT`/`SELECT` on `realtime.messages` failed. Lobby
presence and match emotes share that table, so the blast radius was every realtime channel,
for every player, not just fleet chat.

**Fix** — `supabase/migrations/0026_fleet_realtime_member_guard.sql`: a `SECURITY DEFINER`
`public.is_fleet_member(fleet_id text, user_id uuid)` probe (the pattern the fleet RPCs
already use) and both policies call it. The table stays server-only.

**Regression test** — `server/tests/hardening/realtime-policy-regression.test.ts` (3 tests):
lobby presence insert, match emote insert+read, and a non-member fleet broadcast refused by
RLS (not by a broken grant). They fail on the old policies with the exact error and pass now.

**Residual** — the verifier goes on to fail F2, so it is still red overall until that lands.

---

## F2 — the migration verifier is red against the platform-fee migration (High, ticketed)

**Reproduction** (bisected with a throwaway copy of `supabase/`):

```bash
# with 0026 present and 0025 removed:  85 ok / 0 FAIL / exit 0
# with 0025 present:                   73 ok / 12 FAIL / exit 1
```

All 12 failures are the point/wager checks: the verifier expects the winner of a wagered PvP
match to receive the full 100-point pot; `0025` intentionally takes a 5% fee (pays 95). The
bot-wager check fails only by cascade — a targeted probe shows the bot match has
`is_bot = true` and pays the full 100, so `0025`'s bot exemption works. The remaining 11 are
absolute balances that inherit the 5-point drift.

**Ticket:** update `supabase/verify-offline.mjs`'s wager expectations to the fee (95 gross
payout, 5-point `platform_fee` row), or confirm the fee is not intended. Hardening did not
touch another workstream's migration or its expectations.

---

## F3 — the raid endpoint trusted client-set prices and renown (High, fixed)

A forged `POST /raid/open` card could set `costCoins: 0` (free raid; search costs 50 at
Admiralty 5) and a cove card could set `renown: 999999999` to scale the cove's loot pool
from the body. **Fix** (`server/src/raid/service.ts` + `routes.ts`): `costCoins` is
re-derived from the caller's Admiralty level via `searchCost()`, and cove scaling reads the
attacker's own renown from the server (`renownOf(userId)`), never the card. Pinned by the
adversarial suite (`server/tests/hardening/port-city-http.test.ts`).

## F4 — a forged raid card could raid yourself (Medium, fixed)

Same endpoint, `kind: 'player', userId: <self>`: it opened a raid on your own harbour and
charged you. Search never deals that card. Now refused with `not-found`; the cove-with-null-
seed case (F9) is refused the same way. Tests in the same suite.

## F5 — a shielded defender can still be opened directly (Medium, ticketed)

Search filters shielded targets, but `openRaid` does not re-check the shield, so a stale or
forged card can open on a shielded player. **Pinned by an `it.fails` test** in
`port-city-http.test.ts`, so it flips red the day it is fixed. The suggested fix (a shield
check inside `raid_open`, or a service guard with a new repo method) also requires updating
`tests/integration/raid-api.test.ts`, which deliberately opens directly on a defender it
just shielded — that is why hardening left it for its owner rather than rewriting those
tests.

## F6 — match/offline coin payouts bypass the ledger (Medium, ticketed)

The month sweep (`docs/port-city/progress/hardening-economy-notes.md`) instruments all 16
`economy_ledger` insert sites and 23 reasons. `apply_match_result` and
`apply_offline_result` move `profiles.coins` with **no ledger row**: 3,700 coins over the
simulated month (A 2,810 / B 840 / E 50). part-01 §3 says every currency change writes a row;
the shipped reconciliation only checked steel, so it never noticed. The hardening test pins
the gap in both directions (it fails if the gap grows *or* is fixed without updating the
test). Fix is a migration adding `match_reward`/`offline_reward` rows, or a DECISIONS
exemption — a design call on the most critical settlement path while other workstreams are
editing it.

## F7 — a date-pinned contract fixture expired (Medium, fixed)

`server/tests/integration/bounties-db.test.ts` pinned a contract's expiry to
`2026-09-23 12:00 UTC`, but `contracts_advance` filters on the **database clock**
(`expires_at > now()`), so on 2026-09-24 three claim tests started failing. The fixture now
sets `expiresAt` relative to `Date.now() + 24h`; every assertion is unchanged. 18/18 pass.

## F8 / F9 — two 503s that should have been typed 404s (Low, fixed)

- `GET /visit/<unknown-uuid>`: `city_load` lazily inserts a city row, hit the `profiles` FK
  and surfaced as 503 `internal`. **Fixed** by migration
  `0024_city_load_unknown_profile.sql` (a profile-existence guard; real players keep the
  lazy-create), with the route's existing `if (!city) → not-found` handling it.
- Cove card with `coveSeed: null`: a SQL constraint raised through as 503. **Fixed** in
  `openRaid` as `not-found` (F4's branch).

Both migrations apply cleanly twice (`verify-offline.mjs` pass 1 and pass 2).

## F10 — concurrent test compared the wrong state object (Low, fixed)

The in-flight `arsenal.test.ts` case asserted `expect(forged.state).toBe(state)` after
calling `reduce` with `{ ...state, turn: P0 }`. A rejected action returns exactly the object
it was handed, so the identity comparison must be against that copy. Fixed the target, not
the assertion's intent (23/23 pass).

## F11 — city API narrows nothing (Low, ticketed)

`src/city/api.ts` casts any unknown server code to `CityApiErrorCode`; a future code would
reach `captainLineFor`'s exhaustive record and throw. Raid and daily already map unknown →
`internal`. Fix needs a runtime `CITY_ERROR_CODES` list; more than a one-liner, so ticketed.

## F12 — `raid_looted` is an economy row, not a wallet row (Low, ticketed)

E's `raid_looted` is −344 coins / −510 steel while their wallet moved −100 / −50; the
difference is collector stores and the scrap pile, which were never wallet currency. If the
ledger is an economy ledger (D21's framing), this is by design; if wallet-only, it drifts.
The reconciliation test makes the adjustment explicit so the gap cannot hide. Decision
needed, not patched.

## F13 — 503 retry can double-apply on requestId-less endpoints (Low, ticketed)

Hardening fixed a real bug: both transports treated 503 as non-retryable
(`status >= 500 && status !== 503`) even though 503 is the server's transient catch-all,
contradicting their own comments. Now `status >= 500` retries. That intensifies a
pre-existing class: raid action, puzzle fire and voyage send/collect have no `requestId`, so
a retried 503 can apply twice if the first request actually landed. The raid session's
reject counter and the puzzle/voyage once-only constraints cap the damage, but an audit is
ticketed. Tests: `tests/hardening/offline-flaky-network.test.ts`.

## F14 — device-only metrics (Low, ticketed)

City-screen fps while panning at 3× with every plot built, time to first paint from cache,
and the real network round trip need a device/emulator + instrumented build. The pure floors
are measured in §6; the rest is a ticket, not a guess.

---

## 1. Gates

| Gate | At pass start | Final (all fixes) |
| --- | --- | --- |
| App suite | 76 files / **1358 passed** (214 s) | 85 files / **1412 passed** (581 s, with coverage) |
| Server suite | 32 files / **435 passed** | 41 files / **515 passed + 1 expected fail** (94 s) |
| Reference suite | 4 files / **80 passed** | 4 files / **80 passed** |
| `tsc --noEmit` (app) | clean (exit 0, 0 lines) | clean (exit 0, 0 lines) |
| `tsc --noEmit` (server) | clean (exit 0, 0 lines) | clean (exit 0, 0 lines) |
| `eslint .` | clean (exit 0, 0 lines) | clean (exit 0, 0 lines) |
| `verify-offline.mjs` (migrations ×2) | crashed at realtime (F1) | 85/85 with 0025 removed; 73 ok / 12 FAIL due to F2 |

Two tooling gaps were fixed to make the gates runnable:
- `docs/port-city/reference/vitest.config.ts` — without it, `npm test` there inherited the
  app's include globs, found nothing and exited 0 (DECISIONS D9's trap; the suite had been
  silently unrun).
- `@vitest/coverage-v8` added to the app devDependencies — `npm run test:coverage` could not
  run at all before (REPO-MAP recorded this).

`verify-offline.mjs` also applies `0025_platform_fee.sql` and `0026` cleanly on both passes;
`0026` and `0024` are idempotent.

---

## 2. Coverage — the Port City pure-rules modules

Measured with the v8 provider over the whole app suite. **Before** (start of the pass), six
files were under 90% lines:

| File | Before | After | What closed it |
| --- | --- | --- | --- |
| `src/engine/bounties/metrics.ts` | 86.2% | 100% | dead private `bestSingleUse` deleted |
| `src/engine/fleets/raidPolicy.ts` | 82.4% | 100% | cast test for the type-exhaustive default |
| `src/engine/fleets/flagHall.ts` | 87.5% | 100% | same, for `earnsFlag`'s default |
| `src/engine/gazette/facts.ts` | 3.4% | 100% | `hardeningGaps.test.ts`: `summariseDay`, `emptyRecords`, atomic-run reads |
| `src/engine/puzzle/puzzle.ts` | 89.8% | 100% | `resumeRun` / `finish` / `hitCount` / finished-run refusal |
| `src/engine/voyages/routes.ts` | 27.8% | 100% | `tests/voyages/routes.test.ts`: the whole route table |

**Dead code, removed rather than tested:** `bestSingleUse` in `bounties/metrics.ts` was
private and had zero callers (`grep -rn bestSingleUse src server` → its definition only), so
no test could reach it. Deleting it changes no behaviour.

**Genuinely unreachable by construction, now pinned defensively:** the `default:` arms of
`raidPolicy` and `earnsFlag` are exhaustive-switch guards — TypeScript's `never` makes them
unreachable for any `LayoutContext`. They are tested with a cast (`'nonsense' as
LayoutContext`) to prove the fallback is the *most restrictive* answer, not the most
generous. That is the only sense in which those lines can be executed.

Module totals after the pass (whole app suite): bounties 98.0, captains 100, city 94.7, cosmetics 99.1, empire 100, fleets 97.9, gazette 99.3, liveWorld 96.2, puzzle 100, raid 95.2, terrain 97.3, voyages 99.2, worldBoss 100 — every module ≥ 94.7%, and the overall app line coverage rose from 67.09% to **70.34%**.

---

## 3. Adversarial endpoints

`server/tests/hardening/port-city-http.test.ts` — **56 tests, 55 passed + 1 expected fail**.
Every Port City HTTP endpoint (all 55 routes across city/raid/fleet/bounties/cosmetics/daily
plus the shared `/config`) was driven with: no auth, expired token, another user's id, a
replayed `requestId`, two concurrent calls, negative/huge numbers, wrong types, missing
fields, unknown building/item ids, and the disallowed states (empty collector, finished job,
self-raid, shielded target, over-budget harbour, unresearched item). Every case answers a
typed error; no stack trace, no 500, no partial write (DB-backed paths assert
wallet/ledger/harbour/raid/voyage row counts). Findings F3, F4, F5, F8, F9 above.

Run: `cd server && npx vitest run tests/hardening/port-city-http.test.ts` (~11 s).

## 4. Secrecy sweep

Three new files, **6 tests, all passing**; no leaks found, so no product code changed:

- `match-secrecy.test.ts` — a full advanced match over real sockets; every frame
  (`hello:ok`, `queued`, `matched`, `state`, `events`, `turn`, `over`, `error`, `pong`) is
  grepped for un-hit enemy ship cells in both key forms. A decoy hit emits **exactly
  `['HIT']`** and never enters `revealedItems` while unexposed; the untouched mine never
  surfaces. Negative control: a tampered frame makes the checker throw.
- `raid-secrecy.test.ts` — real `/raid` routes over PGlite: search, open, status, action
  (decoy hit, full clear, illegal action), settle, replay (before/after end), log, revenge,
  harbour. No `layout`/`ships`/`arsenal`/`origin`/`orientation`, no un-marked cell, no
  unexposed decoy, no untouched mine before `over`. The defender's own harbour read is the
  one allowed exception; the post-raid reveal is asserted to arrive.
- `puzzle-secrecy.test.ts` — a full 18-cell solve sweeping `/puzzle`, `/puzzle/fire` and
  `/puzzle/leaderboard` after every response: no layout, no ship ids, no un-fired ship cell.

Gaps (documented, not covered): match sweep is FIRE-only (arsenal weapons run in the raid
sweep); raid sweep does not trigger a mine or expose a decoy (the engine's 500-raid fuzz
does); puzzle day key uses the live clock.

## 5. Economy and pacing

Full numbers in `docs/port-city/progress/hardening-economy-notes.md`. Headlines:

- **Reconciliation:** 28 simulated days, 5 users, all **16 ledger insert sites / 23
  reasons** exercised (proved by a `distinct reason` assertion). Strict
  `wallet == seed + ledger` with **zero adjustment** for the fully-ledgered users (C/D); for
  A/B/E it holds once the two accounted quantities are added (F6's match coins, F12's
  non-wallet raid loot). The scrap pile reconciles exactly for every user. Every replay was
  byte-identical; no double-writes.
- **No double credits** on: match/offline settlement, raid open/settle, stale
  `city_apply`/`research_apply`, fleet create/donate/war, contract, season, cosmetics,
  puzzle, voyage.
- **Drift vs the docs:** raid star distributions and defence-item worth match part-06 §2
  exactly (0%); puzzle median 57 / best quartile 52 matches part-09 §2 (0%); salvage matches
  NUMBERS.md exactly; NUMBERS.md regenerates from the reference source with 0 diff lines;
  the stochastic economy sim varies at most −6.5% from its saved baseline; season ink is
  827/day finishing day 22 against the locked day-18–24 window. **Nothing over 20%.**

## 6. Performance (numbers, not impressions)

`scripts/hardening-perf.ts`, run with `server/node_modules/.bin/tsx --expose-gc`:

| Measure | Result |
| --- | --- |
| Raid action resolution (engine) | 1,600 actions across 20 raids: mean 0.012 ms, p50 0.010, p95 0.073, max 0.76 ms; 20 full raids wall 36 ms |
| Raid action via `RaidSession` (validation + rate gate + state) | p50 0.010 ms, p95 0.022, max 0.17 ms |
| Memory after 20 full raids | heap 8.5 MB → 8.5 MB, **0.0 MB delta** (gc between samples) |
| City `settle()` with every plot at max | 2,000 calls: p50 0.009 ms, p95 0.014, max 0.25 ms |

Not measurable in Node, ticketed (F14): city-screen fps while panning at 3× (worklet +
renderer), time to first paint from cache (device bundle), and the real network round trip
(needs a socket to the deployed server). The numbers above are CPU floors, not substitutes.

## 7. Offline and flaky network

New files: `tests/hardening/offline-flaky-network.test.ts` (app),
`tests/hardening/flags-off.test.ts` + `server/tests/hardening/flags-off.test.ts`,
`flags-off-match.test.ts`, `raid-disconnect-settlement.test.ts` and
`match-mid-turn-disconnect.test.ts`. App **16/16**, server hardening **9/9** (plus the
mid-turn socket test in the app), 311/311 on the touched-transport regression set.

- **Airplane mode:** `forcedOffline`, OS-level, fetch-rejects — typed `offline`, no retry,
  and nothing computed locally.
- **3G-shaped:** a fetch that hangs until the 12 s abort then recovers on retry; a 503 that
  retries; a typed 409 that is never retried (verified with fake timers).
- **Mid-action disconnect:** a match socket killed mid-turn applies the action exactly once
  and both sides resync to the same board; a raid disconnect settles with what it earned
  exactly once (profile delta == settlement numbers, stores drained, a second sweep moves
  nothing).
- **Fix (F13):** 503 is retryable again in both transports.
- **Not simulated without a device:** real radio airplane-mode transitions, real 3G
  latency, Android half-open sockets, and RN rendering of the flags-off city screen (the
  gate decision is pinned instead).

## 8. Flags off

With every `PORT_CITY_*` variable unset:

- `server/tests/hardening/flags-off.test.ts`: `/config` reports all flags false and no
  season sea; **all 59 Port City endpoints** answer 409 `feature-off` (or 401 without auth)
  and never 500/stack — the `db` seam throws, so a dark endpoint touching the database would
  fail the sweep.
- `flags-off-match.test.ts`: real sockets; `matched` carries **no `sea`**, views carry null
  captains and water terrain, a `ready` naming a captain is refused and not half-applied,
  and Classic **and** Advanced both play to a fleet victory with the old rewards.
- `tests/hardening/flags-off.test.ts`: flag defaults dark, `/config` unreachable stays dark,
  only server-reported flags turn on, and the city gate never calls `/city` while off.
- The Part 10 regression harness is unchanged: Classic/Advanced **50.2% / 100 moves** with
  water terrain and no captains.

This is the strongest proof available without rendering: every server surface and wire shape
is asserted to be the old experience; the UI equivalent is pinned at the gate
(`loadFlags() → cityEnabled() → no fetch`) rather than rendered, since the repo has no
component-test setup.

---

## Tickets (for their owners)

1. **F2** — update `verify-offline.mjs` wager expectations to the 5% platform fee (or
   confirm the fee is not intended). Repro: bisect note in F2.
2. **F5** — re-check the shield inside `openRaid`/`raid_open`; adjust the direct-open tests
   in `server/tests/integration/raid-api.test.ts`. The `it.fails` test flips red when fixed.
3. **F6** — ledger rows for match/offline coins (migration), or a DECISIONS exemption.
4. **F11** — runtime `CITY_ERROR_CODES` narrowing in `src/city/api.ts`.
5. **F12** — decide whether `raid_looted` is an economy row (as D21 implies) or a wallet
   row.
6. **F13** — audit 503 retries on requestId-less endpoints (raid action, puzzle fire, voyage
   send/collect); add `requestId` where the double-apply class is real.
7. **F14** — device metrics: city pan fps at 3× fully built, first paint from cache, real
   network RTT, and a mid-action disconnect on a real radio.

---

## Files added or changed by this pass

**Product fixes:** `supabase/migrations/0024_city_load_unknown_profile.sql`,
`supabase/migrations/0026_fleet_realtime_member_guard.sql`,
`server/src/raid/service.ts` (re-derived price/renown; self/cove guards),
`src/net/featureClient.ts` + `src/city/api.ts` (503 retryable),
`src/engine/bounties/metrics.ts` (dead code removed),
`docs/port-city/reference/vitest.config.ts` (the D9 trap).
**Tests:** `server/tests/hardening/` (8 files), `tests/hardening/` (3 files),
`src/engine/__tests__/hardeningGaps.test.ts`, `tests/voyages/routes.test.ts`,
`server/tests/integration/bounties-db.test.ts` (fixture date), `arsenal.test.ts`
(concurrent assertion target).
**Evidence:** `scripts/hardening-perf.ts`,
`docs/port-city/progress/hardening-economy-notes.md`, this report.
**Dependency:** `@vitest/coverage-v8` (app devDependency, to measure at all).

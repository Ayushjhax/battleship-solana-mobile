# Part 1 — City core: implementation plan

**Status:** plan only. No implementation code written yet.
**Read:** `00-OVERVIEW.md`, `part-01-city-core.md`, `NUMBERS.md`, `progress/REPO-MAP.md`,
`reference/src/city.ts`, `reference/test/city.test.ts`.

Reference suite verified locally: **80/80 passing** (resolve 26, new-items 16, raid 17,
city 21).

> **Correction to REPO-MAP.md §7 gap 9.** I reported the reference had 84 tests and that the
> README's "17 raid tests" was stale. That was wrong — it was a bad `grep -c` over lines
> containing `it(`. The real count is **80**, exactly as the README says. What *is* true:
> `npm test` inside `reference/` reports **"No test files found"**, because vitest walks up
> and picks up `my-app/vitest.config.ts` (the reference has no config of its own). It has to
> be run with an explicit config. Recorded in DECISIONS.md.

---

## 0. The one architectural decision everything else follows from

`part-01-city-core.md` §3 and `reference/src/city.ts` **disagree about where money lives**:

| | Reference | part-01 §3 |
| --- | --- | --- |
| `CityState` | holds `coins`, `steel`, `gems` | holds no currency at all |
| currencies | inside the city | "live **with the profile** … so one transaction updates wallet and city together" |

The doc wins (it is the newer, repo-aware spec, and it is the only shape that lets one
`update profiles` + one `update city` sit in a single transaction). So the pure module takes
**both** halves:

```ts
export interface Wallet { readonly coins: number; readonly steel: number; readonly gems: number; }
export interface CityWorld { readonly city: CityState; readonly wallet: Wallet; }

export type CityActionResult =
  | { ok: true; world: CityWorld; ledger: readonly LedgerDelta[]; events: readonly CityTelemetryEvent[] }
  | { ok: false; error: CityError };
```

Two further deliberate deviations from the reference, both to match this repo rather than the
model:

1. **Immutable.** The reference mutates `s` in place and returns `CityError | null`. This
   repo's engine is immutable (`reduce()` returns a new state). The city module returns a new
   `CityWorld`; the server's version-conflict retry loop needs that anyway.
2. **Every action returns its ledger rows.** `economy_ledger` requires one row per currency
   change (§3), and a reconciliation test must replay them onto the balances. Making the pure
   layer emit the deltas means the ledger cannot drift from the rules — the server just writes
   what it is handed.

Consequence for the server: **rules run in TypeScript, the database is a transactional
store.** One SQL function (`city_apply`) takes the already-computed next state plus the
deltas and commits city + wallet + ledger + request-log atomically under a version check. The
catalogue is never duplicated in SQL.

The **one** exception is salvage at match settlement, which must land inside the existing
`apply_match_result` transaction (§4). There the Scrapyard bonus percentage has to be known
in SQL. Rather than pass a possibly-stale bonus computed before the lock, six numbers
(0/5/10/15/20/25) go into a SQL `case`, **pinned by a cross-file test against the TS
catalogue** — precisely the idiom `src/engine/__tests__/ranks.test.ts` already uses for the
rank ladder vs `0003_ranks.sql`.

---

## 1. Files I will add

### Rules — `src/engine/city/` (pure, no imports outside itself)

| File | Contents |
| --- | --- |
| `src/engine/city/types.ts` | `BuildingId`, `BuildingSpec`, `LevelSpec`, `BuildingState`, `CityState`, `Wallet`, `CityWorld`, `CityError`, `LedgerDelta`, `CityActionResult`, `CityTelemetryEvent` |
| `src/engine/city/catalogue.ts` | `CITY_CATALOGUE` (one exported table), `maxLevel`, `rateOf`, `capacityOf`, `nextLevelSpec`, `STARTING_GRANT`, `SALVAGE_PER_CELL`, `WORKER_GEM_COST`, `WORKER_ADMIRALTY_REQ`, `ADMIRALTY_GEM_GRANT`, `RANK_GEM_BACKPAY`, `OFFLINE_REWARD_CAP`, `catalogueChecksum()` |
| `src/engine/city/settle.ts` | `accrueTo`, `settle(world, now)` |
| `src/engine/city/actions.ts` | `newCity`, `canStart`, `startUpgrade`, `speedUpGems`, `speedUp`, `cancelUpgrade`, `collect`, `collectAll`, `collectScrap`, `buyWorker`, `salvageFor`, `creditSalvage`, `countsForOfflineReward`, `freeWorkers`, `busyWorkers` |
| `src/engine/city/migrate.ts` | `migrateToV1(world, rankPoints, now)` — the §2.7 grant + rank back-pay, idempotent on `cityVersion` |
| `src/engine/city/index.ts` | barrel for `@engine/city` |

**`src/engine/index.ts` is deliberately NOT extended.** It is described as "the engine's
public surface" and re-exports with `export *`; adding the city would collide on generic
names (`collect`, `settle`, `maxLevel`). Consumers import `@engine/city` directly. Stated
here so it reads as a choice rather than an oversight.

Lint check done up front: `eslint.config.js` has two engine overrides, and because flat
config lets the later one replace the earlier for the same rule, files at
`src/engine/city/*.ts` are governed by the `src/engine/*/**/*.ts` block, which bans `../../*`
but permits `../types`. A city subdirectory therefore needs **no lint change**. The city
module will in fact import nothing at all.

### Rules tests — `src/engine/city/__tests__/`

Covered by the existing `src/engine/**/*.test.ts` glob, so **no `vitest.config.ts` change.**

| File | Covers |
| --- | --- |
| `city.test.ts` | reference scenarios 1–11, ported |
| `catalogue.test.ts` | checksum pin + the NUMBERS.md cross-file pin |
| `migrate.test.ts` | §2.7 migration as a pure function |

### Server — `server/src/city/`

| File | Contents |
| --- | --- |
| `server/src/city/repo.ts` | the data-access seam: `loadWorld`, `applyWorld`, `lookupRequest`, `recordRequest`. Supabase-RPC implementation + `__setCityRepoForTests` (same idiom as `auth.ts`'s `__resetAuthCacheForTests`) |
| `server/src/city/service.ts` | load → settle → act → save, version retry (once), `requestId` replay, `CityError` → HTTP mapping |
| `server/src/city/routes.ts` | the seven endpoints from §4 |
| `server/src/city/salvage.ts` | final `MatchState` → per-player sunk enemy ship lengths |
| `server/src/city/rateLimit.ts` | 10 actions / 10 s per user, in-memory, returns `rate-limited` (never kills a connection) |
| `server/src/features.ts` | `portCity.*` flags from env, default off; backs `GET /config` |

### Server tests — `server/tests/`

| File | Covers |
| --- | --- |
| `helpers/pgliteDb.ts` | boots PGlite, installs the `auth`/`realtime` stubs, applies every migration |
| `integration/city-db.test.ts` | migration twice, concurrency, ledger reconciliation, salvage-in-transaction, offline cap |
| `integration/city-api.test.ts` | every endpoint × happy path + every typed error, idempotency, authorisation, feature-off |
| `unit/city-salvage.test.ts` | sunk-ship extraction from a finished match |
| `regression/city-sql-catalogue-pin.test.ts` | the SQL Scrapyard bonus vs the TS catalogue |

### Client — `src/city/`

| File | Contents |
| --- | --- |
| `src/city/types.ts` | wire types (`CitySnapshot`, `CityResponse`, `CityApiError`) |
| `src/city/api.ts` | typed client, `requestId` per call, retries network errors only — never a 409 |
| `src/city/store.ts` | `useCity`: snapshot, `serverOffset`, `loading`, `error`; selectors `freeWorkers`, `canAfford`, `secondsLeft`, `collectable` |
| `src/city/features.ts` | flag fetch + cache; everything no-ops when `portCity.core` is off |
| `src/city/telemetry.ts` | typed `emitCity(event)` — the §7 event names |
| `app/(dev)/city-lab.tsx` | dev-only screen: a button per endpoint, clock-offset override, JSON dump |

### Client tests — `tests/city/`

Covered by the existing `tests/**/*.test.ts` glob, so again **no config change**.

| File | Covers |
| --- | --- |
| `tests/city/store.test.ts` | selectors, negative-time clamp, cached snapshot round trip |
| `tests/city/api.test.ts` | requestId per call, no retry on 409, feature-off short circuit |

### Docs

`docs/port-city/progress/DECISIONS.md`, `docs/port-city/progress/part-01-report.md`.

---

## 2. Files I will touch

| File | Change | Why |
| --- | --- | --- |
| `supabase/migrations/0014_city_core.sql` | **new** | tables, functions, `steel` column, guard update |
| `server/src/db.ts` | extend `applyMatchResult` args; add `applyOfflineResult` salvage args; city RPC wrappers | salvage must ride the existing settlement transaction |
| `server/src/room.ts` | compute per-player sunk lengths, pass to `applyMatchResult` | §4: "It must be told which enemy ships were sunk by each player" |
| `server/src/index.ts` | register city routes + `GET /config` | new endpoints |
| `server/package.json` | add `@electric-sql/pglite` to devDependencies | see §6 |
| `src/state/profile.ts` | `steel` in `ProfileData`, `DEFAULT_PROFILE`, **`partialize`** | else steel is not persisted |
| `src/net/api.ts` | `steel` in `ProfileSchema` + `PROFILE_COLUMNS` | else the profile read fails to parse |
| `src/net/profileSync.ts` | `steel` on `CloudProfile`, `fromApi` | |
| `src/net/profileMerge.ts` | `steel` in `localAsPatch` / `cloudAsLocal` | |
| `app/(dev)/kitchen-sink.tsx` | one link to City lab | discoverability |

**No existing test is modified or deleted.** The two existing suites must stay at 410 and 138
passing. If `apply_match_result`'s signature change forces an edit to an existing server test,
I will list the test, the reason, and the diff in the report rather than quietly changing it.

---

## 3. Database

### Tables (all in `0014_city_core.sql`)

```sql
profiles: add column steel integer not null default 0;   -- gems already exists (default 10)
-- and guard_profile_update() gains `steel` to its rejected-column list

city (
  user_id      uuid primary key references profiles(id) on delete cascade,
  state        jsonb   not null,      -- CityState (no currencies)
  version      integer not null default 1,   -- optimistic concurrency
  city_version integer not null default 0,   -- migration marker; 1 after v1
  updated_at   timestamptz not null default now()
)

economy_ledger (
  id       bigserial primary key,
  user_id  uuid not null references profiles(id) on delete cascade,
  at       timestamptz not null default now(),
  reason   text not null,          -- salvage|build|cancel|speedup|collect|migration:v1|...
  ref      text,                   -- match id, building id
  d_coins  integer not null default 0,
  d_steel  integer not null default 0,
  d_gems   integer not null default 0
)

city_request_log (
  user_id    uuid not null references profiles(id) on delete cascade,
  request_id uuid not null,
  at         timestamptz not null default now(),
  response   jsonb not null,
  primary key (user_id, request_id)
)
```

RLS on all three, **no end-user policies and no grants** — identical to `offline_results` and
`privy_accounts`. The service-role key is the only writer, so acceptance criterion §9.2
("the database refuses a direct write carrying a user token") holds by construction, and the
pglite suite asserts it.

### Functions

| Function | Role |
| --- | --- |
| `city_load(p_user)` | returns `(state, version, city_version)`, creating an empty row if absent |
| `city_apply(p_user, p_expected_version, p_state, p_d_coins, p_d_steel, p_d_gems, p_ledger jsonb[], p_request_id, p_response, p_city_version)` | the whole write: version check → `update city` → `update profiles` → ledger rows → request-log row → trim to newest 50. Returns the new version, or null on version conflict |
| `city_request_lookup(p_user, p_request_id)` | stored response or null |
| `credit_salvage(p_user, p_base, p_ref, p_cap, p_count_toward_cap)` | locks the city row, applies the Scrapyard bonus, adds to `scrapPile`, writes the ledger row, maintains `offlineRewardsToday`. Returns the credited amount (0 when capped) |
| `apply_match_result(… , p_salvage_base_a, p_salvage_base_b)` | **signature change** — see §6 risk 1 |
| `apply_offline_result(… , p_salvage_base, p_offline_cap)` | **signature change** |

Signature changes are done as `drop function if exists <exact old signature>;` followed by
`create or replace` of the new one with the new parameters defaulted. Naming the *old* arity
in the drop keeps the migration re-runnable: on the second pass the old signature is already
gone and `if exists` makes it a no-op.

### Migration to v1 (§2.7)

Lazy, on the first `GET /city`, one transaction, keyed on `city_version = 0`:
Admiralty 1, Scrapyard 1, everything else 0, 2 workers, +400 steel, +50 gems, plus rank
back-pay 10/20/40/80/150 cumulative by rank already reached, one ledger row per grant with
reason `migration:v1`, then `city_version = 1`.

---

## 4. Order of work

1. **Rules** — `src/engine/city/*`, then its three test files. Green before anything else.
   The catalogue and the checksum land first so every later number is pinned.
2. **Migration** — `0014_city_core.sql`, driven by `helpers/pgliteDb.ts` and
   `city-db.test.ts` (migrations applied twice from the first commit).
3. **Server wiring** — `features.ts` + `GET /config` first, so every endpoint is born behind
   the flag; then `repo.ts` → `service.ts` → `routes.ts`; `city-api.test.ts` alongside.
4. **Settlement hook** — `salvage.ts`, the `apply_match_result` / `apply_offline_result`
   signature changes, `room.ts` and `db.ts`. **Re-run the existing 138 server tests here**,
   because this is the step that can break live matches.
5. **Client** — `steel` plumbing through the five files, then `api.ts` → `store.ts` →
   `city-lab.tsx`; `tests/city/*` alongside.
6. **Full sweep** — both suites, `npm run typecheck`, `npm run --prefix server typecheck`,
   `npm run lint`, `node supabase/verify-offline.mjs`. Then the report.

---

## 5. Tests I will write

### Rules — ported from `reference/test/city.test.ts` (part-01 §8.1)

| # | Scenario |
| --- | --- |
| 1 | start takes the cost up front and books a worker |
| 2 | two workers busy → third build is `no-free-worker` |
| 3 | two jobs due in one `settle` complete in `endsAt` order |
| 4 | cancel refunds exactly half, floored, and frees the worker |
| 5 | `speedUpGems`: 60 s→0, 1 h→16, 4 h→31, 24 h→76, 72 h→132, monotonic over 4 days at 137 s steps |
| 6 | collector accrues `rate × hours` and stops dead at `rate × capacityHours` |
| 7 | settling every 30 s for 5 h is byte-identical to settling once |
| 8 | level-up mid-window: 15 min @12/h then 2 h @18/h = 3 + 36 = 39 |
| 9 | `salvageFor` = 5/cell, Scrapyard bonus applied, floored |
| 10 | salvage lands in `scrapPile`, only `collectScrap` moves it to the wallet |
| 11 | 2,000-step random walk: no negative balance, no negative workers, no building over max |

Two additions of my own, both probing things the reference cannot:

| # | Scenario | Why |
| --- | --- | --- |
| 12 | **scenario 7 repeated at a non-dividing rate** (Fish Market L3, 26/h) | see risk 4 |
| 13 | catalogue checksum + **every row parsed out of `NUMBERS.md` equals `CITY_CATALOGUE`** | §8.20, in the true rank-ladder idiom — pins against the doc, not just a magic number |

Scenario 11 will use the engine's seeded `createRng` rather than `Math.random`, so a failure
reproduces. (The engine ban on `Math.random` applies to `src/engine/**`, tests included.)

### Server (part-01 §8.2)

| # | Scenario | Vehicle |
| --- | --- | --- |
| 14 | every endpoint, happy path | Fastify `inject` |
| 15 | every typed error: `feature-off`, `unknown-building`, `max-level`, `already-upgrading`, `no-free-worker`, `needs-admiralty`, `not-enough-steel`, `not-enough-coins`, `not-enough-gems`, `not-upgrading`, `nothing-to-collect`, `rate-limited`, `version-conflict` | `inject` |
| 16 | same `requestId` twice → one effect, **identical response both times** | `inject` + pglite |
| 17 | two concurrent `collect` calls → credited exactly once | **pglite, real SQL** |
| 18 | user A cannot build / collect / speed up in user B's city | `inject` |
| 19 | migration: fresh profile; veteran at Captain rank → 150 back-paid gems; run twice → identical | pglite |
| 20 | a settled match credits salvage exactly once inside the points+coins transaction; a replayed settlement does not double-credit | pglite |
| 21 | the 11th offline match of a UTC day credits **no salvage but still credits coins** | pglite |
| 22 | ledger reconciliation: replaying every `economy_ledger` row lands on the stored balances | pglite |
| 23 | the SQL Scrapyard bonus `case` equals `CITY_CATALOGUE.scrapyard` | cross-file read |
| 24 | flag off → every endpoint returns `feature-off` and writes nothing | `inject` |

### Client

| # | Scenario |
| --- | --- |
| 25 | selectors: `freeWorkers`, `canAfford`, `secondsLeft`, `collectable` |
| 26 | `secondsLeft` clamps a negative remaining time to 0 (device clock ahead) |
| 27 | cached snapshot survives a store rebuild and opens read-only |
| 28 | `api.ts` retries a network error but **never** a 409 |

### Regression guard

| # | Scenario |
| --- | --- |
| 29 | with `portCity.core` off, an online match settles exactly as it does today — same points, coins, ledger rows, and no city row created |

---

## 6. The risky parts

**1. Changing `apply_match_result`'s signature.** It is the single most important function in
the app, it was already replaced once (0008 → 0010), and it now carries wager settlement.
`create or replace` cannot change a signature, so the migration must `drop function if exists`
the exact 7-arg version and create a 9-arg one with the new parameters defaulted. Risks: a
deploy window where old server code calls the dropped arity (mitigated by the defaults — a
7-arg call binds to the new function), and a re-run dropping the wrong thing (mitigated by
naming the exact old signature). The existing wager tests are the safety net and must stay
green untouched.

**2. `guard_profile_update` fails open.** The trigger lists guarded columns by name
(`0001_profiles.sql:73-84`). If `steel` is added to `profiles` but not to that `if`, it
becomes **client-writable** and nothing in the suite would notice. This is REPO-MAP risk 1 and
the single highest-consequence line in the part. It gets its own pglite assertion: an
authenticated-role update of `steel` must raise `42501`.

**3. The five-file currency plumbing.** `steel` has to be added to `ProfileData`,
`partialize`, `ProfileSchema` + `PROFILE_COLUMNS`, `CloudProfile`/`fromApi`, and
`localAsPatch`/`cloudAsLocal`. Four of the five fail *silently*; only the zod schema fails
loudly (and it fails the whole profile read, which is worse). A single test that round-trips a
profile with steel through all five is the guard.

**4. `ceil` in the accrual clock.** The reference advances `lastAccrualAt` by
`Math.ceil(add * 3_600_000 / rate)`. For rates that divide 3,600,000 evenly (12/h, 18/h — the
only rates the reference tests exercise) this is exact. For 26/h, 38/h, 54/h it rounds *up*,
so repeated settling could lose fractions that a single settle keeps — which would break
part-01 §2.4's "settling every 30 seconds and settling once after five hours give the
identical number" and acceptance criterion §9.3. Scenario 12 exists to find out. If it fails,
the fix is to store accrued-milliseconds rather than rounding, and **it goes in DECISIONS.md
as a finding against the reference** — it is a new rule, so the docs and reference are the
spec, and I do not get to silently change them.

**5. The feature flag is being built from nothing.** There is no flag mechanism anywhere in
the repo (REPO-MAP §2). Part 1 introduces the minimum that satisfies the requirement: env
vars on the server (`PORT_CITY_CORE`, default off), one `GET /config`, and a client cache.
This is *not* the twelve-flag remote-config system `00-OVERVIEW.md` §5 describes; it is the
first flag, shaped so the others can join it. Scenario 29 is what proves "flag off reproduces
today's behaviour".

**6. Rate limiting must not reuse the socket limiter.** REPO-MAP risk 2: `ws.ts` closes the
socket after 10 messages/second or 5 rejected actions. City traffic is HTTP and gets its own
per-user limiter returning a typed `rate-limited`, exactly as `00-OVERVIEW.md` §5 requires.
No city action ever touches the socket counters.

**7. PGlite is not Supabase.** It has no PostgREST, no real `auth.uid()`, no service-role
enforcement — `verify-offline.mjs` stubs those. So the pglite tests prove the *SQL* (atomicity,
concurrency, idempotency, the guard trigger) and the `inject` tests prove the *routes*.
Neither proves the PostgREST RPC serialisation in between; that gap stays, and the report will
say so.

**8. Duplicated stub block.** `helpers/pgliteDb.ts` re-creates the `auth`/`realtime` stubs that
`verify-offline.mjs` defines inline. I am duplicating ~30 lines rather than refactoring a
working verification script mid-part. Drift risk noted; if the stubs change, both move.

---

## 7. Dependencies

**No new dependency for production code.** Everything uses what is already there: zod,
zustand, Fastify, supabase-js, expo-sqlite's localStorage shim.

One devDependency moves package: **`@electric-sql/pglite`** is added to
`server/package.json` devDependencies. It is already a devDependency of the app (used by
`supabase/verify-offline.mjs`) and already resolves from `server/` by hoisting — but relying
on hoisting is fragile, and the server suite is about to depend on it for four scenarios.
Declaring it is the honest fix. No new package enters the lockfile.

---

## 8. Numbers I had to decide (→ `DECISIONS.md`)

Every cost, time, rate, gate, gem price, vault and cap comes from `NUMBERS.md` or
part-01 §2. These are the gaps:

| # | Gap | Proposal |
| --- | --- | --- |
| D1 | `city.version` initial value | `1`, incrementing on every successful write |
| D2 | Cancel rounding: §2.3 says "floored", the reference *test* asserts `Math.ceil` (both agree at 300 steel because it is even) | Implement **floor**, per the prose and the reference's own code |
| D3 | Telemetry transport — §7 names eleven events; the repo has **no telemetry system at all** | Emit through a typed `emitCity()` — pino on the server, `__DEV__` console on the client. Event names and payloads exactly as §7 lists, so a real sink is a one-file change |
| D4 | Feature-flag delivery mechanism (none exists) | Server env var → `GET /config` → client cache. Default off |
| D5 | City action rate limit window | 10 per 10 s per user (`00-OVERVIEW.md` §5), in-memory, per-process |
| D6 | `request_log` trim policy | Keep newest 50 per user (§3); trim inside `city_apply` |
| D7 | Which UTC day the offline cap uses | `to_char(now() at time zone 'utc', 'YYYY-MM-DD')`, stored in `offlineRewardsToday.day` — server time only, never the device's |
| D8 | Whether a *bot* match counts as online for salvage | Yes — §2.2 says "online (including bot matches)", and it already pays coins and points |

Nothing else was invented. If implementation turns up another gap it goes in DECISIONS.md
before the code that needs it.

---

## 9. Definition of done for this part

- [ ] Both existing suites still green, unmodified: app 410, server 138
- [ ] Every scenario in §5 above passing
- [ ] `npm run typecheck` and `npm run --prefix server typecheck` clean; no new `any`
- [ ] `npm run lint` clean
- [ ] `node supabase/verify-offline.mjs` still passes with 0014 in place
- [ ] Flag off ⇒ byte-identical behaviour to today (scenario 29)
- [ ] `DECISIONS.md` and `part-01-report.md` written, with the manual QA checklist from §8.3 run on a dev build

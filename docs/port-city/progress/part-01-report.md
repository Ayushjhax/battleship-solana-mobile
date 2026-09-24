# Part 1 — City core: report

**Status: complete.** Rules, migration, server API, client data layer, City lab and tests.

| Gate | Result |
| --- | --- |
| App suite | **500 passed / 42 files** (was 410 / 37) |
| Server suite | **176 passed / 16 files** (was 138 / 14) |
| `tsc --noEmit` (app) | **0 errors** outside the pre-existing `docs/port-city/reference/` set — see §6 |
| `tsc --noEmit` (server) | **clean** |
| `eslint .` | **clean** |
| `node supabase/verify-offline.mjs` | **all database checks passed** (every migration applied twice) |

**128 new tests.** No existing test was deleted or weakened; two changed, both listed in §5.

---

## 1. What was built, file by file

### Rules — `src/engine/city/` (pure, imports nothing)

| File | What it holds |
| --- | --- |
| `types.ts` | `CityState`, `Wallet`, `CityWorld`, `BuildingState`, 11 typed `CityError`s, `LedgerDelta`, `CityTelemetryEvent` |
| `catalogue.ts` | `CITY_CATALOGUE` — 15 buildings, 68 levels — plus worker prices, Admiralty and rank gem grants, `catalogueChecksum()` |
| `settle.ts` | settle-on-read: chronological completion, exact production accrual, Admiralty gem grants |
| `actions.ts` | `newCity`, `canStart`, `startUpgrade`, `speedUp`, `cancelUpgrade`, `collect`, `collectAll`, `buyWorker`, `salvageFor`, `creditSalvage`, selectors |
| `migrate.ts` | the lazy v1 migration with rank back-pay, idempotent on `cityVersion` |
| `index.ts` | the `@engine/city` surface |

Purity is enforced, not asserted: the module imports nothing at all, and `eslint` blocks any
escape. Time is always a `now` parameter; there is no `Date.now()` or `Math.random()`.

### Database — `supabase/migrations/0014_city_core.sql`

`profiles.steel` (+ the guard trigger), `city`, `economy_ledger`, `city_request_log`, and
seven service-role-only functions: `city_default_state`, `city_load`, `city_request_lookup`,
`city_apply`, `credit_salvage`, and replacements for `apply_match_result` and
`apply_offline_result`.

### Server — `server/src/`

| File | What it does |
| --- | --- |
| `features.ts` | the twelve `portCity.*` flags from env, default **off**; backs `GET /config` |
| `city/repo.ts` | the data-access seam + `__setCityRepoForTests` |
| `city/service.ts` | load → settle → act → save, version retry, `requestId` replay, error mapping |
| `city/routes.ts` | the seven endpoints |
| `city/salvage.ts` | final `MatchState` → per-seat salvage base |
| `city/rateLimit.ts` | 10 actions / 10 s per user, typed error — **never** a disconnect |
| `city/telemetry.ts` | the eleven §7 events, typed, stub transport |

### Client — `src/city/` and `app/(dev)/city-lab.tsx`

`types.ts` (the whole wire contract in one file), `api.ts` (requestId per call, retries
network errors only), `store.ts` (`useCity` + `serverNow`, `secondsLeft`, `buildProgress`,
`canAfford`, `collectable`, `plotVisible`), `features.ts`, and the City lab dev screen with a
button per endpoint, a live JSON dump and a double-requestId probe.

---

## 2. Three defects found and fixed

### The reference implementation loses production (D13)

`reference/src/city.ts:313` advances the accrual clock with
`Math.ceil(add * 3_600_000 / rate)`, which is exact only when the rate divides an hour
evenly. Its own tests only exercise 12/h and 18/h — both exact — so it never shows.

At **26/h** (Fish Market L3), measured:

| | stored after 5 h |
| --- | --- |
| settle once | 130 |
| settle every 30 s | **129** |

That breaks §2.4 and acceptance criterion §9.3. Replaced with an exact carry:
`total = carry + rate × elapsedMs`, `produced = floor(total / 3_600_000)`,
`carry' = total − produced × 3_600_000`. Additive over any chopping of the interval, integer
throughout. **This adds a `carry` field to `BuildingState` that part-01 §3 does not list** —
the doc should gain it.

### A replayed request returned a different body than the original (found by test)

`actOnCity` stored the response *before* `city_apply` returned the new version, then returned
a body with the version patched in. So the replay and the original differed, breaking
§8.2.13's "identical response both times". `city_apply` always sets `version = version + 1`,
so the next version is now computed before the write and both paths return the same object.

### The score-guard test passed for the wrong reason (found by probe)

`set local role` only lives inside an explicit transaction, and PGlite autocommits. So
`auth.uid()` was null, RLS matched zero rows, and an UPDATE that should have been *rejected*
quietly returned zero rows. The guard test "passed" without ever reaching the trigger.

Fixed with session-level `set role`, and the test now **proves it is reached** by first
writing a permitted column, then asserting `steel` is rejected, then asserting the server-side
write still succeeds. This is the highest-consequence line in the part — had `steel` been
missing from `guard_profile_update`, it would have shipped client-writable.

---

## 3. Deviations from the design

| Deviation | Why |
| --- | --- |
| `BuildingState.carry` added | §2 above — the published shape cannot express exact accrual |
| Currencies live on the profile, not in `CityState` | part-01 §3 says so; the reference disagrees. The doc wins — it is the only shape that lets one transaction move wallet and city together |
| Rules are immutable and return ledger rows | The repo's engine is immutable, and emitting deltas from the rules means `economy_ledger` cannot drift from them |
| Salvage lands via a base + SQL bonus | The bonus needs the locked row. The six percentages live in SQL, **pinned by a test** against `CITY_CATALOGUE.scrapyard` — the rank-ladder idiom |
| `@engine/city` is not in `src/engine/index.ts` | That barrel uses `export *`; `collect`, `settle` and `maxLevel` would collide |
| `apply_offline_result` returns `integer`, not `boolean` | It now reports how much salvage landed (`-1` = already applied, `0` = capped). No caller read the old boolean |
| Feature flags are env vars + `GET /config` | No flag mechanism existed (D4). This is the first flag, shaped so the other eleven join it |
| Telemetry transport is a stub | No analytics backend exists (D3). Names, payloads and call sites are real |

---

## 4. Tests

### Rules — 67 tests (`src/engine/city/__tests__/`)

All eleven §8.1 scenarios ported from the reference, plus:

- **settle-often == settle-once at 26/h** — the test that caught D13.
- **The catalogue pin (§8.20)** done properly: as well as a checksum, the test **parses
  `NUMBERS.md` itself** and asserts all 68 levels match. A number cannot move in the code
  without moving in the published table.
- Every catalogue cost is even — so D2's floor-vs-ceil choice is currently unobservable, and
  the pin fails the moment an odd cost appears.
- The random walk uses the engine's seeded RNG, so a failure reproduces.

### Database — 17 tests (`server/tests/integration/city-db.test.ts`, real PGlite)

Migration applied twice; the guard trigger (§3 above); no client grants on any city table;
`city_default_state` pinned against `newCity()`; the SQL Scrapyard bonus pinned against the TS
catalogue level by level; salvage credited in the settlement transaction and **not** re-credited
on replay; the offline cap paying 10 then stopping while coins keep flowing;
`city_apply` refusing a stale version, refusing to drive a balance negative, and trimming the
request log to 50; **two collects racing, credited exactly once**; ledger reconciliation.

### API — 21 tests (`server/tests/integration/city-api.test.ts`)

Real rules over real SQL, only the repo seam swapped. Flag off on every endpoint (and off for
junk values); migration of fresh and veteran profiles; settle-on-read; **every one of the
typed errors**; `requestId` idempotency including "a replay does not consume a rate-limit
slot"; authorisation, including that the request log is keyed by `(user, request)`.

### Client — 23 tests (`tests/city/`)

Store: clock offset from `serverNow`, wallet passed through untouched, cache excludes session
fields, `secondsLeft` counting from the **server** clock with a device clock an hour fast,
negative clamped to 0, `canAfford` shortfalls, gated-plot visibility.
API: bearer token, distinct requestId per call, **never retries a 409**, retries transport
failures and gives up after three, hard-offline short-circuit.

---

## 5. Existing tests that changed (none weakened)

1. **`server/src/__tests__/room.test.ts:102`** — asserted `applyMatchResult`'s exact argument
   list, which now has a fifth salvage argument. **Strengthened**: it now also proves the
   winner who swept the fleet is credited exactly 18 cells × 5 = 90, read off the real final
   board, and that the loser gets strictly less.
2. **`src/net/__tests__/profileMerge.test.ts:24`** — a `CloudProfile` fixture gained
   `steel: 0`. A fixture, not an assertion.

One config change: **`eslint.config.js`** gained a third engine-purity override for
`src/engine/*/*/**/*.ts` banning `../../../*`. Without it a test at
`src/engine/city/__tests__/` could not import `src/engine/ranks`, which is engine-internal and
legal. **Verified by probe** that a genuine escape (`../../../ui/tokens`) is still rejected.

---

## 6. Still open

- **`npm run typecheck` reports 104 errors that predate this part**, all in
  `docs/port-city/reference/`, which is swept into the root tsconfig's `**/*.ts`. Confirmed by
  stashing all Part 1 work and re-running. Part 1 adds zero. One line
  (`"docs/port-city/reference"` in `exclude`) fixes it; left for you to approve (D15).
- **`src/net/database.types.ts` must be regenerated** once 0014 is applied to a real project
  (`npx supabase gen types typescript --linked > src/net/database.types.ts`). Until then the
  four new RPCs go through one narrow typed seam in `city/repo.ts`, marked for deletion.
- **`CurrencyChip` has no `'steel'` kind** — Part 2 adds it. Steel is stored and synced, just
  not yet shown in the HUD.
- **Part 4 will need `credit_salvage` split** — it both checks *and* increments the daily
  counter, so contracts calling it too would halve the cap to 5. Detailed in
  `part-04-plan.md` §1.
- The auto-claim/cron machinery, the Result-screen salvage line and the menu badge are Parts
  2 and 4.

---

## 7. How to test this by hand

```bash
# 1. Apply the migration
npx supabase db push          # or paste 0014_city_core.sql into the SQL editor

# 2. Turn the feature on for the server only
echo 'PORT_CITY_CORE=on' >> server/.env

# 3. Run the server and the app
npm run server
npm start -- --dev-client
```

Then, in a dev build, open **`/(dev)/city-lab`**:

- [ ] **Press `GET /city`.** A fresh profile migrates: 400 steel, 50 gems, Admiralty 1,
      Scrapyard 1, two workers. A veteran at Captain rank gets 150 back-paid gems.
- [ ] **Build the Fish Market** (150 steel, 1 minute). Watch the timer count down, wait,
      press `GET /city` and confirm it is level 1 — nothing client-side finished it.
- [ ] **Leave it ten minutes**, press `GET /city`, then `collect`: 12 coins/hour, so ~2 coins.
- [ ] **Press the idempotency button.** The same `requestId` twice: the log says `ok` both
      times and the wallet moves once.
- [ ] **Press any action eleven times inside ten seconds** → `rate-limited`, and the socket
      stays up. Start a match in another tab first to prove it does not drop you.
- [ ] **Move the device clock forward a day.** Timers may look odd for one frame; the next
      `GET /city` repairs them and **nothing is credited** — server time rules.
- [ ] **Airplane mode.** The cached city still renders; actions report `offline`.
- [ ] **Win an offline match against the AI** → `GET /city` shows the salvage in `scrapPile`
      (5 × cells of every ship you sank). Do it eleven times in a UTC day: the eleventh adds
      no salvage but still pays coins.
- [ ] **Turn the flag off** (`PORT_CITY_CORE=off`, restart the server). Every endpoint returns
      `feature-off` and `app/city.tsx` is exactly today's screen.

## 8. Assets

Part 1 needs **no art and no audio** — the only surface is a dev screen of buttons and a JSON
dump. The three sound effects specced for Part 2 (`inkComplete`, `coinCollect`,
`steelCollect`), with ElevenLabs prompts and settings, are in `part-02-plan.md` §9; nothing is
blocked on them.

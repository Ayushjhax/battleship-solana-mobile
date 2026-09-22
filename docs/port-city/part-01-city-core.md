# Part 1 — City core: economy, buildings, timers, salvage

**Depends on:** nothing · **Flag:** `portCity.core` · **Surface:** pure rules + server + a thin client data layer (no real UI yet — that is Part 2)
**Numbers:** every cost, time and rate is in `NUMBERS.md`. Do not invent any.
**Reference:** `reference/src/city.ts` with `reference/test/city.test.ts` (21 passing tests) is a working model of this part.

---

## 1. What the player gets

Coins finally do something. The Port City gets a real economy:

- **Steel**, a new resource, dropped by every enemy ship you sink.
- Buildings that cost steel and coins, take real time, and are built by **dock workers**.
- The **Admiralty**, whose level gates everything else, so there is always one big goal.
- Two collectors — the **Fish Market** (coins) and the **Foundry** (steel) — that fill up
  while you are away and give you something to tap when you come back.
- The **Scrapyard**, where the wrecks of the ships you sank pile up until you collect them.

## 2. Rules

### 2.1 Resources

| Rule | Detail |
| --- | --- |
| Coins | existing profile field, unchanged (+50 win, +10 loss) |
| Steel | new, starts at 0, granted 400 on migration |
| Gems | new counter behind the green gem already in the HUD, granted 50 on migration, plus back-pay for ranks already reached (§2.7) |
| Floor | no balance may ever go below zero; the rules module refuses the action instead of clamping |
| Cap | none in v1. What protects you from hoarding is the raid vault in Part 6 |

### 2.2 Salvage

- When a match that counts for rewards ends, each player earns **5 steel per cell of every
  enemy ship they sank**, times the Scrapyard bonus, rounded down. Sinking a battleship
  is 20, a whole fleet is 100.
- Ships you only damaged pay nothing. Sinking is the unit.
- Counted modes are exactly the modes that already pay rank points and coins: online
  (including bot matches), offline against the AI, and hot-seat for the device owner as
  Player 1. **The tutorial pays nothing.**
- A resign or a forfeit still pays for ships sunk before the end, on both sides.
- Salvage does **not** go to the wallet. It goes into `scrapPile`, and the player collects
  it in the city. The Result screen says so (Part 2).
- **Anti-farm:** salvage, contract progress and log ink from offline and hot-seat matches
  stop after `economy.offlineRewardCap` (default **10**) such matches per UTC day. Coins
  and rank points are untouched — they keep the behaviour they have today. Log the cap
  hit; if telemetry shows real players hitting it, raise it.

### 2.3 Buildings and dock workers

- A building is at level 0 (not built) or 1…max. Building it and upgrading it are the
  same action: `build(buildingId)` always means "go to the next level".
- Starting a job needs: the feature flag on, a free dock worker, `admiralty.level ≥
  reqAdmiralty` for the target level, and enough steel and coins. The cost is taken **at
  the start**.
- Two dock workers to begin with; a third and a fourth are bought with gems (`NUMBERS.md`).
- Jobs finish on their own at `endsAt`. There is no server cron: `settle(state, now)` on
  any read or write completes everything due, **in chronological order**, and accrues
  production around each completion.
- **Cancel** returns half the steel and half the coins (floored) and frees the worker.
- **Finish now** costs gems (`NUMBERS.md`); the last 60 seconds are free.
- A building under construction keeps working at its **old** level. Starting a job on a
  collector **collects it first**, so nothing is lost.

### 2.4 Collectors

- A collector holds `rate × capacityHours` and then stops.
- Accrual is integer and loses nothing: from `lastAccrualAt`, produce
  `floor(rate × elapsedHours)`, add up to the cap, and advance `lastAccrualAt` by exactly
  the time those whole units took — so settling every 30 seconds and settling once after
  five hours give the identical number. If it is full, `lastAccrualAt` jumps to now and
  the overflow time is simply lost.
- Collecting moves the pile into the wallet and sets `stored = 0`.

### 2.5 The Scrapyard

- Holds `scrapPile` steel with no cap. Collecting moves it to the wallet.
- Its level adds a salvage bonus (0 / 5 / 10 / 15 / 20 / 25%).
- An uncollected pile is **lootable** once Part 6 ships (half of it). That is the point:
  collect your salvage or a raider takes a cut.

### 2.6 The Admiralty

- Level 1 at migration. Its level gates every other building's next level.
- Completing a level grants gems: **L2 10, L3 15, L4 25, L5 40, L6 60, L7 90, L8 150**.
- It also sets the vault that protects resources from raids (`NUMBERS.md`, used in Part 6).

### 2.7 Migration for existing profiles

Idempotent, re-runnable, one transaction per user, triggered lazily on the first `GET /city`:

1. Create the city row: Admiralty 1, Scrapyard 1, everything else level 0, two workers.
2. Grant 400 steel and 50 gems.
3. Back-pay rank gems for ranks already reached: Seaman Apprentice 10, Petty Officer
   Second Class 20, Chief Ship Petty Officer 40, Captain 80, Vice-admiral 150 (cumulative).
4. Write one ledger row per grant with reason `migration:v1`.
5. Set `cityVersion = 1` so the migration never runs twice.

No past matches are back-paid for salvage.

## 3. Data model

```ts
type BuildingState = {
  level: number;                 // 0 = not built
  upgrading?: { toLevel: number; startedAt: number; endsAt: number };
  stored: number;                // collectors only
  lastAccrualAt: number;
};

type CityState = {
  version: number;               // optimistic concurrency
  cityVersion: number;           // migration marker
  workers: number;
  scrapPile: number;
  buildings: Record<BuildingId, BuildingState>;
  updatedAt: number;
  offlineRewardsToday: { day: string; count: number };
};
```

Storage: follow whatever the server already uses for profiles.

- `city` — one row per user: `user_id` (pk), `state` (json), `version` (int), `updated_at`.
  Client writes rejected by policy, exactly like rank points.
- Currencies live **with the profile** (`coins` exists; add `steel`, `gems`) so one
  transaction updates wallet and city together.
- `economy_ledger` — `id`, `user_id`, `at`, `reason` (`salvage`, `build`, `cancel`,
  `speedup`, `collect`, `migration:v1`, `raid_loot`, …), `ref` (match id, building id, raid
  id), `d_coins`, `d_steel`, `d_gems`. Append-only. Every currency change writes one row;
  a reconciliation test replays the ledger and must land on the current balances.
- `request_log` — `user_id`, `request_id`, `at`, `response` (json). Last 50 per user.

## 4. Server API

All authenticated as the current user, all responses `{ city: CitySnapshot, wallet, serverNow }`.

| Endpoint | Body | Notes |
| --- | --- | --- |
| `GET /city` | — | settles, migrates if needed |
| `POST /city/build` | `{ buildingId, requestId }` | starts the next level |
| `POST /city/speedup` | `{ buildingId, requestId }` | gems |
| `POST /city/cancel` | `{ buildingId, requestId }` | half back |
| `POST /city/collect` | `{ buildingId, requestId }` | one collector, or `scrapyard` for the pile |
| `POST /city/collect-all` | `{ requestId }` | every collector plus the pile, one ledger row each |
| `POST /city/workers/buy` | `{ requestId }` | gems |

Errors (HTTP 409 with a typed code): `feature-off`, `unknown-building`, `max-level`,
`already-upgrading`, `no-free-worker`, `needs-admiralty`, `not-enough-steel`,
`not-enough-coins`, `not-enough-gems`, `not-upgrading`, `nothing-to-collect`,
`rate-limited`, `version-conflict`.

Concurrency: read the row with its `version`, apply the pure rules, write with
`where version = :version` and retry once on conflict. Two `collect` calls racing must
credit exactly once — there is a test for it.

The **match settlement hook** (online settle, and the endpoint the app reports offline
results to) calls `creditSalvage` inside the same transaction that writes points and
coins. It must be told which enemy ships were sunk by each player. Use the server's event
log for online, and the reported result for offline — the same trust level as today.

## 5. Client data layer (no UI yet)

- `src/city/api.ts` — typed client for the endpoints, `requestId` per call, retries only
  on network errors (never on a 409).
- `src/city/store.ts` — snapshot, `serverOffset`, `loading`, `error`; selectors:
  `freeWorkers`, `canAfford(buildingId)`, `secondsLeft(buildingId)`, `collectable()`.
  It renders timers locally but never advances a balance on its own.
- Cached snapshot in the same local storage the profile uses, so the city opens instantly
  and works read-only when hard-offline mode is on.
- A **City lab** screen alongside the existing kitchen sink (dev builds only) with a
  button for every endpoint, a clock offset override, and a JSON dump. This is how you
  test Part 1 before Part 2 exists.

## 6. Edge cases

| Case | Behaviour |
| --- | --- |
| Device clock is wrong or moves backwards | Only `serverNow` is ever used for rules; the client clamps a negative remaining time to 0 |
| App killed mid-build | Nothing is stored client-side; `settle` on next read finishes the job |
| Two devices, same account | Optimistic `version` makes the loser retry; the snapshot in the response repairs the UI |
| `settle` called with a `now` before `updatedAt` | No-op, never negative production |
| A building is at max level | `max-level`, and the client hides the button |
| Feature flag off mid-session | Endpoints return `feature-off`; client falls back to the old static city |
| Player has 0 coins but plenty of steel | `not-enough-coins`; the panel says which one is short and by how much |

## 7. Telemetry

`city_opened`, `city_build_started {buildingId, toLevel, steel, coins, seconds}`,
`city_build_finished {buildingId, level, viaSpeedup}`, `city_speedup {gems, secondsSaved}`,
`city_cancel`, `city_collect {buildingId, amount, resource}`, `city_scrap_collected {amount}`,
`city_worker_bought {index, gems}`, `salvage_credited {matchId, amount, mode}`,
`offline_reward_cap_hit`, `city_error {code, buildingId}`.

## 8. Tests

### 8.1 Rules (port these from `reference/test/city.test.ts`)

Golden scenarios, all of which the reference already asserts:

1. Starting a build takes the cost up front and books a worker.
2. With two workers busy, a third build is refused with `no-free-worker`.
3. Two jobs finishing in the same `settle` complete in `endsAt` order.
4. Cancelling refunds exactly half, floored, and frees the worker.
5. `speedUpGems`: 60 s → 0, 1 h → 16, 4 h → 31, 24 h → 76, 72 h → 132, and the function
   is monotonic across four days sampled every 137 seconds.
6. A collector accrues `rate × hours` and stops dead at `rate × capacityHours`.
7. Settling every 30 s for five hours gives byte-identical state to settling once.
8. A collector that levels up mid-window produces at the old rate up to `endsAt` and the
   new rate after it (15 min at 12/h then 2 h at 18/h = 3 + 36 = 39).
9. `salvageFor` pays 5 per cell, applies the Scrapyard bonus, floors the result.
10. Salvage lands in the pile, not the wallet, and only `collectScrap` moves it.
11. A 2,000-step random walk over every action never produces a negative balance, a
    negative worker count, or a building above its max.

### 8.2 Server

12. Every endpoint: happy path and every typed error.
13. Same `requestId` twice → one effect, identical response both times.
14. Two concurrent `collect` calls → credited once (run them against a real DB).
15. User A cannot build, collect or speed up in user B's city.
16. Migration on a fresh profile, on a veteran profile (Captain rank → 150 back-paid
    gems), and run twice → identical result.
17. A settled match credits salvage exactly once, inside the same transaction as points
    and coins; a replayed settlement does not double-credit.
18. The 11th offline match of the day credits no salvage but still credits coins.
19. Ledger reconciliation: replaying every ledger row equals the stored balances.
20. Catalogue checksum test, in the style of the existing rank-ladder pin.

### 8.3 Manual QA checklist

- [ ] Fresh install → city migrates, 400 steel, 50 gems, Admiralty 1, Scrapyard 1.
- [ ] Build the Fish Market, watch the timer, confirm completion after 1 minute.
- [ ] Airplane mode: cached city opens, actions show the offline error, timers keep ticking.
- [ ] Start a 30-minute job, force-quit the app, reopen after it should have finished.
- [ ] Win an offline match → salvage appears in the pile with the right number.
- [ ] Move the device clock forward one day → nothing is credited (server time rules).

## 9. Acceptance criteria

1. A player can build and upgrade every building in the roster within the limits in
   `NUMBERS.md`, with the costs, times and gates exactly as generated.
2. No client call can change a balance except through these endpoints, and the database
   refuses a direct write carrying a user token.
3. Collectors never lose a fraction and never exceed capacity.
4. Salvage is credited exactly once per counted match, and never for the tutorial.
5. All of §8 passes; existing tests still pass; the flag off reproduces today's behaviour.

## 10. Out of scope for this part

The city screen (Part 2), cosmetics, contracts, raids, anything that spends gems other
than speed-ups and workers, buying resources with gems, IAP, push notifications.

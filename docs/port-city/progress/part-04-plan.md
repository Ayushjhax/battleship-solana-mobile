# Part 4 — Bounty Board and Captain's Log: implementation plan

**Status:** plan only.
**Read:** `part-04-bounties-log.md`, `00-OVERVIEW.md`, `progress/REPO-MAP.md`, and the Part 1
code as actually built (`src/engine/city/`, `supabase/migrations/0014_city_core.sql`,
`server/src/city/`).

---

## 0. Where the dependencies actually stand

Part 4 is "Depends on: Parts 1–2". The honest position, verified just now:

| | State |
| --- | --- |
| **Part 1 rules** (`src/engine/city/`) | **built, 67 tests green** |
| **Part 1 migration** (`0014_city_core.sql`) | **built, verified twice against PGlite**, all 28 existing DB checks pass |
| **Part 1 server** (features, repo, service, routes, salvage hook) | **built, typechecks, 138/138 server tests green** |
| Part 1 client data layer + City lab | not built |
| `part-01-report.md` | not written (Part 1 is not finished) |
| **Part 2** (the city screen) | **plan only** |
| Part 3 | plan only |

So the thing this part was told to extend — "the ledger and settlement hook" — **does now
exist**, and I have read it rather than assumed it. `economy_ledger`, `city_apply`,
`credit_salvage` and the `apply_match_result` salvage hook are real and tested.

What is **not** available is Part 2, which owns the Harbour Master's Office plot and the
sheet chrome. So this part splits cleanly:

- **Server half — buildable now** on what Part 1 built: catalogue, evaluator, issue/reset,
  season, auto-claim job, all six endpoints, all seven tests in §5.
- **UI half — blocked on Part 2**: the pinned paper notes, the ink-tick progress, the
  stamp-to-claim and the logbook all hang off a plot and a sheet that do not exist yet.

---

## 1. Three findings before any code

### Finding A — Part 1's daily cap will double-count, and this part is what exposes it

`part-04` §1: "Hot-seat and offline matches count toward contracts only under the **same**
daily cap as salvage." That word is load-bearing, and Part 1 as built cannot honour it.

`public.credit_salvage` (0014, §f) both **checks and increments** the counter:

```sql
if v_counter_count >= p_cap then return 0; end if;
v_state := jsonb_set(v_state, '{offlineRewardsToday}',
  jsonb_build_object('day', v_day, 'count', v_counter_count + 1));
```

If contract evaluation calls it too, one offline match burns **two** slots and the cap
becomes 5 matches, not 10. If contracts instead read the counter without incrementing,
ordering decides the answer.

**Fix, which belongs in this part:** split the cap out of `credit_salvage` into

```sql
public.claim_offline_reward_slot(p_user_id uuid, p_cap integer, p_now bigint)
  returns boolean   -- true = this match still counts today
```

called **once** per offline settlement; salvage, contract progress and log ink all key off
the single boolean. `credit_salvage` keeps its bonus maths and loses its counter. This is a
small, surgical change to a Part 1 function that has tests, so those tests move with it and
are listed in the report.

### Finding B — most metrics cannot advance offline, and the spec half-says so

§1 says `metric` is evaluated "from the match event log for online matches and **from the
reported result** for offline ones". A reported offline result is
`{ id, mode: 'ai'|'hotseat', won, completedAt }` — that is all `apply_offline_result`
receives, and all it can be trusted with, because the device computes it.

So of the 22 metrics in §1, offline play can honestly advance only the result-shaped ones:
*win N matches*, *beat the AI on Hard* (if difficulty is reported — it is **not** today),
and nothing else. "Sink 2 ships with one Atomic Bomber" cannot be verified from a boolean.

**What I will ship:** every contract carries `offlineEligible: boolean`, derived from its
metric, and offline settlement advances only those. Accepting richer offline reports would
mean trusting the client with contract progress, which §1's own last sentence forbids
("The client never reports progress"). Two consequences worth your ruling, both recorded in
DECISIONS rather than decided by me:

- *beat the AI on Hard* is **unshippable as an offline contract** unless the offline result
  grows a `difficulty` field — which is client-reported, i.e. forgeable. I will mark it
  `online: false, offlineEligible: false` and issue it only to players who can reach it
  through a matchmade bot game, or drop it. **Recommend: drop it from v1.**
- A player who only plays offline will see roughly a third of the daily board be
  un-advanceable. Mitigation: the issuer prefers `offlineEligible` contracts for a profile
  whose recent play is all offline. Cheap, and it is a nicety rather than a rule.

### Finding C — 500 gems for the premium track does not fit Part 1's gem supply

Counting every gem source Part 1 actually pays:

| Source | Gems |
| --- | --- |
| Migration grant | 50 |
| Rank back-pay (veteran at Vice-admiral) | up to 300 |
| All seven Admiralty levels (10+15+25+40+60+90+150) | 390 |
| **New profile, realistic first season** | **50 + a few Admiralty levels ≈ 100–150** |

Against that: the 3rd and 4th dock workers cost **350** (100 + 250), and premium is
**500**. A brand-new player cannot buy the premium track in season 1 from city income —
they would need most of a season of *hard* contracts (5–15 gems each) on top.

That may be exactly the intent (premium is meant to be a real decision, and IAP arrives
later). But it is not stated anywhere, and it interacts with Part 1's worker economy, which
competes for the same currency. Flagging rather than retuning: **no number in `NUMBERS.md`
or part-04 is changed without your say-so.** The pacing test in §5.7 covers ink, not gems,
so this would otherwise ship unnoticed.

---

## 2. The contract catalogue

`src/engine/bounties/catalogue.ts` — one exported table, checksummed and cross-file pinned
exactly like `CITY_CATALOGUE` (Part 1 pins 68 levels against `NUMBERS.md`; this pins the
reward tiers against `part-04` §1).

```ts
export interface ContractSpec {
  readonly id: string;
  readonly tier: 'easy' | 'medium' | 'hard';
  readonly title: string;            // "Sink three battleships"
  readonly metric: MetricId;
  readonly target: number;
  readonly scope: 'daily' | 'weekly';
  readonly requires?: 'raids' | 'cosmetics' | 'academy';   // checked at ISSUE time
  readonly offlineEligible: boolean; // Finding B
}
```

**36 contracts** across the 22 metrics — more than the 30 asked for, because several metrics
carry an easy/medium/hard ladder:

| Group | Metrics | Contracts |
| --- | --- | --- |
| Battle — outcome | win N, win N online, win with 4+ afloat, win without buying arsenal | 10 |
| Battle — weapons | torpedo kill, 2-with-one-atomic, N submarine kills, N AA shootdowns, 2 planes one gun, N mine stops, radar-then-hit | 12 |
| Battle — skill | sink N battleships, 5-hit run in one turn | 5 |
| City | collect N steel, finish N upgrades, reach Admiralty N, collect Scrapyard N times | 6 |
| Raids (`requires: 'raids'`) | N stars, N steel from raids, successful defence, 3★ a harbour | 3 |

Rewards come from the tier, not the row (§1): easy 150/200/60, medium 350/500/120,
hard 700/1,200/250 + 5–15 gems; weeklies ×4. Keeping rewards on the tier means a new
contract cannot accidentally be worth more than its difficulty.

## 3. The metric evaluator

`src/engine/bounties/metrics.ts` — **pure**, in the engine, so it is testable under Node and
the server is the only thing that ever calls it.

```ts
export interface MatchFacts {
  readonly playerId: string;
  readonly mode: 'online' | 'ai' | 'hotseat';
  readonly won: boolean;
  readonly events: readonly MatchEvent[];   // empty for offline
  readonly finalState?: MatchState;          // absent for offline
}
export function evaluate(facts: MatchFacts): ReadonlyMap<MetricId, number>;
```

This is the heart of the part. Every metric is a fold over the **event log the server
already keeps** — `Room.eventLog` (`server/src/room.ts:102`), which is appended on every
`reduce()` cycle and already persisted to `match_events`. Nothing new needs recording.

Worked examples of the harder ones, to show the log really does carry enough:

| Metric | How it is read |
| --- | --- |
| sink 2 ships with one Atomic Bomber | count `SUNK` events between an `ARSENAL_USED{kind:'atomicBomber'}` and the next `ARSENAL_USED`/`TURN_CHANGED` |
| down 2 planes with the same gun in one match | group `AIRCRAFT_DOWNED` by `gunAt` coordinate; max group ≥ 2 |
| N of your mines stop an enemy turn | `MINE_TRIGGERED` where `playerId !== me` (the actor is the attacker, the mine is the defender's) |
| radar then hit inside that 3×3 | `RADAR_RESULT{at}` followed by this player's next `HIT` whose coord is inside `atomicFootprint(at)` — the engine already exports that helper |
| 5-hit run in one turn | longest consecutive `HIT` run by this player between `TURN_CHANGED` events |
| win with 4+ ships afloat | `finalState`: own ships where `!isSunk(ship)` ≥ 4 |

`atomicFootprint` and `isSunk` are existing engine exports, so the evaluator reuses the real
rules rather than re-deriving geometry — the same discipline that keeps `salvage.ts` honest.

**City metrics** (collect N steel, finish N upgrades, reach Admiralty N, collect Scrapyard N
times) do not come from a match at all. They are fed by the Part 1 telemetry events that
already exist: `city_collect`, `city_build_finished`, `city_scrap_collected`. Those are
emitted inside `actOnCity`, in the same transaction as the write, so progress rides an
existing atomic path with no new hook.

## 4. Server, storage and the job

Three tables, in `0015_bounties_log.sql`, following 0014's shape exactly (RLS on, no
end-user grants, service-role-only functions):

```
contracts        user_id, slot, contract_id, progress, target, state, issued_at, expires_at
season           id, starts_at, ends_at, catalogue_version
season_progress  user_id, season_id, ink, premium, claimed_pages int[]
```

Issue/reset is **settle-on-read**, the pattern Part 1 already uses: `GET /bounties` computes
the current daily and weekly period from `serverNow` and reissues any slot whose
`expires_at` has passed. No cron for the boards.

- `dailyPeriod(now)` = `floor(now / 86_400_000)`; `weeklyPeriod(now)` anchored on Monday
  00:00 UTC. Both pure, both in the engine, both tested at the 23:59:59 / 00:00:00 boundary.
- Slots by Harbour Master's Office level: L1 → 3, L2 → 4, L3 → 5 (§1). The level comes from
  the Part 1 city row, which the same transaction already holds.
- Reroll: one free per UTC day, then 10 gems; the replacement is drawn from the same tier
  and excluded against the day's already-seen set (§1, §5.3).

**The auto-claim job** is the first cron this repo has ever had (`00-OVERVIEW.md` §5:
"Cron jobs exist only for seasons, wars and events"). Rooms are in-memory and single-instance
(`render.yaml` forbids a second), so a `setInterval` in `index.ts` is consistent with how the
process already works — but a process restart must not skip a season.

**Design:** `runSeasonAutoClaim(now)` is idempotent and keyed on `claimed_pages`, and is
called from **both** an hourly interval **and** lazily at the top of `GET /log`. Running it
twice is a no-op, which is exactly what §5.6 asks the test to prove. A missed interval is
therefore repaired by the next player read rather than lost.

Endpoints, all under `portCity.bounties`, all returning whole snapshots with `serverNow`,
all idempotent by `requestId` through Part 1's existing `city_request_log`:
`GET /bounties`, `POST /bounties/claim`, `POST /bounties/reroll`, `GET /log`,
`POST /log/claim`, `POST /log/premium`.

## 5. Tests (§5 in full)

| # | Test | Where |
| --- | --- | --- |
| 1 | every metric: a crafted event log advances exactly the right contracts, and a non-qualifying match advances none | `src/engine/bounties/__tests__/metrics.test.ts` |
| 2 | reset boundaries at 23:59:59 and 00:00:00 UTC, a player in UTC+13, and a backwards clock jump | `.../periods.test.ts` |
| 3 | reroll: one free per day, then gems; never returns the same contract twice in a day | `server/tests/integration/bounties.test.ts` |
| 4 | claim is idempotent; a double claim credits once | same |
| 5 | the 11th offline match advances no contracts and no ink but still pays coins | `server/tests/integration/city-db.test.ts` (extends Part 1's cap test) |
| 6 | season rollover archives progress, resets ink, and the auto-claim job pays every unclaimed page exactly once **when run twice** | `server/tests/integration/season.test.ts` |
| 7 | **pacing**: simulated active player finishes 30 pages between day 18 and 24; casual lands between page 10 and 18 | `src/engine/bounties/__tests__/pacing.test.ts` |

**Test 7 is the one that matters most**, because it is the only thing standing between a
reward tweak and a broken season. It is a deterministic simulation — no RNG — of the two
profiles §2 describes, driven through the same `inkFor()` the server uses:

```
active:  5 matches/day (3 wins), all dailies, most weeklies  -> ~895 ink/day -> 18,000 by day ~20
casual:  2 matches/day (1 win),  some dailies                -> ~295 ink/day -> ~page 13.8
```

I checked those against §2's own figures before writing this: 30 × 600 = 18,000, and 850/day
reaches it on day 21.2 — inside the 18–24 window, and the casual figure lands on page 14,
inside 10–18. **The spec's numbers are self-consistent**, which is worth saying because the
previous three parts each contained a number that was not.

## 6. Order of work

1. `catalogue.ts` + `metrics.ts` + `periods.ts` + `inkFor()` — pure, with tests 1, 2, 7.
2. **Finding A's refactor**: split the cap out of `credit_salvage`, move Part 1's cap tests.
3. `0015_bounties_log.sql`, verified through `verify-offline.mjs` and the PGlite harness.
4. Evaluator wired into `apply_match_result` and `apply_offline_result`, in-transaction.
5. Endpoints + tests 3, 4, 5, 6.
6. **UI once Part 2 exists**: the Harbour Master's Office plot, pinned notes, stamp, logbook.

## 7. Assets

No images. The pinned paper notes, ink ticks, stamps and the logbook are all drawn with the
existing stroke kit (`roughRect`, `roughPath`, `TitleRibbon`, `InkPanel`) — the same
procedural approach Part 2 uses for buildings.

**Two sounds**, both new keys on the closed `SFX_SOURCES` union (null = silent, so not a
blocker): `stampClaim` (a rubber stamp hitting paper — the payoff moment §1 calls out) and
`pageTurn` (the logbook). Prompts and ElevenLabs settings in §8 of the report when this part
is built; same shape as the three I specced in `part-02-plan.md` §9.

# Part 6 — Harbour raids (rules + server): report

**Scope built:** the pure raid rules, the harbour and kit, the search, the settlement, and
the tests. **No raid UI**, as instructed — the only client-visible surface is a set of
HTTP endpoints behind `portCity.raids`, which is **off by default**.

**Status:** green. `npm test` 692/692 (app) · `npm test` in `server/` 272/272 ·
`tsc --noEmit` clean in both (the 104 pre-existing errors in `docs/port-city/reference/`
are unchanged — DECISIONS D15).

**One flake to flag, honestly.** On one full-suite run the server took 81 s instead of the
usual 23 s and `src/__tests__/room.test.ts > both captains walk away > still forfeits the
absentee when only one of the two returns` timed out waiting for a socket message. It
passes in isolation and passed on every re-run. That test is wall-clock and socket-based,
and Part 6 adds **two more PGlite instances** to the suite (a full WASM Postgres each),
doubling the CPU pressure during the parallel phase. I have not touched the test — a
timeout is not an assertion, but shortening someone else's grace period to make room for my
own tests is not my call. If it recurs, the fix is to keep the socket suite off the same
worker as the PGlite ones rather than to loosen its timer.

---

## 1. The finding, and what it cost

The plan opened with it, so the report should close on it.

`part-06` §2 defines destruction as **"enemy ship cells hit ÷ 20"**, and
`reference/src/grid.ts` agrees (`FLEET_CELLS = 20`, four single-cell boats). **This game
has eighteen cells and two boats** (`src/engine/fleet.ts`: *"the classic ten-ship fleet
minus two of the four one-cell boats"*).

Hard-coding 20 would have capped destruction at 18/20 = 90%, which makes
`destruction >= 1` unsatisfiable and **the third star unreachable, permanently**. It would
not have thrown, logged or failed a type check; it would simply have meant nobody ever got
three stars, and the reason would have been one character in a denominator.

So:

```ts
// src/engine/raid/raid.ts
export const RAID_DESTRUCTION_DENOMINATOR = FLEET_CELL_COUNT;
```

imported, never inlined, with two tests that fail if it drifts — one pinning the constant,
one clearing an auto-placed fleet and asserting the score reaches exactly `1` and `3`
stars. This is the same class of bug the repo has already been bitten by (a stale hardcoded
fleet count of 10 that silently wiped every offline board), which is why it gets a
constant, a comment and two tests rather than a note.

The second consequence is that **`reference/out/raid.md` is calibrated against a different
game** and cannot be used as an acceptance target. §5 measures the difference instead.

---

## 2. What was built

### Rules — `src/engine/raid/` (pure, shared with the server)

| File | What it owns |
| --- | --- |
| `types.ts` | `RaidState`, `RaidConfig`, `RAID_DEFAULTS` (30 / 2 / 240 s), `RaidAction`, `RaidLogEntry`, `RAID_KIT_KINDS` |
| `raid.ts` | `startRaid` · `fireShell` · `useKit` · `retreat` · `abandonRaid` · `settleRaid` · `replayRaid` · `raidScore` |
| `view.ts` | `raidView()` — the masking function — and `raidFinalReveal()` |
| `harbour.ts` | `validateHarbour` · `validateKit` · `generateDefaultHarbour` · `generateCoveHarbour` · the fuel and cap tables |
| `scoring.ts` | `lootPool` · `lootEarned` · `allocateLoss` · `renownDelta` · `settleRenown` · `shieldHours` · `searchCost` · `renownWindow` · `covePool` |

Every cell resolution goes through the match engine's own `resolveCell` and the arsenal
resolvers, so interception, the decoy's silence and the halo reveal behave in a raid
exactly as they do in a match. What a raid changes is only the **currency**: shells instead
of turns.

The shell maths is one line, and it is the whole economy:

```ts
const shellDelta = outcome.mine ? -1 - state.config.minePenalty : outcome.hit ? 0 : -1;
```

A decoy returns `{ hit: true }` from `resolveCell`, so the shell comes back — which is
exactly right, and exactly what makes a decoy expensive: the raider spends their *next*
four shells on the cells around it.

### Server

| File | What it owns |
| --- | --- |
| `supabase/migrations/0016_harbour_raids.sql` | §9's six tables, the search query, `raid_open`, `settle_raid` |
| `server/src/raid/config.ts` | `raid.shells` and the operational limits, from the environment |
| `server/src/raid/repo.ts` | the data-access seam (the same shape as the city's) |
| `server/src/raid/session.ts` | live raids in memory — **the secrecy boundary** |
| `server/src/raid/service.ts` | search, open, settle, sweep |
| `server/src/raid/replay.ts` | §8's two replay modes |
| `server/src/raid/routes.ts` | seven endpoints, all gated on the flag |

---

## 3. The three hard rules, and where each one is kept

**The hidden layout never leaves the server.** Structurally, not carefully:

- `RaidView` has **no field that could hold a layout**. A leak needs someone to add one.
- `RaidSession` holds the layout in a **private class field** (`#layout`), so a stray
  `JSON.stringify(session)` cannot reach it.
- `raidFinalReveal()` is a separate function with `over` in its guard, returning `null`
  mid-raid, so calling it early is a visible mistake rather than a quiet leak.
- A **500-raid fuzz test** asserts, after *every single action*, that the serialised view
  contains no un-hit ship cell, no hidden item's cell, no unexposed decoy and no un-sunk
  ship's id. It has a **negative control** that proves the same coordinates *are* present
  in the raid state, so it cannot pass vacuously.
- The service-level tests repeat the assertion one layer up, where a future response field
  could reintroduce a leak the pure test would never see.
- `public.harbour` has RLS on, no policy and no grant: a client JWT cannot select it at
  all. There is a test that tries.

**Rank points and match rewards are untouched.** Nothing in `0016` or `server/src/raid/`
reads or writes `rank_points`, `battles_played` or `battles_won`. Two tests: one runtime
(a full settlement moves neither side's rank points), one **structural** — it reads the
migration file, strips the comments, and fails if any of those three column names appears.
A future edit cannot quietly break the rule without deleting a test that says why.

**Renown is a separate ladder that can fall.** It lives in its own table, `public.renown`,
with `value` and `best`. `settleRenown()` floors it at 0 and reports the **applied** delta,
not the notional one — a defender at 3 renown who "should" lose 20 loses 3, and the row
says `-3`. The attacker still gains their full amount: renown is a ladder, not a conserved
currency. A cove moves nothing at all.

**Below Admiralty 3, neither side.** `RAID_MIN_ADMIRALTY = 3`, enforced in three places:
`validateHarbour` refuses to save one, `searchTargets` refuses the caller, and
`raid_search` filters the candidates on the indexed city-JSON expression.

---

## 4. Decisions taken (DECISIONS.md D21–D24)

| | |
| --- | --- |
| **D21** | A defender who spends mid-raid: the drain is clamped to what is there, and **the house covers the gap** rather than shrinking the attacker's pay. The attacker cannot see the defender's collectors, so the alternative pays differently for invisible reasons. The raid row stores both figures separately. |
| **D22** | Pirate cove sizing: `coveLevelFor(renown) = clamp(3 + renown/300, 3, 8)` and `COVE_POOL_FRACTION = 0.6`. The 0.6 is load-bearing — using the full per-raid cap as "a normal pool" would make coves richer than people, and coves exist to fill a thin player base, not to replace it. |
| **D23** | Academy unlocks are read from the Naval Academy's **level**, because Part 5's research queue is still unbuilt. Strictly tighter than Part 5's current "no gate", strictly looser than the eventual queue, and one function to replace. |
| **D24** | `raid.shells` is configurable (`RAID_SHELLS`) and **the default is still 30**. The config is snapshotted into the raid at open and stored in `raid_log.config`, so a mid-raid change cannot affect a running raid and an old replay uses the budget that raid actually had. |

---

## 5. Measured star distribution

**Method:** `scripts/raid-calibration.ts`, a like-for-like rebuild of
`reference/sim/raid-calibration.ts` on `src/engine/raid`, driven by **this repo's**
masked-view AI (`src/engine/ai.ts`) through `projectView()`. Same five defence loadouts,
same four kits, same shell budgets, **1,500 raids per row**. Full output:
[`part-06-calibration.md`](./part-06-calibration.md).

### The comparison the plan promised — 30 shells, Normal raider, Armory 3 kit

| Defence | ref 3★ | **mine 3★** | Δ | ref dest. | **mine dest.** |
| --- | --- | --- | --- | --- | --- |
| none | 46% | **46%** | 0 | 94% | **94%** |
| CC1 basic (3 mines, 1 gun) | 30% | **33%** | +3 | 89% | **89%** |
| CC3 basic (5 mines, 2 guns) | 21% | **24%** | +3 | 85% | **85%** |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | 21% | **19%** | −2 | 84% | **83%** |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | 15% | **13%** | −2 | 78% | **75%** |

`part-06` §2's stated target is **"3★ 21%, 2★ 72%, 1★ 4%, 0★ 3% against a typical
harbour"**. Against CC3 basic this implementation measures **3★ 24%, 2★ 69%, 1★ 5%,
0★ 2%**; against CC3 researched, **3★ 19%, 2★ 72%, 1★ 5%, 0★ 3%**. The design's
intended shape holds. **No change to the 30-shell budget is warranted.**

### My §0 prediction was half right, and the half that was wrong is the interesting half

The plan predicted that an 18-cell fleet would make 30 shells produce a **higher** 3★ rate
than the reference. That is true for bare and lightly-defended harbours (+3 points) and
**false** for researched ones (−2 points). Two things explain it, and both are measurable
rather than argued:

**1. The cell count matters far less than the arithmetic suggests.** ÷18 versus ÷20 looks
like a 10% swing. It is not, because destruction is dominated by *misses*, not by ship
cells: clearing an undefended harbour takes ~56 shots of which ~38 are misses. Section A
puts the median at **56 shots here against the reference's 58** — a 3% difference, not
10%. Removing two one-cell boats removes two hits, but it also removes the two *hardest
targets to find*, and those effects very nearly cancel.

**2. This repo's decoy is better than the reference's.** Section D isolates each item's
worth against the bare fleet's 46% 3★ rate:

| Item | reference cost to the raider | **this implementation** |
| --- | --- | --- |
| +2 decoys | 0 points | **−4 points** |
| +3 decoys | 0 points | **−7 points** |
| +8 mines | −26 points | **−23 points** |
| +2 nets | +5 points | **+3 points** |

In the reference, decoys are worth *nothing* — 93%/45% against a bare 94%/45%. Here they
cost the raider real stars. That is Part 5's decoy doing its job: it serialises as a plain
hit and stays unexposed until all eight neighbours are marked, so the raider spends the
shells around it before learning anything. It is why "researched" harbours defend slightly
*better* here while "basic" ones defend slightly *worse*.

Every delta in the comparison table is ≤3 points. At n=1,500 and p≈0.2 the standard error
is ~1 point, so ±3 is real but small — and it is small in both directions, which is the
result that matters: **the calibration transfers.**

### Sonar nets still make a harbour easier to raid

Reference and implementation agree, and it is worth flagging because it is
counter-intuitive and it is a *design* observation, not a bug: a harbour with two sonar
nets is **easier** to clear than a bare one (95% destruction, 49% 3★, against 94%/46%). A
net occupies a legal cell that a mine could have used, eats one submarine, and then does
nothing. Against a raider who brings no submarine it is a free empty cell.

This is not something Part 6 should fix — nets defend against a specific weapon and that is
a legitimate rock-paper-scissors — but a player who buys nets blind will be worse off, so
the harbour UI (a later part) should say what a net is *for* rather than listing it beside
mines as though they were comparable.

---

## 6. Tests

| Suite | File | Count |
| --- | --- | --- |
| Rules (§11 shells / stars / ends / replay) | `src/engine/raid/__tests__/raid.test.ts` | 38 |
| Secrecy fuzz — 500 raids | `src/engine/raid/__tests__/secrecy.test.ts` | 4 |
| Loot / renown / shields / search | `src/engine/raid/__tests__/scoring.test.ts` | 30 |
| Harbour and kit | `src/engine/raid/__tests__/harbour.test.ts` | 27 |
| SQL, concurrency, settlement | `server/tests/integration/raid-db.test.ts` | 42 |
| Service end to end | `server/tests/integration/raid-api.test.ts` | 30 |
| Replay and its fallback | `server/tests/unit/raid.replay.test.ts` | 9 |
| `raid.shells` config | `server/tests/unit/raid.config.test.ts` | 10 |

**190 new tests**, all green. The secrecy fuzz is four tests but ~9,000 assertions: it
checks the serialised view after every action of 500 raids.

Every scenario §11 lists is covered. The ones worth naming:

- **Concurrency.** Two attackers cannot lock the same defender (`insert ... on conflict do
  nothing` after clearing the expired row — one atomic statement, not check-then-act). A
  defender editing their harbour mid-raid does not change the raid, because the layout is
  snapshotted into `raid_log` at **open**. A raid settling twice credits once, guarded by
  `ended_at is null` under a `for update` lock.
- **Disconnect settles.** 61 seconds of silence and the sweeper closes the raid with
  `end_reason = 'disconnect'` and whatever stars it had earned. Never "no result".
- **The search charges once on a retry.** The replay check is *inside* the transaction that
  takes the money — a crash between a successful charge and a separate "remember" would
  otherwise let the retry charge again.
- **Replay.** 25 different recorded raids re-run through the engine reproduce stars,
  destruction and marks exactly. A version mismatch returns `mode: 'as-recorded'` with the
  stored per-action results and `view: null`, without throwing.

### Bugs this found in my own code

1. **`validateFleetComposition` imported from the wrong module.** `harbour.ts` imported it
   from `../placement`; it lives in `../fleet`. It resolved to `undefined`, so
   `validateHarbour` threw on every call — and nothing noticed until the harbour tests were
   the first thing to call it. Fixed, and 12 tests now cover that path.
2. **Radar was silently dropped from the raid kit.** The kit was derived from
   `spec.placement === 'offensive'`, but radar is classified `'own board'` in
   `src/engine/arsenal.ts` (it is held, not placed) — while §4 names it explicitly. The kit
   is now the literal §4 list, `RAID_KIT_KINDS`, with a regression test.
3. **`registerCityRoutes` was imported but never called.** Pre-existing, from Part 1:
   `/city/*` was dead code in production while the service behind it was fully tested,
   because the Part 1 suite drives the service directly. Both route groups are now
   registered in `server/src/index.ts`.

---

## 7. What is deliberately not here

- **No raid UI.** Instructed. The endpoints exist so the rules can be driven end to end.
- **No client API module or store.** Same reason — those belong with the screen.
- **The Academy research queue** is still unbuilt (Part 5), so D23 stands in for it.
- **`raid_defender_snapshot` returns raw stores** and TypeScript classifies them against
  `CITY_CATALOGUE`. The SQL deliberately does not know that a Fish Market produces coins: a
  second copy of the catalogue in plpgsql is a second thing to keep in step.
- **`database.types.ts` still does not know the 0016 RPCs**, so `server/src/raid/repo.ts`
  carries the same narrow `LooseRpc` seam as the city's, marked for deletion once the types
  are regenerated. That regeneration is still one of the open decisions from Part 1.

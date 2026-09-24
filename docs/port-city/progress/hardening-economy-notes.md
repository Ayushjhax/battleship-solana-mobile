# Hardening sweep — economy ledger + pacing drift (2026-09-24)

Scope: Task A (ledger reconciliation over a simulated month) and Task B (reference-sim
pacing drift). New files only:

- `server/tests/hardening/economy-ledger.test.ts`
- this note

No product code and no existing test was modified — the sweep found no bug that required a
fix to make the deliverable pass. The two accounting gaps it found are reported below, not
patched.

---

## Commands

```bash
# Task A — the month sweep (PGlite, all migrations applied twice, ~10–30 s)
cd /Users/ayush/Desktop/Battleship/my-app/server
npx vitest run tests/hardening/economy-ledger.test.ts

# Task B — the three reference simulations
cd /Users/ayush/Desktop/Battleship/my-app/docs/port-city/reference
npm run sim:raid        # deterministic (seeded)
npm run sim:puzzle      # deterministic (seeded)
npm run sim:economy     # stochastic; ran 3x for variance

# NUMBERS.md is generated: prove it is in sync with the reference source
npx tsx sim/tables.ts > /tmp/NUMBERS.regen.md
diff -u ../NUMBERS.md /tmp/NUMBERS.regen.md     # -> 0 diff lines

# Season pacing / salvage probe (throwaway script outside the repo)
cd /Users/ayush/Desktop/Battleship/my-app
npx tsx /private/var/folders/pd/rdpzrlx54072q0319kcw49ch0000gn/T/opencode/hardening/pacing-probe.ts
```

Latest run: **5/5 tests passed** (`tests/hardening/economy-ledger.test.ts`, 18.8 s).

---

## Task A — reconciliation result

Five players, 28 simulated days (2026-01-05 12:00 UTC → 2026-02-02 12:00 UTC):

- A/B: a daily online match (alternating winner), 2 offline matches/day (11 on one day to hit
  the 10-cap), greedy city builds + `collect-all`, plus a guaranteed `cancel`, `speedup`,
  `buy-worker`, `migration:v1`.
- E: builds, never collects, is raided once (collector + scrap-pile drain).
- C/D: one-shot paths (fleet, war, donation, research, cosmetics, puzzle, season, voyage,
  contracts), each replayed once.

**23 distinct ledger reasons** were exercised, covering all **16 `insert into economy_ledger`
sites** in `supabase/migrations/`:

| Migration | Sites | Reasons |
| --- | --- | --- |
| 0014 | 2 | `build`, `cancel`, `speedup`, `collect`, `collect_scrap`, `worker`, `admiralty_gems`, `migration:v1`, `salvage` |
| 0015 | 1 | `salvage` (redefinition) |
| 0016 | 3 | `raid_search`, `raid_looted`, `raid_loot` |
| 0017 | 3 | `fleet_create`, `fleet_donation`, `war_reward` |
| 0018 | 1 | `research_start`, `research_rush` |
| 0019 | 3 | `contract_claim`, `season_claim`, `season_premium` |
| 0020 | 1 | `cosmetic_buy` |
| 0021 | 2 | `puzzle`, `voyage` |

0022 (world boss) and 0023 (empire) contain **no** profile/currency writes — nothing to exercise.

### Exact reconciliation (test stdout)

```
A wallet {coins 9052, steel 2595, gems 369} seed {2000, 5000, 300} ledger {+4242, -2405, +69}
  matchCoins 2810  pile 0 = 3800 credited - 3800 collected
B wallet {coins 5732, steel 2638, gems 205} seed {1000, 2000, 100} ledger {+3892, +638, +105}
  matchCoins 840   pile 0 = 587 credited - 587 collected
C wallet {coins 500,  steel 1400, gems 250} seed {1000, 1000, 50}  ledger {-500, +400, +200}
  strict: wallet == seed + ledger (no adjustment)
D wallet {coins 2070, steel 3880, gems 202} seed {3000, 3000, 1000} ledger {-930, +880, -798}
  strict: wallet == seed + ledger (no adjustment)
E wallet {coins 850,  steel 750,  gems 160} seed {1000, 1000, 100} ledger {-344, -510, +60}
  matchCoins 50  storeLoot {+144 coins, +260 steel}
  pile 0 = 20 credited - 0 collected - 20 looted (raid scrap)
```

- **Strict ledger == balance** (no adjustment at all) holds for C and D — the users whose whole
  month is ledgered.
- For A, B, E it holds once two explicitly-accounted quantities are added: match/offline coin
  payouts (no ledger row — finding 1) and the non-wallet half of `raid_looted` (finding 2).
- **Scrap pile** reconciles exactly for every user:
  `pile == salvage credited − collect_scrap − raid scrap taken`.
- **Idempotency**: every replay (settled match, offline id, `settle_raid`, `raid_open` with the
  same requestId, stale `city_apply`, stale `research_apply`, `fleet_create`, `donation_fill`,
  `settle_war`, `contract_claim`, `season_claim_pages`, `season_buy_premium`, `cosmetics_buy`,
  `puzzle_settle`, `voyage_collect`) left a byte-identical wallet/pile/ledger snapshot.
- **No double-writes**: every once-only row (`raid_search`/`raid_loot`/`raid_looted`,
  `war_reward`, `contract_claim`, `cosmetic_buy`, `voyage`, `puzzle`, `season_claim`,
  `season_premium`, `fleet_create`, `fleet_donation`) appears exactly once per ref.

---

## Task B — pacing drift

Reference sims re-run 2026-09-24. `raid` and `puzzle` are seeded and reproduced `out/*.md`
byte-for-byte; `economy` is stochastic (12 runs/profile) and was compared over 3 runs.

| Check | Source target | Measured | Drift |
| --- | --- | --- | --- |
| Raid, 30 shells, Armory 3, CC3 basic (5 mines, 2 guns) | part-06 §2: 0★ 3%, 1★ 4%, 2★ 72%, 3★ 21% | 3%, 4%, 72%, 21% | 0% |
| Raid, maxed CC6 researched, 30 shells | part-06 §2: 3★ 15% | 15% | 0% |
| Raid, CC3 basic at 40 shells | part-06 §2: 3★ 62% | 62% | 0% |
| Raid, CC3 basic at 24 shells | part-06 §2: 11% end with nothing (0★) | 11% | 0% |
| Defence-item worth (bare, +3 mines, +5, +8, +1 gun, +3 guns, 5m+2g+2d) | part-06 §2: 45, 32, 27, 19, 40, 33, 17 (%) | 45, 32, 27, 19, 40, 33, 17 (%) | 0% |
| Puzzle par, normal | part-09 §2: median 57, best quartile 52 | median 57, best 25% 52 | 0% |
| Salvage, Scrapyard 1/3/6 | NUMBERS.md: boat 5/5/6, destroyer 10/11/12, cruiser 15/16/18, battleship 20/22/25, fleet 100/110/125, avg loss 60/66/75 | identical | 0% |
| NUMBERS.md regenerated from reference source | `sim/tables.ts` | `diff` = 0 lines | 0% |
| Economy, hardcore A3 (baseline out 3.1) | — (no spec target; baseline = `out/economy.md`) | 3.0 / 3.2 / 2.9 | max −6.5% |
| Economy, active A7 (baseline 98.3) | — | 97.9 / 97.9 / 98.0 | max −0.4% |
| Economy, casual A3 (baseline 12.7) | — | 12.5 / 12.1 / 12.8 | max −4.7% |
| Economy, battles-only A6 (baseline 106.0) | — | 106.2 / 106.2 / 106.4 | max +0.4% |
| Season ink, active (part-04 §2, §5.7) | ~850 ink/day; all 30 pages day 18–24 | 827 ink/day; finishes day 22 | −2.7%; window ✓ |
| Season, casual (part-04 §2) | ~page 14; window page 10–18 | page 14 | 0%; window ✓ |

**Nothing drifts over 20%.** The only movements are economy-sim stochastic variance (≤ 6.5%
on the noisiest early level) and the season ink estimate (−2.7%, comfortably inside the
locked day-18–24 window).

Note: the season-ink figures come from the app's own season simulation
(`src/engine/bounties/season.ts`, locked by `tests/bounties/season.test.ts`); the three
reference sims do not model ink.

---

## Findings, by severity

1. **MEDIUM — match/offline coin payouts bypass `economy_ledger`.**
   `apply_match_result` and `apply_offline_result` update `profiles.coins` (and rank points)
   with no ledger row. Over the simulated month that is **3,700 unledgered coins** (A 2,810,
   B 840, E 50) against **0 ledger rows**. part-01 §3 says "Every currency change writes one
   row; a reconciliation test replays the ledger and must land on the current balances", and
   §8.2.19 asks for exactly that — but the shipped reconciliation in
   `server/tests/integration/city-db.test.ts` only checks **steel**, so it never noticed.
   The hardening test pins the exact gap (it fails if the gap grows, and also if the gap is
   fixed without updating the test). Options: (a) a new migration that adds
   `match_reward`/`offline_reward` rows inside both functions, or (b) a DECISIONS entry
   documenting the exemption. Not fixed here: it changes the most critical settlement
   function while other agents are editing, and the right answer is a design call.

2. **LOW / semantic — `raid_looted` records the full loot, not the wallet loss.**
   E's `raid_looted` row is `-344 coins / -510 steel`, while E's wallet actually moved
   `-100 coins / -50 steel`; the difference (**144 coins + 260 steel**) is the collector
   stores and scrap pile, which were never wallet currency. A strict wallet-only replay
   therefore over-counts the defender's loss by exactly the non-wallet part. If the ledger is
   an *economy* ledger this is by design (the defender's whole loss is recorded, and D21 has
   the house cover the attacker's gap); if it is meant to be a *wallet* ledger, it drifts.
   The hardening test makes the adjustment explicit so the number cannot hide.

3. **No other gaps.** All other ledger-writing paths write exactly one row per movement and
   credit exactly once on replay. Salvage rows are zero-delta by design (the steel lands in
   the pile, not the wallet) and the pile reconciles separately and exactly.
   `research_apply` with a zero delta (`research_done`) writes no row by design — no currency
   moves — which the sweep confirmed in code and in the ledger.

---

## Not feasible / limits

- A day-by-day month for **all five** players was impractical; A/B/E ran the 28-day loop and
  C/D covered the one-shot paths. Coverage of every ledger-writing path is *proved* by the
  `distinct reason` assertion, not assumed.
- Wagers (`point_ledger` / `point_accounts`) are a separate currency system and are outside
  `economy_ledger`; not exercised.
- World boss (0022) and empire (0023) store state only and pay no profile currency in the
  current server code; there was nothing to exercise.
- The month's raids settle with synthetic (empty) action/result logs — the raid *rules* are
  covered by `server/tests/integration/raid-db.test.ts`; this sweep is about the ledger.
- The economy sim uses `Math.random`, so its figures are reported as variance against the
  saved baseline, not as a fixed target.

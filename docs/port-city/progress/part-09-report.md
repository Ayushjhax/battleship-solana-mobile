# Part 9 — The Port Gazette, the daily puzzle and trade voyages: report

**Flags:** `portCity.gazette`, `portCity.voyages`. Both default off.

**Status:** automated tests green — `npm test` **1266/1266** (app, +101) · `npm test` in
`server/` **406/406** (+101) · `tsc --noEmit` clean in both · `npx eslint .` clean.
Migration 0021 applies twice against real Postgres.

**Read §1 and §6 first.** §1 is the par measurement the plan promised, and it changes what
"beating par" means. §6 is the information-boundary problem I found while writing the
emoji-grid test, and it is a design question I did not answer unilaterally.

---

## 1. Par 52, measured

The plan (§0.1) flagged that §2's par comes from `reference/out/puzzle.md`, whose closing
line is *"The fleet holds **20 cells**"* — the reference's ten-ship fleet. This game ships
**8 ships / 18 cells**. I committed to measuring rather than assuming, and
`scripts/puzzle-calibration.ts` is the mirror of the reference's simulation on this repo's
own AI and this repo's own board.

**2,000 boards per difficulty, 0 failures:**

| difficulty | best 10% | best 25% | median | worst 25% | worst 10% | mean |
| --- | --- | --- | --- | --- | --- | --- |
| easy | 48 | 53 | 58 | 64 | 68 | 58.1 |
| **normal** | **45** | **50** | **56** | 62 | 67 | 56.0 |
| hard | 45 | 50 | 56 | 62 | 67 | 56.0 |

Beside the reference's (20-cell) figures for a competent solver:

| | reference (20 cells) | this game (18 cells) | delta |
| --- | --- | --- | --- |
| best 10% | 47 | **45** | −2 |
| best 25% (**par**) | 52 | **50** | −2 |
| median | 57 | **56** | −1 |

**The finding, plainly: par 52 is about two shots loose here.** On this fleet the best
quartile is 50, so 52 sits at roughly the **32nd percentile** rather than the 25th:

| difficulty | beat par 52 | Admiral's round (< 46) |
| --- | --- | --- |
| easy | 20.4% | 5.7% |
| normal | **32.4%** | **11.5%** |
| hard | 32.4% | 11.5% |

So "beating par" means "a good solve" rather than "an average one" — §2's intent survives —
but it is a bit more generous than the best quartile it claims to be. The Admiral's round
at under 46 is almost exactly right: 11.5% against an intended 10%.

**What shipped.** Par is **52**, as instructed. It is `PUZZLE_PAR` in
`src/engine/puzzle/puzzle.ts`, never inlined, and server-configurable as `puzzle.par`
(`server/src/daily/config.ts`), so tightening it to 50 is an environment variable rather
than a client release. I did not change it.

The deltas are smaller than the two-cell difference suggests, and the reason is the same
one Part 6 found: **misses dominate.** A median solve here is 56 shots = 18 hits + 38
search. The reference's is 57 = 20 hits + 37 search. Removing two one-cell boats removes
two guaranteed hits but *adds* about a shot of search, because the smallest ships are the
most expensive per cell to find.

### A second finding, unrelated to Part 9

**`normal` and `hard` are the same AI on this board.** Not approximately — byte-identical
across all 2,000 boards. `src/engine/ai.ts` line 63 gives `hard` two extra exclusions:
cells around a *sunk* ship, and the diagonals of an un-sunk *hit*. On a no-arsenal board
both are dead:

- the engine's no-touch auto-reveal already resolves a sunk ship's halo, so those cells are
  gone from `unknown` before the exclusion runs;
- the diagonal rule only applies while `hits` is non-empty, and while `hits` is non-empty
  the AI is targeting orthogonally rather than hunting, so it never consults `excluded`.

This is pre-existing behaviour in Part 3's AI, not something Part 9 introduced, and it
affects the offline "Hard" opponent too — a player choosing Hard over Normal in a classic
match is getting the same opponent. I have not changed it: it is Part 3's rule and
tightening an AI is a balance decision. Flagged here because the calibration is what made
it visible.

---

## 2. What was built

### The Gazette (§1)

| | |
| --- | --- |
| `src/engine/gazette/templates.ts` | **45 templates**, each `{id, score, text, trigger, slots}`. §1's six worked examples at §1's exact scores (90 / 85 / 80 / 75 / 70 / 0). |
| `src/engine/gazette/edition.ts` | `buildEdition()` — every trigger, sorted by score, top one is the headline, the next **two or three** are sub-stories (§1). Total sort order, so the edition is reproducible. |
| `src/engine/gazette/facts.ts` | `summariseDay()` — raw records → `DaySummary`. **Reuses Part 4's event readers**, see §3. |
| `public.gazette` + `gazette_get_or_create` | `on conflict do nothing` then read, so two simultaneous opens get the same paper. |
| `app/gazette.tsx` | Masthead, dateline, joke price, headline, two columns, Captain's corner, weather box, back page. |

Templates are **one localisable string with named slots**, never concatenation (§1).
`render()` is a single substitution over one string; a test greps the source file for a
concatenated fragment, because the type system cannot express that rule.

### The daily puzzle (§2)

| | |
| --- | --- |
| `src/engine/puzzle/puzzle.ts` | `seedForDate` → `autoPlaceFleet`, so no-touch holds by construction. `fire()` goes through the match engine's own `resolveCell`. |
| `src/engine/puzzle/share.ts` | `emojiGrid` — exactly 10×10, 🟥/🟦/⬜. |
| `public.puzzle` (one row per **day**, not per player) | The layout column. RLS on, no policy, no grant. |
| `public.puzzle_run` (per player per day) | Every shot is `where finished_at is null`. |
| `app/puzzle.tsx` | `GridBoard` at 10×10 with `cells` + `onCellPress`. No new board component. |

### Trade voyages (§3)

| | |
| --- | --- |
| `src/engine/voyages/routes.ts` | §3's four routes verbatim. `rollReward()` is called **once, at send**. |
| `src/engine/voyages/skirmish.ts` | The 5×5: its own geometry, `placeSkirmish`, `shoot`, `pirateMove`, `replaySkirmish`. |
| `public.voyage` / `public.skirmish` | `voyage_collect` claims before it pays; `voyage_ledger_once_idx` is an independent backstop. |
| `app/voyages.tsx`, `app/skirmish.tsx` | Three berths; the skirmish plays locally and submits its log. |

**§4's seven endpoints**, all registered (`server/src/index.ts`): `GET /gazette`,
`GET /puzzle`, `POST /puzzle/fire`, `GET /puzzle/leaderboard`, `POST /voyage/send`,
`POST /voyage/collect`, `POST /voyage/skirmish` — plus two §4 does not name but the
screens need: `POST /gazette/read` (the read receipt) and `GET /voyage` (the berths).

---

## 3. Reuse, and the one place I changed a shared component

The instruction across this package has been *reuse, do not fork: if a component needs a
prop to serve both, add the prop.*

**`GridBoard` now takes `grid`, defaulting to 10.** §3's skirmish is 5×5 and
`src/board/layout.ts`'s `GRID` is a module constant. Rather than write a second board
renderer, the size is a prop — and the 10×10 path is **byte-identical**:

- every derived value falls back to the module constants when `grid === GRID`;
- the three static styles (`sheetMask`, `watermarkClip`, `watermark`) keep their
  `StyleSheet.create` objects and are only overridden when `grid !== GRID`, so the battle
  board — the hottest render in the game — allocates nothing new;
- `pointToCell` still bounds-checks against 10×10, so the smaller board rejects the cells
  past its own edge itself.

`tests/board` and `tests/ui` (75 tests) stay green unchanged.

**Part 4's event readers are now exported rather than copied.** The Gazette's
`gun-triple`, `atomic-multi` and `run-of-hits` templates need the same readings Part 4's
contracts do. `longestHitRun` and `bestAtomicRun` are now exported from
`src/engine/bounties/metrics.ts`, and `sameGunDoubles` was refactored into an exported
`bestSameGunDowns(): number` with `sameGunDoubles` becoming `>= 2` over it — the Gazette
needs the count for its sentence, and a second copy of that loop would be a second thing
to forget when the event vocabulary next moves. Part 4's 71 tests pass unchanged.

Also reused: `featureClient` transport, `InkPanel`/`Paper`/`Scale`/`TitleRibbon`/
`InkButton`, `CellMark`, the engine's `resolveCell` / `autoPlaceFleet` / `createRng`, and
`expo-clipboard` (already a dependency).

---

## 4. Tests — §5, all seven

| § | File | Tests |
| --- | --- | --- |
| 5.1, 5.3, 5.4 | `tests/puzzle/puzzle.test.ts` | 40 |
| 5.2 | `server/tests/integration/puzzle-db.test.ts` | 30 |
| 5.5 | `tests/gazette/gazette.test.ts` | 28 |
| 5.6 | `server/tests/integration/voyage-db.test.ts` | 32 |
| 5.7 | `tests/voyages/skirmish.test.ts` | 33 |
| all three, service level | `server/tests/integration/daily-api.test.ts` | 39 |

### The two the instruction named

**"the 10,000-board legality test for the 5×5 skirmish."** `placeSkirmish` generated
**10,000 of 10,000** legal boards — zero failures. Worst case cost 1,344 rng draws, about
5 whole-board restarts against a budget of 200, so the margin is large. Seven cells plus
their halos on twenty-five squares is tight enough that this was a real question; it is
now a measured answer. The test also asserts `isLegalLayout` rejects a touching board, an
off-edge board, a short board and a wrong-length board, so a vacuously-true checker fails
the build.

**"a skirmish log which does not replay is rejected and pays half."** Both directions, in
two files:

- an **honest** log is `ok: true` and pays full + 25% on a win, half on a loss;
- a **forged** log (claiming a win it did not earn) is rejected and pays `payout(reward,
  'unverified')` = **half**;
- truncated, repeated-cell, illegal-cell and wrong-seed logs are each rejected with their
  own reason.

The honest case matters as much as the forged one. If the replay drifted, *every honest
player* would silently get half cargo and nothing would fail — so the suite fails on a
false rejection too. The log fixture deliberately plays a row-major scan rather than
perfect play, because perfect play never passes the turn and the recomputed pirate
sequence — the half of the replay that actually secures the voyage — would go untested.
A separate test asserts the fixture really does hand the pirate turns, so it cannot
regress into that.

### The secrecy assertions

§5.1's "the layout never appears in any response" is checked at three levels:

1. **Structural** — `PuzzleView` has no `ships` and no `layout` field; a test pins its
   exact key set. The client's `PuzzleViewSchema` is `.strict()`, so a server that ever
   sent one would fail the parse rather than hand the solver the answer.
2. **Fuzz** — a full solve and a 200-day sweep serialise the view after every shot and
   grep for an un-hit ship cell and for every ship id.
3. **SQL** — an end-user JWT cannot `select` from `public.puzzle` or `public.puzzle_run`
   at all (RLS on, no policy, no grant), proven by an expected rejection.

---

## 5. Exactly-once, twice over

Both money paths use the two independent mechanisms Parts 6 and 8 established.

| | The claim | The backstop |
| --- | --- | --- |
| **puzzle** | `puzzle_settle` sets `streak` `where finished_at is not null and streak = 0` | a second call matches zero rows and returns `paid: false` |
| **voyage** | `voyage_collect` sets `state='collected', settled_at=now() where state <> 'collected' and settled_at is null`, before any wallet write | `voyage_ledger_once_idx` — unique on `economy_ledger(ref) where reason='voyage'` |

Tested: three consecutive collects pay once and write one ledger row; a hand-written
second ledger insert is rejected by the index even with the claim bypassed; `skirmish_expire`
run twice returns 1 then 0.

---

## 6. ⚠ The emoji grid is the day's layout (D32)

**This is the thing to read before shipping the puzzle.**

Found while writing §5.4's "the grid matches the marks" test. Three facts from §2 combine
badly:

1. every player gets the **same board** on a given UTC day;
2. a finished grid marks 🟥 on **exactly the 18 ship cells**, positionally, in a
   copy-pasteable block;
3. the leaderboard is **ranked by shots**.

So the first player to finish and share hands the day's complete layout to everyone who
has not played. They can then solve in **18 shots**, against an Admiral's round of 46 and a
measured median of 56. It is the dominant strategy the moment one grid is posted, and it is
the opposite of §2's own claim that server authority *"makes the leaderboard trustworthy"* —
the server is authoritative about **resolutions**, which does nothing about a player who
already knows where to aim.

This is not Wordle-shaped. Wordle's grid encodes *relative* feedback and cannot be inverted
into the answer; a battleship grid **is** the answer.

**What I did.** Shipped §2's format unchanged — it is an explicit instruction with a worked
example and a legend, and the alternative is a share nobody would post. Then:

- pinned it as a named, passing test in `tests/puzzle/puzzle.test.ts` that reconstructs the
  layout from the grid and asserts they are equal, so it cannot be rediscovered by surprise;
- `puzzle_run` records **`hits`** alongside `shots`, so the signal any policy would need
  already exists without a later migration (18 hits in 18 shots is not reachable without
  the layout);
- applied **no** policy. Excluding, flagging or shadow-ranking those runs is a product
  decision about punishing players, and it is not mine to make.

Options and my recommendation are in `DECISIONS.md` D32. Short version: rank by shots
*then* by submission time, plus the `hits` signal — it keeps §2's format, costs a friend
posting their grid at lunch nothing, and stops handing the top of the table to whoever
reads it.

---

## 7. Two other judgement calls

### The image share does not ship (plan §0.2)

§1: *"exports the edition as an image **if the repo already has a view-shot dependency**;
otherwise the button is hidden. **Never add a dependency for this.**" `package.json` has no
`react-native-view-shot` and no `captureRef`, so the button does not exist — not a disabled
one, no code path. The puzzle's emoji-grid share **does** ship, because it is text and
`expo-clipboard@~57.0.2` is already a dependency, which §2 says is enough.

### `revealed` is ⬜, not 🟦

§2's legend is about what the **solver did**: *"⬜ never fired"*. A halo cell opened by the
no-touch rule was never fired at, so it is blank. Painting halos blue would both overstate
the shot count and trace a one-cell outline around every sunk hull. My first test asserted
the opposite and was wrong; the code was right.

### The skirmish seed is sent to the client, deliberately

§3 says the skirmish *"runs on the client for speed"*, so the client must be able to build
the same 5×5 board — which it does from the seed. **The security is the replay, not
secrecy.** The seed is still null until the ship is home, because knowing *which* voyage
will be attacked beforehand is what would actually matter. The migration comment on
`public.skirmish` says this explicitly, because I first wrote it as "SERVER ONLY" and that
was overstated.

---

## 8. What is not wired, and why

The Gazette's day summary reads real data for raids, defences, contracts, donations,
voyages, the puzzle and the global feed. **Six fields read as honest nulls** because
nothing in the schema records them:

| Field | Why | Templates affected |
| --- | --- | --- |
| `difficulty`, `shipsAfloat` | `public.matches` (0002) stores neither: offline difficulty is not persisted, and ships-afloat is a property of the final state, not the row | `beat-hard`, `untouched-win`, `near-untouched` |
| `rankedUp`, `admiraltyUp`, `buildingFinished`, `researchFinished` | these are **events**, and nothing records "this happened today" | `rank-up` (§1's top-scoring template), `admiralty-up`, `building-done`, `research-done` |
| `logPage`, `inkEarned` | same | `log-page`, `ink` |

`summariseDay` treats them exactly as a day on which they did not happen, and the quiet-day
template means the paper is never empty because of them. The templates and their tests all
exist and pass; what is missing is columns.

Adding them is a migration on the **match settlement path**, which is Part 2's territory —
`apply_match_result` would need to write a small per-day facts row. I did not widen that
path from Part 9. It is the single highest-value follow-up here, because `rank-up` is §1's
90-point headline and it currently cannot fire.

Carried from before, still blocked:

- **`database.types.ts`** — needs `supabase db push` of 0010–0021 first (D31). The live
  project is at ~0009; regenerating now would *remove* `point_wallet` and break
  `src/net/points.ts`. The `LooseRpc` seams in `server/src/daily/repo.ts` and `summary.ts`
  are marked for deletion after that push.
- **Manual QA** — §5's manual list (solve and share the grid; send three voyages and let one
  be attacked; read a Gazette after a big raid) needs a device/APK. Not done, not claimed.
  I have **no** device-test log for this part and am not writing one.

---

## 9. Files

```
src/engine/puzzle/      puzzle.ts  share.ts  index.ts
src/engine/gazette/     templates.ts  edition.ts  facts.ts  index.ts
src/engine/voyages/     skirmish.ts  routes.ts  index.ts
src/daily/api.ts        the typed client, .strict() schemas
app/                    gazette.tsx  puzzle.tsx  voyages.tsx  skirmish.tsx
server/src/daily/       config.ts  repo.ts  service.ts  routes.ts  summary.ts
supabase/migrations/    0021_gazette_puzzle_voyages.sql
scripts/                puzzle-calibration.ts
tests/                  puzzle/  gazette/  voyages/
server/tests/integration/  puzzle-db  voyage-db  daily-api
```

Changed, not added: `src/board/GridBoard.tsx` (the `grid` prop),
`src/engine/bounties/metrics.ts` (three readers exported), `app/city.tsx` (two plot
routes), `server/src/index.ts` (`registerDailyRoutes`).

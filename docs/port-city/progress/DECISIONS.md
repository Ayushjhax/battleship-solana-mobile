# Decisions

Numbers and rules that the design package did not settle, recorded as they were made.
Each entry says what was missing, what was chosen, and why.

---

## Part 1 — city core

### D1 — `city.version` starts at 1

`part-01` §3 names `version` for optimistic concurrency but not its initial value. A new city
row is created at `version = 1`, and every successful write increments it. `0` is reserved for
"no row", so a client holding `version: 0` always loses the compare-and-set.

### D2 — cancel refunds are floored, not rounded up

`part-01` §2.3 says cancel "returns half the steel and half the coins (floored)".
`reference/src/city.ts:415` agrees (`Math.floor(spec.steel / 2)`), but
`reference/test/city.test.ts:82` asserts `Math.ceil(...)`. Both pass today only because the
one value the test exercises (Admiralty L2, 300 steel) is even.

**Chosen: floor**, per the prose and the reference's own implementation. The ported test uses
an odd-cost building so the distinction is actually covered.

### D3 — telemetry has no backend, so it gets a typed sink

`part-01` §7 names eleven events. The repo has **no telemetry system at all** — no analytics
dependency, no event bus, nothing (verified by grep across `src`, `app`, `server/src`).

**Chosen:** a typed `emitCity(event)` with the exact event names and payloads from §7, writing
to pino on the server and to `console` under `__DEV__` on the client. The call sites and the
shapes are real; only the transport is a stub, so pointing it at a real sink later is a
one-file change. Inventing a vendor integration was out of scope for this part.

### D4 — the feature flag is an env var plus `GET /config`

No flag mechanism exists anywhere in the repo. `00-OVERVIEW.md` §5 assumes twelve
server-driven flags; building that system is not Part 1's job, but Part 1 cannot ship without
the first one.

**Chosen:** `PORT_CITY_CORE` (and siblings) read from the server environment, default **off**,
surfaced at `GET /config` as `{ features: { 'portCity.core': false, … }, serverNow }`, cached
client-side. Shaped so the remaining eleven flags join it without a redesign.

### D5 — city action rate limit: 10 per 10 s per user

From `00-OVERVIEW.md` §5. Implemented as an in-memory per-user window on the HTTP routes,
returning the typed `rate-limited`. It deliberately does **not** reuse the socket limiter in
`server/src/ws.ts`, which closes the connection after 10 messages/second — city traffic must
never be able to drop a player out of a live match.

### D6 — `request_log` keeps the newest 50 per user

`part-01` §3 says "Last 50 per user" without saying who trims. Trimming happens inside
`city_apply`, in the same transaction as the write, so the table cannot grow unbounded between
calls.

### D7 — the offline cap day is a UTC server date

`part-01` §2.2 says "per UTC day" but the counter lives in `CityState.offlineRewardsToday`.
The day string is computed server-side as `to_char(now() at time zone 'utc', 'YYYY-MM-DD')`.
The device clock is never consulted — a player moving their clock forward gets nothing, which
is also the §8.3 manual QA case.

### D8 — bot matches count as online for salvage

`part-01` §2.2 defines counted modes as "exactly the modes that already pay rank points and
coins: online (including bot matches), offline against the AI, and hot-seat…". Bot matches
already pay through `apply_match_result`, so they credit salvage on the online path and are
**not** subject to the offline daily cap.

### D9 — the reference's `npm test` does not run its own tests

Not a rule, but it cost time and will cost the next person time.
`docs/port-city/reference/` has no `vitest.config.ts`, so `npm test` there walks up, finds
`my-app/vitest.config.ts`, applies that config's `include` globs, and reports
**"No test files found"** while exiting 0. The suite is real — 80 tests, all passing — but it
has to be run with an explicit config pointed at that directory.

This also corrects `progress/REPO-MAP.md` §7 gap 9, which claimed the reference had 84 tests
and that the README's count was stale. The README was right; my `grep -c` was wrong.

---

## Part 3 — cosmetics (decided early, applied when Part 3 is built)

### D10 — sink effects are capped at 420 ms, not 600 ms

`part-03` §3 permits 600 ms and simultaneously requires that sink effects "must not delay the
turn flip". In this codebase those conflict: `EventPlayer` is strictly serial, and
`TURN_CHANGED` (which awaits `TURN_FLIP_MS`) is dequeued *after* the `SUNK` branch's existing
`await player.wait(420)` in `src/fx/battleEffects.ts:152-164`. Any effect over 420 ms adds
latency to every sink in every match.

**Chosen (ratified by the user):** cap the catalogue at **420 ms**, assert the awaited total in
the `SUNK` branch is identical whichever effect is equipped, and correct
`part-03-cosmetics.md` §3. The 600 ms allowance is not implemented.

### D11 — Gold ink is withheld from light papers pending a ruling

> **CLOSED (2026-09-24) — the bidirectional remap was adopted.**
> Every ink now carries an `onLight` variant as well as an `onDark` one, and
> `inkOn(ink, paper)` in `src/engine/cosmetics/contrast.ts` picks whichever
> clears the 3:1 floor. Gold renders as a dark bronze (`#6E5510`) on the five
> light papers and keeps its bright form on Blueprint.
>
> **Why (a) and not (b):** acceptance criterion §7.2 requires legibility "in
> every combination we sell", and a 350-gem ink legible on one paper of six is
> a purchase the player cannot see going wrong. It also extends a rule §3
> already establishes — the remap existed, it simply pointed one way.
> `tests/cosmetics/cosmetics.test.ts` sweeps all 48 pairs and separately pins
> that gold's RAW colour still fails, so the remap is provably doing work.
> The original reasoning is kept below.

Measured WCAG contrast over all 48 ink × paper pairs: 13 fail the 3:1 floor. Seven are
dark-ink-on-Blueprint, which §3's remap handles. The other six are **Gold** (the 350-gem
premium ink), which scores 1.95–2.51 on all five light papers and passes only on Blueprint —
§3's remap is one-directional and does not reach it.

A bidirectional remap (`onDark` **and** `onLight` variants per ink) was proposed and **not
adopted**. Since acceptance criterion §7.2 requires the board to stay legible "in every
combination we sell", Gold therefore cannot be sold as a general-purpose ink under the current
rule. **Open** — to be resolved when Part 3 is built, by either adopting the bidirectional
remap or darkening Gold's base.

### D12 — Ghost fleet ships own-board only, pending a ruling

> **CLOSED (2026-09-24) — the scoping was adopted, and there was no conflict.**
> `opponentHullVisible(ship)` returns true only for a **sunk** ship. A sunk
> ship's cells are already marked `'sunk'` and the whole hull is already drawn
> as a wreck, so a drifting wreck reveals nothing — the wreck IS the reveal.
> §1's table ("Hull set — seen by the opponent? yes, same rule as ink") is
> satisfied exactly and no information boundary moves.
>
> What does not ship: any hull cosmetic on an un-sunk enemy ship. There is no
> flag for it and no code path to it. The original reasoning is kept below.

Ghost fleet's "slow drift" (`part-03` §2) would reveal a ship's presence if rendered on an
enemy cell the rules have not made public. Scoping opponent hull cosmetics to the
`wrecksOf(...)` path was proposed and **not adopted**.

The user's own hard rule for Part 3 is to stop rather than ship a cosmetic that moves an
information boundary, so **Ghost fleet renders on your own board only** until the scoping
question is settled. No opponent-visible hull cosmetic ships in the meantime. **Open.**

---

## Part 1 — findings from implementation

### D13 — the reference's accrual clock loses production; replaced

**This is a real defect in `reference/src/city.ts`, found by a test written to
look for it** (the risk was flagged as risk 4 in `part-01-plan.md`).

The reference advances the accrual anchor by `Math.ceil(add * 3_600_000 / rate)`
(`reference/src/city.ts:313`). That is exact only when the rate divides an hour
evenly. Its own tests only ever exercise **12/h** (Fish Market L1) and **18/h**
(L2), both of which do, so the bug is invisible there.

At **26/h** (Fish Market L3) it is visible immediately:

| | stored after 5 h |
| --- | --- |
| settle once | 130 |
| settle every 30 s (600 calls) | **129** |

That breaks part-01 §2.4 ("settling every 30 seconds and settling once after
five hours give the identical number") and acceptance criterion §9.3
("Collectors never lose a fraction").

**Chosen:** carry the remainder instead of rounding the anchor. `BuildingState`
gains a `carry` field holding production earned but not yet worth a whole unit,
in units of (unit × milliseconds-per-hour):

```
total    = carry + rate * elapsedMs
produced = floor(total / 3_600_000)
carry'   = total - produced * 3_600_000
```

`rate * elapsedMs` splits additively over any chopping of the interval and the
carry accumulates exactly, so accrual is path-independent by construction, at
every rate, in integer arithmetic. When a collector fills, the carry is dropped
— §2.4 says the overflow time is lost on purpose.

`carry` is an addition to the `CityState` shape published in part-01 §3. The
doc should gain the field; the alternative was to keep a demonstrably lossy
clock.

### D14 — one eslint override added for engine sub-module tests

`part-01-plan.md` asserted that a `src/engine/city/` subdirectory needed no lint
change. That was wrong for files **two** levels down.

`eslint.config.js` had two engine-purity overrides: `src/engine/**/*.ts` banning
`../*`, and `src/engine/*/**/*.ts` banning `../../*`. A test at
`src/engine/city/__tests__/` importing `../../ranks` resolves to
`src/engine/ranks` — engine-internal and legal — but matches the banned text
`../../*` and was rejected.

**Chosen:** a third override for `src/engine/*/*/**/*.ts` banning `../../../*`,
which is the depth at which a relative import actually leaves the engine from
that directory. The rule's stated intent ("src/engine may not import from
outside src/engine") is unchanged, and this was verified by probe: a file at
`src/engine/city/__tests__/` importing `../../../ui/tokens` is still rejected.

### D15 — `npm run typecheck` was already failing before this part

Not caused by Part 1, but it blocks the Definition of Done item that says tsc
must be clean, so it needs recording.

`tsc --noEmit` reports **104 errors on the clean committed tree** (verified by
stashing all Part 1 work and re-running). Every one is in
`docs/port-city/reference/` — the reference implementation, which is written
against its own looser `tsconfig.json` but is swept into the root typecheck
because the root `tsconfig.json` includes `**/*.ts` and excludes only
`node_modules`, `server`, `android`, `ios` and three config files.

Part 1 adds **zero** new errors. The fix is one line — add
`"docs/port-city/reference"` to the root tsconfig's `exclude` — but that is a
change to shipped config outside this part's scope, so it is left for the user
to approve rather than slipped in. Until then, "typecheck clean" has to be read
as "no errors outside `docs/port-city/reference/`".

### D16 — a replayed requestId must return the byte-identical body

Found by test. `actOnCity` stored its response before `city_apply` returned the new version,
then returned a body with the version patched in — so the stored replay and the original call
differed, which part-01 §8.2.13 ("identical response both times") forbids.

`city_apply` always sets `version = version + 1`, so the next version is deterministic.
It is now computed before the write and stamped on the body once, so the stored response and
the returned one are the same object.

### D17 — `apply_offline_result` returns integer, not boolean

It now reports how much salvage landed: `-1` for an id that was already applied, `0` when the
daily cap is spent, otherwise the credited amount. The previous boolean had no reader
(`server/src/db.ts` checked only `error`), so nothing depended on it.

### D18 — test hazard: static imports hoist above a localStorage stub

Not a product decision, but it will cost the next person an hour.

A store that uses zustand `persist` over the expo-sqlite `localStorage` shim captures the
storage object when the module first evaluates. Under vitest, a static
`import { useCity } from '@/city/store'` is hoisted **above** the
`Object.defineProperty(globalThis, 'localStorage', …)` that the test installs, so persist
captures `undefined`, silently stops writing, and every cache assertion fails for an unrelated
reason.

`tests/city/store.test.ts` therefore loads the store with a dynamic `await import(...)` in
`beforeAll`. `src/state/__tests__/profile.test.ts` has the same hazard but never asserts
persistence, so it has never surfaced there.

### D19 — the Scrapyard shows 2 + level wrecks

part-02 §6 says the Scrapyard draws "the wrecks of your last battles ... up to
the level's display slots" without saying how many slots a level has.

**Chosen: `2 + scrapyardLevel`** — three at L1 rising to eight at L6, so the
yard visibly fills up as it is upgraded without ever crowding a 120x80 plot.
Enforced in both places that trim the list: `scrapDisplaySlots()` in
`src/engine/city/actions.ts` and the `v_slots` calculation in
`public.credit_salvage` (0015), which a DB test pins.

### D20 — `apply_match_result` returns jsonb, not boolean

Part 2 left the Result screen's salvage line unshipped because the server
credited salvage without telling anyone how much, so the client had no
server-sourced number and could only have guessed.

**Chosen:** `apply_match_result` now returns
`{settled, salvage_a, salvage_b}` (0015). The room puts the credited amount
into the `over` frame as an optional `salvage: { steel }`, and the Result
screen renders it. A return-type change needs a drop-and-recreate, and it
moved five existing assertions in `supabase/verify-offline.mjs` plus two in
`server/tests/integration/city-db.test.ts` from `=== true` to
`.settled === true` — all strengthened rather than weakened, since they now
also assert the credited amounts.

**Offline and hot-seat still show no salvage line.** An offline result is
reported to the server asynchronously, long after the Result screen has opened,
so there is no server number to show at that moment. Showing a client estimate
would break "the server is the only source of numbers". The line simply does
not appear for those modes.

---

## Part 6 — Harbour raids

### D21 — When a defender spends mid-raid, the house covers the gap

The loot pool is computed from the defender at raid START (§7.2), but the raid
takes four minutes, in which the defender can collect their Fish Market and
spend the coins. At settle time the drain is clamped to what is actually there,
so the defender can never be driven negative — that part is not in question.

The open question is what the ATTACKER gets. Two candidates:

1. shrink the attacker's pay to what was actually taken, or
2. pay the attacker what the raid earned, and let the house absorb the gap.

**Chosen: (2).** The attacker cannot see the defender's collectors, so under
(1) an identical raid pays differently for reasons the player has no way to
observe or influence — which reads as a bug, and invites "the game stole my
loot" reports that are impossible to answer. It is also the same shape as the
star bonus, which §7.2 already has the house paying. The defender still loses
only what they have, and the raid row records both figures separately
(`loot_coins/loot_steel` = paid to the attacker, `taken_coins/taken_steel` =
removed from the defender), so the gap is visible in the data rather than
hidden in an average.

### D22 — Pirate cove sizing: `coveLevelFor` and `COVE_POOL_FRACTION = 0.6`

§5 gives coves "70% of a normal pool" and nothing else — not which Admiralty
band a cove imitates, and not what "a normal pool" is worth.

**Chosen:** `coveLevelFor(renown) = clamp(3 + floor(renown / 300), 3, 8)`, and
"a normal pool" = **60%** of that band's per-raid `LOOT_CAP`.

The 0.6 is the load-bearing number. `LOOT_CAP` is the most a raid can EVER
take, which a real defender almost never has sitting out; treating it as
typical would make coves richer than people, and nobody would raid a person
again — which is the one thing coves must not do, since they exist to fill the
gaps in a thin player base, not to replace it. 0.6 x 0.7 = 42% of the cap at
full destruction: always available, never the best thing available.

Both live in `src/engine/raid/scoring.ts`, pure and unit-tested, not in SQL.

### D23 — Academy unlocks are read from the Naval Academy's level, for now

> **CLOSED (2026-09-24).** The research queue is built:
> `src/engine/city/research.ts`, migration `0018_research.sql`,
> `server/src/city/research.ts` and `/city/research*`. `unlocks` is a real
> per-item list on the `city` row, served in the city snapshot, and the three
> places that used the stand-in now read it. The real rule is **strictly
> tighter**: a level-3 Academy with nothing researched unlocks nothing, where
> the stand-in unlocked all three. The original reasoning is kept below.

Part 5 shipped the three Academy items but not the research queue
(part-05-report, "The Academy research queue"), so there is no per-item unlock
store for Part 6 to read — and `validateHarbour`/`validateKit` both need one.

**Chosen:** a BUILT Naval Academy (level >= 1) unlocks all three; level 0
unlocks none. It is one function, `unlocksFor()` in
`server/src/raid/routes.ts`, marked for replacement. This is strictly tighter
than Part 5's current behaviour (which passes `unlocks: undefined`, meaning no
gate at all) and strictly looser than the eventual queue. When the queue lands,
that function reads it and nothing else changes.

### D24 — `raid.shells` is configurable but the default is untouched

The instruction for this part was explicit: do not change the 30-shell budget,
but make it server-configurable. `RAID_SHELLS` (and `RAID_MINE_PENALTY`,
`RAID_TIME_LIMIT_MS`) are read in `server/src/raid/config.ts` and fall back to
the engine defaults on anything unparseable, so a typo cannot hand every raider
zero shells. The config is SNAPSHOTTED into the raid at open and stored in
`raid_log.config`, so changing it mid-raid cannot change a raid already
running, and a replay of an old raid uses the budget that raid actually had.

---

## Part 8 — Fleets, donations, wars, visits and the Flag Hall

### D25 — The war chest's scale

§4 says "a war chest (steel and coins scaled by war size and stars, plus 10
gems each); the loser gets a third", and NUMBERS.md gives none of the figures.

**Chosen** (`src/engine/fleets/war.ts`): a per-size base — 5v5 1,500 steel /
500 coins, 10v10 3,500 / 1,200, 15v15 6,000 / 2,000 — plus 60 steel and 20
coins per star the side earned, split between the members who showed up.

They are deliberately modest next to a raid's loot. A war is a weekly event
with a 22-hour prep and a 24-hour battle day; if winning one out-earned a week
of raiding, raiding would become the thing you do while waiting for a war, and
Part 6 is the feature that gives the game a reason to open at 3 a.m.

**A draw pays both sides the loser's share, and no gems.** §4 does not mention
draws. Paying nothing for a 22-hour commitment reads as a bug, and paying both
sides the winner's share makes a draw the best outcome available.

### D26 — `src/engine/fleets/` (plural) next to `src/engine/fleet.ts` (singular)

`fleet.ts` is the eight SHIPS (`FLEET_SPEC`, `FLEET_SHIP_COUNT = 8`). Part 8's
"fleet" is the 30-captain social unit. Same word, different things, one
character apart.

**Chosen:** keep the domain word, add loud cross-referencing headers to both
files, and a test that pins that `@engine/fleets` exports nothing about ships.

Renaming the social unit in code (`squadron`, `armada`) was the alternative and
would make the collision impossible — but the design doc, the SQL tables
(`fleet_member`, `fleet_request`) and the endpoints (`/fleet/*`) all say
*fleet*, so a code-only synonym means translating at every boundary forever.
The mitigating fact: the two modules share no export name, so a wrong import is
a type error, not a silent wrong answer. This repo's earlier fleet-count bug
was a hardcoded `10`, which is a different failure mode — a number that
compiles.

### D27 — The country list ships with the app, not from the server

There was no country list in the repo at all; `profile.countryCode` defaulted
to `'IN'` and nothing ever set it. Part 8 adds `src/data/countries.ts` with 199
ISO 3166-1 alpha-2 entries.

**Chosen: a static file, bundled.** The picker must work offline (the profile
is editable offline), the list changes about once a decade, and a served list
would mean the Flag Hall's denominator could change under a player who is
halfway through filling the wall.

**Sorted by a diacritic-stripped key, not by `<`.** 'Türkiye' > 'Tuvalu' in
code-point order, so a naive sort files it after Tuvalu — where a player
scanning for it between Tunisia and Turkmenistan will never look, and will
conclude it is missing. `sortKey()` strips combining marks; the letter index
uses the same key, so Türkiye is under T and there is no 'Ü' in the index.


---

## Backlog closed on 2026-09-24

### D28 — `city_load` needed a DROP before its RETURN TYPE could widen

Migration 0018 adds `unlocks` to `city_load`'s `returns table`. Postgres
refuses that with `create or replace` (`42P13: cannot change return type of
existing function`), which the migration suite caught immediately because it
applies every file **twice**.

The second pass is the interesting half: pass 2 re-runs 0014, whose
`create or replace city_load` then collides with 0018's wider version. So
**both** files now carry `drop function if exists public.city_load(uuid,
bigint)` before their create. Each is self-healing whatever ran before it, and
a linear run ends on 0018's definition either way.

This is the same hazard DECISIONS D20 hit with `apply_match_result`, and the
same one `supabase/README.md` warns about for views. Worth stating as a rule:
**a migration that widens a function's return type must drop it first, and so
must every earlier migration that defines it.**

### D29 — Reinforcement capacity is read from the Fleet Hall, and pinned to it

`REINFORCEMENT_CAPACITY` in `src/engine/fleets/donations.ts` is `[0, 20, 30,
40, 50, 60]`, which is also `CITY_CATALOGUE.fleet_hall.levels[].value`. Two
tables that must agree.

Rather than have the fleets module import the catalogue (an engine
cross-dependency for one lookup), the table is duplicated and a **test pins
them together** (`tests/fleets/donations.test.ts`, "is the SAME number the city
catalogue holds"). A catalogue edit that did not reach the fleets module fails
the build rather than silently changing a cap nobody was looking at.


### D30 — Marks needed the remap too, and `revealed` got a lower floor

Part 3's contrast sweep found two things the original survey missed, because
it only checked the DEFAULT paper:

1. **The mine mark (green, 2.82:1) and the revealed mark fail on TINTED light
   papers** — Parchment and Old sea chart are several shades below graph
   paper's near-white. Fixed the same way the inks were: a third palette
   (`MARK_COLOURS_DEEP`) used when the base does not clear that mark's floor.

2. **`revealed` cannot clear 3:1 without changing how the base game looks.**
   It is `inkFaint`, the deliberately subordinate hatch on a known-empty cell,
   and darkening it would make it compete with the hits. So it has its own
   floor of **2:1**, written into `MARK_FLOORS` and tested — an exception
   stated rather than silently allowed.

**And a metric correction.** `marksDistinguishable` first used contrast ratio,
which said the game's miss (violet) and hit (red) were indistinguishable at
1.14:1. Contrast ratio is a LUMINANCE measure and answers "readable against a
background"; the right question for foreground-vs-foreground is colour
DISTANCE, which puts the closest pair at 105. The real guarantee is anyway the
glyph — a dot, an X, a filled cell, a hatch, a ring — which is what keeps the
board readable for a colour-blind player, and `MARK_GLYPHS` now says so.


### D31 — Do NOT regenerate `database.types.ts` yet: the live DB is ten migrations behind

Probed the linked project (read-only, via the REST schema endpoints) on
2026-09-24:

| Table | Migration | Live |
| --- | --- | --- |
| `matches` | 0002 | ✅ 200 |
| `privy_accounts` | 0009 | ✅ 200 |
| `point_wallet` | 0010 | ❌ 404 |
| `city` | 0014 | ❌ 404 |
| `harbour`, `raid` | 0016 | ❌ 404 |
| `fleet` | 0017 | ❌ 404 |
| `contracts`, `season` | 0019 | ❌ 404 |

**The deployed schema is at roughly 0009.** Everything from the points wallet
(0010) onward — which predates this whole design package — is undeployed.

So regenerating is not merely blocked; it would be **actively harmful**.
`supabase gen types --linked` would emit a file describing a 2024-era schema:
it would not add the Port City tables the `LooseRpc` seams are waiting for, and
it would *remove* `point_wallet` and friends, breaking `src/net/points.ts`
against its own types.

**The real prerequisite is `supabase db push`** (0010–0019), which is a
production write against the user's project. Not something to do unilaterally,
so it is not done. The four `LooseRpc` seams stay, each already marked for
deletion, and this entry is the note that says what actually unblocks them.

Two smaller blockers found alongside: no `supabase` CLI is installed and Docker
is not running, so neither `--linked` nor a local `supabase start` would work
in this environment even after a push.


### D32 — The puzzle's emoji grid IS the day's layout, and everyone shares a board

Found while writing §5.4's "the grid matches the marks" test (Part 9).

§2 specifies the share format with a worked example and a legend: 🟥 hit,
🟦 miss, ⬜ never fired. That is implemented exactly as written. But the three
facts around it combine badly:

1. **Everyone plays the same board** on a given UTC day (§2, first bullet).
2. **A finished grid marks 🟥 on exactly the 18 ship cells** — positionally,
   in a copy-pasteable block.
3. **The leaderboard is ranked by shots** (§2, last bullet).

So the first player to finish and share hands the day's complete layout to
everyone who has not played yet, and they can then solve in **18 shots** —
against an Admiral's round of 46, and a measured median far above that. It is
the dominant strategy the moment one grid is posted, and it is the opposite of
§2's own claim that server authority "makes the leaderboard trustworthy": the
server is authoritative about *resolutions*, which does nothing about a player
who already knows where to aim.

This is not a Wordle-shaped share. Wordle's grid encodes *relative* feedback
and cannot be inverted into the answer; a battleship grid is the answer.

**What I did.** Shipped §2's format unchanged — it is an explicit instruction
with a worked example, and the alternative is a share nobody would post. Then:

- Pinned the fact in `tests/puzzle/puzzle.test.ts` as a named, passing test
  ("⚠ a COMPLETED grid is the day's layout, in shareable form") that
  reconstructs the layout from the grid and asserts they are equal, so this
  cannot be rediscovered by surprise.
- The server records `hits` alongside `shots` on `puzzle_run`, so the signal a
  policy would need already exists without a later migration. A solve at or
  near 18 hits in 18 shots is not reachable without the layout.
- Applied **no** policy. Excluding, flagging or shadow-ranking those runs is a
  product decision about punishing players, and it is not mine to make.

**The options, for whoever decides:**

| | Cost |
| --- | --- |
| Accept it | Leaderboard is a race to the first shared grid |
| Rank by shots *then* by submission time, with a per-day cutoff | Partial: still beatable, but the sharer wins |
| Suppress the grid until the day rolls over | Kills the marketing value §2 is buying |
| Drop 🟥/🟦 for a non-positional summary (counts, a sparkline) | Departs from §2's worked example |
| Rank only the first N minutes after a player's first open | Complex, and punishes slow players |

My recommendation is the second plus the `hits` signal: cheap, keeps §2's
format, and makes the common case (a friend posts their grid at lunch) cost
the sharer nothing while no longer handing the top of the table to whoever
reads it.

---

## Part 10 decisions — 2026-09-24 (implemented; see progress/part-10-report.md)

### D33 — Captain ids are code names, and the fuel comes from the roster

`part-10 §10A` names the captains in prose and prices them (45/25/15/30/0/20)
but gives no engine identifiers. **Chosen:** `berhan`, `mara`, `ivo`, `tomas`,
`rosa`, `oldCaptain` — stable, lower-case, in the style of `ArsenalKind`. The
fuel is exactly the roster's, single-sourced in `src/engine/captains.ts`; a
test pins the six ids against the union and the six prices against the doc.

### D34 — Mara's reinforced mounts are PER GUN

The roster says *"each of your AA guns survives its first hit"*. The generic
engine rule says an ability fires at most once. For Mara the roster wins: each
gun's first hit fires the ability once (tracked as `damaged` on the item, one
`CAPTAIN_ABILITY` event per survival), and the gun's second hit destroys it.
Implemented by leaving the cell UNMARKED on the first hit — a mark means
"resolved and never shootable again", which would make the second hit
unreachable and turn the ability into a second copy of the item's own rule.

### D35 — Rosa's +25 % is floored and applied to the base

`part-10` does not say how +25 % rounds or how it stacks with the Scrapyard
bonus. **Chosen:** floor, on the *base* (`salvageBases`), before the SQL
Scrapyard bonus compounds on top — the same discipline D2 and `credit_salvage`
already use. A boat is 5 → 6, not 7; a full 18-cell fleet is 90 → 112.
Her whole ability is that line of arithmetic; the engine's differential test
proves she changes nothing else.

### D36 — The Lighthouse unlocks one sea per level

`part-10 §10B` says the Lighthouse unlocks seas "for non-ranked play and your
own harbour" and fixes no per-level table. **Chosen:** L1 Archipelago, L2 Coral
Reef, L3 Fogbank, L4 The Strait; Open Sea is always available and Classic is
always Open Sea. One sea per level matches how every other catalogue building
uses its value column. Ranked never consults the level — the season sea is the
integrity rule.

### D37 — The season sea rotates for eight seasons, and `SEASON_SEA` overrides it

The rotation is `open, archipelago, open, coral, open, fogbank, open, strait` —
Open Sea at every even position, so "at least every other season" is structural
rather than arithmetic (a test walks 200 consecutive seasons). Season number is
the 28-day period from the Unix epoch (`floor(now / 28d) + 1`), matching the
Captain's Log season length; when seasons become a moving DB row, `seasonSeaFor`
takes that id unchanged. `SEASON_SEA` pins a sea for ops and anything
unparseable falls back to the rotation rather than crashing ranked. Ranked
snapshots the chosen sea into the room; Classic forces water regardless.

### D38 — An island neighbour counts as resolved for decoy exposure

Part 5 exposes a decoy when all eight in-grid neighbours are marked. An island
can never be fired on, so a decoy legally placed beside one could never expose —
which is a bug, not a rule. **Chosen:** `exposeDecoys` counts an island
neighbour as resolved, because an island is public knowledge: nothing can be
there. Every other Part 5 rule (the two-cell placement rule, the silence of a
decoy hit) is untouched.

---

## Part 11 decisions — 2026-09-24

### D39 — Living-world decoration has no game-state input

Night is local `19:00 <= hour || hour < 06:00`, with Auto/Day/Night persisted on the
device. Season windows come from public server config and weather is a deterministic
0–2 five-minute daily schedule. All three produce a `LivingWorldState` consumed only
by pointer-inert render layers. The engine exposes an identity-typed
`gameplayUnaffected` boundary and a differential test pins it. The one existing
`city-port.png` remains the only scene asset.

### D40 — The Armada is 40 ships and its writer serializes per event

The brief says "about 40". Chosen: exactly 40, lengths `6x1, 5x3, 4x6, 3x10,
2x20`; the unique six-cell ship is `flagship`. Wave 1 has eight mines and each later
wave adds two, capped at thirty. The service uses one promise tail per event and the
database schema mirrors the invariant with an event-row lock design plus unique cell,
request and reward keys. A duplicate-cell loser is returned as `refunded` and is not
charged. The concurrency suite races 2 and 100 simultaneous calls.

### D41 — Empire is exactly five ports in each of four regions

There are exactly 20 catalogue entries. Kraken ends region 1, Ghost Fleet region 2,
and Pirate King region 4; region 3 ends in a conventional fortress, preserving the
brief's explicit total of three special bosses. Tribute accrues for at most 24 hours.
The campaign module has no ranked, renown or arsenal-catalogue import; a structural
test pins those words out of the catalogue payload.

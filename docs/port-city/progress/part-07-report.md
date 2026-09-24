# Part 7 — Harbour raids: the client. Report

**Scope built:** the four screens of §1–§5, the scripted first raid of §7, and §8's tests
in full. Behind `portCity.raids`, **off by default**.

**Status:** automated tests green — `npm test` **843/843** (app, +151) · `npm test` in
`server/` **272/272** · `tsc --noEmit` clean in both · `npx eslint .` clean across the
repo. **The manual device QA in §8 has not been run** (no device in this session); the
script for it is written out there.

Also in this session: the three bugs from the Part 6 report were already fixed in place,
and the one open item — the `room.test.ts` flake — is fixed too (§7 below).

---

## 1. Reuse: what I added a prop to, and what I did not touch

The instruction was "reuse, do not fork: if a component needs a prop to serve both, add the
prop". Here is the whole ledger.

### The defence editor **is** `app/(game)/placement.tsx`

No new screen, no copied drag logic. Four additions, all in the **store**, so the screen
reads them exactly as it already reads `fuelBudget`:

| Addition | Why |
| --- | --- |
| `PlacementMode` gains `'harbour'` | the screen already branches on `mode` |
| `allowedKinds` | §2.2 — the shop filters itself, because `ShopPanel` already reads the store |
| `kindCaps` | Coastal Command's caps are **not** `specFor(kind).max`: a harbour at CC6 holds 8 mines where a match allows 5 |
| `fuelLabel` | §2.1 — "Harbour fuel 74 / 90" instead of "Fuel 74 / 260" |

`buyArsenal()` gained **one guard** in front of the existing `purchaseArsenalItem()` —
not a second purchase path. Shuffle, Reset, drag, rotate, the halo rules, the
unsaved-changes guard and `sellPlacedArsenal()` are untouched, and
`src/state/__tests__/placement.test.ts` is green without a single edit, which is the
regression net for "I did not break the match".

The harbour's own concerns — budget, save, read-only, error copy — live in **one hook**,
`useHarbourEditor`, rather than inline: `placement.tsx` already carries four concerns in
1,654 lines and a fifth would have been the one too many.

### The raid board **is** `GridBoard`

`DualBoards` draws two boards; a raid has one. `DualBoards` is itself a wrapper over
`GridBoard`, so the raid screen uses that — the same component, one layer down. Also
reused unchanged: `ShopPanel` (the kit step), `Paper`, `Scale`, `InkButton`, `InkPanel`,
`InkSpinner`, `SpeechBubble`, `TitleRibbon`. "Larger than in a match" is one number,
`RAID_BOARD_SCALE = 1.16`, not a second geometry.

### The city entry point

`HomeHarbour` was not modified at all. Its existing `onPress` now goes through one
callback that checks the flag: **on** → `/harbour`, **off** → today's `focusHarbour()`,
with the plate still showing the battle record. That is the §8 QA case, and it is one
conditional.

### What I added to an existing file rather than duplicating

`src/city/api.ts`'s transport (requestId, retry-on-network-only, 12 s timeout) is now
`src/net/featureClient.ts`, generic over the error code so the city keeps `feature-off`
and the raid keeps `target-locked` without the two vocabularies merging.

---

## 2. The rule that shaped the architecture

`vitest.config.ts` runs `environment: 'node'` with **no React renderer**, and anything
imported from a `.tsx` fails to parse. §8 is almost entirely behavioural — "the refund
fires on hit, not on miss", "scrubbing reproduces the same board", "revenge exactly once".

So every decision lives in a pure `.ts` module and the components only draw:

| Pure (tested) | Component |
| --- | --- |
| `shellHud.ts` | `ShellRow.tsx` |
| `raidFlow.ts` | `app/(game)/raid.tsx` |
| `replayScrub.ts` | `app/raid-replay.tsx` |
| `defenceLog.ts` | `app/harbour-log.tsx` |
| `firstRaid.ts` | the beat bubbles |
| `defenceBudget.ts` | the placement shop |
| `captainCopy.ts` | every error line |

The rule I held: **if a `.tsx` contains an `if` that decides a game outcome, it is in the
wrong file.**

---

## 3. The three hard rules

### "The client renders only what the server sent"

Structural, in two places.

**The parse boundary.** `RaidViewSchema` is a **strict** zod object with no `ships`, no
`arsenal`, no `layout`. A payload carrying one is **rejected**, not ignored — so a
patched server, a proxy or a replayed response cannot put a ship into a component's
props, because the parse fails first. Nine tests in `flagOff.test.ts` try, including
every field name I could think of and a `{...spread}` passenger.

**The HUD never computes.** `shellFeedback(before, after, outcome)` is handed **two
server numbers** and returns what to draw. There is no local counter to drift. The
shell count on screen is always `view.shells`; `shellRow()` clamps to the budget the
open response gave, so even an out-of-order response cannot grow the row.

`starStrip()` deliberately does **not** re-derive stars from destruction. A test pins
that: 100% destruction with `stars: 1` renders one star. Re-deriving is how a client
starts disagreeing with the server the moment a rule changes.

### "A raid never ends without a result the player can see"

This is a state-machine property, so it lives in `raidFlow.ts` where a test can drive it.
Five ways a raid stops, one way out of all five: `settling → result`.

| What happened | What the player gets |
| --- | --- |
| Retreat, shells out, cleared, clock | settle → result |
| **Backgrounded > 60 s** | on return the status probe finds no raid → **settling**, not the kit |
| Settle request failed | stays on `settling` with a **"See the outcome"** button that probes again |
| Network dropped mid-action | a `no-session` response triggers the same probe |

`reduceFlow` has **no transition to a `lost` state** and none that drops a live `raidId`
into the `kit` step. A 400-step exhaustive walk over every event from every reachable
state asserts both.

### "Every animation reuses the existing timings"

`SHELL_POP_MS = 220` and the cleared hold of `900 ms` are §3's own numbers; the mine
flash reuses the battle's 420 ms; the board, marks and FX are the battle's components
unchanged. No new easing curve, no new duration invented.

---

## 4. Decisions worth naming

**The raid is one route with four steps, not four routes.** The kit and the search are
thrown away if the player backs out, and a raid must not survive a route change it did
not settle. Four routes would have made the back button a silent way to abandon a live
raid.

**The live raid is never persisted.** `raid-v1`'s `partialize` allow-lists the harbour,
renown, the shield and the log — and deliberately **not** `raidId`, `view` or
`settlement`. A persisted live raid is a board with no server behind it, which is exactly
the dead screen §9.3 forbids. On restart the client asks `/raid/status` instead.

**`hasRaided` is set on SETTLEMENT, not on open.** A player who backgrounds out of their
first raid has been taught nothing; marking it at open would silently burn the tutorial.
The 300 steel is paid by the server on that settlement — the client never credits it.

**Revenge has two gates.** The server's `revenge_taken` column (atomic
`update ... where revenge_taken = false`) survives a reinstall; an in-session `Set` in
`defenceLog.ts` survives a slow refetch that hands back a stale `revengeAvailable: true`.
Either alone has a hole, and the tests show both holes.

---

## 5. Server additions Part 6 did not have

§5's replay viewer had no endpoint to call, so `0016` gained four read functions and two
columns (`defender_read`, `revenge_taken`), plus the routes `/raid/log`,
`/raid/log/read`, `/raid/revenge` and `/raid/replay/:raidId`.

`raid_replay` refuses a raid the caller was not part of, **in SQL** — and the service
answers `not-found` for both "no such raid" and "not yours", because telling a stranger
which of the two it is leaks that a raid exists.

One real fix while wiring it: `buildReplay` took `RaidAction[]` but the DB hands back
untyped jsonb. Rather than cast, it now **validates** and falls back to `as-recorded`
when the actions are not actions — a corrupted or older row degrades instead of throwing
inside `replayRaid` with the viewer already on screen.

---

## 6. Tests (§8, in full)

| § | File | Count |
| --- | --- | --- |
| 8.1 defence editor | `tests/raid/defenceEditor.test.ts` | 26 |
| 8.2 + 8.3 shell HUD, stars | `tests/raid/shellHud.test.ts` | 27 |
| 8.4 retreat, **backgrounding**, **slow connection**, **double-tap** | `tests/raid/raidFlow.test.ts` | 23 |
| 8.5 replay scrubbing | `tests/raid/replay.test.ts` | 22 |
| 8.6 defence log, revenge | `tests/raid/defenceLog.test.ts` | 21 |
| 8.7 the first raid | `tests/raid/firstRaid.test.ts` | 20 |
| flag off + the parse boundary | `tests/raid/flagOff.test.ts` | 12 |

**151 new tests.** The ones that actually found something:

- **Scrubbing backwards and at random.** §5 says rebuild from action 0, never rewind.
  The test scrubs a 24-action replay backwards end-to-end and then 200 times in random
  order, checking each board against a straight play-through. An incremental rewind would
  not survive either.
- **The decoy must look like a hit in the HUD.** A test asserts
  `shellFeedback(decoy) === shellFeedback(ship)`. If the HUD ever drew them differently,
  Part 5's decoy would be worthless — the attacker would simply read the animation.
- **Every error code has a Captain line.** The test walks the whole union and fails the
  build if a code has no copy, is its own copy, or leaks a status number.

### Bugs this found in my own code

1. **`cancelPendingArsenal` sells the item back.** My first cap test bought and cancelled
   three mines and expected the third to be refused — it was not, because the arsenal was
   empty each time. The test was wrong, not the store; it now places them.
2. **The expo-sqlite hoisting hazard, twice** (DECISIONS D18). `featureClient.ts` and
   `city/features.ts` both reach the localStorage shim at module scope, so a test that
   only wanted to read three constants could not load them. Fixed properly rather than
   worked around: `src/net/retryPolicy.ts` and `src/city/flagKeys.ts` are import-free
   data modules. The second one bought a test worth having — **the client and server
   flag lists must match**, which is exactly the kind of hand-kept pair that drifts.
3. **A harbour layout could type-check as a battle setup.** Adding `'harbour'` to
   `PlacementMode` broke `buildBattleSetup`, which was the compiler catching a real
   hazard. It now handles `'harbour'` beside `'online'`, warns, and falls back to the AI.

---

## 7. The Part 6 flake, fixed

The one open item from the Part 6 report. `room.test.ts`'s absentee-forfeit test rides on
real wall-clock timers (a 4 s forfeit clock waited on for 6 s) while four PGlite instances
each boot a full WASM Postgres on the same cores.

**Fixed by scheduling, not by timings:** `fileParallelism: false` in
`server/vitest.config.ts`. The suite goes 23 s → 59 s and **no test was changed**. The
alternatives were widening the socket timeouts (hides real slowness) or shrinking the
forfeit clock (weakens the assertion), and neither is mine to do to someone else's test.
The reasoning is in the config, next to the flag.

---

## 8. Device-test log — NOT YET RUN

**I have not run this on a device, and nothing below is a result.** It is the script to
run, written out so it can be executed in one sitting. Running it needs three things this
session did not have: an APK build (~25 min), a server deployed with `PORT_CITY_RAIDS=1`,
and a phone. Everything in §6 is automated and green; everything here is manual and
outstanding.

Setup: Android APK (`preview` profile), landscape, `PORT_CITY_RAIDS=1` on the server for
runs 1–5 and unset for run 6.

| # | Case | What to check | Status |
| --- | --- | --- | --- |
| 1 | **Cove loop** — harbour → edit → save → kit → search → raid → settle → result | Fuel chip reads "Harbour fuel *n* / *budget*"; the shop shows four defences and no radar; the result shows stars, loot and renown | ☐ |
| 2 | **First raid (§7)** | Fixed cove; four beats fire in order; 300 steel on the result; **re-run and confirm the script does not appear again** | ☐ |
| 3 | **Human loop** — search → card → raid → retreat → log → replay → revenge | Revenge skips the search cost **once**; the second attempt is refused | ☐ |
| 4 | **Backgrounded mid-raid** (home, 90 s, return) | Lands on the **result screen**, not a dead board | ☐ |
| 5 | **3G-shaped connection** (throttle) | No double-fire on repeated taps; a timed-out settle shows "See the outcome" and recovers on tap | ☐ |
| 6 | **Flag off** | The city nameplate reverts to the stats card and centres the map; no harbour route; `/raid/*` answers `feature-off` | ☐ |

**Two things I expect to need attention, from reading the layout rather than running it:**

- The scrub bar's per-action ticks will be thin at 30 actions on a phone. Each tick is a
  full-height `Pressable` so it should still be tappable, but this is the first thing to
  check in run 3.
- The board is drawn at 1.16×, which puts the column labels close to the top HUD strip.
  Worth eyeballing in run 1.

Runs 4 and 5 are the ones that matter most: they are the only parts of §9.3 that the
automated tests cover as a **state machine** rather than as real behaviour under a real
AppState transition and a real slow socket.

## 9. What is deliberately not here

- **Push notifications.** §6 puts them out of scope for v1 "until someone owns the
  permission prompt". In-app badges only: the plot badge, the log dog-ears, the menu card.
- **The menu attention card is built but not mounted.** `attentionCard()` and its copy are
  written and tested; wiring it into `app/menu.tsx` belongs with whatever else that screen
  gains, and dropping a card into it from this part would have been the one unreviewed
  edit to a screen Part 7 otherwise does not touch.
- **`database.types.ts` still does not know the 0016 RPCs**, so `server/src/raid/repo.ts`
  keeps the narrow `LooseRpc` seam. Same open decision as Parts 1 and 6.
- **Part 5's research queue** is still unbuilt, so D23 (a built Naval Academy unlocks its
  three items) stands in for it on both sides.

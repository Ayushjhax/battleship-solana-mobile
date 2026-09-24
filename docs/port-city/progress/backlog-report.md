# Backlog clear-down — 2026-09-24

Everything deferred across Parts 1–8, worked through in one pass before Part 9.

**Status:** `npm test` **1165/1165** (app) · `npm test` in `server/` **305/305** ·
`tsc --noEmit` **0 errors** (was 104) · `npx eslint .` clean.

---

## 1. What was outstanding, and where it stands now

| From | Item | Now |
| --- | --- | --- |
| Part 8 | Fleet Hall, browse, war and visit screens | **Built** |
| Part 8 | Six donation/war route handlers | **Built** (plus four more) |
| Part 8 | Realtime `fleet:{id}` topic + RLS | **Built** |
| Part 8 | War clock config for manual QA | **Built** (`WAR_PREP_MS`, `WAR_BATTLE_MS`) |
| Part 7 | Menu attention card built but not mounted | **Mounted** |
| Part 5 | The Academy research queue (D23's stand-in) | **Built** — D23 closed |
| Part 4 | The whole part | **Built** — rules, SQL, server, screen, tests |
| Part 3 | The whole part | **Rules, contrast and tests built**; shop screens not (§4 below) |
| Cross-cutting | `docs/port-city/reference` in tsconfig `exclude` | **Done** — 104 errors → 0 |
| Cross-cutting | Regenerate `database.types.ts` | **Not done** — needs a live project (§4) |
| Part 2 | Device perf measurement | **Not done** — no device (§4) |

---

## 2. Part 8, finished

**Four screens**, all built from what exists: `app/fleet.tsx` (roster, quick chat and
donations on one screen, because a fleet is one place), `app/fleet-browse.tsx` (create,
using `InkKeyboard` — there is still no `TextInput` anywhere), `app/fleet-war.tsx` (prep
day, battle day, the live scoreboard from the same `sideScore()` the settlement uses), and
`app/visit.tsx`.

**Ten route handlers**, not six: the donation and war ones §8 listed, plus `/war`,
`/visit/:userId`, `/fleet/friendly/:userId` and `/war/opt-in` that the screens turned out
to need.

Two things are **deliberately absent from responses**, and the types enforce it:

- `war_member.harbour` — a war harbour is hidden exactly as a raid target's is
  (Part 6 §10). `toWarMember` does not map the column, so `/war` has no field that could
  carry one.
- A visited city's stored production and scrap pile. `publicCity()` keeps levels and drops
  the rest: those are what a raid takes (Part 6 §7.2), and serving them would make the
  visit screen a free scouting tool that bypasses the search cost.

**The war clock is now configurable** (`server/src/fleet/config.ts`), which was the thing
blocking §7's manual QA — 22 + 24 hours is untestable by hand. The values are snapshotted
into the war row at pairing, so changing them cannot move a war already running.

---

## 3. Part 4 and Part 5, built

### Part 5's research queue closes D23

`src/engine/city/research.ts` + migration `0018_research.sql` + `/city/research*`.
`unlocks` is a real per-item list on the `city` row, served in the city snapshot, and the
three places that used the stand-in now read it.

**The real rule is strictly tighter than the stand-in:** a level-3 Academy with nothing
researched unlocks *nothing*, where D23 unlocked all three. There is a test that says so.

### Part 4 — the Bounty Board and the Captain's Log

The blocker was `credit_salvage`, which both **checked** the offline daily cap and
**incremented** its counter in one call. Part 4 needs the same decision for contracts and
for ink (§1), and three consumers calling it would have burned three slots for one match.
So `offline_slot_take` is split out: it decides and increments **once** per settlement, and
everything else is handed the answer. `offline_slots_left` reads without spending.

Built: a 36-contract data-driven catalogue, the metric evaluator (§1: *"evaluated only on
the server ... the client never reports progress"*), the season/ink rules, migration 0019,
the service, six endpoints and `app/bounties.tsx`.

**There is no progress endpoint**, which is the structural version of §3's rule. Contracts
advance from `settleMatchExtras`, which the match settlement calls with facts the server
built itself.

---

## 4. Part 3 — the two rulings, resolved

Both had been open since Part 2's survey, and both are now closed with a test that fails
loudly if the ruling is reversed.

### D11 — Gold ink: the bidirectional remap was adopted

§3's remap only pointed one way (light variants on dark papers). Gold scores 1.95–2.51 on
the five light papers. Every ink now carries an `onLight` as well as an `onDark`, and gold
renders as a dark bronze on light papers while keeping its bright form on Blueprint.

Chosen over "don't sell Gold" because §7.2 requires legibility *"in every combination we
sell"*, and a 350-gem ink usable on one paper of six is a purchase the player cannot see
going wrong. The test sweeps all 48 pairs **and** separately pins that gold's raw colour
still fails — so the remap is provably doing work rather than the test being vacuous.

### D12 — Ghost fleet: the scoping was adopted, and there was no conflict

`opponentHullVisible(ship)` is true only for a **sunk** ship. A sunk ship's cells are
already marked `'sunk'` and the hull is already drawn as a wreck, so a drifting wreck
reveals nothing — the wreck *is* the reveal. §1's table is satisfied exactly and no
boundary moves. No hull cosmetic on an un-sunk enemy ship ships, and there is no code path
to one.

### What the contrast sweep found (D30)

Walking *every* paper rather than the default one surfaced two real problems:

- **The green mine mark (2.82:1) and the revealed mark fail on tinted light papers.**
  Parchment and Old sea chart are several shades below graph paper's near-white. Fixed the
  same way the inks were: a third palette used when the base misses the floor.
- **`revealed` cannot clear 3:1 without changing how the base game looks.** It is
  `inkFaint`, the deliberately subordinate hatch; darkening it would make it compete with
  the hits. It has its own floor of **2:1**, written down and tested — an exception
  *stated* rather than silently allowed.

And a metric correction worth recording: `marksDistinguishable` first used contrast ratio,
which claimed the game's miss (violet) and hit (red) were indistinguishable at 1.14:1.
Contrast ratio is a **luminance** measure — it answers "readable against a background".
The right question for foreground-vs-foreground is colour **distance**, which puts the
closest pair at 105. The real guarantee is the glyph anyway (dot, X, filled, hatch, ring),
which is what keeps the board readable for a colour-blind player.

**Part 3's shop screens are not built.** The rules, the catalogue, the contrast engine and
all six §6 test groups are. What is missing is `app/shipyard.tsx`, `app/stationery.tsx`,
the Captain's Desk preview and the `/cosmetics` endpoints — the same trade Part 8 made,
and for the same reason: a rule that is right and untested is a rule that will be wrong
next month.

---

## 5. Still not done, and why

| Item | Why |
| --- | --- |
| **Regenerate `database.types.ts`** | Needs `npx supabase gen types --linked` against a project with 0014–0019 applied. Four repos now carry a narrow `LooseRpc` seam waiting on it, each marked for deletion. |
| **Part 2's device perf measurement** | No device in this session. |
| **Part 3's shop screens and `/cosmetics`** | §4 above. |
| **Part 4 and 8's manual QA** | Both need a device and a deployed server. Part 8's is now *unblocked* (the clock config landed); Part 4's needs an APK. |

---

## 6. Bugs found while clearing the backlog

1. **A migration-ordering hazard, caught by the two-pass idempotency check.** 0018 widens
   `city_load`'s return type, which Postgres refuses with `create or replace`. The second
   pass then re-runs 0014, whose older definition collides with 0018's. **Both** files now
   drop the function before creating it. Worth stating as a rule: *a migration that widens
   a function's return type must drop it first, and so must every earlier migration that
   defines it.* (D28)
2. **`offline_slots_left` returned NULL for a player with no city row**, which a caller
   reads as *zero slots left* — the exact opposite of the truth. Now coalesced to the full
   cap.
3. **The metric evaluator referenced `SHOT_FIRED`**, which is a client-side FX event and
   not in the engine's `MatchEvent` union. The compiler caught it; the weapon-attribution
   windows now close on `ARSENAL_USED` / `TURN_CHANGED` / `GAME_OVER`, which are the real
   boundaries.
4. **Two of my own tests asserted the wrong thing** and were corrected rather than the
   code: a daily contract expires at the next *midnight*, not 24 h after issue; and the
   "every metric has an evaluator" fixture did not contain a torpedo run, so it proved
   less than it claimed.

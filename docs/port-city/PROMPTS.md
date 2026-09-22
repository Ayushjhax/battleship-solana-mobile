# Implementation prompts

One prompt per part of the design. Paste them into Claude Opus 5 (Claude Code, in the repo
root) **one at a time, in order**, and do not start a prompt until the previous part is
merged and green.

## How to use these

1. Copy `docs/port-city/` (this whole folder, including `reference/`) into the repo first
   and commit it. Every prompt reads from it, so the agent always has the spec in context.
2. Run **Prompt 0** once, in a session of its own. It writes
   `docs/port-city/progress/REPO-MAP.md`, which every later prompt depends on.
3. One part per session, on its own branch (`feat/port-city-part-NN`). Long sessions drift.
4. When a session ends, read its report in `docs/port-city/progress/part-NN-report.md`,
   run the tests yourself, and only then move on.
5. If something is wrong, use **Prompt F** rather than arguing in the same context.
6. Keep `docs/port-city/progress/DECISIONS.md` under review: it is where the agent records
   every place the repo disagreed with the design.

---

## Prompt 0 — Repo audit (read-only, run this first)

```
You are working in the Empire of Bits: Ocean Warfare repo (Expo SDK 57 / React Native /
TypeScript app, with the match server in server/). Do not change any code in this session.

Read, in this order:
- docs/port-city/00-OVERVIEW.md
- docs/port-city/NUMBERS.md
- docs/port-city/CORRECTIONS.md
- docs/port-city/reference/README.md

Then explore the real repo and write docs/port-city/progress/REPO-MAP.md answering, with
exact file paths, line references and short quoted snippets:

1. ENGINE: where the pure rules live. The exact types for a cell, a ship, a layout, an
   item, a mark, a shot result. How a shot is resolved and where the turn rule lives. How
   arsenal items are resolved, including AA interception. Whether the engine is imported
   by both the app and the server, and how.
2. SERVER: framework, entry point, how a match room validates and applies an action, how
   state is persisted, what database and client library, how auth works, how the profile
   (coins, rank points) is written, whether there is a migration system, whether there is
   a feature-flag or remote-config mechanism, how errors are returned.
3. CLIENT: routing, the screens that exist, how global state is stored, how the profile is
   cached offline, how the placement screen builds a layout, how the battle screen renders
   marks and animations, what the ink/stroke drawing kit exposes (list the components and
   their props), how sounds and haptics are triggered, how the tutorial and Captain tips
   are implemented.
4. TESTING: what test runners and helpers exist, how to run unit tests, integration tests
   and any device tests, what CI runs, current coverage if measurable.
5. CONVENTIONS: lint and format setup, naming, error handling, i18n, how config values are
   passed from server to client, the protocol version mechanism if any.
6. RISKS: the five places where adding the Port City is most likely to break something
   that already works, with reasons.
7. GAPS: anything in 00-OVERVIEW.md §4 (the expected repo map) that does not match
   reality. Be specific.

Rules: read-only. No refactors, no fixes, no new files except REPO-MAP.md. If you cannot
find something, say so explicitly instead of guessing. Finish with a 10-line summary of
what an implementer most needs to know.
```

---

## The shared preamble

Every implementation prompt below already contains this, but if you write your own, start
with it:

> Read `docs/port-city/00-OVERVIEW.md`, `docs/port-city/NUMBERS.md`, the part file, and
> `docs/port-city/progress/REPO-MAP.md`. Follow the invariants in §3 and the Definition of
> Done in §9 of the overview. Plan first, implement second, test throughout.

---

## Prompt 1 — City core

```
Implement Part 1 of the Port City design in this repo.

Read first: docs/port-city/00-OVERVIEW.md, docs/port-city/part-01-city-core.md,
docs/port-city/NUMBERS.md, docs/port-city/progress/REPO-MAP.md, and the reference
implementation in docs/port-city/reference/ (src/city.ts and test/city.test.ts are a
working model of this part - run `npm install && npm test` in that folder to see its 80
tests pass).

Step 1 - PLAN. Write docs/port-city/progress/part-01-plan.md: every file you will add,
every file you will touch, the order you will do it in, the DB tables and migrations, the
risky parts, and the list of tests you will write. Stop and show me the plan before
writing implementation code.

Step 2 - RULES. Port the city rules into the repo's pure engine location as its own
module (city catalogue, settle, start/cancel/speed-up, production accrual, collection,
salvage, worker purchase). Pure functions only: `now` is a parameter, no Date.now(), no
Math.random(), no I/O, no React. Keep the exact numbers from NUMBERS.md - the catalogue is
one exported table, plus a checksum test in the style of the existing rank-ladder pin.

Step 3 - SERVER. Add the endpoints in part-01 §4 with typed error codes, requestId
idempotency (store the last 50 responses per user), optimistic concurrency on a version
column, whole-snapshot responses with serverNow, the economy ledger, and the lazy v1
migration including rank gem back-pay. Hook salvage crediting into match settlement inside
the same transaction that writes points and coins, for online, offline and hot-seat, with
the offline/hot-seat daily cap. The tutorial pays nothing.

Step 4 - CLIENT DATA LAYER. Typed API client, store, selectors, cached snapshot, server
clock offset. No city UI yet except a dev-only "City lab" screen with a button per
endpoint and a JSON dump - Part 2 builds the real screen.

Step 5 - TESTS. Everything in part-01 §8: the 20 listed scenarios, plus idempotency,
concurrency (two collects race, credited once, against a real DB), authorisation, the
migration run twice, and ledger reconciliation. Port the reference's test scenarios rather
than inventing your own.

Rules:
- Feature flag portCity.core, default off; with it off the app must behave exactly as it
  does today, and every endpoint returns feature-off.
- Never let a client write a balance. Never invent a number: if one is missing, propose it
  in the plan and record it in docs/port-city/progress/DECISIONS.md.
- Do not weaken or delete an existing test. If one must change, list it and why.
- Prefer existing dependencies; justify any new one in the plan.

Finish by writing docs/port-city/progress/part-01-report.md: what you built, file by file;
any deviation from the design and why; the test output (paste the summary); what is still
open; and exactly how I test this by hand in a dev build.
```

---

## Prompt 2 — The city screen

```
Implement Part 2 of the Port City design: the city screen.

Read first: docs/port-city/00-OVERVIEW.md, docs/port-city/part-02-city-screen.md,
docs/port-city/NUMBERS.md, docs/port-city/progress/REPO-MAP.md, and
docs/port-city/progress/part-01-report.md.

Step 1 - PLAN in docs/port-city/progress/part-02-plan.md, including a component tree, how
you will reuse the existing ink/stroke kit (name the exact components), and how plot
overlays stay in sync with the existing pinch/pan transform. Show me the plan first.

Step 2 - BUILD, on top of the existing app/city.tsx. Do not replace the harbour scene, the
pinch/pan, the nameplate or the "You are here" flag.
- src/city/ui/plots.ts with the normalised coordinate table from part-02 §2. Nudge the
  values so each plot sits on the right part of the art, then write the final numbers back
  into that table and into the design doc.
- The six plot states from §3, with tap targets that scale with zoom.
- Procedural pen-drawn buildings: four tiers of ink paths per building, seeded by
  buildingId so they are stable, revealed by strokeDashoffset in proportion to build
  progress, with the pen nib, the completion flourish and the "Inked!" stamp (§4).
- The building sheet (§5) with now/next effects, costs, typed-error copy in the Captain's
  voice, Build / Upgrade / Finish now / Collect / Cancel.
- HUD, collect animation, Collect all, Workers chip and the Workers' Lodge sheet (§6).
- The six-beat Captain tour, once, skippable, replayable from Settings (§7).
- Menu badge and the Result-screen salvage line (§8).
- Ambient life within the budget in §9, off under reduced motion.

Step 3 - TESTS from §11, plus performance: 60 fps pan and zoom with every plot built.

Rules: landscape only, 800x360 virtual canvas, existing ink style, no rounded corners or
shadows, no new dependency without justification, flag portCity.core off = today's screen
exactly. Server is the only source of numbers; the client may animate but never compute a
balance.

Finish with docs/port-city/progress/part-02-report.md including the final plot
coordinates, a note on any art that needs a real illustrator later, and hand-test steps.
```

---

## Prompt 3 — Cosmetics

```
Implement Part 3 of the Port City design: the Shipyard and the Stationer's Shop.

Read first: docs/port-city/part-03-cosmetics.md, 00-OVERVIEW.md, REPO-MAP.md, and the
Part 1 and 2 reports.

Plan first in docs/port-city/progress/part-03-plan.md, then build:
- Server-side catalogue, ownership and equipped slots; buy and equip endpoints with typed
  errors; the equipped set travels in the match payload at arena reveal and contains no
  positions.
- Render hooks for the six slots in the board renderer: fleet ink, paper, pen, hull set,
  sink effect, victory stamp. The opponent sees your ink, pen, hulls and sink effect only
  where the rules already make your ships public.
- The two shop sheets and the Captain's Desk preview screen.
- A GemStore adapter interface with a NotAvailable implementation; no IAP.

Tests: part-03 §6 in full, especially the contrast test over every ink x paper pair, the
mark-distinguishability test per paper, the unknown-effect fallback, and the timing test
that sink effects never delay the turn flip.

Hard rule: zero gameplay effect. If any cosmetic changes a hitbox, a duration that matters
or an information boundary, stop and report instead of shipping it.

Finish with docs/port-city/progress/part-03-report.md.
```

---

## Prompt 4 — Bounty Board and Captain's Log

```
Implement Part 4 of the Port City design: the Bounty Board and the Captain's Log.

Read first: docs/port-city/part-04-bounties-log.md, 00-OVERVIEW.md, REPO-MAP.md, and the
Part 1 report (the ledger and settlement hook you will extend).

Plan first in docs/port-city/progress/part-04-plan.md, then build:
- A data-driven contract catalogue of at least 30 contracts across the listed metrics,
  each with tier, scope and an optional feature requirement.
- A server-side metric evaluator that runs at match settlement from the event log (online)
  or the reported result (offline/hot-seat), under the same daily cap as salvage. The
  client never reports progress.
- Daily and weekly issue/reset at UTC boundaries, slot counts by Harbour Master's Office
  level, one free reroll a day then gems.
- The 28-day season, 30 pages, 600 ink per page, free and premium tracks, retroactive
  unlock on purchase, and an auto-claim job for unclaimed pages 24h after a season ends.
- The Harbour Master's Office UI: pinned paper notes with ink tick progress, stamp-to-claim
  and the logbook.

Tests: part-04 §5 in full, including the pacing test that locks the targets (active player
finishes 30 pages between day 18 and 24; casual lands between page 10 and 18), reset
boundaries, idempotent claims, and the auto-claim job run twice.

Finish with docs/port-city/progress/part-04-report.md.
```

---

## Prompt 5 — Naval Academy and the three new items

```
Implement Part 5 of the Port City design: the Naval Academy and three new arsenal items.
This part touches the core rules engine, so work slowly and keep every existing test green.

Read first: docs/port-city/part-05-academy-items.md, 00-OVERVIEW.md, NUMBERS.md,
CORRECTIONS.md, REPO-MAP.md, and the reference implementation:
docs/port-city/reference/src/resolve.ts and test/new-items.test.ts, which is a working,
tested model of all three items. Run its tests before you start.

Step 1 - PLAN in docs/port-city/progress/part-05-plan.md: exactly which engine types and
functions change, how new marks and item kinds flow through the masked view, the protocol
encoder, the renderer and the AI, and how you will prove no existing rule changed. Show me
the plan before touching the engine.

Step 2 - ENGINE. Add item kinds sonar_net and decoy, weapon kind minesweeper, marks
mine_disarmed and decoy. Implement exactly the rules in part-05 §2-§4, including: the
submarine interception check mirroring AA interception; the decoy obeying the no-touch rule
while every other item is halo-exempt; the decoy serialising as a plain hit until all eight
neighbours are marked; torpedoes stopping on an intact decoy; radar never counting a decoy;
the minesweeper sweeping two rows, being uninterceptable and never ending the turn.

Step 3 - VALIDATION AND RESEARCH. Server-side unlocks, Academy research queue (its own
queue, not a dock worker), layout validation against unlocks, caps and the unchanged 260
fuel budget. Classic must reject all three.

Step 4 - AI, UI, PROTOCOL. Hard AI kit swap; AI must never deadlock on a decoy. Placement
shop cards, the net's guarded column indicator, decoy placement using ship preview, two-row
minesweeper targeting, and the animations and sounds in §8 - with no tell whatsoever on a
decoy hit. Bump PROTOCOL_VERSION and refuse old clients with a typed upgrade-required.

Step 5 - TESTS. Every scenario in part-05 §10, ported from the reference tests, plus the
secrecy test that fails the build if a decoy's kind ever leaks in a masked view, the
Classic rejection test, and a full engine regression run (compare AI-vs-AI win rates before
and after: they must move by less than 2 points).

Also update the game design doc: §7.3 gains the documented minesweeper exception, and
Appendix A's "310 fuel at cap" becomes 360.

Finish with docs/port-city/progress/part-05-report.md, including the before/after
regression numbers.
```

---

## Prompt 6 — Raids: rules and server

```
Implement Part 6 of the Port City design: harbour raids, rules and server only. No raid UI
in this session beyond what a test harness needs.

Read first: docs/port-city/part-06-raids-engine.md, 00-OVERVIEW.md, NUMBERS.md,
REPO-MAP.md, the Part 1 and Part 5 reports, and the reference implementation
docs/port-city/reference/src/raid.ts with test/raid.test.ts. Also read
docs/port-city/reference/out/raid.md, which is the calibration data behind the 30-shell
budget - do not change the budget, but do make it server-configurable as raid.shells.

Step 1 - PLAN in docs/port-city/progress/part-06-plan.md: the raid state machine, where it
lives relative to the existing match room, the tables, the search query and its indexes,
how a raid resolves actions with the shared engine, and how you will guarantee that no
hidden cell can ever be serialised.

Step 2 - RULES. A pure raid module: startRaid, fireShell, useKit, retreat, settle, scoring.
Shell maths exactly as specified: miss -1, hit 0, item destroyed 0, mine -1 minus the
penalty, kit items free but mines in their footprint still bite. Stars and destruction as
specified. Same engine as matches for every resolution and interception.

Step 3 - HARBOUR AND KIT. Harbour layout storage and validation (legal fleet, Coastal
Command fuel and caps, researched items only), a generated default harbour on unlock, the
Armory raid-fuel kit, and the rule that a raid runs against the snapshot taken when it
started.

Step 4 - MATCHMAKING AND SETTLEMENT. Search with cost, renown window widening, shields,
raid locks, the 24-hour repeat rule, and pirate coves labelled honestly and paying
house loot with no renown. Settlement in one transaction: loot with vault protection and
per-raid caps, house-paid star bonus, symmetric renown, shields by destruction, ledger
rows for both sides, defence-log entry, and the raid log for replays.

Step 5 - TESTS. Every scenario in part-06 §11, ported from the reference tests, plus the
500-raid secrecy fuzz test, the concurrency tests, the disconnect-settles test, and a
replay test that re-runs stored actions and reproduces stars, destruction and marks
exactly.

Hard rules: the hidden layout never leaves the server; rank points and match rewards are
untouched; renown is a separate ladder that can fall; a player below Admiralty 3 can
neither raid nor be raided.

Finish with docs/port-city/progress/part-06-report.md, including a table of the star
distribution you measured against your own implementation using the reference AI, so we can
compare it with reference/out/raid.md.
```

---

## Prompt 7 — Raids: the client

```
Implement Part 7 of the Port City design: the raid client.

Read first: docs/port-city/part-07-raids-client.md, part-06-raids-engine.md, 00-OVERVIEW.md,
REPO-MAP.md, and the Part 2 and Part 6 reports.

Plan first in docs/port-city/progress/part-07-plan.md, naming exactly which existing
screens and components you will reuse - the placement screen for the defence editor, the
battle board for the raid, the result screen for the outcome. Reuse, do not fork: if a
component needs a prop to serve both, add the prop.

Then build the four screens in part-07 §1-§5: your harbour, the defence editor with the
harbour-fuel budget and Coastal Command caps, the kit -> search -> raid -> result flow with
the shell HUD and its refund animation, the defence log with revenge, and the replay viewer
that rebuilds state from action 0 when scrubbing.

Also build the scripted first raid (§7): fixed cove seed, four Captain beats, fixed 300
steel reward, runs once.

Tests: part-07 §8 in full, including backgrounding the app mid-raid, a slow connection, the
double-tap-collect case, and the flag-off fallback.

Hard rules: the client renders only what the server sent; a raid never ends without a
result the player can see; every animation reuses the existing timings.

Finish with docs/port-city/progress/part-07-report.md and a short device-test log.
```

---

## Prompt 8 — Fleets and wars

```
Implement Part 8 of the Port City design: fleets, donations, wars, visits and the Flag Hall.

Read first: docs/port-city/part-08-fleets.md, 00-OVERVIEW.md, REPO-MAP.md, and the Part 6
and 7 reports.

Plan first in docs/port-city/progress/part-08-plan.md, with special attention to the war
scheduler: it is the only cron in this package and it must be idempotent and restart-safe.

Build: fleets with roles and the permission table, quick chat and stickers only (free text
stays behind fleets.freeText, default off, and does not ship), donations with the
commission price and reinforcement slots usable only in raids and wars, fleet wars with a
22h prep and 24h battle day and best-stars-per-target scoring, friendly raids, city visits,
the Flag Hall, and the country picker that Appendix C says is missing (ink list,
alphabetical, letter index, no OS keyboard).

Tests: part-08 §7 in full. The two that matter most: a reinforcement can never enter a
ranked match, and running the war settlement job twice pays exactly once.

Finish with docs/port-city/progress/part-08-report.md.
```

---

## Prompt 9 — Gazette, daily puzzle, voyages

```
Implement Part 9 of the Port City design: the Port Gazette, the daily puzzle and trade
voyages.

Read first: docs/port-city/part-09-gazette-puzzle-voyages.md, 00-OVERVIEW.md, REPO-MAP.md,
and docs/port-city/reference/out/puzzle.md, which is where par 52 comes from.

Plan first in docs/port-city/progress/part-09-plan.md.

Build:
- The Gazette: about 40 scored templates, server-side generation once per player per day,
  the drawn newspaper layout, and the share-as-image button only if a view-shot dependency
  already exists.
- The daily puzzle: one seeded board per UTC day for everyone, server-authoritative (the
  layout never reaches the client), one resumable attempt a day, par 52, rewards and
  streaks, the emoji-grid share, and the per-day leaderboard.
- Trade voyages: slots by Trade Docks level, rewards rolled server-side at send time,
  returns, and the 5x5 pirate skirmish played on the client but verified by a server
  replay against the same seeded AI and layout.

Tests: part-09 §5 in full, including the 10,000-board legality test for the 5x5 skirmish
and the test that a skirmish log which does not replay is rejected and pays half.

Finish with docs/port-city/progress/part-09-report.md.
```

---

## Prompt 10 — Captains and seas

```
Implement Part 10 of the Port City design: captains and new seas. This touches the engine
as deeply as Part 5, so the same care applies.

Read first: docs/port-city/part-10-captains-seas.md, 00-OVERVIEW.md, REPO-MAP.md, and the
Part 5 report.

Plan first in docs/port-city/progress/part-10-plan.md, and plan the two halves separately.
Implement 10A (captains) fully, with tests, before starting 10B (seas).

10A: six captains, each exactly one ability priced in fuel out of the same 260, implemented
as pure hooks (onMatchStart, onShotResolved, onTorpedoWouldStrike, onItemHit, onShipSunk).
Each ability fires at most once and is recorded in the match log. Both players see each
other's captain at arena reveal. Classic never sees captains. Rosa must be provably
in-match-neutral: write the differential test.

10B: terrain (island, reef, fog) in the match and raid config, five fixed seas, full
engine support (placement, shots, torpedo runs, bomb footprints, radar, auto-reveal, the
AI, the layout generator), ranked using one season sea for both players, and the Lighthouse
unlocking seas for non-ranked play and for your own harbour only.

Tests: everything listed in part-10, especially the generator test that each sea admits at
least 100,000 legal fleet placements, the Shuffle test (10,000 attempts, zero failures per
sea), and a full engine regression before and after.

Finish with docs/port-city/progress/part-10-report.md, including per-sea AI median shots so
we can see how much each sea changes the game.
```

---

## Prompt 11 — Living city, World Boss, Empire map

```
Implement Part 11 of the Port City design. Treat 11A, 11B and 11C as three separate
deliverables and do them in that order, each with its own tests.

Read first: docs/port-city/part-11-live-world.md, 00-OVERVIEW.md, REPO-MAP.md, and the
Part 2 and Part 6 reports.

Plan first in docs/port-city/progress/part-11-plan.md.

11A - night mode by local time with a Settings override, two seasonal overlays, and rare
weather. Recolour, never a second scene asset. Prove there is no gameplay effect and that
night mode passes the same legibility test as the cosmetics papers.

11B - the World Boss: a 30x30 board drawn as taped graph-paper sheets, a seeded armada with
a 6-cell flagship, 5 shots a day per player plus the listed extras, shared global marks,
waves, milestone rewards, and a serialised writer so two shots at the same cell resolve
once and the loser is refunded rather than charged. This concurrency behaviour is the whole
feature: test it hard.

11C - the Empire map: 20 handcrafted PvE ports in 4 regions with star conditions, three
region bosses (polyomino Kraken, relocating Ghost Fleet, Pirate King), flags on conquered
ports, and capped tribute collected at a Customs House plot. PvE only; none of it may touch
ranked, renown or the arsenal catalogue.

Finish with docs/port-city/progress/part-11-report.md.
```

---

## Prompt T — Test sweep and hardening (run after any part, and before release)

```
Do a hardening pass over the Port City feature. Change behaviour only where a test proves
it is wrong.

1. Run everything: type check, lint, unit tests, integration tests, and the reference suite
   in docs/port-city/reference (npm install && npm test). Paste the summaries.
2. Measure coverage for the new pure rules modules. Anything under 90% lines: write the
   missing tests, and say why any line is genuinely unreachable.
3. Adversarial pass on the server. For every Port City endpoint try: no auth, another
   user's id, a replayed requestId, two concurrent calls, a negative or huge number, a
   wrong type, a missing field, a stale version, an unknown building or item id, a
   disallowed state (collect an empty collector, speed up a finished job, raid yourself,
   raid a shielded player, save an over-budget harbour, submit an unresearched item).
   Every one must return a typed error, never a stack trace, a 500 or a partial write.
4. Secrecy sweep. Write a test that walks every response type the client can receive during
   a match or a raid and asserts it can never contain an un-hit ship cell, an unexposed
   decoy's kind, an undiscovered item, or a puzzle layout. Fail the build if it can.
5. Economy sweep. Replay the ledger for a simulated month of play and assert it reconciles
   with the balances. Then run the pacing simulation in docs/port-city/reference/sim and
   compare against the targets in the docs; report any drift over 20%.
6. Performance. Measure city screen fps while panning at 3x with every plot built, the time
   to first paint from cache, raid action round-trip time, and the memory delta after 20
   raids. Report numbers, not impressions.
7. Offline and flaky network: airplane mode, a 3G-shaped connection, and a mid-action
   disconnect on every flow.
8. Flags off: with every portCity.* flag off, the app must be byte-for-byte the old
   experience. Prove it.

Write docs/port-city/progress/hardening-report.md with findings ordered by severity, each
with a reproduction and a fix (or a ticket if the fix is large). Do not "fix" anything by
weakening a test.
```

---

## Prompt F — Fix-up template (fill in the blanks)

```
In the Port City feature, <WHAT IS WRONG>.

Reproduce it first: write a failing test that demonstrates exactly this, at the lowest
level that can show it (pure rules if possible, otherwise server, otherwise client). Show
me the failing output.

Then find the root cause. Explain it in three sentences before changing anything, and say
which layer the bug really lives in - the rules, the server, the protocol, or the UI.

Then fix it at that layer. Do not paper over it in the UI, do not special-case the test,
and do not change a number in NUMBERS.md unless the design is what is wrong - in which case
change reference/src, re-run reference/sim/tables.ts to regenerate NUMBERS.md, and say so
loudly in the report.

Finally: run the full suite, confirm the new test passes and nothing else broke, and append
a short entry to docs/port-city/progress/DECISIONS.md.
```

---

## Prompt R — Release readiness (before turning a flag on in production)

```
Prepare the Port City feature for a staged rollout.

1. List every portCity.* flag, its current default, what it turns on, and its dependencies.
2. Write the rollout order and the kill-switch procedure for each flag: what happens to a
   player mid-raid, mid-build or mid-war if it is switched off. Any flag that cannot be
   switched off safely is a bug - fix it or document the drain procedure.
3. Verify migrations: run the v1 city migration against a copy of production-shaped data,
   twice, and report timing and row counts.
4. Confirm the protocol gate: an old client is refused with upgrade-required and shown the
   update screen, never a crash or a corrupt board.
5. Write the analytics dashboard spec: the 15 numbers we must watch in week one (day-1 and
   day-7 return rate, city opens per session, builds started, speed-up gem spend, raids
   started/completed/abandoned, star distribution, defence shield rate, renown spread,
   salvage per player per day, steel and coin sinks vs sources, crash rate on the city
   screen, p95 raid action latency, puzzle completion rate, offline-cap hits) and the
   thresholds that should make us pull a flag.
6. Write a one-page player-facing changelog in the Captain's voice.

Output: docs/port-city/progress/release-readiness.md.
```

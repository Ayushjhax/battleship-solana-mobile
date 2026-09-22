# Port City — design package

**Game:** Empire of Bits: Ocean Warfare
**Scope:** everything behind the *Port city* button on the menu
**Status:** design, v1.0 (written to be implemented part by part)
**Read this file before any other part. Every prompt in `PROMPTS.md` starts by loading it.**

---

## 1. What we are building

Today the Port City is one hand-drawn harbour you can pinch and pan, with three dashed
slots that say *Coming soon*. Coins pile up on the profile and nothing spends them.

The Port City becomes the game's second half:

- Battles pay the city. Every enemy ship you sink drops **salvage** into your Scrapyard.
- The city pays the battles back, but only in **choices** — new arsenal items, captains,
  seas — never in bigger numbers.
- Your harbour becomes a thing other captains **raid** while you are offline, and your
  layout — the one skill this game already teaches — becomes the thing that defends it.
- Everything is drawn: buildings are inked in stroke by stroke while they are built.

## 2. The five pillars

1. **Every battle feeds the city.** Salvage, coins, contract progress, log ink. A loss
   where you sank eight ships still pays.
2. **The city feeds battles with options, never with power.** See the ranked integrity
   rule below. This is the invariant that keeps the game fair and reviewable.
3. **It is drawn, not built.** Construction is a pen drawing a building. Upgrades add
   strokes. Nothing in this feature may look like a UI kit.
4. **There is always something to come back to.** Collectors fill, contracts reset,
   voyages return, a new Gazette prints, the harbour gets raided.
5. **The server is the only source of truth.** Same trust model as §11.4 of the game
   design doc: the client asks, the server decides, the database refuses client writes.

## 3. Hard invariants

These are not preferences. A change that breaks one of these is a bug, and each has a
test that must exist and stay green.

### 3.1 Ranked integrity

| Allowed to affect a ranked match | Never allowed to affect a ranked match |
| --- | --- |
| Which arsenal items a player has **unlocked** (all priced in the same 260 fuel) | The 260 fuel budget |
| Which captain a player brings (the ability costs fuel out of the same 260) | Item prices or caps |
| Cosmetics (ink, paper, pen, hulls) | Ship count, ship length, halo rule, turn rules |
| The season's sea (identical for both players) | Timers, rewards, matchmaking other than by rank |

A player's city level, building levels, renown, fleet, pass tier and gem balance have
**zero** effect on any Advanced or Classic match. Classic is untouched by this whole
package: no city item, captain or sea may ever enter it.

### 3.2 Server authority

Coins, steel, gems, buildings, timers, raids, renown, contracts and the pass are written
**only** by the server. The app may render an optimistic animation, but never a balance
it computed itself — exactly like the ink "…" that sits on a cell until the server
answers. Every mutation is idempotent (`requestId`) and appends to an economy ledger.

### 3.3 Pure rules

Every rule in this package lives in a pure module under `src/engine/` (or wherever the
existing engine lives): no React, no I/O, no `Date.now()`, no `Math.random()`. Time
arrives as a `now: number` parameter, randomness as a seed. Both the app and the server
import the same module — that is what makes the server able to referee and the client
able to predict.

### 3.4 The ink

Blue ballpoint on graph paper, on a wooden desk. Bitter in three weights. Hand-drawn
strokes with fixed seeds. No rounded corners, no shadows, no gradients, no UI-kit
rectangles. Landscape only, composed on the 800 × 360 virtual canvas. Any new sound,
haptic or animation follows the tables in §13 of the game design doc.

## 4. Where the code goes

The repo is `my-app` (Expo SDK 57 / React Native / TypeScript) with the match server in
`server/`. **Verify this map before writing anything** — it is inferred from the design
doc, not from the tree.

| What | Where (expected) |
| --- | --- |
| Existing rules engine, shared by app and server | `src/engine/` |
| New pure rules | `src/engine/city/`, `src/engine/raid/`, `src/engine/items/` |
| Server | `server/src/` (match rooms in `server/src/room.ts`) |
| New server service | `server/src/city/`, `server/src/raid/` |
| Screens (expo-router) | `app/` — the city is `app/city.tsx` today |
| Client state | `src/state/` (profile in `src/state/profile.ts`) |
| Ink UI primitives | wherever the stroke generator and frames live today — reuse, never re-invent |
| This package | `docs/port-city/` |

**Rule for the agent:** if the real tree disagrees with this table, the real tree wins.
Write the correction into `docs/port-city/progress/DECISIONS.md` and carry on.

## 5. Shared conventions

- **Time.** The server stamps `serverNow` on every response. The client keeps
  `offset = serverNow - Date.now()` and renders timers from `endsAt - (Date.now() + offset)`.
  Never trust the device clock for a reward.
- **Idempotency.** Every mutating request carries a client-generated `requestId` (uuid).
  The server stores the last 50 per user with their responses and replays the stored
  response instead of applying the action twice.
- **Snapshots.** Every mutation responds with the **whole** city snapshot plus
  `serverNow`. No partial diffs in v1: it removes a whole class of desync bugs.
- **Settle-on-read.** Nothing runs on a timer server-side. Any read or write first calls
  `settle(state, now)`, which completes finished upgrades in chronological order and
  accrues production around them. Cron jobs exist only for seasons, wars and events.
- **Feature flags.** Server-driven config, one per part:
  `portCity.core`, `.cosmetics`, `.bounties`, `.academy`, `.raids`, `.fleets`,
  `.gazette`, `.voyages`, `.captains`, `.seas`, `.worldBoss`, `.empire`.
  A flag that is off means the plot does not appear, the endpoints return `feature-off`,
  and no migration runs. Every part ships behind its flag, default **off** in production
  until QA signs it off.
- **Catalogues are data.** Building costs, item prices, contract definitions, cosmetics
  and rewards live in single exported tables, and a test pins the table against a
  checksum so nobody edits a number by accident (the rank ladder is already pinned this
  way — copy that pattern).
- **Error codes.** Typed string unions, never free text:
  `not-enough-steel`, `no-free-worker`, `needs-admiralty`, `feature-off`, … The client
  maps them to Captain-voice copy.
- **Protocol version.** New marks and new item kinds change what the match/raid protocol
  can contain. Bump `PROTOCOL_VERSION`; the server refuses to queue a client below the
  minimum with a typed `upgrade-required`, and the app shows an ink "New charts available"
  screen. Never send an unknown mark to an old client.
- **Rate limits.** City actions: 10 per 10 s per user. Raid actions: 4 per second.
  Over the limit is a typed error, not a socket kill (that rule stays for match sockets).

## 6. Currencies

| Currency | Icon | Earned | Spent on | Lootable |
| --- | --- | --- | --- | --- |
| **Coins** (existing) | gold coin | +50 win, +10 loss, collectors, contracts, voyages, raids | building costs, research, cosmetics, raid searches | yes, partly |
| **Steel** (new) | ink girder | salvage (5 per sunk enemy ship cell), Foundry, raids, contracts | every building and upgrade | yes, partly |
| **Gems** (the green counter already in the HUD) | green gem | rank-ups, Admiralty levels, contracts, pass, events | speed-ups, extra dock workers, premium cosmetics, pass | **no** |

Gems are never sold for money in v1 — there is no IAP integration in this package. The
gem store screen exists with a `NotAvailable` adapter so the plumbing is ready.

## 7. The city roster

| Building | Unlocks at | Max | What it does | Part |
| --- | --- | --- | --- | --- |
| Admiralty | start (L1) | 8 | gates every other building, protects a vault of resources, grants gems per level | 1 |
| Scrapyard | start (L1) | 6 | holds battle salvage until you collect it, adds a salvage bonus | 1 |
| Fish Market | Admiralty 1 | 8 | coins per hour, 12 h capacity | 1 |
| Foundry | Admiralty 2 | 8 | steel per hour, 12 h capacity | 1 |
| Harbour Master's Office | Admiralty 1 | 3 | Bounty Board contracts, Captain's Log | 4 |
| Shipyard | Admiralty 1 | 4 | hull sets, sink effects, fleet preview | 3 |
| Stationer's Shop | Admiralty 2 | 4 | inks, papers, pens | 3 |
| Newsstand | Admiralty 2 | 3 | the Port Gazette and the daily puzzle | 9 |
| Naval Academy | Admiralty 3 | 5 | researches the new arsenal items | 5 |
| Coastal Command | Admiralty 3 | 6 | harbour defence budget and caps | 6 |
| Armory | Admiralty 3 | 5 | raid kit budget | 6 |
| Fleet Hall | Admiralty 4 | 5 | fleets, donations, wars | 8 |
| Trade Docks | Admiralty 4 | 3 | merchant voyages | 9 |
| Officers' Club | Admiralty 5 | 3 | captains | 10 |
| Lighthouse | Admiralty 5 | 4 | seas, and later the Empire map | 10, 11 |

## 8. Parts, in build order

| Part | Title | Depends on | Flag |
| --- | --- | --- | --- |
| 1 | City core — economy, buildings, timers, salvage (rules + server) | — | `core` |
| 2 | The city screen — plots, pen-drawn construction, collecting | 1 | `core` |
| 3 | Shipyard and Stationer's Shop — cosmetics | 1, 2 | `cosmetics` |
| 4 | Bounty Board and Captain's Log | 1, 2 | `bounties` |
| 5 | Naval Academy — sonar net, decoy buoy, minesweeper | 1, 2 | `academy` |
| 6 | Harbour raids — rules and server | 1, 5 | `raids` |
| 7 | Harbour raids — client, defence log, replays | 6, 2 | `raids` |
| 8 | Fleets and fleet wars | 6, 7 | `fleets` |
| 9 | Port Gazette, daily puzzle, trade voyages | 2, 4 | `gazette`, `voyages` |
| 10 | Captains and new seas | 5 | `captains`, `seas` |
| 11 | Living city, World Boss, Empire map | 2, 6 | `worldBoss`, `empire` |

Parts 1–2 are the spine: nothing else works without them. Parts 5–7 are the centrepiece.
Parts 3, 4, 9, 10, 11 can be reordered to taste. **Do not start a part until the previous
one it depends on is merged and green.**

## 9. Definition of Done (every part)

A part is finished when all of this is true:

1. `tsc --noEmit` clean, lint clean, **no new `any`** in new files.
2. Every existing test still passes. No existing test was weakened or deleted to make a
   new one go green (if one had to change, it is listed in the report with a reason).
3. New pure rules have unit tests covering every rule in the spec, including the golden
   scenarios listed in the part, at ≥ 90% line coverage for those modules.
4. Server endpoints have integration tests: happy path, every typed error, idempotency
   (same `requestId` twice), concurrency (two calls at once must not double-credit), and
   authorisation (user A cannot touch user B).
5. Client state/reducers have tests; at least the key screens have render tests if the
   repo already has a component test setup.
6. The manual QA checklist at the end of the part has been run on a real Android device
   or emulator, landscape, and the result pasted into the report.
7. Feature flag exists, defaults off, and the app behaves exactly as before when off.
8. Migration is written, idempotent, re-runnable, and tested on a copy of a real profile.
9. Telemetry events from the part are emitted.
10. `docs/port-city/progress/part-NN-report.md` exists: what was built, what deviated from
    the spec and why, what is still open, how to test it by hand.

## 10. How the agent should work

- **Read before you write.** Start every part by mapping the real code: the engine's
  types, how the server validates a match action, how the client stores profile state,
  what the ink kit exposes. Write that map into the plan file. Do not guess an API.
- **Plan first.** `docs/port-city/progress/part-NN-plan.md`: files to add, files to
  touch, the order, the risky bits, the tests you will write. Then implement.
- **Small steps.** Rules → tests → server → tests → client → tests. Never a big bang.
- **Never invent a number.** Every number is in these docs. If one is missing, propose it
  in the plan and write it into `DECISIONS.md`.
- **Never weaken fairness.** If a shortcut would let the client write a balance or learn
  a hidden cell, stop and report instead.
- **Dependencies.** Prefer what `package.json` already has. Anything new needs a one-line
  justification in the plan and must work on Expo SDK 57 / React Native, new architecture.
- **The reference implementation** in `docs/port-city/reference/` is a working, tested
  model of the new rules (city economy, raids, the three new items) with 80 passing
  tests and the balance simulations that produced the numbers in these docs. Use it as
  an executable spec: port the behaviour and the test scenarios into the real engine.
  Where it disagrees with the shipped engine about an **existing** rule, the shipped
  engine wins and you note it. Where it disagrees with these docs about a **new** rule,
  the docs win.

## 11. Glossary

| Term | Meaning |
| --- | --- |
| Salvage | Steel earned from enemy ships you sank; lands in the Scrapyard, not the wallet |
| Dock worker | A builder. Two to start, up to four |
| Harbour | Your raidable board: your fleet plus defences placed under a harbour fuel budget |
| Harbour fuel | The defence budget from Coastal Command (separate from the 260 match fuel) |
| Raid fuel | The offensive budget from the Armory, spent on the kit you take into a raid |
| Shell | A raid's currency. A hit hands the shell back |
| Renown | The raid ladder. Unlike rank points, it can fall |
| Ink | Captain's Log experience |
| Pirate cove | A server-built PvE harbour used when no human target fits |
| Ghost | Any pre-computed server-side opponent; never presented as a human |

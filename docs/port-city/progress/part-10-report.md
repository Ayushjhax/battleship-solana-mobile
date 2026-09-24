# Part 10 — Captains and new seas: report

**Flags:** `portCity.captains`, `portCity.seas`. Both default off.
**Status: engine, validation, server, protocol and the playable client path complete. The
Officers' Club recruiting economy and the terrain art pass are not built, and are named in §8.**

| Gate | Result |
| --- | --- |
| App suite (without the heavy generator file) | **1348 passed / 75 files** (Part 10 baseline: 1266 / 69) |
| App generator file (its own file, long timeout) | **10 passed** — see §4 |
| Server suite | **435 passed / 32 files** (Part 10 baseline: 406 / 25) |
| `tsc --noEmit` both sides | clean (outside the pre-existing `docs/port-city/reference/` set) |
| `eslint .` | clean |
| `regression-winrate` after both halves | Classic **50.2 % / 100 moves**, Advanced **50.2 % / 100** — identical to the baseline |

> **Note on the totals.** The working tree gained unrelated Part 11 work
> (`src/engine/empire/`, `server/src/liveWorld.ts` and their tests) while Part 10 was being
> built. Part 10's own additions are 68 app tests (captains 28, seas 25 + 4 harbour, AI 1,
> generator 10) and 17 server tests (flag/wire 5, Rosa salvage 3, season rotation 5, ranked
> terrain 4). Everything above is green together.

---

## 1. The regression, before and after

Measured with the committed harness, 500 seeded Normal-vs-Normal games per mode, engine only:

| | Before Part 10 | After 10A | After 10B | Bar |
| --- | --- | --- | --- | --- |
| Classic, seat A win rate | **50.2 %** | 50.2 % | **50.2 %** | < 2.0 |
| Classic, median moves | **100** | 100 | **100** | ≤ 2 |
| Advanced, seat A win rate | **50.2 %** | 50.2 % | **50.2 %** | < 2.0 |
| Advanced, median moves | **100** | 100 | **100** | ≤ 2 |
| Rejected actions across 1,000 games | 0 | 0 | 0 | 0 |

Zero movement on every measure. Both new rule sets default to "none" and "water", so the
only way these numbers could move is if an existing rule moved.

Three existing tests changed, all key-set pins that exist to fail when a public shape grows
(§5): `view.test.ts`'s enemy keys, `raid/__tests__/secrecy.test.ts`'s `RaidView` keys, and the
two `PlacementSnapshot` test helpers. No test was weakened or deleted.

---

## 2. Part 10A — the six captains

### The engine

`src/engine/captains.ts` is the roster and the five hooks — `onMatchStart`,
`onShotResolved`, `onTorpedoWouldStrike`, `onItemHit`, `onShipSunk`. Each ability is a small
pure object implementing only the hooks it needs; each hook returns a decision and the call
site (which already owns the mutable working board) applies it. The ability's one-shot state
is `PlayerState.captainUsed`, so a replay from the same seed and actions re-derives every
firing. Every firing emits one `CAPTAIN_ABILITY` event, which is what the match log persists.

| Captain | Fuel | Mechanism, and the trap it avoids |
| --- | --- | --- |
| **Berhan** | 45 | The first plain FIRE that resolves to MISS flips `keepsTurn` in `reduce`. A hit does not spend it; a mine is not a miss and does not spend it; arsenal fire never reaches the hook. |
| **Mara** | 25 | First hit on each AA gun sets `damaged` and **leaves the cell unmarked** — a mark means "never shootable again", so marking it would make the second hit unreachable. The gun still intercepts (`!destroyed`). See D34. |
| **Ivo** | 15 | When the second layout lands, counts the enemy's mines/guns/nets/decoys — counts only, never cells — and emits it once. |
| **Tomas** | 30 | `torpedo()` skips the first intact ship cell it would strike and carries on down the row. A decoy still stops the run (a decoy is not a ship); the second torpedo is normal. |
| **Rosa** | 0 | Implements no hook. `salvageBases` floors her +25 % onto the base (D35). |
| **The Old Captain** | 20 | The first of the defender's ships to sink adds `radar-free-1` to their own board, usable like any radar. One event, one grant. |

`validateSubmission` gains the captain: the roster id is validated, Classic refuses any
captain, and the fuel joins the same 260 check. `submitLayout` stores it; `projectView`
exposes `you.captainId/captainUsed` **and** `enemy.captainId/captainUsed`, which is the
arena-reveal counterplay the design asks for.

### Integration

- **Wire:** `ready` carries an optional `captainId`; `PROTOCOL_VERSION` 2 → 3 with the
  deferred gate — a client below 3 is refused at `queue` only while `portCity.captains` (or
  `.seas`) is on. With every flag off, an old client queues exactly as before (tested).
- **Server:** `Room.handleReady` passes the captain to the same reducer the client runs; if
  the flag is off the captain is refused with a typed error, not silently dropped.
- **Rosa:** `salvageBases` applies her +25 % per seat, floor, before the SQL Scrapyard bonus.
- **AI:** Hard brings Berhan (`buildBattleSetup`), Easy and Normal bring none, the online bot
  brings none. `chooseMove` itself is untouched — a captain is not an AI decision.
- **Client:** the placement flow has a captain picker (Classic hides it), the fuel gauge and
  shop budget around the captain's cost, the reveal cards and the battle HUD show each
  captain, and `applyEvent` handles the damaged-gun case so the second hit stays tappable.

### The tests (`src/engine/__tests__/captains.test.ts`, 28)

Every ability: the trigger fires exactly once (for Mara: once per gun, destroyed on the
second hit); the right fuel and the 260 rejection; the opponent sees the captain and nothing
else; a scripted replay reproduces the event list; Classic refuses every captain. The one the
design names specifically is **Rosa's differential**: the same seeded AI-vs-AI game played
with and without her, comparing every event, every mark, every hit and every arsenal flag —
identical, three seeds.

---

## 3. Part 10B — terrain and the five seas

### The model

`src/engine/terrain.ts` holds the three cell types, the five fixed tables (written as chart
strings so they are readable and hand-tunable), the season rotation and the Lighthouse
ladder. `MatchState.terrain` and `PlayerView.terrain` are public by construction: the sea is
the board, not knowledge about it, so it lives beside the marks and carries no ship or item
information. Classic forces `WATER` even if a terrain is handed to `createMatch`.

Rules, exactly as implemented:

| Place | Rule |
| --- | --- |
| placement | island: no ship or item; reef: only ships of length ≤ 2 (items fine); halo rule unchanged |
| FIRE | an island is refused, costs nothing, consumes no turn |
| bombs / atomic | island cells are skipped: no mark, no event, `resolves: false`, excluded from `resolvedCells` |
| torpedo | stops dead on an island (path ends there, `hitAt: null`); a ship before it is still hit |
| submarine | cannot surface on an island |
| radar | unchanged — counts ships, and a test pins that it cannot count an island |
| auto-reveal | halo cells in fog do not hatch; cells outside the fog do |
| decoy exposure | an island neighbour counts as resolved (D38), or a legal decoy beside land could never expose |
| AI | `unknown()` excludes islands, so every list (hunt, target, arsenal) inherits it |
| raids | `RaidConfig.terrain` is snapshotted, `HarbourLayout.sea` is the defender's choice, `RaidView` carries the sea |

### The seas

| Sea | Cells | What it does to a game |
| --- | --- | --- |
| Open Sea | none | the control |
| Archipelago | 7 islands | shrinks the effective board; torpedoes much weaker |
| Coral Reef | reef across D–F | long ships squeezed top and bottom |
| Fogbank | fog over columns 6–10 | halos stop revealing; the slowest sea to clear |
| The Strait | island chain down column 5, reefs at both edges | two small seas joined in the middle |

### The two generated proofs (§4)

- **100,000 legal fleet placements per sea.** `autoPlaceFleet` runs 100,000 times on each
  real sea and every result goes through `validateLayout`; the first illegal fleet would fail
  the build. All five pass (~30–45 s each; 172 s for the whole file, which has long timeouts
  and lives on its own).
- **Shuffle: 10,000 attempts per sea, zero failures** — legal layout every time, ~3.1–4.8 s
  per sea.

### How much each sea changes the game

200 seeded AI-vs-AI games per sea, Normal both sides, advanced mode with an empty arsenal
(terrain requires advanced; Classic ignores it). Median shots to clear a board:

| Sea | median | best | worst |
| --- | --- | --- | --- |
| Open Sea | **101** | 65 | 137 |
| Archipelago | **96** | 50 | 127 |
| Coral Reef | **101.5** | 57 | 137 |
| Fogbank | **122** | 76 | 160 |
| The Strait | **94.5** | 51 | 124 |

The reading: islands make the board *smaller*, so Archipelago and the Strait are faster to
clear; Fogbank is materially slower (+21 median) because a sunk ship stops hatching its
fogged halo, so the search space stays open; Coral is neutral because the fleet simply
adapts. The test also asserts zero island shots across all 1,000 games and that every game
converges.

### Ranked, the season sea and the Lighthouse

- `seasonSeaFor(season)` is an eight-season cycle with Open Sea at every even position, so
  "at least every other season" is structural (a 200-season walk is a test).
- The matchmaker snapshots `currentSeasonSea(now)` into every online room (bot fallback
  included); both `matched` frames carry the same `sea`, and both views carry the terrain.
  With the flag off, the frame is byte-for-byte as before (no `sea` key) and the board is
  water.
- `SEASON_SEA` is the ops override; a typo falls back to the rotation rather than failing
  ranked.
- The Gazette edition carries the season sea and the screen prints it, so the season is
  announced before placement.
- `/config` carries the season sea (unauthenticated), so a ranked player can arrange a legal
  fleet **before** queueing; the placement screen uses it for online matches.
- The Lighthouse gates non-ranked play: one sea per level (D36), enforced server-side for the
  harbour (`validateHarbour` → `sea-locked`) and client-side for offline/hot-seat. Ranked
  never consults it — that is the integrity rule.
- Your own harbour: `HarbourLayout.sea` rides the existing `layout` jsonb (no migration), the
  sea is validated against the Lighthouse, and a raid snapshots that terrain so a replay is
  exact. Coves stay on Open Sea; nothing in the docs asks for more.

### Client

`GridBoard` gained a `terrain` prop (islands in ink hachure, reefs in dots, fog a faint wash,
drawn under the marks; the 10×10 path only), `DualBoards` draws it on both boards, the battle
screen passes the view's terrain, and the placement flow has a sea picker plus terrain-aware
drag previews and Shuffle.

---

## 4. Tests added

| File | Tests | Covers |
| --- | --- | --- |
| `src/engine/__tests__/captains.test.ts` | 28 | the six abilities, fuel, Classic, reveal, replay, Rosa differential |
| `src/engine/__tests__/seas.test.ts` | 25 | every rule in §3, the tables, season rotation, Lighthouse ladder, raid terrain, replay |
| `src/engine/__tests__/seas-generator.test.ts` | 10 | 100,000 placements × 5 seas; Shuffle 10,000 × 5, zero failures |
| `src/engine/__tests__/seas-ai.test.ts` | 1 | 1,000 games: no island shots, convergence, the medians above |
| `src/engine/raid/__tests__/harbour.test.ts` | +4 | sea gating, terrain legality, Open always legal |
| `server/tests/integration/captains-match.test.ts` | 5 | flag off refuses; flag on reveals to both; Classic refuses; protocol gate; flags-off old client unaffected |
| `server/tests/unit/captains-salvage.test.ts` | 3 | Rosa's +25 %, floored, per seat |
| `server/tests/unit/seas.test.ts` | 5 | rotation, override, fallback, announcement |
| `server/tests/integration/seas-match.test.ts` | 4 | ranked one sea both seats; view terrain; flags-off water; Classic water |

---

## 5. Existing tests that changed

All three are shape pins whose stated job is to fail when a public type grows; each was
extended, not weakened:

1. **`src/engine/__tests__/view.test.ts`** — the enemy view's exact key set now includes
   `captainId` and `captainUsed`, and the top-level set includes `terrain`. These are public
   by design (the arena reveal; the sea). The leak greps are untouched and still run.
2. **`src/engine/raid/__tests__/secrecy.test.ts`** — `RaidView`'s key set includes `terrain`.
   `RaidView` still has no field that can hold a layout, and the 500-raid fuzz is untouched.
3. **`src/features/battle/__tests__/setup.test.ts` and
   `tests/regression/arsenal-missing-in-battle.test.ts`** — their `PlacementSnapshot` helpers
   gained `captainId`/`seaId`/the hot-seat captain fields. No assertion changed.

---

## 6. Deviations from the spec, and readings taken

- **Mara fires per gun, not once for the whole match** (D34) — the roster sentence and the
  generic once-rule conflict; the roster wins, and every gun's survival is still recorded.
- **A decoy beside an island counts the island as a resolved neighbour** (D38) — otherwise a
  legal placement is permanently un-exposable.
- **The season number is the 28-day period from the Unix epoch**, not a moving DB row, which
  does not exist yet. `seasonSeaFor(season)` takes the id unchanged when it does.
- **`PROTOCOL_VERSION` is 3**, not 2; the minimum needed to draw captains and terrain is 3,
  and the academy's minimum stays 2. The gate composes.
- **The full terrain tables are public to the AI**, which is the design: the sea is announced
  and drawn, so nothing is leaked by letting `chooseMove` read it.

---

## 7. Where the captain/sea choices live in the client

- The placement flow owns both pickers (top strip), gated by ruleset and mode.
- Online: the rank sea arrives from `/config` before placement; the picker collapses to a
  label because the Lighthouse must not change it.
- Offline/hot-seat: the picker cycles the unlocked seas (Lighthouse level from the cached city
  snapshot; Open only when there is no snapshot).
- Harbour: the sea picker sits on the defence editor and the server refuses a locked or
  illegal combination on save.

---

## 8. Not done (named, not claimed)

- **Officers' Club recruiting** (coins / Berhan's Hard achievement): the docs give no price
  table and no acceptance criterion. Captains are selectable from the roster; nothing grants
  them yet. This is the one visible gap between this report and `part-10 §10A`'s "Recruiting".
- **A dedicated Officers' Club screen.** The picker is in the placement flow.
- **Terrain line art beyond the ink vocabulary.** Islands/reefs/fog draw from the existing
  rough kit; a bespoke sprite set is an art pass.
- **Cove seas** — pirate coves stay on Open Sea.
- **Manual QA on a device.** No APK in this environment, so no device-test log; the same
  honesty as Part 9's report.
- **Part 9's open items are deliberately not folded in here** — D32's puzzle-share policy is a
  product call, and the six `DaySummary` nulls are a per-day facts row on the match settlement
  path. Part 10 touches that path for Rosa, but the two changes are independent and mixing
  them would make both harder to review.

---

## 9. How to test this by hand

```bash
echo 'PORT_CITY_CAPTAINS=on' >> server/.env
echo 'PORT_CITY_SEAS=on'     >> server/.env
echo 'SEASON_SEA=archipelago' >> server/.env   # pin a season for the test
npm run server && npm start -- --dev-client
```

1. **Captains.** Advanced placement shows the captain picker. Pick Berhan (45) and note the
   fuel gauge and the shop both account for it. Miss your first shot: the turn stays yours and
   the log shows the ability. Miss again: it does not.
2. **Mara.** Place two AA guns, bring Mara, and shoot a gun. It is damaged, the cell stays
   shootable, and shooting it again destroys it. Fly a plane down its row: still intercepted.
3. **Tomas.** Have the opponent bring Tomas and run a torpedo row with a boat first: the
   torpedo passes under it to the next ship.
4. **Old Captain.** Sink their first ship; a free radar appears in their arsenal for the rest
   of the match.
5. **Rosa.** Bring her and check the Result screen reads +25 % salvage (server-credited).
6. **Classic.** No captain picker, and the server refuses one if forced.
7. **Ranked sea.** Queue advanced: the arena reveal announces the season sea and the board
   draws it on both sides. Islands cannot be tapped; a torpedo run stops on one; sinking a
   ship beside fog shows only the un-fogged halo.
8. **Shuffle** on every sea: always finds a legal layout.
9. **Harbour.** Set the harbour to Archipelago with the Lighthouse at level 1; save; raid it
   (or a cove with your own account) and watch the terrain and the torpedo rules apply. Try a
   higher sea at level 0: refused with a typed `bad-harbour`.

---

## 10. Files

```
src/engine/       captains.ts  terrain.ts
src/engine/       types.ts  match.ts  shots.ts  arsenal.ts  placement.ts  ai.ts  index.ts
src/engine/raid/  types.ts  raid.ts  harbour.ts  view.ts
src/state/        placement.ts  battle.ts
src/fx/           applyEvent.ts
src/net/          protocol.ts  match-client.ts
src/features/     offline/LocalMatch.ts  battle/setup.ts  battle/Hud.tsx
src/board/        GridBoard.tsx  DualBoards.tsx
src/engine/gazette/edition.ts
src/daily/api.ts  src/city/features.ts  src/city/types.ts  src/raid/{api,store,types}.ts
src/raid/ui/useHarbourEditor.ts
server/src/       seas.ts  room.ts  matchmaker.ts  protocol.ts  ws.ts  index.ts
server/src/raid/  service.ts  routes.ts
server/src/city/  salvage.ts
server/src/daily/service.ts
app/(game)/       placement.tsx  searching.tsx  battle.tsx
app/gazette.tsx
src/engine/__tests__/  captains.test.ts  seas.test.ts  seas-generator.test.ts  seas-ai.test.ts
server/tests/     integration/captains-match.test.ts  integration/seas-match.test.ts
                  unit/captains-salvage.test.ts  unit/seas.test.ts
docs/port-city/progress/  part-10-plan.md  part-10-report.md  DECISIONS.md (D33–D38)
```

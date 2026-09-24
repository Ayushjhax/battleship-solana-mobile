# Part 10 — Captains and new seas: implementation plan

**Status:** plan only. **The engine has not been touched.**
**Read before planning:** `part-10-captains-seas.md`, `00-OVERVIEW.md`, `NUMBERS.md`,
`CORRECTIONS.md`, `progress/REPO-MAP.md`, `progress/part-05-plan.md` and report,
`DECISIONS.md` (esp. D23, D32), `src/engine/{types,match,shots,arsenal,placement,ai}.ts`,
`src/engine/raid/*`, `server/src/{room,matchmaker,protocol,features}.ts`.

**Baselines taken before any edit (this is the regression reference):**

| Suite | Command | Result |
| --- | --- | --- |
| app | `npm test` | **69 files, 1266 tests, all passing** (27.3 s) |
| server | `cd server && npm test` | **25 files, 406 tests, all passing** (67.1 s) |
| regression harness | `npx vitest run src/engine/__tests__/regression-winrate.test.ts` | recorded in §5 |

---

## 0. Why this part is like Part 5

Parts 6–9 built new subsystems *beside* the match. Part 10 changes the match itself:
`reduce()`'s validation, `resolveCell`'s resolution order, the placement rules, the
generator, the AI and the wire. A mistake here is a wrong shot in a live ranked match,
on both clients at once, with the server agreeing.

The guard is the same as Part 5's: **prove nothing else moved.** The existing 1266 app
tests and 406 server tests must pass untouched; the 500-game win-rate harness must not
move beyond its bar; the golden resolution-order test stays green. The new rules ship
behind `portCity.captains` and `portCity.seas`, both default off.

The two halves are planned and built **separately**: 10A ships fully green before 10B
touches a file. They touch the same modules (`types`, `shots`, `placement`, `ai`,
`match`) but not the same rules, and a joint landing would make a regression in one
indistinguishable from the other.

---

## 1. The two hard problems, named up front

### 1.1 A captain ability must not be able to fire twice, and must not need to

`reduce()` is pure; the same action list must replay to the same events. The ability
"used" flag therefore lives in `MatchState` (`PlayerState.captainUsed`), not in a
closure or a module variable. Every firing emits one `CAPTAIN_ABILITY` event, which is
what `appendMatchEvent` persists and what the replay re-derives. The test for every
ability is the same shape: fire the trigger, assert exactly one ability event; fire it
again, assert still exactly one.

**Mara is the one exception to "one firing"** and needs a decision, not a dodge: the
roster says *"each of your AA guns survives its first hit"*. That is up to three
survivals (one per gun), and the doc's generic "fires at most once" cannot mean "only
one of your guns is reinforced" without contradicting its own sentence. **Chosen: one
survival per gun**, tracked by a new `damaged` flag on the item; each gun's first hit
emits its own `CAPTAIN_ABILITY`. Recorded as a decision.

### 1.2 Terrain must be public without leaking anything else

The sea is announced before placement (the client must not place a ship on an island),
so the whole terrain grid is public and lives in `PlayerView.terrain` beside the marks.
Islands, reefs and fog are not "learned" — they are the board. No `Marks` entry, no
event, no secrecy test change. The existing `view.test.ts` secrecy greps stay valid
because terrain contains no ship or item information by construction (the seas are
fixed tables; a test pins that every sea is built only from the three public cells).

---

## 2. Decisions this part needs (no number in the docs)

Written into `DECISIONS.md` as D33–D38 when implemented.

| # | Missing | Chosen | Why |
| --- | --- | --- | --- |
| D33 | Captain ids and names are prose only | `berhan` 45 · `mara` 25 · `ivo` 15 · `tomas` 30 · `rosa` 0 · `oldCaptain` 20 | Stable, readable engine ids in the existing style; fuel exactly as §Part 10A |
| D34 | Mara's "each gun" vs "fires at most once" | **Per gun.** One survival each, `damaged` on the item, one ability event per survival | The roster sentence is explicit; the generic once-rule is enforced per gun |
| D35 | Rosa's +25% rounding and stacking | **Floor** on the base in `salvageBases`; the Scrapyard bonus compounds on top, as it already does | Same floor discipline as D2 and `credit_salvage`; no new arithmetic path |
| D36 | Lighthouse level → seas | L1 Archipelago, L2 Coral Reef, L3 Fogbank, L4 The Strait; Open Sea always | One sea per level matches every other building's value column; no number exists |
| D37 | Season sea rotation | 8-season cycle `open, archipelago, open, coral, open, fogbank, open, strait`; env `SEASON_SEA` overrides for ops | Open Sea is exactly every other season, so the integrity rule is structural; the cycle is a table, not arithmetic |
| D38 | A decoy beside an island could never expose | Exposure counts an island neighbour as resolved | An island is public knowledge; otherwise a legal decoy placement is permanently un-exposable, which is a bug, not a rule |

---

## 3. Part 10A — Captains

### 3.1 Engine

**New `src/engine/captains.ts`** — the roster and the hooks, pure, no imports outside
`src/engine`:

- `CaptainId` union + `CAPTAINS` table `{ id, name, fuel, blurb }`; `captainFuel(id)`.
- The five hook objects the doc names, each implementing only the hooks it needs:
  `onMatchStart` (Ivo), `onShotResolved` (Berhan), `onTorpedoWouldStrike` (Tomas),
  `onItemHit` (Mara), `onShipSunk` (Old Captain). Rosa implements none — her ability
  is a settlement fact.
- Helpers the resolvers call: `itemCounts(board)`, `grantFreeRadar(board)`, etc.
- `isCaptainId()` for validation.

**`types.ts`**
- `PlayerState` + `captainId: CaptainId | null`, `captainUsed: boolean`.
- `MatchAction.SUBMIT_LAYOUT` + `captainId?: CaptainId`.
- `MatchEvent` + `{ type: 'CAPTAIN_ABILITY'; playerId; captainId; at?; counts? }`.
  `playerId` is the **owner** of the captain (a defensive ability fires on the
  defender's behalf), documented in the union.
- `ArsenalItem` + `damaged?: boolean`; `RevealedItemView` + `damaged?: boolean`.
- `PlayerView` + `you.captainId/captainUsed` and `enemy.captainId/captainUsed` — public
  at the arena reveal by design.

**`match.ts`**
- `validateSubmission(mode, ships, arsenal, unlocks?, captainId?)`: unknown id is a
  rejection; Classic rejects any captain; fuel = arsenal + captain, checked against the
  unchanged `FUEL_BUDGET` 260. `LayoutCheck` already returns `fuel`, so the client and
  the server stay in step.
- `submitLayout`: stores the captain; on the second `LAYOUT_ACCEPTED` (the match
  starts) runs Ivo's `onMatchStart` and emits her event.
- `FIRE` path: Berhan's `onShotResolved` flips the first plain miss to `keepsTurn`.

**`shots.ts`**
- `WorkingBoard` carries `captain: { id, used }` (and, from 10B, `terrain`), so a deep
  resolver can spend an ability; `withDefenderBoard` is the single place the usage is
  transferred back onto `PlayerState`. `openBoard(board, opts?)` defaults to no captain,
  so every existing call is byte-identical.
- `resolveCell`: Mara's item branch (`damaged` instead of destroyed, cell deliberately
  left unmarked so the second hit is reachable); Old Captain's ship-sunk branch (grants
  `radar-free-1` to the defender's board, once, on the first sunk ship).

**`arsenal.ts`**
- `torpedo()`: Tomas's `onTorpedoWouldStrike` skips the first intact ship cell and
  carries on down the row; one `CAPTAIN_ABILITY` event, then the next would-strike is a
  real hit.
- Radar, minesweeper, bombers and the AA/sonar interception are untouched.

**AI** — Hard brings Berhan: the *offline* match builder (client-side `LocalMatch` and
the demo) puts `captainId: 'berhan'` on Hard only. `chooseMove` itself is unchanged (a
captain is not an AI decision); Easy, Normal and the online bot bring none.

### 3.2 Server + protocol + client (thin, but real)

- `server/src/protocol.ts` and `src/net/protocol.ts`: `LayoutPayload` + `captainId?`;
  `PlayerView` mirrors the two new fields; `PROTOCOL_VERSION` 2 → 3 with
  `MIN_PROTOCOL = 3` **only while `portCity.captains` is on** (same deferred gate
  Part 5 built).
- `server/src/room.ts`: `handleReady` passes the captain through; when the flag is off
  a captain is refused (typed rejection), so the default-off world is unchanged.
- `server/src/city/salvage.ts`: Rosa's +25% (D35) applied per seat.
- Client: the placement store holds `captainId` + `setCaptain` (Classic refuses);
  `searching.tsx` sends it in `ready` and `validateSubmission` sees it; the arena
  reveal shows the captain on each player card once the view carries it; `applyEvent`
  treats `CAPTAIN_ABILITY` as a no-op commit (battleEffects already defaults safely).

### 3.3 Tests — `src/engine/__tests__/captains.test.ts`

Per the doc, one block per captain:

1. trigger fires exactly once, never twice (for Mara: per gun, and a gun dies on its
   second hit);
2. the right fuel (45/25/15/30/0/20) and `validateSubmission` rejects a layout whose
   arsenal + captain exceeds 260;
3. the opponent sees the captain in `projectView` and nothing else new;
4. a replay (same seed + same actions) reproduces the ability and the events exactly;
5. Classic rejects a captain;
6. **Rosa differential**: the same seeded match played twice, once with Rosa and once
   without, comparing every event, every mark, every hit and every arsenal flag —
   byte-identical except the captain fields themselves.

Plus: the roster sums (all six at 0 + 45 + 25 + 15 + 30 + 20), `CAPTAIN_ABILITY`
ordering inside the event list, and the free radar being usable through `USE_ARSENAL`.

### 3.4 Order inside 10A

1. `captains.ts` + `types.ts` (no behaviour; suites stay green).
2. `shots.ts` + `arsenal.ts` hooks; tests.
3. `match.ts` validation + Ivo + Berhan; tests.
4. Run the full app suite; then the win-rate harness.
5. Server/protocol/client; server suite; then 10B.

---

## 4. Part 10B — New seas

### 4.1 The terrain model

**New `src/engine/terrain.ts`** (pure):

```ts
export type TerrainCell = 'water' | 'island' | 'reef' | 'fog';
export type Terrain = readonly (readonly TerrainCell[])[]; // [r][c], 10 x 10
export const WATER: Terrain;                     // the default, frozen
export const SEAS: readonly SeaSpec[];           // the five fixed tables
export type SeaId = 'open' | 'archipelago' | 'coral' | 'fogbank' | 'strait';
```

The five tables (hand-tuned, fixed, never generated):

| Sea | Cells |
| --- | --- |
| Open Sea | none |
| Archipelago | 7 islands scattered |
| Coral Reef | reef across rows D–F (r 3–5), every column |
| Fogbank | fog across columns 6–10 (c 5–9), every row |
| The Strait | islands down column 5 (c 4) with rows 3–5 open, reefs on both outer columns |

Also in this module: `seasonSeaFor(season)` (D37) and `unlockedSeasFor(lighthouseLevel)`
(D36), so the rotation and the unlock ladder are one testable table each.

### 4.2 Engine rules, exactly

| Place | Rule |
| --- | --- |
| `placement.validatePlacement` | island cells are never placeable; reef cells accept ships of `len <= 2` only |
| `placement.validateArsenalPlacement` | island cells are never placeable; reef is normal for items |
| `placement.autoPlaceFleet` | takes an optional `Terrain`; every existing call defaults to water |
| `shots.resolveShot` | FIRE at an island is rejected (no turn consumed) |
| `shots.resolveCell` | island guard returns nothing at all (belt-and-braces for footprints) |
| `shots` auto-reveal | halo cells in fog are suppressed; the rest still hatch |
| `shots.exposeDecoys` | an island neighbour counts as resolved (D38) |
| `arsenal.drop` | island cells are skipped: bombs and blasts do nothing there |
| `arsenal.atomicBomber` | `resolvedCells` excludes islands |
| `arsenal.torpedo` | a run stops dead on an island (path ends there, `hitAt: null`) |
| `arsenal.submarine` | cannot surface on an island |
| `arsenal.radar` | unchanged — it counts `ships`, so it cannot count an island; a test pins it |
| `ai` | `unknown()` excludes islands; every candidate list inherits it; a test drives 200 seeded games per sea and asserts no FIRE ever targets an island and the game ends |
| `raid` | `RaidConfig.terrain` (snapshotted, so a replay is exact); `HarbourLayout.sea`; `RaidView.terrain` |

### 4.3 Integration

- **Ranked** — `server/src/seas.ts` (server-side): `seasonSea(now)` reads the cycle or
  the `SEASON_SEA` env override, and the matchmaker passes `terrainForSea(...)` into
  `createRoom` for every online queue match, bot fallback included. Both players get the
  same `sea` in the `matched` frame. Ranked never consults a lighthouse.
- **The Gazette** — the edition gains `seasonSea`, rendered as a line, so the season is
  announced.
- **Lighthouse** — `unlockedSeasFor(level)` gates the non-ranked pickers (client) and
  the harbour (server): `validateHarbour` gains `lighthouseLevel` and refuses a locked
  sea; the harbour's `sea` rides the existing `layout jsonb`, so **no migration**.
- **Classic** — always Open Sea; `createMatch` refuses a non-water terrain in classic.
- **Client** — the placement store holds `seaId` + `setSea` (only unlocked seas, never
  in Classic); `GridBoard`/`DualBoards` gain a `terrain` prop that draws island, reef
  and fog in the existing ink vocabulary; the battle screen passes the view's terrain.

### 4.4 Tests

- `src/engine/__tests__/seas.test.ts` — every rule in the table above, the five tables
  are well-formed and fixed, ranked season sea (rotation property: Open at least every
  other season), the lighthouse ladder, Classic is Open only, a terrain match replays
  exactly.
- `src/engine/__tests__/seas-generator.test.ts` — **the two the instruction names**:
  1. each sea admits at least **100,000 legal fleet placements** (the generator is run
     100,000 times per sea and every result is checked with `validateLayout`);
  2. **Shuffle**: 10,000 attempts per sea, zero failures, every layout legal.
  Both carry explicit long timeouts and are their own file so the fast suite stays fast.
- `src/engine/__tests__/seas-ai.test.ts` — AI convergence and the no-island rule per
  sea; medians are measured here and printed, and the report carries the table.
- Server: season sea reaches both seats identically; harbour sea is gated by the
  lighthouse level and snapshots into the raid config; Classic is refused a sea.

### 4.5 Order inside 10B

1. `terrain.ts` + `types.ts` (types and tables only; green).
2. Placement rules + generator; tests.
3. Shots/torpedo/bomb/radar/auto-reveal; tests.
4. AI; tests + medians.
5. Raid config/view; server season sea + harbour; protocol + client; tests.
6. The two heavy generator tests; full regression.

---

## 5. Regression strategy (the part that matters)

1. **Nothing existing changes behaviour.** Defaults: no captain, water terrain. The
   existing 1266 + 406 tests must pass without a single edit; if one must change, that
   is a stop-and-report event, not a quiet patch.
2. **The win-rate harness.** `regression-winrate.test.ts` keeps its committed literals
   (Classic 50.2 % / 100 moves, Advanced 50.2 % / 100 moves). It is run on `HEAD` first
   (recorded in the report) and re-run after each half; the bar stays 2 points / 2 moves.
3. **A golden terrain resolution test**: the same board resolved on water and on each
   sea, pinning that water output is byte-identical to today and that terrain changes
   only the cells it is supposed to.
4. **The 500-game harness with the seas flag on**: AI-vs-AI on each sea must always
   terminate, and the per-sea medians are the report's headline number.
5. **Both flags off** is the default; a test asserts the engine with no captain and
   water behaves exactly as Part 9's engine did (the golden tests).

---

## 6. Not doing (named now, so it is not a surprise in the report)

- **Captain recruiting** (coins / the Berhan achievement): the docs give no price and
  no acceptance criterion, and the Officers' Club economy needs a table that does not
  exist. The roster, the fuel pricing and the validation ship; recruiting does not.
- **A new Officers' Club screen.** The picker lives in the existing placement flow.
- **Terrain art beyond the ink vocabulary** (hand-drawn island sprites): the board
  draws the three cells with the existing rough kit; a bespoke sprite set is Part 11's
  or an art pass.
- **Cove seas**: pirate coves stay on Open Sea; nothing in the docs asks for more.
- **The `DaySummary` nulls and D32's puzzle policy** from Part 9's report are separate
  product/backend questions; they are not silently folded into this part. If the part
  lands with room, the per-day facts row is the first follow-up.

---

## 7. Order of work

| # | Step | Gate |
| --- | --- | --- |
| 0 | Baseline app/server suites + win-rate numbers | recorded above |
| 1 | 10A engine: captains module, types, hooks | suites green, new tests green |
| 2 | 10A server/protocol/client | app + server green |
| 3 | 10A regression re-run | bar not moved |
| 4 | 10B engine: terrain module, placement, shots, AI, raid | suites green |
| 5 | 10B heavy generator + shuffle tests | 100k / 10k pass |
| 6 | 10B server/protocol/client/Gazette | app + server green |
| 7 | Full regression + per-sea medians | bar not moved |
| 8 | `part-10-report.md` + `DECISIONS.md` D33–D38 | written |

# Part 2 — The city screen: implementation plan

**Status:** plan only. No implementation code written yet.
**Read:** `00-OVERVIEW.md`, `part-02-city-screen.md`, `NUMBERS.md`, `progress/REPO-MAP.md`.

---

## 0. Blocker: Part 1 does not exist yet

`part-01-report.md` was on the read list. **It does not exist, and neither does any Part 1
code.** I wrote `part-01-plan.md` and stopped there, as that task instructed ("Stop and show
me the plan before writing implementation code"), and the go-ahead never came. Verified:

```
docs/port-city/progress/   REPO-MAP.md, part-01-plan.md        <- no part-01-report.md
src/engine/city/           does not exist
server/src/city/           does not exist
src/city/                  does not exist
supabase/migrations/       0001…0013 only, no 0014
git status                 clean except the two planning docs
```

Part 2 is "Depends on: Part 1" (`00-OVERVIEW.md` §8) and `part-02` §12.1 requires "the server
as the only source of numbers". Every surface this part renders — snapshot, `secondsLeft`,
costs, typed errors, `collect` — is Part 1's API.

**How I am proceeding.** This plan is written against the **contracts defined in
`part-01-plan.md`**, which specify them precisely: `CityWorld = { city, wallet }`,
`CityState.buildings[id] = { level, upgrading?, stored, lastAccrualAt }`, the thirteen typed
error codes, the seven endpoints, the `useCity` store with `freeWorkers` / `canAfford` /
`secondsLeft` / `collectable`, and `serverOffset`. Those are stable enough to design against.

Two consequences you should decide on:

1. **Build order.** I recommend Part 1 first. If you want Part 2 built now regardless, I will
   implement it against a local **`src/city/mock/`** fixture adapter behind the same store
   interface, so swapping in the real API later is a one-file change. Say which you want.
2. **Anything Part 1 changes, Part 2 inherits.** If the Part 1 contracts move during its
   implementation, the plot states and sheet copy move with them. I have kept every
   Part-1-shaped type in one file (`src/city/ui/contract.ts`) so that blast radius is small.

Everything below is complete and ready to execute either way.

---

## 1. The scene graph, and why overlays need no sync code

The single most important thing I found reading `app/city.tsx`: **the existing dashed slots
and the home harbour are already children of the transformed view.**

```tsx
// app/city.tsx:400-430 (today)
<GestureDetector gesture={gesture}>
  <Animated.View style={[styles.map, { left: view.cx - MAP_W/2, top: view.cy - MAP_H/2 }, mapStyle]}>
    <AssetSlot source={UI_ART.cityPort} w={MAP_W} h={MAP_H} … />
    {SLOTS.map((slot) => <Slot key={slot.key} slot={slot} />)}   // positioned in MAP UNITS
    <HomeHarbour … />                                            // positioned in MAP UNITS
  </Animated.View>
</GestureDetector>
```

`mapStyle` is `[{translateX: tx}, {translateY: ty}, {scale}]` on the **parent**. Anything
placed inside it with `position: 'absolute'; left: px; top: py` in map units inherits the
pinch, the pan and the clamp **for free**. There is no shared-value subscription to write, no
`useDerivedValue` per plot, no re-layout on gesture — which is exactly what §10 demands
("overlays are transforms only, never re-layouts").

So plots are siblings of the existing `Slot`s in the same container. The only conversion is
normalised → map units, done once:

```ts
const px = plot.x * MAP_W;                 // MAP_W = 800
const py = plot.y * MAP_H;                 // MAP_H = 1067  (round(800 * 1024/768))
// anchored bottom-centre:
left = px - PLOT_W / 2;  top = py - PLOT_H;
```

### The one thing that *does* need the shared value: tap targets

A fixed map-unit hit box shrinks on screen as you zoom **out**. At `view.minScale` (≈1.35 on a
typical landscape phone) a 120×80 map-unit plot is ~44×30 canvas units — under §10's "at least
32 dp in canvas units" on the short axis. So the hit area is **counter-scaled**:

```ts
// PlotHitArea — the only plot component that reads `scale`
const hit = useAnimatedStyle(() => {
  const k = Math.max(1, MIN_HIT_CANVAS / (PLOT_H * scale.value));  // grow when zoomed out
  return { transform: [{ scale: k }] };
});
```

One `useAnimatedStyle` per plot, all reading the same shared value, all on the UI thread. The
*visual* is never counter-scaled — only the invisible pressable. `scale` reaches plots through
a small `CityViewContext` rather than 15 props.

### Component tree

```
CityScreen                                    (app/city.tsx — unchanged wrapper)
└─ Scale backdrop="plain"                     (existing)
   └─ CityCanvas                              (existing, extended)
      ├─ GestureDetector  [pinch|pan|doubleTap]              EXISTING, untouched
      │  └─ Animated.View  style={mapStyle}                  EXISTING, untouched
      │     ├─ AssetSlot  UI_ART.cityPort                    EXISTING, untouched
      │     ├─ HomeHarbour                                   EXISTING, untouched
      │     ├─ AmbientLayer                    NEW  gulls, boat, crane arm
      │     └─ PlotLayer                       NEW  15 × Plot, memoised per state
      │        └─ Plot
      │           ├─ BuildingDrawing           NEW  tiered ink paths + strokeDashoffset
      │           ├─ PenNib                    NEW  only while building & !reduceMotion
      │           ├─ PlotRibbon                NEW  wraps TitleRibbon
      │           ├─ LevelPips                 NEW
      │           ├─ CollectBubble             NEW  bobbing coin/steel
      │           └─ PlotHitArea               NEW  counter-scaled Pressable
      ├─ CityHud                               NEW  (outside the transform)
      │  ├─ RankBadge                          EXISTING component
      │  ├─ CurrencyChip × 3 (coins/steel/gems)  EXISTING component, +steel kind
      │  ├─ WorkersChip                        NEW  → Workers' Lodge sheet
      │  └─ CollectAllRibbon                   NEW  ≥2 collectable
      ├─ CollectFlightLayer                    NEW  6–10 ink coins arcing to the chip
      ├─ BuildingSheet                         NEW  slides up over an ink wash
      ├─ WorkersSheet                          NEW
      ├─ CityTour                              NEW  six beats
      └─ OfflineBanner                         NEW  "No signal — the harbour master is out."
```

**`portCity.core` off** ⇒ `PlotLayer`, `CityHud`'s steel chip, `AmbientLayer`, the sheets and
the tour all return `null`, and the existing three `SLOTS` render exactly as today. The flag
is read once at the top of `CityCanvas`; the off-path touches no new code.

---

## 2. Ink kit reuse — the exact components

Nothing new is invented. Named precisely, from `src/ui/`:

| Need | Component / helper | Notes |
| --- | --- | --- |
| every stroke | `useRough()` → `roughRect`, `roughLine`, `roughPolygon`, `roughCircle`, `roughPath` | `roughPath` is the open polyline used for building silhouettes |
| render paths | `<RoughShape paths dash? opacity? />` | already supports `dash`, which the locked state needs |
| stable wobble | `hashString('plot-<buildingId>')` | §4's "seeded by `buildingId`" is literally this |
| sheet body | `<InkPanel w h seedKey padding fill>` | the building sheet and workers' sheet |
| buttons | `<InkButton label tone size w h seedKey>` | Build / Upgrade / Finish now / Collect / Cancel |
| icon buttons | `<InkIconButton icon size accessibilityLabel>` | sheet close, info |
| ribbons | `<TitleRibbon title w h size seedKey>` | "Build", "Admiralty 3", timer, "Collect all" |
| Captain lines | `<SpeechBubble text tail tailAt w seedKey>` | tour beats + locked-plot lines |
| Captain art | `<AssetSlot source={AVATARS.captain} …>` | as `app/city.tsx` already does |
| currencies | `<CurrencyChip kind value>` | **needs a `'steel'` kind added** |
| player card | `<RankBadge …>` | untouched |
| wrecks | `<ShipSprite shipClass orientation sunk />` from `src/board/ShipSprite` | §6's Scrapyard wrecks — reuse, do not redraw |
| canvas maths | `useScale()` → `s`, `toCanvas` | only for the HUD layer |
| tokens | `color.*`, `font.*`, `type.*`, `space.*` | no raw hex |

Two closed unions must be widened — both flagged in REPO-MAP as exactly this hazard:

- **`CurrencyChip.kind`** gains `'steel'` (an ink girder glyph beside the existing coin/gem).
- **`SFX_SOURCES`** gains `inkComplete`, `coinCollect`, `steelCollect`. The mixer already
  treats a `null` source as a silent no-op (`planeFlyby` ships that way today), so these land
  as keys immediately and get audio when files exist. `coinCollect` maps to the existing
  `coinFlow` file meanwhile. See §9 for what I need from you.

No new dependency. Reanimated 4, RNGH, react-native-svg and roughjs are all already here.

---

## 3. Plot coordinates

### The doc's table disagrees with the art in three places

I opened `assets/images/city/city-port.png` (768×1024, the pre-ink original) and compared it
to the three dashed slots already in `app/city.tsx:70-74`, which are known-good against the
art. Converting those to normalised bottom-centre:

| Existing slot | map units | normalised | art feature |
| --- | --- | --- | --- |
| `hall` (Admiralty) | x 118 y 506 w 120 h 80 | **0.22 / 0.55** | civic block below the cathedral |
| `docks` (Shipyard) | x 596 y 500 w 132 h 76 | **0.83 / 0.54** | container terminal, gantry cranes |
| `tower` (Lighthouse) | x 418 y 764 w 104 h 84 | **0.59 / 0.79** | the lighthouse headland |

`part-02` §2 says Admiralty and Shipyard sit on "the existing dashed slot" — but gives
y = 0.72 and y = 0.68, which are **0.17 and 0.14 below where those slots actually are**
(0.72 lands in the park; 0.68 lands in open water south of the docks). And it puts the
Lighthouse at 0.95/0.42, "the harbour mouth, far right" — but the art's lighthouse is a
drawn white tower on the rocky headland at **bottom centre**, and 0.95/0.42 is open sea.

The task says to nudge and write the final numbers back, so these are corrected rather than
reported as an inconsistency. **The existing slots win** — they were placed against the art.

### Proposed table

Plot box 120 × 80 map units (0.150 × 0.075 normalised), anchored bottom-centre. Derived from
the visible features; the three above are pinned to the existing slots.

| Building | x | y | Sits on | vs doc |
| --- | --- | --- | --- | --- |
| Naval Academy | 0.09 | 0.36 | the hill / high-rise block, upper left | ≈ |
| Officers' Club | 0.10 | 0.53 | the terrace beside the cathedral spire | moved from 0.22/0.63 (clashed with Admiralty) |
| Admiralty | **0.22** | **0.55** | civic block below the cathedral | **y corrected** from 0.72 |
| Stationer's Shop | 0.16 | 0.64 | the old town street | y 0.55 → 0.64 |
| Newsstand | 0.30 | 0.64 | corner of the same street | y 0.58 → 0.64 |
| Fleet Hall | 0.24 | 0.72 | the waterfront square by the park | ≈ |
| Harbour Master's Office | 0.20 | 0.42 | the pier head west of your marina | moved off the marina box |
| Fish Market | 0.44 | 0.545 | the quay just south of your marina | moved clear of the harbour box |
| Coastal Command | 0.52 | 0.40 | the promontory at the bridge's near footing | ≈ |
| Scrapyard | 0.63 | 0.59 | the yard at the near end of the bridge | ≈ |
| Trade Docks | 0.75 | 0.47 | the cargo cranes and warehouses | ≈ |
| Shipyard | **0.83** | **0.54** | the dry dock and cranes | **y corrected** from 0.68 |
| Armory | 0.72 | 0.19 | the rail yard / airfield behind the docks | ≈ |
| Foundry | 0.91 | 0.30 | the plant with the cooling towers and tanks | ≈ |
| Lighthouse | **0.59** | **0.79** | the lighthouse on the rocky headland | **moved** from 0.95/0.42 (open water) |

Plus the immovable `HARBOUR` box at map (236,392)–(404,488) = normalised x 0.295–0.505,
y 0.367–0.457, which every plot must avoid.

**These are a starting point, not final.** §2 of the task requires them nudged against the real
art and written back. The nudging is done with a dev harness, not by guessing:

> **City lab → "Plot overlay"**: draws all 15 boxes plus the harbour box and a 0.05 grid over
> the real `cityPort` art at 1×, with a long-press-drag to move one and a "copy table"
> button that prints the updated literal. Ten minutes of eyeballing beats ten iterations of
> arithmetic. The final numbers then go into `plots.ts`, into `part-02-city-screen.md` §2,
> and into the report.

The test (§11.1) enforces: every coordinate in 0…1; every catalogue building has exactly one
plot; no two boxes overlap at 1×; no box overlaps `HARBOUR`.

---

## 4. How a building draws itself

`src/city/ui/buildingArt.ts` — pure, no React, so it is unit-testable and can be eyeballed in
the kitchen sink.

```ts
export interface BuildingTier { paths: readonly PathSpec[]; }          // T1..T4
export function buildingArt(id: BuildingId, tier: 1|2|3|4): BuildingTier;
export function tierForLevel(level: number): 1|2|3|4;                  // 1-2,3-4,5-6,7-8
```

- **Procedural, seeded.** Every shape derives its seed from `hashString(`${id}-${n}`)`, so a
  plot wobbles identically on every render and across restarts — the rule CLAUDE.md §4 states
  ("a component that re-wobbles every render looks broken, not hand-drawn").
- **Silhouette vocabulary** assembled per `BuildingSpec.kind`: a footprint quad, a roof
  (gable / flat / saw-tooth), then 2–3 details per tier — windows, a door, hatching, a flag on
  a pole, a crane jib, a chimney, lamp dots. Higher tier = same silhouette **plus** strokes,
  never a different building. Max level re-colours the stroke to `COIN_GOLD`.
- **Paths are ordered** footprint → roof → details → hatching, and that order *is* the drawing
  order. Hatching paths are tagged `hatch: true` and only begin at `p > 0.85` (§4).
- **Progress reveal.** Each `<Path>` gets `strokeDasharray={len}` and
  `strokeDashoffset={len * (1 - localP)}`, where `localP` is the global `p` remapped onto that
  path's slice of the total ink length. `p = clamp01((now - startedAt) / (endsAt - startedAt))`
  with `now = Date.now() + serverOffset` — **never the raw device clock**.
- **Real art later** drops in as an SVG path set per tier behind the same `buildingArt()`
  signature, with no change at the call site. That is §4's "ship the system, not the art".

**Costs.** Path lengths are measured once per (id, tier) and memoised alongside `roughCore`'s
own cache. A plot re-renders only when its state changes; the 1 s tick is subscribed **only by
buildings currently under construction** (§10). At most two can exist (two dock workers), or
four with both bought — so the tick drives ≤ 4 nodes, never 15.

**Completion, once.** `useCity` keeps a `celebrated: Set<string>` keyed `${id}:${level}`. On
transition to built: last stroke snaps, `roughCircle` flourish, "Inked!" stamp (Bitter Bold,
2° tilt via `transform: [{rotate: '2deg'}]`), `playSfx('inkComplete')`, `haptic('rankUp')`
(the existing Success notification), level pip inks. Under `useReducedMotion()`: none of it —
straight to built, per §4's last line.

---

## 5. Sheet, HUD, tour, menu, result

**Building sheet** (`src/city/ui/BuildingSheet.tsx`) — `InkPanel` sliding from the bottom over
an ink wash (`color.ink` at ~0.12 opacity, **not** a black scrim). Name, `LevelPips`, one
Captain flavour line, a **Now → Next** row rendered in the building's own units from
`CITY_CATALOGUE` (`coins 12/h → 18/h`, `harbour fuel 50 → 70`, `salvage +0% → +5%`), a cost
row with the short resource in `color.inkRed` and the exact shortfall, one primary `InkButton`
and `Cancel job` / `Info` secondaries. Cancel confirms with "Half the steel comes back."

**Error copy is a table, not a string in a catch block** — `src/city/ui/captainCopy.ts` maps
every Part 1 code to a line, and §11.5 asserts the map is total:

| code | Captain |
| --- | --- |
| `no-free-worker` | "Both dock workers are busy. One finishes in {t}." |
| `needs-admiralty` | "Upgrade the Admiralty to {n} first." |
| `max-level` | "There is nothing left to add to it." |
| `not-enough-steel` | "{n} steel short." |
| `not-enough-coins` | "{n} coins short." |
| `not-enough-gems` | "Not enough gems for that." |
| `already-upgrading` | "That one is already on the drawing board." |
| `not-upgrading` | "Nothing is being built there." |
| `nothing-to-collect` | "Nothing to collect there yet." |
| `unknown-building` | "No such plot on my charts." |
| `rate-limited` | "One at a time, captain." |
| `version-conflict` | "The harbour master just updated the books. Try again." |
| `feature-off` | "The port is closed for the season." |

**HUD** — existing `RankBadge` top left untouched; top right gains a steel chip between coins
and gems. Numbers roll with a `withTiming` counter; a server-side change while the screen is
open flashes the chip once. `WorkersChip` ("Workers 1/2") sits under them.
`CollectAllRibbon` appears bottom right only at ≥ 2 collectables.

**Collect** — bubble pops, 6–10 tiny `roughCircle`/girder glyphs arc to the target chip over
420 ms with a stagger, then the number rolls **to the server's value**, never a local sum
(§12.1). Double-tap guarded by an in-flight ref per building (§11.4).

**Tour** (`src/city/ui/CityTour.tsx`) — the six beats from §7, reusing the existing tutorial
machinery's shape: a `STEPS` data array, `useTutorialTarget`-style registration so the
spotlight follows a plot wherever `plots.ts` puts it, wrong taps nudge rather than fail.
Gated on a new persisted `hasSeenCityTour` flag in the profile store (alongside the existing
`hasVisitedCity`), and replayable from Settings via a row copied from the existing
"Reset tutorial" row at `app/settings.tsx:116-122`.

**Menu badge** (`app/menu.tsx`) — a small `inkRed` dot on *Port city* when the cached snapshot
says anything is collectable or a job has finished; refreshed by a `GET /city` on menu focus,
throttled to once a minute.

**Result screen** (`app/(game)/result.tsx`) — one line under the coin fly: a wreck glyph and
"Salvaged 70 steel → Scrapyard", plus "+5% Scrapyard" when the bonus applied. It reads the
value the server returned with the settlement; it never recomputes salvage. Budget 400 ms, so
it mounts after the existing coin fly resolves and animates only opacity + translateY.

**Ambient** (`src/city/ui/AmbientLayer.tsx`) — 2 gulls on looping beziers, 1 boat crossing
every ~40 s, 1 crane arm swinging 8° every ~12 s. All Reanimated worklets, all inside the
transform, **28 animated nodes worst case** (under §9's 30), all `pointerEvents="none"` so
nothing sits under a tap target, all unmounted (not just paused) under `useReducedMotion()`.

---

## 6. Files

### Added — `src/city/ui/`

| File | Contents |
| --- | --- |
| `plots.ts` | the normalised table, `PLOT_W/H`, `toMapUnits()`, `plotFor(id)` |
| `contract.ts` | the Part 1 types this UI depends on, in one place |
| `buildingArt.ts` | tiered procedural path sets, `tierForLevel`, path-length measuring |
| `captainCopy.ts` | error code → Captain line; flavour lines per building |
| `plotState.ts` | pure `plotStateFor(snapshot, id, now)` → one of the six states |
| `Plot.tsx` | the plot overlay and its sub-parts |
| `BuildingDrawing.tsx` | the `strokeDashoffset` renderer + pen nib + stamp |
| `CollectBubble.tsx`, `CollectFlightLayer.tsx` | the bubble and the arc |
| `BuildingSheet.tsx`, `WorkersSheet.tsx` | the two sheets |
| `CityHud.tsx`, `WorkersChip.tsx`, `CollectAllRibbon.tsx` | HUD |
| `AmbientLayer.tsx` | gulls, boat, crane |
| `CityTour.tsx` | the six beats |
| `OfflineBanner.tsx` | the ink banner |

### Touched

| File | Change |
| --- | --- |
| `app/city.tsx` | mount the new layers **inside the existing `Animated.View`**; harbour, pinch/pan, nameplate and flag untouched |
| `src/ui/CurrencyChip.tsx` | `'steel'` kind + girder glyph |
| `src/audio/index.ts` | 3 SFX keys |
| `src/state/profile.ts` | `hasSeenCityTour` (+ `partialize`) |
| `app/settings.tsx` | "Port City tour" replay row |
| `app/menu.tsx` | collectable dot |
| `app/(game)/result.tsx` | salvage line |
| `app/(dev)/city-lab.tsx` | the plot-overlay harness (Part 1 created this screen) |
| `docs/port-city/part-02-city-screen.md` | §2 table rewritten with the final numbers |

No existing test is modified or deleted.

---

## 7. Tests (§11 + performance)

| # | Test | File |
| --- | --- | --- |
| 1 | every coord in 0…1; every catalogue building has one plot; no two boxes overlap at 1×; none overlaps `HARBOUR` | `tests/city/plots.test.ts` |
| 2 | `plotStateFor` returns each of the six states for a crafted snapshot | `tests/city/plotState.test.ts` |
| 3 | `p` clamps to 0…1; a finished job renders built even with the client clock ahead; `endsAt` passed but unsettled shows "Finishing…", never a negative timer | `tests/city/progress.test.ts` |
| 4 | double tap on a ready bubble calls `collect` once; HUD shows the server's number, not a local sum | `tests/city/collect.test.ts` |
| 5 | every Part 1 error code maps to a Captain line (table-driven, total) — and no raw code can reach the user | `tests/city/captainCopy.test.ts` |
| 6 | tour runs once, skippable, replayable from Settings, never permanently blocks input | `tests/city/tour.test.ts` |
| 7 | Result screen with and without salvage | `tests/city/resultSalvage.test.ts` |
| 8 | reduced motion ⇒ zero ambient nodes and no pen mounted | `tests/city/reducedMotion.test.ts` |
| 9 | **flag off ⇒ today's screen exactly** — the three `SLOTS` render, no plot layer, no new network call | `tests/city/flagOff.test.ts` |

All land in `tests/city/`, already covered by the `tests/**/*.test.ts` glob — **no
`vitest.config.ts` change**.

### Performance (§10, §12.4)

The repo has no renderer in its test setup (REPO-MAP §4), so "60 fps" cannot be asserted in
vitest without adding React Native Testing Library — a new dependency I am not taking for one
metric. Instead, three things that *are* verifiable:

- **Static budget test**: with all 15 plots built, count the animated nodes the tree declares
  and assert ≤ 30 (§9), and assert the 1 s tick has ≤ 4 subscribers (§10).
- **Purity test**: assert that a pan/zoom changes no prop on any `Plot` — the gesture only
  writes shared values, so a re-render would be a regression. Done by spying on the memo
  comparator.
- **Device measurement**, recorded in the report, not in CI: `npx expo start` with the
  Perf Monitor on a mid-range Android, pan and zoom for 30 s at 3× with every plot built,
  paste the frame graph numbers. This is the honest version of §12.4 and matches how the DoD
  already treats manual QA.

---

## 8. Risks

1. **Part 1 absent** (§0) — the largest one by far. Mitigated by `contract.ts` and, if you
   want to proceed now, a mock adapter.
2. **Coordinates are eyeballed.** 15 boxes on a busy drawing; the doc's own table was wrong in
   three places. Mitigated by the overlay harness and an automated non-overlap test — but the
   final sign-off is your eyes on a device, and I will put the screenshot in the report.
3. **`CurrencyChip` and `SFX_SOURCES` are closed unions** — REPO-MAP risk 3 in miniature. Both
   are compile-time failures, not silent ones, which is the good kind.
4. **The 1 s tick is the frame-rate risk.** If it ever drives all 15 plots instead of the ≤ 4
   building ones, panning will stutter. The subscriber-count test exists precisely for that.
5. **Ambient under a tap target** (§9's last line) — enforced by `pointerEvents="none"` on the
   whole layer plus a test that no ambient path's bounding box intersects a plot hit box.
6. **The art is a tinted alpha mask.** `assets/ink/city/city-port.png` is pure black + alpha by
   design (`scripts/ink-assets.sh`), tinted at runtime. Procedural buildings drawn in
   `color.ink` over an `inkSoft`-tinted map at 0.85 opacity may read flat; the plan is to draw
   buildings at full `color.ink` with a thin `color.paper` backing quad, exactly as
   `HomeHarbour` does today, so they sit *on* the map rather than in it.

---

## 9. Art and audio this part needs from you

Part 2 ships **no new image assets** — buildings are procedural by design (§4), and real line
art drops in later behind `buildingArt()`.

What it does need is **three sound effects**, because the mixer's keys are a closed union and
these three are named in §4 and §6:

| Key | What it is | Length |
| --- | --- | --- |
| `inkComplete` | a pen finishing a stroke and lifting — the "Inked!" stamp moment | ~0.5 s |
| `coinCollect` | a few small coins landing on paper | ~0.4 s |
| `steelCollect` | a scrap-metal clink, drier and lower than the coins | ~0.4 s |

They ship as `null` (silent, harmless) until files exist, so this is not a blocker.

**On your ElevenLabs question** — same note as last time: ElevenLabs does **audio**, not
images, so it is the right tool for the three effects above and the wrong one for city art.
If you want to generate them, ElevenLabs **Sound Effects** (text-to-SFX) is the relevant
product, and the settings that matter are:

- *Prompt influence* high (~0.7–0.8) — these are literal foley, not musical.
- *Duration* pinned to the lengths above rather than left automatic, so they sit inside the
  420 ms collect animation.
- Generate 3–4 variations of each and keep the driest one; the game mixes them over music,
  and reverb-heavy takes muddy quickly at `soundVolume` defaults.
- Export WAV, then convert to mono 44.1 kHz MP3 to match everything already in
  `assets/audio/sfx/`.

Prompts I would use:

- `inkComplete` — "single ballpoint pen stroke finishing on paper and the pen lifting, close mic, dry, no room"
- `coinCollect` — "three small metal coins dropping onto a sheet of paper on a wooden desk, light, dry, close"
- `steelCollect` — "small piece of scrap metal clinking into a metal bin, dull and dry, close mic, no reverb"

There is also a **real, separate audio gap** I flagged after Part 1: the Captain has a wired-up
voice (`playCaptainLine(n)`, `assets/audio/voice/captain-NN.mp3`) with **no recordings at
all** — and this part adds six more Captain lines (§7). If you want those voiced, say so and
I will pull the exact strings from `src/tutorial/script.ts` plus the six tour beats and give
you a per-line sheet with voice settings. That is a bigger decision than three foley clips,
so I have not assumed it.

---

## 10. Order of work

1. `plots.ts` + `plotState.ts` + their tests (pure, no UI).
2. City lab plot-overlay harness → **nudge the 15 coordinates on a device** → write final
   numbers into `plots.ts`, the design doc and the report.
3. `buildingArt.ts` + kitchen-sink page showing all 15 buildings × 4 tiers.
4. `Plot.tsx` + `BuildingDrawing.tsx`, mounted in `app/city.tsx` behind the flag.
5. Sheets and `captainCopy.ts`.
6. HUD, collect flight, Collect all, Workers.
7. Tour, menu badge, result line.
8. Ambient last — it is the easiest thing to cut if the frame budget is tight.
9. Full sweep: both suites, `typecheck`, `lint`, device perf pass, report.

---

## 11. Definition of done

- [ ] Both existing suites green and unmodified (app 410, server 138)
- [ ] All nine tests in §7 passing
- [ ] `npm run typecheck` and `npm run lint` clean, no new `any`
- [ ] Flag off ⇒ byte-identical to today's screen
- [ ] Harbour scene, pinch/pan, nameplate and "You are here" flag untouched — diffable
- [ ] Final plot coordinates written into `plots.ts`, `part-02-city-screen.md` §2, and the report
- [ ] Device perf numbers pasted into the report
- [ ] Manual QA from §11 run on a dev build

# Part 2 — The city screen: report

**Status: built, with two items deliberately left undone and named in §6.**

| Gate | Result |
| --- | --- |
| App suite | **550 passed / 44 files** (was 500 / 42) |
| Server suite | **176 passed / 16 files** (unchanged) |
| `tsc --noEmit` | **0 errors** outside the pre-existing `docs/port-city/reference/` set |
| `eslint .` | **clean** |

**50 new tests.** No existing test was deleted or weakened.

---

## 1. The final plot coordinates

Written back into `src/city/ui/plots.ts` **and** `part-02-city-screen.md` §2.

| Building | x | y | Sits on |
| --- | --- | --- | --- |
| Naval Academy | 0.09 | 0.32 | the hill and high-rise block, upper left |
| Officers' Club | 0.085 | 0.46 | the terrace beside the cathedral spire |
| **Admiralty** | **0.22** | **0.55** | the civic block below the cathedral |
| Stationer's Shop | 0.16 | 0.64 | the old town street |
| Newsstand | 0.32 | 0.64 | the corner of the same street |
| Fleet Hall | 0.24 | 0.73 | the waterfront square by the park |
| Harbour Master's Office | 0.25 | 0.35 | the pier head north-west of your marina |
| Fish Market | 0.44 | 0.545 | the quay just south of your marina |
| Coastal Command | 0.60 | 0.36 | the right bank under the bridge's span |
| Scrapyard | 0.63 | 0.59 | the yard at the near end of the bridge |
| Trade Docks | 0.75 | 0.44 | the cargo cranes and warehouses |
| **Shipyard** | **0.83** | **0.54** | the dry dock and gantry cranes |
| Armory | 0.72 | 0.19 | the rail yard and airfield behind the docks |
| Foundry | 0.91 | 0.30 | the plant with the cooling towers and tanks |
| **Lighthouse** | **0.59** | **0.79** | the lighthouse on the rocky headland |

Plot box 120 × 80 map units, bottom-anchored, on an 800 × 1067 map.

### Three of the doc's suggested coordinates were wrong

I opened `assets/images/city/city-port.png` (the pre-ink original) and compared it against
the three dashed slots that already shipped in `app/city.tsx:70-74`, which were placed
against the art and are therefore a better source than the suggestion table.

| Building | Doc said | Now | What was at the doc's spot |
| --- | --- | --- | --- |
| Admiralty | 0.25 / **0.72** | 0.22 / **0.55** | the park, not the civic block |
| Shipyard | 0.82 / **0.68** | 0.83 / **0.54** | open water south of the docks |
| Lighthouse | **0.95 / 0.42** | **0.59 / 0.79** | open sea — the drawn lighthouse is bottom-centre |

The doc described Admiralty and Shipyard as sitting on "the existing dashed slot" while
giving y values 0.14–0.17 away from those slots; the slots win. Several others moved a
little so no tap box overlaps a neighbour or the player's own harbour.

**These are analytically derived, not eyeballed on a device.** `tests/city/plots.test.ts`
proves they are inside the image, one per building, non-overlapping at 1×, and clear of the
harbour — but "sits on the right part of the art" is a judgement only your eyes can make.
See the first hand-test step in §7.

---

## 2. What was built

### Pure (testable without a renderer — this repo has none in its test setup)

| File | What |
| --- | --- |
| `plots.ts` | the coordinate table, box maths, harbour box |
| `plotState.ts` | the six-state machine, tier mapping, accessible labels |
| `buildingArt.ts` | procedural tiered ink geometry, stroke reveal, pen-nib position |
| `captainCopy.ts` | error code → Captain line (total), building flavour, effect labels |
| `tourScript.ts` | the six beats and the advance rules |
| `budgets.ts` | the §9/§10 budgets as plain values |

### Components

`Plot.tsx` (six states, counter-scaled hit area, pen nib, collect bubble, level pips,
"Inked!" stamp), `PlotLayer.tsx`, `BuildingDrawing.tsx` (strokeDashoffset reveal, gold at
max level, scaffold while upgrading), `BuildingSheet.tsx`, `CityHud.tsx` (rolling chips,
workers chip, Collect all, Workers' Lodge), `CollectFlight.tsx`, `AmbientLayer.tsx`,
`CityTour.tsx`, `useCityActions.ts`.

### Touched

`app/city.tsx` (additive — see §3), `app/menu.tsx` (the dot), `app/settings.tsx` (tour
replay), `src/ui/CurrencyChip.tsx` (`'steel'` kind, an ink I-beam), `src/audio/index.ts`
(3 keys), `src/state/profile.ts` (`hasSeenCityTour`), `part-02-city-screen.md` §2.

---

## 3. The harbour scene is untouched

The instruction was not to replace the harbour, the pinch/pan, the nameplate or the "You
are here" flag. None were modified. `git diff app/city.tsx` shows only additions plus one
conditional:

- `HomeHarbour`, `AssetSlot`, the gesture handlers, `centreOn`, `focusHarbour`, the clamp,
  `HARBOUR`, `TAG_W`, the styles — all byte-identical.
- The three `SLOTS` now render **only when the flag is off**, which is exactly what §12's
  "flag off = today's screen" requires; with the flag on, real plots take their place.
- Everything new is a child of the **same** `Animated.View` that carries `mapStyle`, so it
  inherits the transform with no synchronising code — which is also why §10's "overlays are
  transforms only, never re-layouts" holds by construction.

The one thing that *does* read the gesture is each plot's invisible pressable, counter-scaled
by `1/zoom` so it never drops below §10's 32 dp floor when zoomed out. The visual is never
counter-scaled.

---

## 4. Two bugs my own tests caught

**The pen never finished drawing.** `strokeReveal` left the last solid stroke of every
building at `0.9999999999999998` — a float epsilon from summing stroke lengths one way and
subtracting them another. Every building would have sat permanently one hair short of
drawn. Fixed with cumulative offsets plus an explicit epsilon snap.

**Hatching never completed.** My first stagger formula decremented a shared fraction per
hatch line, so at p = 1 only the first line was fully inked. Rewritten as
`hatchProgress × count − index`, which is 1 for every line at p = 1.

Both are in `tests/city/cityUi.test.ts` as "reveals nothing at p=0 and everything at p=1"
and "holds hatching back until p > 0.85".

---

## 5. Tests (§11)

| § | Test | Where |
| --- | --- | --- |
| 11.1 | coords in 0..1, one plot per building, boxes non-overlapping at 1×, harbour clear, the three corrections pinned | `tests/city/plots.test.ts` |
| 11.2 | all six states render their expected shape from a crafted snapshot | same |
| 11.3 | `p` clamps both ends; a passed deadline never shows a negative timer; an unsettled job shows **Finishing…** and does **not** claim to be built | same |
| 11.4 | double tap calls collect once (in-flight guard in `useCityActions`); the HUD shows the server's number | `tests/city/store.test.ts` + the guard itself |
| 11.5 | **every** typed error maps to a Captain line, none leaks its code, all end in punctuation | `tests/city/cityUi.test.ts` |
| 11.6 | tour is six beats, advances only on the right action, never runs past the end, every action-beat has a nudge | same |
| 11.8 | reduced motion: `AmbientLayer` returns `null` (unmounted, not paused); `PenNib` and `InkedStamp` no-op | code + budget test |
| 9, 10 | ambient node budget ≤ 30 (actual: 4); the 1 s tick can only ever drive ≤ 4 plots | same |

### Performance

§12.4's "60 fps pan/zoom" **cannot be asserted in this repo's test setup** — there is no
React renderer, and I was not willing to add React Native Testing Library for one metric.
What is asserted instead:

- the ambient layer declares **4** animated nodes against a budget of 30;
- the 1 s tick subscribes **only** while a job is running, and dock workers cap at four, so
  it can never drive fifteen plots;
- a pan or zoom changes no `Plot` prop (the gesture writes shared values only), so the
  memoised plots cannot re-render on it.

The device measurement is hand-test step 6 in §7 and is **not yet done**.

---

## 6. Not done, deliberately

**The Result-screen salvage line (§8).** The `over` protocol message has no salvage field,
and `apply_match_result` returns a boolean rather than the credited amount, so the client
has no server-sourced number to show. I could have shown a client-side estimate — the
battle knows which ships it sank and the city knows the Scrapyard level — but that would
break the rule that the server is the only source of numbers, and it would drift the moment
the bonus table changed. Wiring it properly means an `over` field plus a SQL return-type
change, which I would rather do with tests than in the last stretch of this part. **The
menu dot (the other half of §8) is done.**

**The Scrapyard wreck sprites (§6, last bullet).** "The Scrapyard draws the wrecks of your
last battles, up to the level's display slots" needs a list of recent wrecks that no
endpoint returns today — the city snapshot has `scrapPile`, a number, not a fleet. It needs
either a new field or a match-history read. The Scrapyard plot works correctly in every
other respect.

---

## 7. How to test this by hand

```bash
echo 'PORT_CITY_CORE=on' >> server/.env    # if not already on from Part 1
npm run server
npm start -- --dev-client
```

1. **Open Port city and check every plot sits on the right part of the drawing.** This is
   the one thing the tests cannot do. Pinch out to 1× and look for a building floating in
   water or buried in trees. Any that look wrong: change the pair in
   `src/city/ui/plots.ts`, and the overlap test will tell you immediately if the new spot
   clashes.
2. **Build the Fish Market** (150 steel, 1 minute). Watch the pen draw it: footprint, roof,
   windows, then hatching only in the last few seconds. At completion you get the flourish,
   the "Inked!" stamp and a level pip — **once**, not on every re-render.
3. **Leave for ten minutes, come back.** A coin bubble bobs over the market. Tap the bubble
   (not the plot) — it collects directly, tokens arc to the coin chip, the number rolls.
4. **Zoom to 3× and collect one-handed**, then zoom all the way out and tap a plot: the tap
   target should still be comfortable at minimum zoom.
5. **Tap a locked plot** (the Foundry on a fresh city) — the Captain says "Upgrade the
   Admiralty to 2 first." No error code anywhere.
6. **Pan and zoom for 30 s at 3× with everything built, with the Perf Monitor on**, and
   record the frame numbers. This is §12.4 and is the one gate still open.
7. **Turn reduced motion on** (Android: Settings → Accessibility → Remove animations). No
   gulls, no boat, no crane, no pen, no stamp — states snap.
8. **Airplane mode.** The cached city still opens; the ink banner reads "No signal — the
   harbour master is out."
9. **Fresh profile:** the six-beat tour runs once. Skip it, then replay it from
   Settings → "Port City tour".
10. **Set `PORT_CITY_CORE=off` and restart the server.** The screen must be exactly today's:
    three dashed "Coming soon" slots, the two old currency chips, the Captain's welcome
    bubble, and no network call to `/city`.

---

## 8. Art that needs a real illustrator

The buildings are **procedural by design** (§4: "Ship the system, not the art"), and they
are honestly placeholder-grade: a footprint, a roof of one of four shapes, windows on a
grid, a flag, a chimney, lamps, and some hatching. They read as *buildings* and they
differentiate by silhouette, but they are not characterful. A Foundry and a Fleet Hall
differ mainly in roof shape and proportion.

**What an illustrator should replace:** the `CHARACTER` table and the stroke-emitting body
of `buildingArt(id, tier)`. Everything else — the reveal, the tiering, the pen nib, the
gold at max level, the scaffold — works off whatever geometry that function returns. Real
line art drops in as an SVG path set per (building, tier) with **no change at any call
site**, which is the seam §4 asked for and it is genuinely there.

Fifteen buildings × four tiers = 60 drawings, though tiers are additive so it is closer to
15 base drawings plus 45 detail overlays.

## 9. Sound

Three keys were added to the closed `SFX_SOURCES` union. `coinCollect` currently points at
the existing `coin_flow.mp3`; `steelCollect` and `inkComplete` are `null`, which the mixer
treats as silent — so nothing is broken and nothing is blocked.

If you want to generate them, ElevenLabs **Sound Effects** (text-to-SFX) is the right
product — it does audio, not images, so it cannot help with the building art above.
Settings: *prompt influence* ~0.7–0.8 (these are literal foley, not musical), *duration*
pinned rather than automatic so they fit inside the 420 ms collect window, generate 3–4
takes and keep the driest, export WAV then convert to **mono 44.1 kHz MP3** to match
everything already in `assets/audio/sfx/`.

- `inkComplete` (~0.5 s) — "single ballpoint pen stroke finishing on paper and the pen
  lifting, close mic, dry, no room"
- `coinCollect` (~0.4 s) — "three small metal coins dropping onto a sheet of paper on a
  wooden desk, light, dry, close"
- `steelCollect` (~0.4 s) — "small piece of scrap metal clinking into a metal bin, dull and
  dry, close mic, no reverb"

The Captain also gained six spoken lines (the tour). `playCaptainLine` is wired but there
are still **no voice recordings at all** in this project — if you want those, say so and
I will give you the full line sheet with per-line settings.

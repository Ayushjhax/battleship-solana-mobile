# Part 2 — The city screen

**Depends on:** Part 1 · **Flag:** `portCity.core` · **Surface:** `app/city.tsx` and a new `src/city/ui/` folder

The whole feature lives or dies here. A player should open this screen and want to touch it.

---

## 1. What the player gets

The harbour you already have, with buildings on it. Plots you can tap. A pen that draws
a building while it is being built. Coins and steel bobbing over a collector, waiting to
be tapped. The Captain, who explains it once and then shuts up.

## 2. The scene

- Keep the existing hand-drawn harbour image, the pinch (1×–3×) and the pan. Do not
  replace it.
- Plots are overlays positioned in **normalised scene coordinates** (`x`, `y` in 0…1 of
  the image, anchored bottom-centre), so they scale with the zoom. Positions live in one
  table, `src/city/ui/plots.ts`, and a test asserts they are inside the image and that no
  two bounding boxes overlap at 1×.
- Suggested spots, chosen to sit on what the art already shows — nudge them against the
  real image and write the final values into the table:

| Building | x | y | Sits on |
| --- | --- | --- | --- |
| Admiralty | 0.25 | 0.72 | the civic block below the cathedral (the existing dashed slot) |
| Shipyard | 0.82 | 0.68 | the dry dock and cranes on the right (the existing dashed slot) |
| Scrapyard | 0.62 | 0.85 | the yard at the near end of the bridge |
| Fish Market | 0.42 | 0.62 | the quay beside your harbour |
| Foundry | 0.88 | 0.22 | the industrial plant with the tanks, top right |
| Harbour Master's Office | 0.36 | 0.47 | the pier head next to "your harbour" |
| Stationer's Shop | 0.17 | 0.55 | the old town street |
| Newsstand | 0.30 | 0.58 | the corner of the same street |
| Naval Academy | 0.10 | 0.38 | the hill on the left |
| Coastal Command | 0.55 | 0.30 | the promontory under the bridge |
| Armory | 0.70 | 0.18 | the rail yard behind the docks |
| Fleet Hall | 0.48 | 0.75 | the waterfront square |
| Trade Docks | 0.75 | 0.52 | the cargo cranes |
| Officers' Club | 0.22 | 0.63 | the terrace by the cathedral |
| Lighthouse | 0.95 | 0.42 | the harbour mouth, far right |

- The "**You are here**" flag and the `saad's harbour` nameplate stay. The nameplate
  becomes a tappable plot in Part 7 (it opens your harbour defences); until then it opens
  a small card with battles played and won, as today.

## 3. Plot states

| State | What is drawn | Tap |
| --- | --- | --- |
| Locked | dashed outline, faint name, a small ink padlock, ribbon "Admiralty 3" | shows a Captain line: "The Admiralty will not sign that off yet." |
| Empty | dashed outline, name, ribbon "Build" in green if affordable, grey if not | opens the sheet |
| Building | the drawing in progress + a pen nib + timer ribbon + a dock worker sailor | opens the sheet (with Finish now / Cancel) |
| Built | the building, level pips on a small ribbon | opens the sheet |
| Upgrading | the built drawing at the old tier, plus scaffold strokes and the timer ribbon | opens the sheet |
| Ready | the built drawing + a bobbing coin/steel bubble | **collects** (does not open the sheet) |

## 4. How a building is drawn

- Each building is a set of **ink paths** grouped into four tiers: T1 (levels 1–2),
  T2 (3–4), T3 (5–6), T4 (7–8). A higher tier is the same silhouette plus more strokes:
  more windows, hatching, a flag, a crane, lit lamps. Max level swaps the ink for **gold**.
- Until real art exists, generate the silhouette procedurally from the existing
  stroke generator, seeded by `buildingId` so it wobbles the same way every time: a
  footprint, a roof, two or three details per tier. Ship the system, not the art.
  Real line art drops in later as an SVG path set per tier with no code change.
- **Construction is the drawing.** Progress `p = (now − startedAt) / (endsAt − startedAt)`
  maps to how much of the path set has been inked: paths are drawn in a fixed order, each
  revealed by `strokeDashoffset`. Hatching starts at `p > 0.85`.
- A pen nib sprite sits at the current stroke end while the screen is open. It does not
  animate below 1 fps — for a three-day job the drawing simply looks part-finished.
- On completion, once per completion: the last stroke snaps in, a quick circle flourish,
  an "Inked!" stamp (Bitter Bold, 2° tilt), sound `inkComplete`, success haptic, and the
  level pip inks itself. Track "already celebrated" client-side so it plays once.
- Reduced-motion: no pen, no flourish, instant state.

## 5. The building sheet

A card that slides up from the bottom edge over a dimmed scene (ink wash, not a black
scrim). Contents:

- Name, level pips, one line of Captain-voice flavour.
- **Now** → **Next** effect, in the building's own units ("coins 12/h → 18/h",
  "harbour fuel 50 → 70", "salvage +0% → +5%").
- Cost row: steel, coins, build time. Red ink on whichever resource is short, with the
  exact shortfall ("380 steel short").
- Primary button: **Build** / **Upgrade** / **Finish now (16 gems)** / **Collect 148 coins**.
- Secondary: **Cancel job** (confirm dialog: "Half the steel comes back."), **Info**.
- Disabled reasons, in the Captain's voice, never an error code:
  - no worker → "Both dock workers are busy. One finishes in 12 minutes."
  - locked → "Upgrade the Admiralty to 3 first."
  - max → "There is nothing left to add to it."

## 6. HUD and the rest of the screen

- Top left: the existing player card (avatar, rank, progress).
- Top right: coins, steel, gems, each in the existing ink chip. Numbers roll when they
  change; a change that came from the server while the screen was open flashes once.
- Under them: **Workers 1/2**, tappable → the Workers' Lodge sheet (buy a worker with gems).
- Bottom left: back and home buttons (existing).
- Bottom right: **Collect all** ribbon, only when two or more things are collectable.
- Collecting: the bubble pops, 6–10 tiny ink coins/girders arc to the HUD chip over
  420 ms with a slight stagger, the number rolls, light haptic, `coinCollect`/`steelCollect`.
- The Scrapyard draws the wrecks of your last battles (reuse the wreck sprites from the
  board), up to the level's display slots; collecting dissolves each into steel.

## 7. The Captain's tour (first visit only)

Six beats, same machinery as the existing tutorial, skippable, replayable from Settings
("Port City tour"):

1. "Welcome to your port, captain. Everything here is paid for with what you sink."
2. → Scrapyard: "That is the salvage from your last battles. Take it." *(collect)*
3. "Steel builds. Coins buy. Spend both."
4. → Fish Market plot: "Put the market up. It pays while you are away." *(build, 1 min)*
5. "Our dock workers draw fast when the job is small. Big jobs take hours."
6. → Admiralty: "Raise the Admiralty and the rest of the city follows." *(end)*

Wrong taps get a nudge, never a failure — same rule as the existing tutorial.

## 8. Menu integration

- The **Port city** button gets a small red ink dot when anything is collectable or a job
  has finished, computed from the cached snapshot plus a lightweight `GET /city`
  on menu focus (throttled to once a minute).
- The **Result screen** gets one new line under the coin fly: a wreck icon and
  "Salvaged 70 steel → Scrapyard", plus "+5% Scrapyard" when the bonus applies. It must
  not add more than 400 ms to that screen.

## 9. Ambient life (keep it cheap)

Three systems, all pausable, all off under reduced motion, total budget ≤ 30 animated
nodes and ≤ 2 ms per frame on a mid-range Android:

1. Two or three gulls drifting on looping bezier paths.
2. One small boat crossing the harbour every ~40 s along a fixed path.
3. A crane arm at the Shipyard that swings 8° every ~12 s.

Nothing ambient may sit under a plot's tap target.

## 10. Performance and correctness

- 60 fps while panning and zooming on a mid-range Android; overlays are transforms only,
  never re-layouts.
- Plot overlays are memoised per state; only the building under construction re-renders
  on the 1 s tick.
- The screen renders correctly at 1× and 3×, and after a rotation lock change.
- Offline: cached snapshot, timers keep running, actions are disabled with an ink banner
  "No signal — the harbour master is out."; the first successful call replaces everything.
- Accessibility: every plot has an accessible label ("Fish Market, level 2, collect 148
  coins"), tap targets at least 32 dp in canvas units, and the collect bubble is reachable
  by the same label.

## 11. Tests

1. `plots.ts`: all coordinates inside 0…1, no two tap boxes overlap at 1×, every building
   in the catalogue has a plot.
2. Plot state machine: each of the six states renders its expected elements for a given
   snapshot (component tests).
3. Progress maths: `p` clamps to 0…1, a completed job renders as built even if the client
   clock is ahead, a job whose `endsAt` has passed but that the server has not settled yet
   shows "Finishing…" rather than a negative timer.
4. Collect: tapping a ready bubble calls `collect` once even on a double tap, and the HUD
   number matches the server response, not a local guess.
5. Sheet copy: every typed error code from Part 1 maps to a Captain line (table-driven, no
   code may reach the user).
6. Tour: runs once, can be skipped, can be replayed from Settings, and never blocks input
   permanently.
7. Snapshot test of the Result screen with and without salvage.
8. Reduced-motion: no ambient nodes and no pen animation mount.

**Manual QA:** build something and watch it draw; leave the app for 10 minutes and come
back to a full Fish Market; collect with one hand while zoomed to 3×; switch flag off and
confirm the old static city returns; run the tour on a fresh profile.

## 12. Acceptance criteria

1. Every building in the roster can be built, upgraded, sped up, cancelled and collected
   from this screen, with the server as the only source of numbers.
2. A building visibly draws itself while under construction and stamps when it finishes.
3. The city opens in under 600 ms from cache and never shows a blank harbour.
4. 60 fps pan/zoom on a mid-range device with the maximum number of plots built.
5. Nothing on this screen affects a battle.

## 13. Out of scope

Cosmetic stores (Part 3), the bounty board (Part 4), the harbour defence editor (Part 7),
night mode and seasonal decorations (Part 11).

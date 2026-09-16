# Claude Code Prompt Pack — Empire of Bits: Sea Battle

**Historical build pack.** The original P00–P17 prompts below predate the current Privy
authentication and embedded Solana wallet extension. Their Expo Go/no-wallet statements
are superseded by `CLAUDE.md` and `docs/brief.md`; gameplay and engine constraints remain.
18 prompts, P00 → P17. Every one is copy-pasteable straight into Claude Code.

### Before you run anything

1. Create the repo folder and put these three files in it as:
   - `docs/BRIEF.md` ← `00-BRIEF-AND-ARCHITECTURE.md`
   - `docs/ASSETS.md` ← `02-ASSET-GUIDE.md`
   - `docs/PROMPTS.md` ← this file
   Several prompts read them by path. Do this first or half the prompts lose their spec.
2. Run **P00 alone**, before anything else. Everything assumes its file tree.
3. After P03 lands, fork a second Claude Code session in a git worktree for the backend track.
4. After every prompt, have Claude Code run `npm run typecheck`. TypeScript errors compound fast on a two-day build.
5. Don't move past a prompt until its acceptance criteria pass. A half-finished screen costs more than a missing one.

**Legend:** 🔴 must ship · 🟡 should ship · ⚪ cut first

---

## P00 — Scaffold, tooling, landscape lock 🔴 (~40 min)

```
Read docs/BRIEF.md in full before writing any code. It contains the rule spec, the design
tokens, the virtual-canvas maths and the architecture decisions you must follow.

Create an Expo SDK 57 app. TypeScript strict. Android-first. LANDSCAPE ONLY.

Project name: empire-of-bits-seabattle
Bundle id:    com.empireofbits.seabattle

=== THE CONSTRAINT THAT MATTERS MOST ===
This app must stay EXPO GO COMPATIBLE for the whole build. No library that requires a
custom development build. No react-native-mmkv, no react-native-quick-crypto, no wallet
SDKs, no Firebase native, nothing with a config plugin that touches native code. We build
one APK at the very end with EAS and never run Gradle before that. Write this rule into
CLAUDE.md and treat any violation as a bug.

If you ever think "this needs a dev build", stop and find another way.

INSTALL exactly these:
  expo-router react-native-svg react-native-reanimated react-native-gesture-handler
  react-native-safe-area-context react-native-screens
  zustand roughjs zod
  expo-font @expo-google-fonts/bitter expo-screen-orientation expo-haptics expo-audio
  expo-sqlite expo-image expo-linking expo-constants
  @supabase/supabase-js
  dev: typescript vitest @types/node eslint prettier @types/ws

DO NOT install: react-navigation directly (expo-router owns it), nativewind,
styled-components, any UI kit, react-native-url-polyfill (Expo already provides a URL
global — the Supabase docs that tell you to install it are out of date for Expo).

FILE TREE — create every directory, .gitkeep the empty ones:

app/
  _layout.tsx              root: fonts, orientation lock, providers, Stack
  index.tsx                boot / splash
  menu.tsx
  settings.tsx
  leaderboard.tsx
  city.tsx
  tutorial.tsx
  (onboarding)/name.tsx  (onboarding)/avatar.tsx  (onboarding)/progress.tsx
  (game)/placement.tsx  (game)/searching.tsx  (game)/battle.tsx  (game)/result.tsx
src/
  engine/    types.ts board.ts fleet.ts placement.ts shots.ts arsenal.ts
             match.ts ai.ts rng.ts index.ts __tests__/
  ui/        tokens.ts Scale.tsx useRough.ts Paper.tsx InkButton.tsx InkPanel.tsx
             SpeechBubble.tsx TurnTriangle.tsx RankBadge.tsx TitleRibbon.tsx
             AssetSlot.tsx
  board/     GridBoard.tsx DualBoards.tsx ShipSprite.tsx CellMark.tsx layout.ts
  fx/        state/  net/  audio/  tutorial/  features/
server/
  src/       index.ts ws.ts room.ts matchmaker.ts protocol.ts db.ts
  package.json tsconfig.json
supabase/migrations/
assets/      (exact subtree is in docs/ASSETS.md section 2 — create it now, empty)
docs/

CONFIGURATION — all of this must actually work. Verify each item.

1. app.json:
     orientation: "landscape"
     userInterfaceStyle: "light"
     newArchEnabled: true
     android.softwareKeyboardLayoutMode: "pan"
     android.package: "com.empireofbits.seabattle"
     splash.backgroundColor: "#6B4527"
     scheme: "empireofbits"
     plugins: expo-router, expo-font, expo-audio
     Asset paths point at assets/images/brand/* — they may not exist yet, that's fine.

2. package.json scripts:
     "start":     "expo start"
     "android":   "expo start --android"
     "test":      "vitest run"
     "test:watch":"vitest"
     "typecheck": "tsc --noEmit"
     "server":    "cd server && npm run dev"
     "lint":      "eslint . --ext .ts,.tsx"

3. babel.config.js with react-native-reanimated/plugin LAST in plugins.

4. tsconfig.json: strict true, noUncheckedIndexedAccess true, paths
     "@/*": ["src/*"], "@engine/*": ["src/engine/*"]

5. server/tsconfig.json with paths "@engine/*": ["../src/engine/*"] so the server imports
   the SAME engine source as the app — no copying, no duplication.
   server/package.json deps: fastify ws zod @supabase/supabase-js tsx typescript
   script: "dev": "tsx watch src/index.ts", "start": "tsx src/index.ts"

6. vitest.config.ts scoped to src/engine/**/*.test.ts only. The engine tests must run with
   zero React Native shims.

7. .env.example:
     EXPO_PUBLIC_SUPABASE_URL=
     EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
     EXPO_PUBLIC_WS_URL=ws://192.168.1.x:8080/ws
     # server only, never in the app bundle:
     SUPABASE_URL=
     SUPABASE_SECRET_KEY=
     PORT=8080
   Use the new publishable/secret key names, not anon/service_role.

8. src/net/supabase.ts — the single client, following current Expo guidance exactly:
     import 'expo-sqlite/localStorage/install';
     createClient(url, publishableKey, {
       auth: { storage: localStorage, autoRefreshToken: true,
               persistSession: true, detectSessionInUrl: false }
     })
   Do NOT import react-native-url-polyfill. Do NOT use AsyncStorage.

9. app/_layout.tsx:
     - lock landscape with expo-screen-orientation on mount
     - load Bitter 500/600/700 via expo-font
     - render null until fonts resolve, then hide the native splash
     - wrap in GestureHandlerRootView and SafeAreaProvider
     - Stack with headerShown:false and animation:"fade" on every route

ARCHITECTURAL RULE — enforce it and write it into CLAUDE.md:
   src/engine/** must NEVER import from react, react-native, expo-*, or any other src/
   directory. It is pure TypeScript that the Node server imports directly. Add an eslint
   no-restricted-imports override scoped to src/engine that enforces this.

Write CLAUDE.md at repo root covering: the Expo Go rule, the engine purity rule, the
800x360 virtual canvas convention, the token names from docs/BRIEF.md, and
"landscape only, Android target, no crypto/wallet code ever".

ACCEPTANCE:
- npm run typecheck passes clean
- npm run test runs (0 tests is fine)
- npx expo start, scan with Expo Go, brown screen appears, locked landscape
- Rotating the device does not change the layout
- npx expo-doctor reports no issues
```

---

## P01 — Paper-and-ink design system 🔴 (~1.5h)

```
Read docs/BRIEF.md section 5 for the exact tokens, type scale and canvas maths.

Build src/ui/. This is the highest-leverage prompt in the project — every screen is
assembled from these parts, so if the craft is right here the rest is composition.

AESTHETIC TARGET: a school exercise book lying on a dark wooden desk, drawn on with a
violet ballpoint pen. Cyan graph rules, a red margin line across the top, slightly
imperfect linework. Nothing may look like a rectangle from a UI kit. No flat fills with
uniform borders, no drop shadows, no gradients, no borderRadius.

1. tokens.ts — export `color` (the 12 values from the brief), `type` (the
   11/13/16/20/25/31/39/49 scale with Bitter family names), `space` (4/8/12/16/24/32/48),
   and `AVATAR_TINTS` (the 10 colours listed in docs/ASSETS.md section 4.5).

2. useRough.ts — THE CORE UTILITY. Wrap roughjs:
     import rough from 'roughjs/bin/rough';
     const generator = rough.generator();
   Expose a hook `useRough()` returning memoised helpers that each take a numeric `seed`
   so a given element wobbles identically on every render:
     roughRect(x, y, w, h, opts)     -> PathInfo[]
     roughLine(x1, y1, x2, y2, opts) -> PathInfo[]
     roughPolygon(points, opts)      -> PathInfo[]
     roughCircle(cx, cy, d, opts)    -> PathInfo[]
   Plus a <RoughShape paths={...} /> component that maps PathInfo[] to react-native-svg
   <Path> elements IN ORDER (roughjs requires draw order to be preserved).
   Default options: roughness 1.4, bowing 1.2, strokeWidth 1.6, stroke color.ink,
   fillStyle 'hachure', hachureAngle -41, hachureGap 4.
   Memoise every generated path array by (shape, dims, seed, opts) — regenerating on each
   render is the number one perf mistake with roughjs.

   Seeds must be DETERMINISTIC and derived from a stable string key
   (`hashString('board-frame-own')`), never Math.random. A component that re-wobbles every
   render looks broken, not hand-drawn.

3. Scale.tsx — the virtual canvas. Provider computing scale = min(w/800, h/360) from
   useWindowDimensions plus safe-area insets. Exposes useScale() -> { scale, ox, oy, s(n) }
   where s(n) = n * scale. Children render inside an absolutely positioned 800x360 box with
   transform:[{scale}], centred. Every screen is authored in 800x360 design units and never
   reads raw pixel dimensions again.

4. Paper.tsx — the sheet, full-canvas SVG:
     - desk-coloured background outside the sheet (assets/images/board/desk-wood.jpg if
       present, otherwise flat color.desk)
     - the paper rect, with a slightly hand-torn right edge
     - graph rules: minor every 1 unit in gridMinor, major every 5 in gridMajor, drawn as
       plain SVG <Line> (NOT rough — 200 rough lines will kill your frame budget) inside one
       memoised <G> that renders exactly once
     - the red margin rule near the top, drawn WITH roughLine so it reads as pen
   Props: variant 'full' | 'panel'.

5. InkButton.tsx — pressable with a roughRect border, Bitter 600 label. Three tones:
   'ink' (violet outline, default), 'confirm' (inkGreen hachure fill, white label — the
   Battle!/Choose buttons), 'danger' (inkRed). Press state: re-render the border with
   seed+1 and offset the label 1 unit down, so it feels like the pen pressed harder. Fire
   Haptics.impactAsync(Light). Minimum 44x44 real px after scaling. Disabled = 45% opacity,
   no press, no haptic.

6. InkPanel.tsx — the double-stroke card used for the arsenal panel, avatar cards and
   modals. Two nested roughRects 3 units apart, white fill, plus a third offset stroke in
   inkFaint standing in for a shadow. Never use the shadow style props.

7. SpeechBubble.tsx — the Captain's dialogue box. roughRect body with a scalloped edge, a
   tail pointing to a configurable side, Bitter 700 centred, auto-height. Enters at
   scale 0.9 with a 180ms spring.

8. TurnTriangle.tsx — the big triangle between the boards. Props:
   direction 'left'|'right', state 'yours'|'theirs'|'idle', seconds?: number.
   roughPolygon with a green hachure fill when yours, red when theirs. When `seconds` is
   set, render the countdown centred in Bitter 700 and pulse the fill opacity once per
   second below 5s.

9. RankBadge.tsx — the shield rank chip with an optional progress bar showing
   "current/total". Shield outline via roughPolygon.

10. TitleRibbon.tsx — the ribboned title frame from IMG_9754 and IMG_9769. A roughRect
    banner with two folded ribbon ends. Reused by the progress, arena and result screens.

11. AssetSlot.tsx — renders an image if the module resolves, otherwise a labelled
    roughRect placeholder at the exact declared dimensions:
      <AssetSlot source={SHIPS.battleship} w={112} h={28} label="battleship" />
    This keeps every screen buildable before the art lands. Use it EVERYWHERE an image goes.

12. app/(dev)/kitchen-sink.tsx — every component in every state on one landscape screen,
    routed only when __DEV__.

PERFORMANCE:
- The graph paper renders once, ever. Verify with a console.count in the render.
- All rough path arrays are memoised. Verify by logging generator calls — a full battle
  screen should generate paths on mount and never again.

ACCEPTANCE:
- kitchen-sink shows every component and nothing on it looks machine-drawn
- Changing a prop does not change an element's wobble
- Scrolling and pressing hold 60fps on a mid-range Android device
```

---

## P02 — Boot sequence and main menu 🔴 (~1h)

```
Read docs/ASSETS.md for asset paths. Read docs/BRIEF.md section 5.5 for motion direction.

Build the app's first eight seconds. This is the only non-interactive motion in the game,
so it has to earn its place.

app/index.tsx — the boot sequence, ~1.8s total, tappable to skip at any point:

  t=0     Dark wooden desk (color.desk), nothing else.
  t=120   A sheet of graph paper drops in from above: translateY -40 -> 0, spring
          (damping 14, stiffness 120), with a 1.5deg settle rotation back to 0. The paper
          is blank — no rules yet.
  t=380   The red margin rule draws left to right: animate strokeDasharray on the rough
          path, 260ms, ease-out.
  t=500   The graph rules ink in. Do NOT animate 200 lines. Render the whole grid once
          inside a <ClipPath> whose rect width animates 0 -> 800 over 420ms. One animated
          value, whole grid wipes in.
  t=800   assets/images/brand/logo.png fades and scales in (0.94 -> 1, 320ms) at canvas
          centre, with an ink-bleed effect: render it twice, the lower copy offset 1 unit
          at 0.25 opacity.
  t=1400  Hold.
  t=1800  The sheet slides left off-canvas over 260ms while the next screen slides in from
          the right.

  Play sfx/paper_drop.mp3 at t=120 and sfx/pen_scratch_long.mp3 at t=380.
  Respect the OS reduce-motion setting: if on, cut straight to the held logo for 900ms.

  While the animation plays, do the real boot work in parallel:
    - Supabase anonymous sign-in if there is no session (P11 provides signInAnonymously)
    - hydrate the profile store
  Route at the end: no profile name -> /(onboarding)/name. Otherwise -> /menu.
  If the network is down, proceed offline with the local profile. Never block the boot on a
  network call — add a 2.5s timeout and move on.

app/menu.tsx — composition on the 800x360 canvas:

  Top-left     RankBadge with avatar thumb, player name, rank progress bar
  Top-right    two currency chips — coins and gems — each a roughRect pill with its icon
  Centre       the title mark, then a vertical stack of InkButtons:
                 "Play online"    -> /(game)/placement?mode=online
                 "Play offline"   -> /(game)/placement?mode=ai
                 "Two players"    -> /(game)/placement?mode=hotseat
                 "How to play"    -> /tutorial
                 "Leaderboard"    -> /leaderboard
                 "Port city"      -> /city
  Bottom-left  settings and sound-toggle ink icons
  Bottom-right the version string in small ink text (P17 turns this into the demo-menu tap
               target)

  Under "Play online", show the live player count from Supabase Presence once P11 lands
  ("142 sailors online"). Until then, hide the line rather than showing a zero.

  The buttons enter as one staggered group on mount, 40ms apart, translateY 8 -> 0 with
  opacity. That is the only entrance animation on this screen.

src/state/profile.ts — zustand store persisted via expo-sqlite's localStorage shim
(createJSONStorage(() => localStorage)), holding:
  { userId, name, avatarId, avatarColor, countryCode, rankPoints, battlesPlayed,
    battlesWon, coins, gems, hasCompletedTutorial, soundOn, musicOn, hapticsOn }
Every screen reads the profile from here, never from Supabase directly.

ACCEPTANCE:
- Boot holds 60fps on a mid-range Android — profile it, the grid wipe is the risky part
- Tapping during boot jumps straight to the end state with no visual glitch
- Cold start to interactive menu is under 2.5s, including with the network unplugged
```

---

## P03 — Game engine, pure TypeScript 🔴 (~2h) — the load-bearing prompt

```
Read docs/BRIEF.md section 3 in full. It is the complete rule spec. Implement it exactly.
Where it is silent, pick the simplest deterministic behaviour and note the choice in a
comment.

Build src/engine/ as pure TypeScript. HARD RULE: no imports from react, react-native,
expo-*, or any other src/ directory. This code runs unchanged inside the Node match server.
The eslint rule from P00 enforces it — do not disable it.

FILES:

rng.ts   — mulberry32 seeded PRNG. createRng(seed: number) -> { next, int(maxExclusive),
           pick<T>(arr), shuffle<T>(arr) }. Every random decision goes through this so any
           match replays exactly from its seed. No Math.random anywhere in src/engine.

types.ts — the vocabulary. Be precise, everything depends on it:
           Coord {r,c} · Orientation 'h'|'v' ·
           ShipClass 'battleship'|'cruiser'|'destroyer'|'boat' ·
           Ship { id, class, len, origin, orientation, hits: Coord[] } ·
           ArsenalKind (the 8 from the brief) · ArsenalItem ·
           CellState 'unknown'|'miss'|'hit'|'sunk'|'revealed'|'mine' ·
           Board · PlayerState · MatchState ·
           MatchAction (discriminated union) ·
           MatchEvent (discriminated union — this is the animation script the UI replays) ·
           PlayerView (the masked per-player projection) ·
           MatchMode 'classic'|'advanced'

board.ts — grid helpers: inBounds, cellsOf(ship), neighbours8(coord), halo(ship)
           (the expanded footprint), coordKey/parseKey, emptyBoard().

fleet.ts — FLEET_SPEC = [battleship 4 x1, cruiser 3 x2, destroyer 2 x3, boat 1 x4].
           makeFleet(), isSunk(ship), allSunk(player).

placement.ts —
  validatePlacement(board, ship) -> { ok:true } | { ok:false, reason: string }
    checks bounds, overlap, and the no-touching-including-diagonally halo rule
  placeShip / removeShip / moveShip / rotateShip
    rotate pivots on the ship's first cell and fails cleanly when invalid
  autoPlaceFleet(rng) -> a full valid random layout. Retry with backoff: 200 attempts per
    ship, restart the whole fleet if stuck. It MUST terminate. Write a test running it
    1000 times with different seeds asserting every result is valid.
  validateArsenalPlacement(board, item) -> 1 cell, must be empty, halo rule does NOT apply

shots.ts —
  resolveShot(state, attackerId, coord) -> { events: MatchEvent[], keepsTurn: boolean }
  Implement the brief's resolution order exactly: already-shot -> reject without consuming
  a turn; mine -> MINE_TRIGGERED and turn ends; hit -> HIT, and if the ship is now dead
  emit SUNK plus AUTO_REVEAL for every 8-neighbour of the whole ship, turn kept; otherwise
  MISS and turn ends.

arsenal.ts — one resolver per kind, each returning MatchEvent[]:
  torpedoBomber(row) · doubleTorpedoBomber(row) · bomber(coord) · atomicBomber(coord) ·
  submarine(coord) · radar(coord)
  AIRCRAFT RULE: before resolving any bomber variant, scan the target row(s) on the
  defender's board for an AA gun. If present, emit AIRCRAFT_DOWNED, reveal the gun's cell
  to the attacker, consume the weapon, end the turn, resolve nothing else.
  Radar returns only a COUNT of occupied cells in the 3x3, never positions.
  Any arsenal attack landing >= 1 hit keeps the turn.

match.ts —
  reduce(state, action) -> { state, events }
  Pure, never mutates. Validates that the actor is the current player and that the phase
  allows the action. Handles SUBMIT_LAYOUT, FIRE, USE_ARSENAL, TIMEOUT, RESIGN. Manages
  phase 'placing'|'playing'|'over' and turn switching.

  projectView(state, playerId) -> PlayerView
  THE MASKING FUNCTION. Returns the player's own board in full and the enemy board with
  ONLY the cells that player has learned about. This function is the entire anti-cheat
  story. Write four tests asserting no enemy ship position leaks through it.

ai.ts — chooseMove(view, difficulty, rng). Hunt/target:
  HUNT: fire on a parity lattice ((r+c) % 2 === 0) among unknown cells, weighted by how
        much open space surrounds each candidate
  TARGET: on an unresolved hit, queue its orthogonal neighbours; once two hits are
        collinear, extend along that axis only
  'easy' adds a 35% chance of a random move. 'hard' also excludes cells adjacent to sunk
  ships, since the no-touching rule guarantees they're empty.
  In advanced mode, spend arsenal when a good target exists — atomic bomber on the densest
  unknown 3x3.

index.ts — barrel export.

TESTS — src/engine/__tests__/, vitest, all must pass:
  placement.test.ts  halo rejects diagonal touches; autoPlaceFleet valid over 1000 seeds
  shots.test.ts      hit keeps turn; miss ends turn; sink auto-reveals exactly the 8-halo;
                     already-shot rejected without consuming a turn; mine ends turn
  arsenal.test.ts    each weapon's footprint; AA gun downs a bomber crossing its row;
                     radar returns a count and leaks no positions
  match.test.ts      a full scripted game from layout to win; out-of-turn action rejected
  view.test.ts       projectView never exposes an un-hit enemy ship cell — assert by
                     serialising the view to JSON and grepping for enemy ship coords
  ai.test.ts         AI finishes against a fixed layout in under 100 moves, over 200 seeds

ACCEPTANCE:
- npm run test green
- npx tsx -e "import('./src/engine/index.ts').then(m=>console.log(Object.keys(m)))" works,
  proving purity
- grep finds no Math.random and no Date.now inside src/engine
```

---

## P04 — Board renderer 🔴 (~1.5h)

```
Read docs/ASSETS.md for ship sprite filenames and sizes.

Build src/board/. Everything is react-native-svg, authored in the 800x360 design space from
P01. Cell size 28 design units.

layout.ts — pure geometry: cellToPoint(coord, boardOrigin), pointToCell(xy, boardOrigin)
  returning null outside the board, shipRect(ship), BOARD_SIZE = 280, CELL = 28.

GridBoard.tsx — one 10x10 board. Props:
  { origin, cells, ships?, arsenal?, interactive, onCellPress, onCellLongPress,
    highlight?: Coord[], watermark?: ImageSource }

  Layers, bottom to top:
    1. optional watermark image at 12% opacity, clipped to the board
       (assets/images/board/watermark-*.png)
    2. the 10x10 cell rules — 22 memoised plain <Line>s, not 100 rects, not rough
    3. the board frame — a heavy double roughRect with overshooting corners, seeded by a
       stable key so it never re-wobbles
    4. row letters A-J and column numbers 1-10 outside the frame, Bitter 700 at 16 units,
       color.ink. In the two-board layout, row letters appear on BOTH outer sides.
    5. revealed/shaded cells — rough hachure fill in inkFaint
    6. ships (own board only)
    7. cell marks
    8. highlight overlay

  interactive=false must skip touch handling entirely, not just ignore it.

ShipSprite.tsx — two modes:
  'sprite' the PNG from assets/images/ships/, rotated 90deg when vertical, sized
           len*CELL x CELL with 2 units of bleed so it overlaps the rules slightly, the way
           a drawn object would. Tinted with color.ink.
  'wreck'  when sunk — the sprite at 55% opacity in inkFaint with three rough scribbles
           struck through it and a smoke puff
  Also renders arsenal items (AA gun, mine, radar) from assets/images/arsenal/.

CellMark.tsx — per-cell marks, each drawn rather than stamped:
  miss     a small ink dot with 4 short radiating splash ticks
  hit      an irregular filled blob in ink with 6 debris ticks and 2 inkRed flecks
  sunk     the hit blob with a heavier outline
  revealed rough hachure fill only
  mine     a small spiked circle in inkRed
  Entrance: 160ms, scale 0.4 -> 1.15 -> 1 with a small rotation.

DualBoards.tsx — the battle layout: own board at x=100, enemy at x=420, 40-unit gutter,
  TurnTriangle centred in the gutter at y=180. This is the exact composition in the
  reference screenshots; match it.

PERFORMANCE — this is the screen the whole game lives on:
  - Static grid, frame and labels render ONCE. Wrap in React.memo with a comparator that
    only checks `origin`.
  - Cell marks keyed by coordKey; only the changed cell re-renders.
  - No Animated value on the parent SVG. Animate leaves only.
  - Target: adding a cell mark costs under 2ms of JS. Measure with the RN perf monitor
    before calling this done.

Build app/(dev)/board-lab.tsx: both boards with a full fleet, one of every cell mark, every
ship state, and buttons that fire random shots so you can watch marks land.

ACCEPTANCE:
- board-lab shows every visual state at once and reads as hand-drawn
- Firing 20 rapid shots holds 60fps with no dropped frames
- Tapping returns the right coordinate at every corner and edge
```

---

## P05 — Fleet placement screen 🔴 (~2h)

```
Reference screenshot: IMG_9767. Match its composition.

Build app/(game)/placement.tsx. Players spend more deliberate time here than anywhere else,
so the drag has to feel excellent. That is most of the work.

LAYOUT (800x360):
  Top-left      back InkButton
  Top-right     fuel gauge — barrel icon plus a roughRect bar with a green hachure fill and
                "235/260" in Bitter 700. Animate the fill on change.
  Left 300u     the player's GridBoard, interactive
  Right 460u    the arsenal shop container (P06 fills it; render the frame now)
  Bottom-right  "Battle!" InkButton, tone 'confirm', large (Bitter 700 at 31)
  Bottom-centre a circular-arrow reset button and a shuffle/auto-place button

SHIP DRAGGING — react-native-gesture-handler Pan plus Reanimated worklets. All of it runs
on the UI thread. A placement drag that stutters makes the whole game feel cheap.

  - Long-press 120ms or an immediate pan picks a ship up. On pickup: Light haptic, the ship
    lifts (scale 1.06) and renders a soft offset ink shadow beneath it.
  - While dragging, snap the ghost to the nearest cell continuously. Show a full-row and
    full-column tint band through the hovered cell — the purple hachure band in the
    screenshot — so the player reads alignment without looking away.
  - Valid drop: the snapped ghost outlines in ink. Invalid: outlines in inkRed and the halo
    cells causing the conflict tint red.
  - Release on invalid: spring back to origin, Warning haptic, no state change.
  - Release on valid: commit, Medium haptic, play sfx/ship_place.mp3.
  - TAP with no movement on a placed ship: rotate it. If the rotation is invalid, shake the
    ship 3px twice over 180ms and do not rotate.
  - Drag a ship off the board into the tray to un-place it.

  Unplaced ships sit in a small tray on the left edge.

STATE — src/state/placement.ts (zustand):
  { ships, arsenal, fuelSpent, fuelBudget, mode }
  Every mutation goes through the P03 engine functions. Do not reimplement validation in
  the UI — call validatePlacement and render its `reason` string.

FLOW:
  - On mount, call autoPlaceFleet(seed) so the board is never empty. Players who don't care
    hit Battle! in one tap; players who do can rearrange. This is a deliberate UX choice —
    keep it.
  - "Battle!" is disabled until every ship is placed. Once enabled it gets one slow pulse
    every 3s to draw the eye.
  - On Battle!, branch on mode:
      'ai'      -> push /(game)/battle with the local layout
      'hotseat' -> hand the device to player two for their placement (P14)
      'online'  -> submit the layout over WS and push /(game)/searching (P13)

ACCEPTANCE:
- Dragging never drops a frame, even with 10 ships and 6 arsenal items placed
- The no-touching rule is visibly enforced: dragging diagonally adjacent shows red
- Rotate near an edge fails with the shake, never silently repositions
- Auto-place produces a valid layout every time — hammer shuffle 50 times
```

---

## P06 — Arsenal shop 🟡 (~1h)

```
Reference screenshots: IMG_9767 (shop panel), IMG_9750 (in-battle popover).
Read the arsenal table in docs/BRIEF.md section 3.4 for exact costs, caps and effects.

Build src/features/arsenal/ShopPanel.tsx, rendered inside placement.tsx.

CARD GRID — 2 columns x 3 rows, scrollable. Each card is an InkPanel containing:
  top-left     an "i" info button, circled, inkRed
  top-right    the price, right-aligned, with the fuel-drop icon
  centre       the item sprite from assets/images/arsenal/
  bottom-left  owned/max as "1/3" in Bitter 600
  bottom       the item name in Bitter 600 at 16

  Affordable and under cap -> full opacity, pressable
  Unaffordable             -> 45% opacity, price in inkRed, press shakes the fuel gauge
  At cap                   -> full opacity, count in inkGreen, press is a no-op

BUY:
  - Offensive items (bombers, submarine): buying just increments the count. Animate the
    count and roll the fuel number down.
  - Defensive items (AA gun, mine, radar): buying enters placement mode for that item — the
    shop dims, the board highlights every legal cell, and the next board tap places it.
    Hardware back cancels and refunds. Placed items can be dragged, and long-pressed to
    sell back at full price.

INFO POPOVER — tapping "i" opens an InkPanel over the board with the item name, a diagram
  of its effect drawn on a mini 5x5 grid, and one line of rules copy. Write the copy
  yourself, active and specific:
    AA Gun:  "Shoots down any enemy aircraft flying through its row."
    Mine:    "The enemy's turn ends the moment they hit it."
    Radar:   "Reports how many ship cells sit in a 3x3 area. Not which ones."
  Not "This is a powerful defensive tool that can be used to..." — no filler, ever.

CLASSIC MODE: don't render the panel at all, and hide the fuel gauge. Not a disabled shop —
no shop. Reflow the board to centre.

ACCEPTANCE:
- Fuel can never go negative; the sum of purchases always equals fuelSpent
- Selling a placed AA gun restores fuel exactly and frees the cell
- Switching to classic removes the panel and recentres the board cleanly
```

---

## P07 — Battle screen 🔴 (~2.5h)

```
Reference screenshots: IMG_9770 (live HUD) and the three store screenshots. Match the HUD
composition precisely.

Build app/(game)/battle.tsx. This screen is where the demo lives or dies.

HUD (top strip above the boards):
  far left       your avatar card, framed portrait from assets/images/avatars/
  left           the "Arsenal" tab — inkRed label on a scalloped tab hanging down from the
                 top edge, with a badge showing total items remaining
  centre-left    your rank name (Bitter 600, 13), your name (Bitter 700, 20),
                 "Points: N" in inkRed
  centre-right   the same mirrored for the opponent, with their flag chip
  far right      the opponent's avatar card
  top-right      a home InkButton
  Between the boards: TurnTriangle with the live countdown, a chat/emote button above it,
  the home button below.

BOARDS: DualBoards from P04. Your board fully visible with ships. The enemy board shows
only what you know, with a watermark behind it.

TURN LOOP:
  Your turn  -> enemy board interactive, triangle green pointing right, 20s countdown.
                Tapping a cell shows the four converging red crosshair arrows (IMG_9745)
                for 260ms, then fires.
  Their turn -> enemy board locked, triangle red pointing left, marks appear on your board.
  Under 5s   -> countdown pulses, soft tick each second.
  Timeout    -> auto-fire a random legal cell offline; the server decides online.

THE EVENT REPLAY SYSTEM — the core abstraction. Build it carefully.
  The engine returns MatchEvent[]. The UI NEVER inspects match state to decide what to
  animate; it plays the event list as a timeline.

  src/fx/EventPlayer.ts — an async queue consuming MatchEvent[]. Per event: await an
  animation, play a sound, fire a haptic, then commit the state change to the store. Events
  play strictly in order. Input is locked while the queue is non-empty.

  SHOT_FIRED     a shell arcs from the firing board to the target cell, 340ms ease-in-out,
                 with a thin dotted ink trail fading behind it
  MISS           ink splash, sfx/splash.mp3, Light haptic
  HIT            explosion sprite sequence, sfx/explosion.mp3, Medium haptic, plus a 6px
                 camera shake on the BOARD only, never the HUD
  SUNK           the ship redraws as a wreck with a smoke puff, sfx/ship_sink.mp3, Heavy
                 haptic, then AUTO_REVEAL events hatch the halo cells in a 40ms stagger
                 radiating outward from the ship
  MINE_TRIGGERED red flash, sfx/mine.mp3, Heavy haptic, turn indicator flips with a hard snap
  TURN_CHANGED   the triangle flips: 180ms rotate-and-recolour
  MATCH_OVER     hold 900ms, then route to /(game)/result

  Every animation must be interruptible by a "skip" tap that fast-forwards the queue. On a
  demo stage you will want this.

CHAT/EMOTE: the bubble button opens a small InkPanel with 8 ink-style emoji stickers
  (assets/images/ui/emote-*.png). Sending broadcasts over the Supabase Realtime match
  channel (P13) and floats the sticker up over the opponent's avatar for 1.6s.

MODE PLUMBING: the screen takes mode 'ai' | 'hotseat' | 'online'.
  'ai'      drives the loop with src/engine/ai.ts on a randomised 900-1400ms delay so the
            opponent feels like it's thinking
  'online'  the loop is driven by server state/event messages (P13)
  'hotseat' both sides are local, with a pass-the-device curtain between turns (P14)
  The screen must not care which. All three feed the same EventPlayer.

ACCEPTANCE:
- A full AI match from first shot to victory plays with no visual desync
- Rapid-tapping the enemy board during an animation queues nothing and fires nothing
- The skip tap fast-forwards cleanly with no orphaned animation
- 60fps during a sink plus 8-cell auto-reveal cascade
```

---

## P08 — Arsenal in battle 🟡 (~1.5h)

```
Reference: IMG_9750 (the popover) and IMG_9753 (a bomber run in flight).

Extend battle.tsx with offensive arsenal use.

POPOVER: tapping the "Arsenal" tab slides an InkPanel down from the top edge over the left
half of the screen with a 2x5 grid of weapon cards showing remaining counts. Zero-count
items render at 40% opacity. Tapping a card with count > 0 enters targeting mode and
dismisses the popover.

TARGETING OVERLAYS — one per weapon, on the enemy board:
  Torpedo Bomber        hovering a row tints the whole row; a plane icon sits at the launch edge
  Double Torpedo Bomber tints two adjacent rows, moving together
  Bomber                a 3-cell T footprint follows the finger
  Atomic Bomber         a 3x3 footprint follows the finger, tinted inkRed
  Submarine             a single cell, must be unshot; the vertical column tints faintly
  Radar                 a 3x3 footprint in inkGreen
  Cancel via a back button, hardware back, or a tap outside the board. The weapon is only
  consumed on fire, never on cancel.

ATTACK ANIMATIONS — these are the moments people screenshot. Spend time here.
  Bomber run     the plane sprite (assets/images/fx/plane-bomber.png) flies in from your
                 side, crosses the gutter, passes over the target row, drops bombs that arc
                 down, exits the far edge. ~1.4s. Bombs land 120ms apart.
  AA intercept   if the defender has an AA gun in that row, the plane reaches the gun's
                 column, the gun flashes, the plane trails smoke, banks, and spirals down
                 with a falling-pitch sfx. Then the AA gun's cell is revealed to the
                 attacker with a stamped reveal, and the turn ends. THIS IS THE BEST
                 MOMENT IN THE GAME — make it read clearly to someone who has never played.
  Atomic bomber  the plane crosses, one large bomb falls, a white flash fills the enemy
                 board for 90ms, then a 3x3 crater resolves outward from centre in a 60ms
                 ring stagger. Heavy haptic. Hold 400ms before the turn resolves.
  Submarine      the sub surfaces at the target cell, fires two torpedoes vertically that
                 travel cell by cell at 80ms each until they hit or exit, then submerges.
  Radar          a green arc sweeps once over the 3x3, then a result chip appears above it
                 reading "3 cells" in Bitter 700. The chip stays 2.5s.

All of these are just MatchEvent types flowing through the P07 EventPlayer. Add:
  AIRCRAFT_LAUNCHED · AIRCRAFT_DOWNED · BOMB_DROPPED · TORPEDO_TRAVEL · RADAR_RESULT ·
  SUBMARINE_SURFACED · NUKE_FLASH

ACCEPTANCE:
- Every weapon's resolved footprint matches the P03 engine tests exactly
- The AA intercept unmistakably reads as "your plane got shot down"
- Cancelling targeting never consumes a weapon or a turn
```

---

## P09 — Tutorial 🔴 (~2h)

```
Reference screenshots in order: IMG_9744, IMG_9745, IMG_9746, IMG_9748, IMG_9750,
IMG_9753, IMG_9767, IMG_9768. These are the exact beats.

Build a scripted, on-rails tutorial that REUSES the real battle and placement screens with
an overlay driver. Do NOT build a parallel fake game. If the tutorial and the game diverge,
the tutorial is lying to the player.

src/tutorial/script.ts — the tutorial as data:

  type Step = {
    id: string
    say?: { text: string; side: 'left' | 'right' }
    spotlight?: { target: 'cell' | 'element'; ref: string }
    require?: { kind: 'tap-cell'; coord: Coord }
             | { kind: 'tap-element'; ref: string }
             | { kind: 'drag-ship'; shipId: string; to: Coord }
             | { kind: 'wait'; ms: number }
    forceOutcome?: MatchEvent[]
  }

  Rigging outcomes is essential. Step 3 must always hit, step 4 must always sink. A tutorial
  that depends on luck teaches nothing. The engine stays honest — the tutorial supplies a
  fixed enemy layout and a fixed shot script.

THE 14 STEPS:
  1  Boards ink in. The Captain slides up from bottom-right.
     "Welcome aboard. Let's sink something."
  2  Green triangle appears, enemy board spotlit. "Your turn. Tap a square on the right to
     fire." Require tap-cell F5.
  3  Crosshairs converge, shot arcs, HIT. Captain moves to the left.
     "A hit. That means you fire again."
  4  Require tap-cell E5. HIT -> SUNK -> halo auto-reveals.
     "Sunk. The squares around a wreck are always empty, so we mark them for you."
  5  Require tap-cell H8. MISS. Triangle flips red. "A miss ends your turn."
  6  Opponent fires, misses on your board at I7 (matches IMG_9748). Triangle flips green.
  7  Spotlight the Arsenal tab, pulsing. "You're not limited to one square at a time."
     Require tap-element 'arsenal-tab'.
  8  Popover opens, Bomber card spotlit. "A bomber hits three squares at once."
     Require tap-element 'card-bomber'.
  9  Targeting overlay. Require tap-cell C4. Plane flies, bombs drop, one hit lands.
  10 A second bomber run, this time into a row holding an AA gun. Plane shot down.
     "Their anti-air covers that row. Aircraft can't cross it."
  11 Hard cut to placement with a fresh empty board and one ship in the tray.
     "Before every battle, you set your own fleet." Require drag-ship 'cruiser-1' to C3.
  12 "Tap a ship to turn it." Require tap-element 'ship-cruiser-1'.
  13 Spotlight the AA Gun shop card. "And you can buy defences. You can buy more mid-battle
     too." (matches IMG_9768) Require tap-element 'card-aagun', then a board tap to place.
  14 "That's everything. Go win one." -> set profile.hasCompletedTutorial, route to /menu.

src/tutorial/TutorialOverlay.tsx — the driver:
  - a full-canvas dim layer at 55% with an SVG mask cutting a hole around the spotlight
    target, the hole outlined in a dashed animated ink stroke
  - the Captain portrait sliding in from the step's side, with the P01 SpeechBubble
  - a pointing-hand cursor (assets/images/ui/hand-pointer.png) that animates toward the
    required target and taps twice, looping every 2s until the player acts
  - a "Skip" InkButton pinned top-right on every step
  - all input outside the spotlight is swallowed

  Register targets with a useTutorialTarget('arsenal-tab') hook that reports the element's
  measured rect into a context. Do NOT hardcode coordinates — they drift the first time you
  touch a layout.

VOICE: play assets/audio/voice/captain-NN.mp3 per line if the file exists, silent otherwise.
Text always shows regardless of audio.

ACCEPTANCE:
- The whole tutorial completes in under 2 minutes at a normal pace
- Skip works from any step and lands on /menu with hasCompletedTutorial set
- No step can soft-lock: a wrong tap re-prompts the Captain and restarts the hand cursor
- The tutorial uses the REAL battle screen — verify by tweaking a P07 animation and seeing
  it appear in the tutorial with no extra work
```

---

## P10 — Name, avatar, progress 🟡 (~1.5h)

```
Reference screenshots: IMG_9755 (name + keyboard), IMG_9756 (avatar), IMG_9754 (progress).

app/(onboarding)/name.tsx — reference IMG_9755:
  An InkPanel modal centred in the upper half: "Enter your name:", a wide roughRect field
  showing the current value in Bitter 700 at 25, a "Save" InkButton below, and a red X close
  button at the panel's top-right.

  THE CUSTOM KEYBOARD is the distinctive part — a hand-drawn keyboard filling the bottom 55%
  of the canvas. Each key is a roughRect with a Bitter 600 glyph:
    row1  q w e r t y u i o p -
    row2  a s d f g h j k l _ +
    row3  shift z x c v b n m ' @ backspace(inkRed border)
    row4  123  !  globe  [space]  .  ,  enter
  Keys press with a 1-unit downward offset and a Light haptic. Build it as
  src/ui/InkKeyboard.tsx taking { value, onChange, onSubmit } so it is reusable.
  No native keyboard ever appears — the field is a rendered string with a blinking ink
  caret, not a TextInput.

  Validation: 1-14 characters, trimmed. Save disabled when empty. On save, write to the
  profile store AND update the Supabase profiles row.

  BUDGET NOTE: this is cut item #2 in docs/BRIEF.md section 6. A styled native TextInput is
  an acceptable fallback. Only build the keyboard if the rest of Day 2 is on track.

app/(onboarding)/avatar.tsx — reference IMG_9756:
  Four avatar cards in a row inside one large InkPanel. Each card: a framed portrait, a 5x2
  grid of colour swatches beneath, and a "Choose" button. The selected swatch gets a 2-unit
  inkRed outline. Tapping a swatch recolours that portrait instantly.

  IMPORTANT: there is ONE image per avatar, not ten. The portraits are black line art and
  you recolour with <Image tintColor={AVATAR_TINTS[color]} />. Ten colours are listed in
  docs/ASSETS.md section 4.5.

  "Choose" writes { avatarId, avatarColor } to the profile store and to Supabase, then
  routes onward.

app/(onboarding)/progress.tsx — reference IMG_9754:
  Two panels side by side inside a TitleRibbon reading "Choose game progress".
    Left, warm pink tint:   "Local progress" / "Currently loaded" in inkRed
    Right, cool violet tint:"Cloud progress" / "last save: DD/MM/YYYY, HH:MM"
  Each shows a RankBadge with progress bar, three stat rows with icons (battles, gems,
  buildings), the account id in small Bitter 500 wrapped over two lines, and a large green
  "Choose" InkButton.

  This screen appears ONLY when a local profile and a Supabase profile both exist and
  differ. Choosing one overwrites the other and routes to /menu. Skip it entirely otherwise.

app/settings.tsx — sound / music / haptics toggles, a "Reset tutorial" button, credits (see
  docs/ASSETS.md section 7 — if you used game-icons.net or Freesound assets, attribution is
  required and it goes here), and the build version.

ACCEPTANCE:
- The custom keyboard never triggers the OS keyboard and never drops characters when typed fast
- Avatar recolour is instant with no image flicker
- The progress screen is skipped when there is no conflict
- Names round-trip to Supabase and survive an app restart
```

---

## P11 — Supabase: schema, auth, RLS 🔴 (~1.5h) — *backend track starts here*

```
Read docs/BRIEF.md sections 4.3-4.5.

Set up Supabase. Every change goes in a numbered, idempotent SQL file under
supabase/migrations/. Do not click anything in the dashboard that isn't captured in a
migration.

KEY NAMING: Supabase is deprecating anon/service_role keys by the end of 2026 in favour of
publishable (sb_publishable_*) and secret (sb_secret_*). The app uses publishable; the Node
server uses secret. The secret key must never appear in the Expo bundle.

SCHEMA:

  profiles
    id             uuid pk references auth.users on delete cascade
    name           text not null check (char_length(name) between 1 and 14)
    avatar_id      smallint not null default 0
    avatar_color   text not null default 'violet'
    country_code   text
    rank_points    int not null default 0
    battles_played int not null default 0
    battles_won    int not null default 0
    coins          int not null default 0
    gems           int not null default 10
    created_at     timestamptz default now()
    updated_at     timestamptz default now()

  matches
    id           uuid pk default gen_random_uuid()
    mode         text check (mode in ('classic','advanced'))
    player_a     uuid references profiles
    player_b     uuid references profiles
    winner       uuid references profiles
    seed         bigint not null
    started_at   timestamptz default now()
    ended_at     timestamptz
    end_reason   text check (end_reason in ('victory','resign','timeout','disconnect'))

  match_events
    id       bigserial pk
    match_id uuid references matches on delete cascade
    seq      int not null
    payload  jsonb not null
    unique (match_id, seq)
    -- the full replay log. Makes matches auditable and lets you rebuild any game.

  ranks
    id smallint pk, name text not null, points_required int not null
    seed: 1 Seaman Recruit 0 · 2 Seaman Apprentice 100 · 3 Petty Officer Second Class 400 ·
          4 Chief Ship Petty Officer 1000 · 5 Captain 3000 · 6 Vice-admiral 10000

RLS — enable on every table:
  profiles      SELECT any authenticated user (needed for opponent cards and leaderboard)
                UPDATE only where id = auth.uid(), AND only the columns name, avatar_id,
                  avatar_color, country_code. Enforce the column restriction with a BEFORE
                  UPDATE trigger that rejects any change to rank_points, coins, gems or
                  battles_* unless the role is the service role. Clients must never be able
                  to write their own score — this is the whole point.
                INSERT where id = auth.uid()
  matches       SELECT where player_a = auth.uid() or player_b = auth.uid()
                INSERT/UPDATE service role only
  match_events  SELECT via a join to a match the user played
                INSERT service role only
  ranks         SELECT public

VIEW:
  leaderboard — top 100 by rank_points, exposing ONLY
    { name, avatar_id, avatar_color, country_code, rank_points, battles_won }.
    Never expose ids or emails.

AUTH:
  Anonymous sign-in on first launch, so a player can play immediately and never sees a login
  screen. An AFTER INSERT trigger on auth.users creates the profiles row with a generated
  name ("Sailor 4821") that onboarding then overwrites.

  Optional, only if Day 2 has slack: a "Save my progress" button in settings that links an
  email to the existing anonymous user via updateUser, so a reinstall recovers the account.
  This is the only reason the Choose Game Progress screen exists. Do not build a login
  screen — there is no login in this game.

REALTIME:
  Turn off "Allow public access" in Realtime settings and add RLS policies on
  realtime.messages so all channels are private. Two topic shapes:
    lobby:{mode}    Presence only — the online player count on the menu
    match:{matchId} Broadcast — chat and emotes ONLY. Never game state; that is the Node
                    server's job.
  Policy: a user may read/write match:{id} only if they are player_a or player_b of that
  match. Use realtime.topic() inside the policy to extract the id.

CLIENT:
  src/net/supabase.ts already exists from P00 — extend it.
  Generate types: `supabase gen types typescript` into src/net/database.types.ts, use them
  everywhere.
  src/net/api.ts — signInAnonymously, getProfile, updateProfile, getLeaderboard,
  getMatchHistory. Validate every response at the boundary with zod. Every function returns
  a Result type; no throwing across the network boundary.

ACCEPTANCE:
- `supabase db reset` applies every migration cleanly from scratch
- A test authenticating as user A and trying to UPDATE user B's rank_points fails
- A test where user A tries to UPDATE THEIR OWN rank_points fails
- Subscribing to a match:{id} channel for a match you're not in fails
- grep finds the secret key in no file under app/ or src/
```

---

## P12 — Node authoritative match server 🔴 (~2.5h) — *backend track*

```
Read docs/BRIEF.md section 4. The critical property: THE SERVER OWNS BOTH BOARDS. A client
never receives an enemy ship position it hasn't earned. Everything else is negotiable.

Build server/ — Fastify + ws + tsx. It imports the engine directly from ../src/engine via
the tsconfig path alias from P00. Do not copy or reimplement any rule.

server/src/protocol.ts — the wire protocol as zod schemas plus exported types.
WRITE THIS FILE FIRST and FREEZE IT — the client track (P13) codes against it in parallel.
Every message carries `v: 1`.

  Client -> Server
    { t:'hello',       v:1, token: string, resumeMatchId?: string }
    { t:'queue',       v:1, mode: 'classic'|'advanced' }
    { t:'cancelQueue', v:1 }
    { t:'ready',       v:1, layout: LayoutPayload }
    { t:'action',      v:1, seq: number, action: MatchAction }
    { t:'resign',      v:1 }
    { t:'ping',        v:1 }

  Server -> Client
    { t:'hello:ok', v:1, playerId }
    { t:'queued',   v:1, position, onlineCount }
    { t:'matched',  v:1, matchId, you, opponent, mode, fuelBudget, layoutDeadline }
    { t:'state',    v:1, seq, view: PlayerView }      // masked, authoritative
    { t:'events',   v:1, seq, events: MatchEvent[] }  // the animation script
    { t:'turn',     v:1, playerId, endsAt }
    { t:'over',     v:1, winnerId, reason, rewards }
    { t:'error',    v:1, code, message }
    { t:'pong',     v:1 }

server/src/room.ts — one Room per match holding the full MatchState in memory.
  - Validate every inbound action through the engine reducer. An illegal action returns an
    `error` and is NOT applied. Log it with the player id. Five illegal actions from one
    connection = disconnect; that's a cheating signal.
  - After each action: reduce(), persist events to match_events, then send each player their
    own projectView() output plus the shared event list.
  - Turn timer: setTimeout, 20s + 2s latency grace. On expiry dispatch TIMEOUT through the
    reducer. Two consecutive timeouts from one player forfeits the match.
  - Layout phase has its own 90s deadline; a player who doesn't submit gets autoPlaceFleet().
  - Disconnect: keep the room alive 45s, set an `opponentDisconnected` flag on the view so
    the UI can show "Reconnecting…". After 45s, award the win.
  - Reconnect: `hello` with resumeMatchId re-attaches the socket, replays current state plus
    any events missed. Track lastAckedSeq per player.

server/src/matchmaker.ts — a queue per mode. Pair FIFO with a widening rank window: start at
  ±150 rank_points, widen by 150 every 5s, uncapped after 30s. On pair: insert the matches
  row, generate a seed, create the Room, send `matched` to both.
  If a player has waited 45s with no human available, offer a bot match — send `matched`
  with a bot opponent driven by src/engine/ai.ts server-side. The client cannot tell the
  difference and your demo never stalls on an empty lobby. Mark it `isBot` in the DB only.

server/src/index.ts — Fastify with:
  - GET /health -> { ok, rooms, queued, uptime }
  - GET /ws upgraded by the ws server
  - JWT verification on `hello`: verify the Supabase access token against the project JWKS
    and extract the user id. An unverified token gets a hard close. This is the ONLY auth
    gate — never trust a player id sent in a message body.
  - 30s heartbeat ping/pong; terminate sockets that miss two

SAFETY RAILS — all of these, they're cheap:
  - rate limit 10 messages/second per socket, then close
  - 16KB message size cap
  - validate every inbound message with its zod schema before touching it; reject unknown `t`
  - NEVER send MatchState over the wire, only PlayerView. Add a unit test that serialises a
    full outbound message set from a real match and asserts the enemy's un-hit ship
    coordinates appear nowhere in the JSON.

server/src/__tests__/room.test.ts — drive two mock sockets through a complete match including
a timeout, a disconnect/reconnect, and an illegal-action attempt.

DEPLOY: a Dockerfile plus a fly.toml (or railway.json). One small instance is plenty. Health
check on /health. Note the WSS URL in docs/README.md — the Expo app needs wss:// in
production, ws:// only on the local network.

ACCEPTANCE:
- Two `wscat` sessions play a complete match end to end
- Killing one client mid-match and reconnecting inside 45s resumes with correct state
- The leak test passes: enemy positions are absent from every outbound payload
- /health responds while a match is in progress
- Deployed and reachable over wss:// from a phone on mobile data
```

---

## P13 — Client netcode and matchmaking 🔴 (~1.5h)

```
Depends on the frozen protocol from P12.

Build src/net/match-client.ts and wire it into placement and battle.

  - Connect to EXPO_PUBLIC_WS_URL, send `hello` with the Supabase access token
  - Exponential-backoff reconnect: 500ms, 1s, 2s, 4s, capped at 8s, with jitter. On
    reconnect during a match, send resumeMatchId.
  - Parse every inbound message with the shared zod schemas. A message that fails validation
    is logged and dropped — never crashes the app.
  - Expose a zustand store: { status, matchId, view, pendingEvents, opponent, turnEndsAt }
  - Outbound actions carry a client `seq`; the server echoes it so stale responses are dropped

OPTIMISTIC UI — this is where multiplayer feels good or bad:
  On firing, immediately show the crosshair and the shell arc locally. Do NOT show a
  hit/miss result until the server's events arrive. The arc takes 340ms, which covers most
  round trips, so the shot feels instant while staying honest. If the server hasn't
  responded by the time the arc lands, show a small ink "…" at the target cell until it does.
  NEVER predict a shot outcome. A rolled-back hit is far worse than a 200ms wait.

CONNECTION UI:
  Connecting          a small ink spinner (a pen drawing a circle) in the HUD corner
  Reconnecting        dim the boards to 60%, Captain SpeechBubble: "Lost contact. Trying to
                      raise them." with a countdown to forfeit
  Opponent dropped    same treatment: "They've dropped out. Waiting 45 seconds."
  Failed              an InkPanel with the reason and two buttons, "Try again" and "Back to
                      menu". Write the copy as plain, specific, non-apologetic sentences.
                      Never "Something went wrong".

app/(game)/searching.tsx — reference IMG_9769 for the arena reveal that follows:
  - "Finding an opponent" with an animated ink radar sweep and the live count from Supabase
    Presence on lobby:{mode}
  - elapsed timer and a Cancel button
  - on `matched`: play the arena reveal — a TitleRibbon drops in with the arena name
    ("Black Harbor"), both player cards slide in from the sides, hold 2s, route to battle

Also subscribe to the Supabase Realtime match:{matchId} channel here for chat and emotes
only. Game state comes from the WS server exclusively — never mix the two.

ACCEPTANCE:
- Airplane-mode toggle mid-match recovers and resumes correctly
- Two physical devices complete a full online match
- Killing the server mid-match shows the reconnecting UI; restarting it recovers
- No unhandled promise rejections across 10 consecutive matches
```

---

## P14 — Offline modes: AI and hot-seat 🔴 (~1h) — *your demo insurance*

```
This prompt exists so your showcase cannot be killed by conference wifi. Treat it as
must-ship, not a nice-to-have.

OFFLINE AI (mode='ai'):
  Run the whole match locally through src/engine. src/features/offline/LocalMatch.ts holds
  the MatchState, applies the player's actions through reduce(), and drives the AI on a
  randomised 900-1400ms delay. It emits exactly the same MatchEvent[] the server would, into
  the same EventPlayer. The battle screen must not contain a single `if (mode === 'ai')`
  branch in its render path.

  Difficulty picker on the placement screen: Easy / Normal / Hard, mapped to the ai.ts
  difficulty parameter. Default Normal.

HOT-SEAT (mode='hotseat'), two players on one device:
  1. Player 1 places their fleet -> "Pass the device to Player 2"
  2. A full-screen curtain: a folded sheet of paper covering both boards with
     "Player 2's turn" and a "Ready" button. Nothing behind it is visible or measurable.
  3. Player 2 places their fleet -> curtain again
  4. Battle proceeds with the curtain between every turn change
  The curtain is not optional and must be genuinely opaque — render it as a sibling above
  the board, not with opacity.

  Name entry for player 2: a simple two-field version of the P10 name screen, defaulting to
  "Player 1" and "Player 2".

RESULT PERSISTENCE: offline and hot-seat matches award points and coins locally and sync to
Supabase on the next successful connection. Queue them in a `pendingResults` array in the
profile store and flush on app foreground. Never block the result screen on a network call.

ACCEPTANCE:
- Full airplane mode: boot, tutorial, an AI match and a hot-seat match all complete with
  zero errors and zero network calls
- Turning the network back on syncs the queued results and the rank bar updates
- The hot-seat curtain never shows a frame of the other player's board — verify by
  screen-recording a turn change at 60fps and stepping through it
```

---

## P15 — Result, rewards, leaderboard, city 🟡 (~1.5h)

```
app/(game)/result.tsx — uses the TitleRibbon from P01:
  Win   the ribbon reads "Victory", an ink laurel wreath flanks the panel, both player cards
        face each other, coins animate from the loser's side to the winner's, and the rank
        progress bar fills with a number roll.
  Loss  the same composition, muted — ink at 70% opacity, no laurel, coin flow reversed. Do
        not punish the player visually beyond that; losing screens that sulk make people quit.

  Rows: points gained, coins gained, and the new rank if it changed.
  Buttons: "Play again" (straight back into the same mode) and "Menu".

  Rank-up is the one moment worth an extra beat: the badge scales up, the new shield inks
  itself over the old, and the rank name types on character by character. Play
  sfx/rank_up.mp3.

app/leaderboard.tsx — the top-100 view from P11, rendered as a ruled ledger page: rank
  number, avatar thumb, flag, name, wins, points. The current player's row is bracketed in
  inkRed and pinned to the bottom if they're outside the top 100. Pull to refresh.

app/city.tsx — the port city from IMG_9757. For this build it is ONE static screen:
  assets/images/city/city-port.png filling the canvas, pinch-to-zoom and pan (a plain
  Reanimated pinch gesture, no map library), the player card top-left, currency chips
  top-right, and the Captain saying "Welcome to your port city!" on first visit only.
  Three building slots marked with ink outlines and a "Coming soon" ribbon. Do not build a
  building system — this screen exists to show where the metagame goes.

SERVER: on match end, inside one transaction, update both profiles' rank_points,
battles_played and battles_won, and write the matches row. Clients never write these columns
— the RLS trigger from P11 blocks it.
Win  = +25 points, +50 coins.
Loss = +5 points, +10 coins.

ACCEPTANCE:
- Rank thresholds match the ranks table; crossing one triggers the rank-up animation
- Leaderboard loads under 400ms and exposes no user ids
- The city screen pinch-zooms smoothly and clamps at the image edges
```

---

## P16 — Audio, haptics, polish 🟡 (~1.5h)

```
Read docs/ASSETS.md section 5 for the full audio manifest and paths.

src/audio/index.ts — an expo-audio wrapper:
  - Preload every SFX at app start into a pool. Never load during gameplay.
  - play(id, { volume, rate }) with a small random rate variation (0.95-1.05) on repeated
    sounds so explosions don't sound mechanical.
  - Separate music and SFX volume, both persisted, both toggleable in settings.
  - Duck music to 30% during the Captain's voice lines.
  - Respect the device silent switch.
  - If an audio file is missing, no-op silently. Never crash on a missing asset.

src/audio/haptics.ts — map deliberately, then stop:
  button press Light · ship placed Medium · miss Light · hit Medium · sink Heavy ·
  mine Heavy · rank up Success · invalid action Warning
  A global toggle in settings. Nothing else vibrates.

POLISH PASS — work this in order:
  1.  Every InkButton has a pressed AND a disabled state. Check every single one.
  2.  Hardware back is handled on every screen. On battle it opens a confirm ("Resign the
      match?"), never exits silently.
  3.  Safe-area insets respected — nothing under a notch or gesture bar in landscape.
  4.  No text clips at the smallest canvas scale. Test at 1280x540 and 2400x1080.
  5.  Every loading state has an ink spinner, never a blank screen.
  6.  Empty states say what to do next. "No matches yet. Play one." Not "No data."
  7.  Run with "Don't keep activities" enabled and fix every crash.
  8.  Profile with the RN perf monitor: 60fps on the battle screen during a sink cascade on
      a mid-range device.
  9.  npx expo-doctor clean.
  10. Grep for the Supabase secret key anywhere under app/ or src/. Run `npx expo export`
      and grep the output bundle too. It must not be there.
  11. Add the attribution/credits screen if you used game-icons.net or Freesound assets —
      both licences require it. See docs/ASSETS.md section 7.

ACCEPTANCE:
- A full session — cold start, tutorial, one AI match, one online match — produces zero red
  boxes and zero console warnings
- Audio never turns to mush during a sink cascade
```

---

## P17 — Build, demo mode, ship checklist 🔴 (~1h)

```
Ship it.

BUILD:
  - eas.json with a `preview` profile: APK not AAB, production-minified, env vars pointing
    at the deployed wss:// server
  - `eas build -p android --profile preview` producing an installable APK
  - Put the version string in small ink text at the menu's bottom-right

DEMO SAFETY — assume the venue wifi is hostile:
  - A hidden demo menu: five taps on the version string. Contains: jump to any screen, force
    a win, force a rank-up, spawn a scripted AI that plays a rigged entertaining match, and
    a hard offline toggle.
  - Offline mode must give a complete, satisfying game with zero network calls (P14). If the
    wifi dies, your demo does not.
  - Pre-seed your Supabase profile with a good rank and some match history so the menu isn't
    empty on stage.
  - Have a second device paired and warmed up for the multiplayer moment, plus the APK on a
    USB stick.

docs/DEMO.md — a 3-minute script:
  0:00  Cold start. The boot sequence plays. Say nothing; let it land.
  0:20  Menu. Point at the rank and the online count.
  0:35  Tutorial, first three beats, then skip.
  1:05  Placement. Drag one ship, rotate it, buy an AA gun. Talk about the drag feel.
  1:35  Battle against the second device. Fire twice, take a hit, sink one ship.
  2:15  The set piece: bomber run into the opponent's AA gun. Let the plane spiral down.
        This is the moment people remember — do not talk over it.
  2:45  Win. Rank-up animation. Leaderboard.
  3:00  One roadmap line: tournaments, fleet skins, the port city.

docs/README.md — local setup, env vars, how to run the server, how to apply migrations, and
the known limitations (Android target, landscape only, no account recovery unless you built
the email link).

FINAL CHECKLIST — tick every box:
  [ ] APK installs clean on a device that has never seen the app
  [ ] Airplane mode gives a full match with no errors
  [ ] Two devices complete an online match over mobile data, not just wifi
  [ ] Tutorial completes and cannot soft-lock
  [ ] No secret keys in the bundle
  [ ] Attribution screen present if required by your asset licences
  [ ] You have rehearsed the 3-minute script twice on the real hardware
```

---

## Dependency graph

```
P00 ─┬─ P01 ─┬─ P02 ──────────────────────────┐
     │       ├─ P04 ── P05 ── P06 ─┐          │
     │       └─ P10                ├─ P07 ── P08 ── P09 ─┬─ P16 ── P17
     ├─ P03 ─┬───────────────────────┘                    │
     │       └─ P14 ──────────────────────────────────────┤
     └─ P11 ─┬─ P12 ── P13 ───────────────────────────────┘
             └─ P15
```

**Session A (client):** P00 → P01 → P02 → P03 → P04 → P05 → P06 → P07 → P08 → P09 → P10 → P14 → P16 → P17
**Session B (backend, forks after P03):** P11 → P12 → P13 → P15

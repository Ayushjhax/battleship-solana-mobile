@AGENTS.md

# Empire of Bits: Sea Battle

Battleship clone in a ballpoint-pen-on-graph-paper style. Expo SDK 57, TypeScript
strict, Android-first, **landscape only**. Full spec in [docs/brief.md](docs/brief.md);
the build is sequenced in [docs/prompts.md](docs/prompts.md); art and audio drop points
are in [docs/assets.md](docs/assets.md).

Bundle id `com.empireofbits.seabattle` · scheme `empireofbits`.

---

## 1. Expo Go compatibility is non-negotiable

Every dependency must be pure JS or already bundled in Expo Go. **No library that needs
a custom development build.** We never run Gradle during development; one APK gets built
with EAS at the very end.

Banned outright: `react-native-mmkv`, `react-native-quick-crypto`, any wallet SDK,
Firebase native, and anything shipping a config plugin that touches native code.
Also not wanted: `react-navigation` directly (expo-router owns it), `nativewind`,
`styled-components`, any UI kit, and `react-native-url-polyfill` (Expo already provides
a `URL` global — the Supabase docs saying otherwise are out of date for Expo).

If you catch yourself thinking *"this needs a dev build"* — stop and find another way.
**A violation is a bug, not a trade-off.**

Persistence uses `expo-sqlite` (including `expo-sqlite/localStorage/install` for the
Supabase auth session). Not AsyncStorage, not MMKV.

## 2. Engine purity

`src/engine/**` is pure TypeScript. It must **never** import from `react`,
`react-native`, `expo-*`, or any other `src/` directory. It runs unchanged inside the
Node match server (`server/`, via the `@engine/*` path alias) and under vitest with zero
React Native shims.

An eslint `no-restricted-imports` override scoped to `src/engine` enforces this. Do not
disable it. No `Math.random` and no `Date.now` inside the engine either — randomness goes
through the seeded RNG in `src/engine/rng.ts` and time is injected, so a match replays
exactly from its seed.

The server is authoritative for real matches: it owns both boards and sends each player a
masked view from `projectView()`. There is no client-authoritative version of a
hidden-information game.

The engine is complete (P03): `reduce()` handles SUBMIT_LAYOUT / FIRE / USE_ARSENAL /
TIMEOUT / RESIGN and returns `{ state, events }`; events are the animation script the UI
replays. Every place docs/brief.md is silent, the choice is written in the header comment
of the module that makes it (`shots.ts`, `arsenal.ts`, `match.ts`) — change the comment
when you change the rule. `src/engine/__tests__/view.test.ts` greps the enemy half of
every view for ship coordinates; keep it green whenever `PlayerView` grows a field.

## 3. The 800 x 360 virtual canvas

Every screen is composed against a fixed **800 x 360 dp** canvas and uniformly scaled to
fit, letterboxed onto the wooden desk:

```
scale   = min(screenW / 800, screenH / 360)
offsetX = (screenW - 800 * scale) / 2
offsetY = (screenH - 360 * scale) / 2
```

Wrap screens in `<Scale>` from `src/ui/Scale.tsx` and lay everything out in canvas dp.
Board geometry: cell **28**, board **280** square, two boards + **40** gutter = 600,
leaving 100 each side for labels and HUD (`src/board/layout.ts`).

Do not write percentage layouts, `Dimensions` maths, or per-device breakpoints.

## 4. Design tokens

From `src/ui/tokens.ts` — use the token names, never raw hex:

| Token | Value | Use |
|---|---|---|
| `paper` | `#FBFCFE` | the sheet |
| `gridMinor` | `#CFE9F6` | 1-cell rule |
| `gridMajor` | `#A6D8EE` | every 5th rule |
| `ruleRed` | `#E2453A` | red margin line near the top |
| `ink` | `#3E2FB8` | primary ballpoint violet |
| `inkSoft` | `#6C5FD6` | secondary strokes, sprite fills |
| `inkFaint` | `#B4ABEC` | hatching, revealed cells |
| `inkRed` | `#C7261C` | X marks, "Arsenal", danger |
| `inkGreen` | `#3E9B4F` | your-turn triangle, confirm buttons |
| `desk` | `#6B4527` | wood letterbox outside the sheet |
| `deskDark` | `#4E3119` | |

Type is one family, **Bitter**: `font.display` (700), `font.label` (600), `font.body`
(500), on the scale `11 · 13 · 16 · 20 · 25 · 31 · 39 · 49` (`type.xxs … type.xxxl`).
No second display face, no all-caps labels.

Every border, frame, button, panel and hatch fill comes from Rough.js via
`src/ui/useRough.ts`:

```ts
const { roughRect } = useRough();
const border = roughRect(0, 0, w, h, { seed: hashString('board-frame-own') });
<Svg><RoughShape paths={border} /></Svg>
```

- **Seeds are deterministic.** Derive them with `hashString('stable-key')`, never
  `Math.random`. A component that re-wobbles every render looks broken, not hand-drawn.
- **Paths are memoised** by (shape, dims, seed, opts) in `src/ui/roughCore.ts`. Don't
  wrap the helpers in your own `useMemo`, and don't call `rough.generator()` anywhere else.
- Shape geometry (torn edge, scalloped bubble, shield, ribbon) lives in
  `src/ui/geometry.ts` — pure, so it can be rendered and eyeballed outside the app.
- The graph paper (`Paper.tsx`) draws its rules as plain `<Line>`s in one memoised `<G>`
  that renders once. Rough is for pen strokes, not for 200 background lines.
- Every image goes through `<AssetSlot>` with a source from `src/ui/assets.ts`. Metro
  needs `require()` targets to exist, so an asset that hasn't landed is `null` there and
  the slot draws a labelled placeholder at the exact size.
- `app/(dev)/kitchen-sink.tsx` shows every component in every state; it redirects away
  in release builds. Check it after touching anything in `src/ui`.

No `borderRadius`, no shadow props (draw an offset stroke instead), no gradients, nothing
that looks like a rectangle from a UI kit.

### The battle (`app/(game)/battle.tsx`, `src/fx`, `src/state/battle.ts`)

- **The UI never inspects MatchState to decide what to animate.** The engine's events go
  into `src/fx/EventPlayer.ts`; per event it awaits the animation (sound + haptic inside),
  then commits via `src/fx/applyEvent.ts` into `shown`, the view the screen renders.
  Input is locked while the queue is busy; a tap on the boards calls `skip()`.
- Every timed step of an animation goes through `player.wait(ms)` so skip cuts it short;
  visuals in flight live in `src/fx/fxStore.ts` and remove themselves.
- Modes plug in behind the store: `ai` schedules `chooseMove` on a 900-1400 ms delay,
  `hotseat` raises the curtain and swaps `me`, `online` (P13) calls `act()` with server
  events. The screen must not care which.
- The HIT camera shake is an animated style on `DualBoards` — boards only, never the HUD.

### The tutorial (`src/tutorial`, `app/tutorial.tsx`)

- It rides on the REAL screens: `<BattleScreen setup={…} tutorial />` and the placement
  route, with `TutorialOverlay` on top. There is no parallel fake game — a change to a
  P07/P08 animation shows up in the tutorial by itself.
- `script.ts` is the tutorial as data. Outcomes are rigged by the fixed fleets there, not by
  faking events: the engine stays honest and `forceOutcome` only asserts.
- Elements the tutorial points at register themselves with `useTutorialTarget('ref')`
  (`arsenal-tab`, `card-<kind>`, `ship-<id>`, and every `GridBoard` as `board-<seedKey>`).
  Never hardcode a coordinate in the overlay.
- Battle store fields the tutorial and P08 share: `lastAction`/`lastEvents`, `arsenalOpen`
  + `setArsenalOpen`, `targeting` + `selectArsenal(itemId)`; `aim()` fires the armed
  weapon. Mode `'tutorial'` has no AI and never auto-fires on timeout.

### State, audio and boot

- **The profile lives in `src/state/profile.ts`** (zustand, persisted through expo-sqlite's
  localStorage shim). Every screen reads it from there — never from Supabase directly. The
  network only ever writes into the store.
- Rank maths (`rankFor`, `rankProgress`, `REWARD`) is engine code: `src/engine/ranks.ts`.
- Sound effects go through `playSfx('key')` in `src/audio/sfx.ts`; sources are `null` until
  the files land, and a missing effect is a silent no-op.
- The boot (`app/index.tsx` + `src/features/boot/BootSequence.tsx`) is the only
  non-interactive motion in the game. It never waits on the network: the route is decided
  from the local profile and the anonymous sign-in runs fire-and-forget under a 2.5 s cap.
  `menu` and `(onboarding)/name` use `slide_from_right` so the boot sheet can slide out
  under them; every other route fades.

## 5. Landscape only, Android target, no crypto ever

- Landscape only. `app.json` pins `orientation: "landscape"` and `app/_layout.tsx` locks
  it again with `expo-screen-orientation`. Rotating the device must never change layout.
- Android is the target. iOS and web are not tested and not a reason to change anything.
- **No crypto, no wallet, no wagering, no on-chain anything, ever.** This is a Web2 game:
  Supabase for accounts and history, a Node WebSocket server for matches. Do not add a
  wallet SDK, a signing library, or a token. Removing crypto is what bought the Expo Go
  workflow — don't spend it.

## 6. Layout of the repo

```
app/            expo-router routes; (onboarding) and (game) groups
src/engine/     pure rules engine — shared with the server, no RN imports
src/ui/         design system: tokens, Scale, useRough, ink components
src/board/      board geometry and renderers
src/net/        supabase client, websocket client
src/state/      zustand stores
server/         Fastify + ws match server, imports @engine/* directly
supabase/       SQL migrations
docs/           brief, prompt pack, asset guide
```

## 7. Commands

| | |
|---|---|
| `npm start` | Metro, scan with Expo Go |
| `npm run android` | Metro, open on a connected device |
| `npm run typecheck` | `tsc --noEmit`, must stay clean |
| `npm test` | vitest, engine only |
| `npm run lint` | eslint (flat config; `--ext` no longer exists in eslint 10) |
| `npm run server` | the match server on `:8080` |

Secrets: the app only ever sees `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The secret key
lives in the server environment. Use the publishable/secret key names, not
anon/service_role.

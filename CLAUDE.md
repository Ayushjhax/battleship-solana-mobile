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
- Art is dropped into `assets/images/` but the app requires `assets/ink/`: `npm run assets`
  (`scripts/ink-assets.sh`, ImageMagick) turns every line-art PNG into a pure-black alpha
  mask so `tintColor` renders it as ink — a white-filled drawing tinted directly is a
  solid violet blob. It also mirrors the flight planes to face right and builds the app
  icon, adaptive icon and splash from the battleship. Re-run it after replacing any art
  and commit `assets/ink/`; EAS never runs ImageMagick.
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
- **Supabase** lives in `supabase/migrations/` (numbered, idempotent — see
  `supabase/README.md`). The network boundary is `src/net/api.ts`: every call returns a
  `Result`, every response is zod-validated, queries are typed by
  `src/net/database.types.ts`. Clients may write only `name`, `avatar_id`, `avatar_color`,
  `country_code`, `has_completed_tutorial` on their own row — a trigger rejects any score
  write that carries a user JWT. Scores are the match server's (secret key,
  `server/src/db.ts`). Realtime channels are always `{ private: true }`:
  `lobby:{mode}` presence, `match:{id}` broadcast for emotes only.
- `src/net/profileSync.ts` (best-effort, never awaited by the game) sits on `api.ts`; the
  pure merge rules live in `src/net/profileMerge.ts`. The boot shows `/progress` only when
  a played-on local profile and a played-on cloud row differ.
- Text entry is `src/ui/InkKeyboard.tsx` over a rendered string — no TextInput, the OS
  keyboard never appears.
- Sound effects go through `playSfx('key')` in `src/audio/sfx.ts`; sources are `null` until
  the files land, and a missing effect is a silent no-op.
- The boot (`app/index.tsx` + `src/features/boot/BootSequence.tsx`) is the only
  non-interactive motion in the game. It never waits on the network: the route is decided
  from the local profile and the anonymous sign-in runs fire-and-forget under a 2.5 s cap.
  `menu` and `(onboarding)/name` use `slide_from_right` so the boot sheet can slide out
  under them; every other route fades.

### Online play (`src/net/match-client.ts`, `app/(game)/searching.tsx`)

- **The wire protocol is frozen in `server/src/protocol.ts`; `src/net/protocol.ts` is its
  hand-kept mirror.** The app cannot import the server package (separate package.json,
  Metro bundles only its own root), so the two are kept in lockstep by hand — add a message
  type, never repurpose one. Every inbound frame is zod-validated in `decodeServerMessage()`
  and dropped with a warning if it fails. PlayerView is validated deeply; MatchEvent loosely
  (`{type: string}` + passthrough) because the engine's event union keeps growing and
  `applyEvent` already has a default case.
- **Game state comes from the socket only.** Supabase Realtime `match:{id}` is emotes —
  `chat.ts` ref-counts the channel with a hand-over grace, so searching.tsx warms it up during
  the reveal and battle.tsx takes it over; `lobby:{mode}` presence is the online count. Never
  mix the two.
- The flow is place first, then queue: placement → `/searching` (`queue`) → `matched` →
  `ready` with the placement store's fleet, immediately → arena reveal 2 s → `/battle`.
  The server's 90 s layout deadline is the *opponent's* problem; ours is already in.
- `useMatchClient` is a module-level singleton that survives the route change. `status`
  is one enum for the whole lifecycle (`idle → connecting → queued → matched → active →
  over`, with `reconnecting` and `failed` on the side); `opponentDisconnected` is separate
  because it can flip without the seq moving.
- **Reconnect is a hard resync, never an animated replay.** The server replays the whole
  event log on attach; the client absorbs it (seq bookkeeping only) and snaps to the fresh
  `state`. Only events after that are animated. Backoff 500 ms → 8 s ±25 %, resume by
  `matchId`; outside a match it gives up after 4 tries, inside it keeps going until the
  server's 45 s grace is gone. Action `seq` is wall-clock ms so it stays monotonic across an
  app restart (the server dedupes retried actions by seq per seat). A token that can't be
  refreshed while offline is a retry, not a failure. Liveness: in a match the client sends the
  protocol `ping` every 10 s and declares 20 s of silence a dead socket (Android keeps a dead
  socket "open" long past the server's grace); `nudge()` — both screens call it on
  AppState `active` — pings at once and skips any backoff wait.
- **Never predict a shot outcome.** Online `act()` enqueues SHOT_FIRED (the 340 ms shell)
  and sends; `pending` locks input until the server's events land; `pendingShotAt` is the
  ink "…" on the cell once the shell has landed with no verdict (`FxLayer`'s
  `PendingMark`). The opponent's shots get a SHOT_FIRED prefix on arrival so both boards
  read arc-then-verdict.
- Online there is no `match` in the battle store — input guards read `shown.phase` /
  `shown.turn`, which is in sync with the truth whenever `animating` is false, in every
  mode. `matchId` is its own field (the emote channel key); `onlineView` is reconciled into
  `shown` only when the EventPlayer is idle, exactly where offline calls `projectView()`.
- Connection UI lives in `src/features/battle/ConnectionOverlay.tsx`: spinner, Captain
  bubbles with countdowns, and a failed panel whose copy comes from `failureCopy()` —
  plain and specific, never "something went wrong".
- `src/net/__tests__/match-client.test.ts` drives the real client over real sockets against
  a fake server that runs the real engine (kill/restart, resume, dedup, app-restart). Keep
  it green whenever the protocol or the reconnect path changes.

### Results, the ladder and the city (`app/(game)/result.tsx`, `app/leaderboard.tsx`, `app/city.tsx`)

- **A match is settled in ONE transaction, by the server**: `public.apply_match_result`
  (0008) closes the matches row and moves both profiles' `rank_points`, `coins`,
  `battles_played`, `battles_won` atomically, idempotently (a retry returns false and moves
  nothing), never the bot's row. `room.ts finish()` calls it once with `REWARD` from
  `src/engine/ranks.ts` — the SQL never hard-codes 25/50/5/10. Offline results go through
  `apply_offline_result` (0007) the same way.
- Clients never write score columns to Supabase. The result screen mirrors an online
  match's `over.rewards` into the profile store once (`recordOnlineResult`, keyed by matchId
  in `settledMatchIds`) so the menu reads right at once; "before" is always "after minus
  the reward". Rank-up = `rankFor(before) !== rankFor(after)`; `ranks.test.ts` pins the
  engine ladder to `0003_ranks.sql` so the two can't drift.
- **The leaderboard finds "you" by position, never by id.** The view (0004/0006) exposes
  no id and is never altered — `create or replace view` can only append and would break
  re-running older migrations, which `verify-offline.mjs` checks. `my_leaderboard_row()`
  returns the caller's 1-based place in the same ordering: `<= 100` brackets that row,
  beyond pins it under the list. 400 ms budget: both calls in parallel, last page cached
  in memory, ledger rules are hairlines (Rough is for the brackets and the frame).
- The city is one static screen: `UI_ART.cityPort` under a plain RNGH pinch + pan whose
  clamp runs on the UI thread (1x..3x, image edge never inside the canvas), three
  dashed slots with a "Coming soon" ribbon, the Captain's welcome once
  (`profile.hasVisitedCity`). There is no building system — don't start one.

### Shipping and the demo (`eas.json`, `src/state/demo.ts`, `src/features/demo/`, `docs/DEMO.md`)

- **Five taps on the menu's version string open the demo menu.** It never writes to the
  profile or the server: "Force a win" / "Force a rank-up" pass `forced=pb,pa,cb,ca` to the
  result route, "Scripted match" is `/demo-battle` on the fixed fleets in `demoMatch.ts`
  (legal boards, the presenter simply knows them — `demoMatch.test.ts` proves the script),
  "Offline" is the hard toggle below.
- **Hard offline is one flag, gated in four places**: `connectivity.ts` (hasInternet /
  subscribe), `api.ts guard()`, `match-client.ts connect()`, and the two Realtime hooks.
  Any new network path must consult `isForcedOffline()` too. It persists across restarts.
- `npm run check:bundle` exports the Android bundle and fails if the server secret appears
  by value or by shape (`sb_secret_` + base64url). Only `EXPO_PUBLIC_*` may be inlined.
- `eas.json` `preview` = APK, R8-minified (expo-build-properties), public env baked in;
  `EXPO_PUBLIC_WS_URL` there must be the deployed `wss://` host. `server/scripts/seed-demo.ts`
  seeds a crew, history and your rank through the secret key (idempotent).

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
| `npm test` | vitest: engine, placement store, match client (real sockets vs a fake server) |
| `npm run lint` | eslint (flat config; `--ext` no longer exists in eslint 10) |
| `npm run server` | the match server on `:8080` |

Secrets: the app only ever sees `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The secret key
lives in the server environment. Use the publishable/secret key names, not
anon/service_role.

# Bug report — quality pass

Branch `bugfix-audit`, cut from `claude/loving-goodall-g4rfgh` at `a8342c1` on 2026-10-05.
Scope: the game — `app/`, `src/`, `server/src/`, `supabase/migrations/`. The two Remotion
video projects (`launch-film/`, `demo-assets/`) are separate apps and were only looked at
where they break the game's own tooling (BUG-008).

Status values: **Open** (not started) · **Fixed** · **Won't fix** · **Needs decision**.

## Architecture in brief

- **App:** Expo SDK 57 development build (React Native 0.86, TypeScript strict), expo-router,
  landscape only. Every screen is composed on an 800 × 360 canvas (`src/ui/Scale.tsx`).
  Privy handles sign-in and the embedded Solana wallet; Supabase holds profiles, the
  leaderboard and Realtime presence.
- **Rules engine:** `src/engine` is pure TypeScript: a reducer, a seeded RNG, the masking
  function and the AI. The app runs it for offline AI, hot-seat and the tutorial; the
  server runs the same code for online matches.
- **Match server:** `server/` (Fastify + ws) owns every online match in memory
  (`room.ts`), runs matchmaking (`matchmaker.ts`), settles results and wagers in Postgres
  (`db.ts`), and pays SOL out of a treasury (`points.ts`). Deployed as one Render instance.
- **Battle loop:** server or local events → `src/fx/EventPlayer.ts` (animate, then commit)
  → `src/state/battle.ts` → `app/(game)/battle.tsx`. Input is locked while events play.
- **State:** zustand stores persisted to expo-sqlite (`src/state/*`). Offline results are
  queued locally and synced to `/offline-results`.
- **Online flow:** placement → `/searching` (queue) → `matched` → fleet sent → 2 s
  reveal → `/battle` → `over` → reveal (loser only) → `/result`.

## Phase 2 — what ran

| Check | Result |
|---|---|
| `npm test` (app, vitest) | 54 files, **628 passed** |
| `cd server && npm test` | 16 files, **147 passed** |
| `cd server && npx tsc --noEmit` | clean |
| `npm run typecheck` | **fails, 68 errors**, all in `launch-film/` and `demo-assets/` (BUG-008). Game code clean. |
| `npm run lint` | **crashes** (`TypeError: scopeManager.addGlobals is not a function`), only from `launch-film/` (BUG-008). Every game directory lints with 0 problems. |
| `npx expo export --platform android` | builds: 4,681 modules, 12 MB Hermes bundle, 47 s. Three third-party "package exports" fallback warnings (`rpc-websockets`, `@noble/hashes`); harmless. |
| `node scripts/check-bundle-secrets.mjs` | **fails**: the server's Solana RPC URL is in the bundle (BUG-009) |
| `npx expo-doctor` | **20/21**: six Expo packages a patch version behind (BUG-015) |
| Launch on a device or emulator | **Not done.** No device attached; this Mac had ~1.6 GB of reclaimable RAM with 6 of 7 GB of swap in use, so an emulator plus Metro would have thrashed. Needs doing in Phase 6 or by hand. |
| Native Gradle/APK build | **Not done.** Only built on request (your standing instruction); the JS export above covers the bundle. |

## Bugs by severity

| ID | Sev | Status | Summary |
|---|---|---|---|
| BUG-001 | Critical | Fixed | Points can be minted without playing (self-reported offline-wager wins) and sold for treasury SOL |
| BUG-002 | High | Fixed | A late close of a player's old socket detaches their live match seat → forfeit |
| BUG-003 | High | Fixed | Re-queueing from a new socket: `matched` goes to the dead socket, or the player is silently dropped from the queue while the app shows "In line" |
| BUG-004 | High | Fixed | Android back on "Finding an opponent" leaves the player queued in the background → silent forfeit (and stake) |
| BUG-005 | Medium | Fixed | "Try again" after an opponent cancels a wagered match dead-ends on "Connecting…" |
| BUG-006 | Medium | Fixed | Double-tapping Battle! can open two searching/battle screens (double-speed turn clock; hot-seat skips player 2's placement) |
| BUG-007 | Medium | Fixed | Changing your avatar from Settings or Profile stacks a new menu on top instead of going back |
| BUG-008 | Medium | Fixed | `npm run typecheck` fails and `npm run lint` crashes: root tooling sweeps in the nested video projects |
| BUG-009 | Medium | Fixed (key rotation pending — yours) | The server's private Solana RPC key ships inside the APK (local `.env` config) |
| BUG-010 | Medium | Fixed | Self-reported offline and hot-seat results earn ladder points; hot-seat can be farmed |
| BUG-011 | Medium | Fixed | Unwagered match: a Cancel that crosses `matched` becomes a 45 s forfeit loss |
| BUG-012 | Low | Fixed | Misleading failure text ("…for 45 seconds… counted as a loss", every failure titled "No connection") |
| BUG-013 | Low | Fixed | Hot-seat names screen's endless caret animation keeps running under the whole hot-seat match |
| BUG-014 | Low | Fixed | Android back on How to Play probably leaves the guide instead of turning back a page |
| BUG-015 | Low | Won't fix (deferred) | expo-doctor 20/21: six Expo packages a patch version behind |
| BUG-016 | Low | Fixed | A failing wagered settlement retries forever and blocks both players from queueing |
| BUG-017 | Low | Fixed | With both captains away, the turn clock keeps running and can forfeit one of them inside the abandon window |
| BUG-018 | Low | Fixed (by BUG-001) | Signing out discards a won-but-unpaid offline wager |
| BUG-019 | Low | Fixed | Store purchases made as "guest" can appear under the next account on the device |
| BUG-020 | Low | Fixed | Leaderboard briefly shows the previous account's "you" row after switching accounts |
| BUG-021 | Low | Fixed (with BUG-010) | Offline-result rewards are hard-coded in SQL (drift risk against `REWARD`) |
| BUG-022 | Low | Fixed | The launch-time cloud merge ignores unsynced offline results, so rank and coins dip until the next sync |
| BUG-023 | Low | Needs decision | Every online match joins a Supabase Realtime channel even when the server relays emotes |
| BUG-024 | Low | Fixed | `npm run test:coverage` (app) fails: the coverage provider was never a dependency |

---

## Critical

### BUG-001 — Points can be minted without playing and sold for SOL
- **Severity:** Critical (economy / security) · **Status:** Fixed — offline wagers removed
  (routes, client path, `settle_offline_wager` dropped in migration 0014); welcome points
  locked (`point_accounts.locked_points`): playable, never sellable, and a pot pays out in
  the kinds that were staked so they can't be laundered through a wager. Existing balances
  are split once by the migration; legacy pending offline settlements are refunded. Tests:
  `tests/db/verify-offline.test.ts`, `server/tests/regression/offline-wagers-removed.test.ts`,
  `tests/net/legacy-offline-wager.test.ts`, `tests/regression/no-offline-wagers.test.ts`.
- **Where:** `server/src/index.ts:242` (`POST /points/wager/settle`),
  `supabase/migrations/0012_offline_wagers.sql:74` (`settle_offline_wager`),
  `server/src/points.ts:154` (`sellPoints`).
- **What's wrong:** an offline wager's verdict comes from the phone. `settle_offline_wager`
  pays twice the stake whenever `won` is true, and nothing checks that a game was played.
  Reserve then settle with `won: true` nets +50 points per round trip, unlimited and
  scriptable with the player's own session token. Points sell for SOL from the treasury
  (100 points → 0.001 SOL), so this drains the treasury. It also works on an *online*
  queue hold, which has no match id until a room is built. Separately, every new Privy
  identity gets 100 welcome points, which is exactly one sale per throwaway email.
- **Reproduce:** with a valid gameplay token, `POST /points/wager/reserve {requestId}`,
  then `POST /points/wager/settle {requestId, won: true}`. The balance rises by 50.
  Repeat, then `POST /points/sell`.
- **Proposed fix (pick one):** (a) drop offline wagers and play wagered AI games against
  the server's bot room, which already exists (`opponent: 'bot'`); (b) make offline-wager
  prizes unsellable, or cap them per day; (c) at minimum, rate-limit settles. Also consider
  requiring a buy, or some played matches, before welcome points can be sold. The code
  comment calls the device verdict "the trade-off an offline wager makes", so this is a
  decision for you, not a code fix I'll make unasked.

## High

### BUG-002 — A late close of an old socket detaches the live match seat
- **Severity:** High · **Status:** Fixed — `handleDisconnect` now takes the closing socket
  and ignores it unless it is the seat's current one. Test:
  `server/tests/regression/stale-socket-close.test.ts`.
- **Where:** `server/src/ws.ts:124-134` (close handler), `server/src/room.ts:227`
  (`handleDisconnect`).
- **What's wrong:** the close handler acts on the *player id*, never on the socket. When a
  phone changes network, the app opens a new socket and re-attaches to its match. The
  server notices the old, dead socket 30–90 s later through its heartbeat. That close then
  runs `handleDisconnect(playerId)`, which sets the live seat's socket to `null`. From then
  on the room sends that player nothing: their shots get no reply, though pings are still
  answered, so the app's liveness check stays happy. The opponent is told they dropped, and
  45 s later they forfeit, losing the stake in a wagered game.
- **Reproduce:** verified with a real-socket server test. Match two players and ready
  both. Connect a second socket for player A and re-attach it, then close A's first
  socket. A's live socket receives nothing afterwards, not even the result of its own
  shot, and B's next state says `opponentDisconnected: true`.
- **Proposed fix:** pass the closing socket to `handleDisconnect` and ignore it unless it
  is the seat's current socket.

### BUG-003 — Re-queueing from a new socket strands the player
- **Severity:** High · **Status:** Fixed — `hello` now carries a per-install `clientId`; a
  queue from the same install moves its place in line to the new socket (keeping position,
  wait and stake), a closing socket only removes what it holds, and another device on the
  account is still refused. Tests: `server/tests/regression/requeue-new-socket.test.ts`,
  `src/net/__tests__/match-client.test.ts` ("presents the same install id…").
- **Where:** `server/src/matchmaker.ts:145` (refuses a second queue for the same player),
  `server/src/ws.ts:128` (dequeues by player id), `src/net/match-client.ts:953-966` (the
  app reads `already_queued` as "still in line").
- **What's wrong:** this is BUG-002's cause, in matchmaking. If the app reconnects while
  queued and the server still holds the old socket, the new socket's `queue` is refused
  with `already_queued`. The app assumes its old place in line survived and shows "In
  line", but the queue entry still points at the **old** socket, so one of two things
  happens:
  - `matched` is sent to the dead socket. The player never sees the match, the room runs
    without them, and they are forfeited.
  - The old socket's close removes the entry. The app then waits "In line" forever: never
    matched, never given a bot. Cancel and retry is the only way out.

  The second path matches the "one phone stuck on 1 sailor online until cancel and retry"
  report, and was probably part of it alongside the rank-window issue fixed in `98f9c26`.
- **Reproduce:** verified with a real-socket server test. A queues on socket 1, then on
  socket 2 and gets `already_queued`. B queues, and `matched` arrives on socket 1 only.
  Variant: close socket 1 before B queues, and B is never matched.
- **Proposed fix:** when the same player queues from a new socket, move the existing entry
  to it (keeping its place, rank and stake) and send `queued`. Make the close handler
  remove only entries that hold the closing socket.

### BUG-004 — Android back on the searching screen leaves you queued
- **Severity:** High · **Status:** Fixed — the root handler now leaves `/searching` to the
  screen (`rootBackAction`, extracted in a no-behaviour-change refactor first), and the
  screen answers back exactly as its Cancel does. Test: `tests/navigation/root-back.test.ts`.
- **Where:** `app/(game)/searching.tsx` (no back handler; the on-screen Cancel is `onCancel`
  at line 322), `app/_layout.tsx:188-207` (the global handler calls `router.back()` for
  `/searching`).
- **What's wrong:** hardware back pops "Finding an opponent" without cancelling. The socket
  stays in the queue, holding the 50-point stake if wagered. When an opponent is found,
  nothing sends the fleet or opens the battle: the server auto-places it after 90 s and the
  player loses on turn timeouts without ever seeing the match. No resume prompt appears,
  because the match client is in `matched`, not idle.
- **Reproduce:** Play online → Battle! → hardware back. From a second phone, queue the same
  mode. The first phone stays on placement while its match plays out and is forfeited.
- **Proposed fix:** give the searching screen a hardware-back handler that runs the same
  cancel as its on-screen Cancel button.

## Medium

### BUG-005 — "Try again" after the opponent cancels does nothing
- **Severity:** Medium · **Status:** Fixed — the opponent-cancel reset keeps the queue choice
  (mode, wager, opponent) and a fresh wager request id, so `retry()` re-queues. Test:
  `src/net/__tests__/match-client.test.ts` ("re-queues on \"Try again\"…").
- **Where:** `src/net/match-client.ts:742-770` (`queue:cancelled` resets everything,
  including `mode`), `src/net/match-client.ts:1173-1194` (`retry()` with no mode just goes
  idle).
- **What's wrong:** when the other captain cancels a wagered match before it starts, the
  searching screen shows "Match cancelled" with **Try again**. The reset cleared the queue
  mode, so `retry()` drops to idle without queueing. The screen sits on "Connecting…" with
  the radar spinning until the player presses Cancel.
- **Reproduce:** two phones with the wager on. Once matched, one presses Cancel during the
  arena reveal; the other taps Try again.
- **Proposed fix:** keep the queue choice (mode, wager, opponent) through an
  opponent-cancel so `retry()` re-queues it, with a fresh wager request id.

### BUG-006 — Double-tapping Battle! opens two screens
- **Severity:** Medium · **Status:** Fixed (the double push itself still not reproduced on a
  device) — placement lets one launch through per focus (`src/ui/oncePerFocus.ts`), and
  `finishSecondPlayer` refuses while the hot-seat handover curtain is up, with
  `beginBattle` now respecting its result. Tests: `tests/ui/once-per-focus.test.ts`,
  `src/state/__tests__/placement.test.ts` ("hot-seat handover").
- **Where:** `app/(game)/placement.tsx:1264` (`beginBattle`: no re-entry guard except while
  staking), `app/(game)/placement.tsx:1437`.
- **What's wrong:** a fast second tap runs `beginBattle` again before the screen changes:
  - **Online:** two `/searching` screens are pushed.
  - **AI:** two `/battle` screens share one store, so two 1-second tick intervals run and
    the 20-second turn clock counts down twice as fast. Countdown haptics double, and the
    result is navigated to twice.
  - **Hot-seat:** player 1's double tap can skip player 2's placement. The second tap sees
    `hotseatPlayer === 2` and starts the battle with player 2 on a random fleet.
- **Reproduce:** on a device, double-tap Battle! quickly.
- **Proposed fix:** a ref guard in `beginBattle` that ignores taps until the screen is
  focused again.

### BUG-007 — Changing avatar from Settings/Profile stacks a new menu
- **Severity:** Medium · **Status:** Fixed — Settings and Profile open the avatar screen with
  `next=back`, and it goes back like the name screen does (`identityExit`, extracted in a
  no-behaviour-change refactor first). Test: `tests/onboarding/identity-exit.test.ts`.
- **Where:** `app/(onboarding)/avatar.tsx:260`, `app/settings.tsx:205`, `app/profile.tsx:340`.
- **What's wrong:** the avatar screen always ends with `router.replace('/menu')`. Opened
  from Settings or Profile, that replaces it with a second menu on top of Settings:
  `[menu, settings, menu]`. Every change adds another hidden, still-rendering screen (the
  pile-up `exits.ts` was written to prevent), and the player lands on the menu instead of
  back where they were. The name screen already solves this with a `next=back` param.
- **Reproduce:** Menu → Settings → Change avatar → Choose. You arrive on a menu; Settings
  is still mounted beneath it.
- **Proposed fix:** same as `name.tsx`. Settings and Profile push `/avatar?next=back`, and
  the avatar screen goes back when `next=back`.

### BUG-008 — Typecheck fails and lint crashes on the nested video projects
- **Severity:** Medium (tooling) · **Status:** Fixed — both folders excluded from the root
  `tsconfig.json` and ESLint config; `npm run typecheck` and `npm run lint` now pass. Test:
  `tests/tooling/nested-projects.test.ts`.
- **Where:** `tsconfig.json:13-21` (`exclude`), `eslint.config.js:27-35` (`ignores`).
- **What's wrong:** `npm run typecheck` reports 68 errors and `npm run lint` crashes. All
  of them come from `launch-film/` and `demo-assets/`, separate Remotion apps that the root
  configs sweep in; ESLint 10 also picks up `launch-film`'s own config and older parser.
  The game code is clean, but the two checks `CLAUDE.md` says must stay clean can't catch a
  real regression while they're red.
- **Proposed fix:** exclude both folders in `tsconfig.json` and in the ESLint `ignores`.

### BUG-009 — The server's Solana RPC key ships in the APK
- **Severity:** Medium (security) · **Status:** Fixed in code; key rotation pending (yours).
  The app now reads its own `EXPO_PUBLIC_SOLANA_APP_RPC_URL` (public endpoint when unset) and
  never the old shared name; `metro.config.js` refuses to bundle when a public variable the
  app reads carries a server-only value (`scripts/env-guard.cjs`); the bundle secrets check
  passes. Worse than first reported: the same key was also **committed in `eas.json`** (both
  release profiles, since `48ecf33`, pushed) — removed from HEAD, but it stays in git history,
  so rotating it is required. Tests: `tests/tooling/env-guard.test.ts`,
  `src/wallet/__tests__/solana.test.ts`.
- **Where:** your local `.env`, which is git-ignored.
- **What's wrong:** `scripts/check-bundle-secrets.mjs` fails because the server-only
  `SOLANA_RPC_URL` value appears in the app bundle. `EXPO_PUBLIC_SOLANA_RPC_URL` is set to
  the same URL, a private provider with an API-key parameter (I checked its shape only; the
  value was never printed). Anyone who unzips the APK gets the key. The APK in `dist/` was
  presumably built with it.
- **Proposed fix (yours):** give the app its own restricted key or a public endpoint,
  rotate the server's key, and rebuild. Nothing in the repo changes.

### BUG-010 — Offline and hot-seat wins earn ladder points
- **Severity:** Medium (ladder integrity) · **Status:** Fixed — migration 0015 makes an offline
  or hot-seat result pay coins only: no rank points, not counted as a battle played or won.
  The app applies the same rule locally and the result screen shows "Ladder points · online
  only". Points already earned this way stay on the ladder (no clawback was asked for).
  Tests: `supabase/verify-offline.mjs` (0015 checks), `src/state/__tests__/profile.test.ts`
  (updated to the new rule), `server/tests/regression/offline-results-coins-only.test.ts`.
- **Where:** `server/src/index.ts:333` (`/offline-results`),
  `supabase/migrations/0007_offline_results.sql:45`, `src/state/battle.ts:239`.
- **What's wrong:** offline AI and hot-seat results are self-reported and credited at the
  full online rate: +25 rank and +50 coins per win. In hot-seat, player 2 can resign on
  their first turn to hand the device owner a win, as often as they like.
- **Options:** stop crediting hot-seat results; credit offline results at a lower rate or
  off the ladder; or cap them per day.

### BUG-011 — A cancel that crosses `matched` forfeits an unwagered match
- **Severity:** Medium · **Status:** Fixed — an unwagered match cancelled before the start now
  closes with no result (0016: winner null, `end_reason` 'cancelled', no rank or coin moves)
  and both captains are told. Wagered: the existing path already refunded both stakes in one
  transaction (0011, the row is removed); the fix also closes a race both kinds had — a
  cancel landing while the room was still being built was ignored (unwagered) or applied and
  then followed by `matched` anyway (wagered). It is now held and applied before `matched`
  is sent. Tests: `server/tests/regression/cancel-crossing-matched.test.ts`,
  `supabase/verify-offline.mjs` (0016 checks), `src/net/__tests__/match-client.test.ts`.
- **Where:** `server/src/room.ts:297` (`cancelBeforeStart` only handles wagered rooms),
  `server/src/matchmaker.ts` (`cancelBeforeMatchStart`).
- **What's wrong:** if Cancel is tapped just as `matched` arrives, an unwagered match isn't
  cancelled. The app leaves, and 45 s later the room forfeits the player: a loss on their
  record, while the opponent waits 45 s in placement. Wagered rooms already treat this race
  as a clean cancel.
- **Proposed fix:** treat an unwagered room still in placement the same way: close it with
  no result and tell the opponent `opponent_cancelled`. You decide how that match row is
  recorded.

## Low

### BUG-012 — Misleading failure text
- **Status:** Fixed — a failure records whether a match was really lost, and the copy only
  mentions a loss then; `failureTitle()` names each failure for both panels. Test:
  `src/net/__tests__/match-client.test.ts` ("failure copy").
- **Where:** `src/net/match-client.ts:1229` (`failureCopy` for `unreachable`) and `:672`;
  `src/features/battle/ConnectionOverlay.tsx:151`; `app/(game)/searching.tsx:370`.
- **What's wrong:** `unreachable` always says "Couldn't reach the match server for 45
  seconds. If a match was on, it counted as a loss." That also shows when matchmaking just
  failed to connect after four tries (roughly 8–40 s) with nothing at stake, which is common
  against a cold free-tier server. The battle's failure panel is titled "No connection"
  even when the player was kicked or their fleet rejected, and the searching screen titles
  a server error like "already in a match" the same way.
- **Proposed fix:** use the failure's own detail when no match was on, and choose the title
  per reason.

### BUG-013 — Endless caret animation under the hot-seat match
- **Status:** Fixed — the caret blinks ~20 s from the last keystroke, then rests visible;
  `hotseat.tsx` joined the guarded list in `tests/regression/no-endless-animation.test.ts`.
- **Where:** `app/(game)/hotseat.tsx:48-63`, `tests/regression/no-endless-animation.test.ts:26-37`.
- **What's wrong:** the names screen stays mounted under placement and the battle, and its
  blinking caret repeats forever. That keeps a redraw going for the whole hot-seat match,
  against `CLAUDE.md`'s rule for screens under a match. The regression test's list doesn't
  include this file.
- **Proposed fix:** stop the blink while the screen is unfocused, and add the file to the
  test's list.

### BUG-014 — Back on How to Play probably exits instead of paging back
- **Status:** Fixed — `rootBackAction` now leaves `/how-to-play` to the screen. That is correct
  whichever order the two listeners run in, so the on-device question no longer matters.
  Test: `tests/navigation/root-back.test.ts`.
- **Where:** `app/_layout.tsx:188-207`, `src/features/howToPlay/HowToPlayScreen.tsx:590-598`.
- **What's wrong:** the root layout re-registers its back handler on every route change.
  That makes it the newest listener, and React Native calls the newest first. Battle,
  tutorial, placement and city are exempted, but `/how-to-play` isn't, so the guide's own
  "previous page" handler probably never runs and back leaves the guide. This depends on
  React's effect order, so I'd confirm on a device before changing it.
- **Proposed fix:** add `/how-to-play` to the exempt routes.

### BUG-015 — expo-doctor 20/21
- **Status:** Won't fix in this pass — deferred, per your decision, to a separate branch so
  the version bump (and the dev-client rebuild it needs) isn't mixed in with these fixes.
- **What's wrong:** these packages are a patch version behind SDK 57:

  | Package | Installed | Expected |
  |---|---|---|
  | `expo` | 57.0.23 | ~57.0.26 |
  | `expo-asset` | 57.0.17 | ~57.0.18 |
  | `expo-build-properties` | 57.0.20 | ~57.0.22 |
  | `expo-constants` | 57.0.18 | ~57.0.20 |
  | `expo-linking` | 57.0.10 | ~57.0.11 |
  | `expo-router` | 57.0.21 | ~57.0.24 |

  The README requires 21/21.
- **Proposed fix:** `npx expo install --check`. This needs a new dev client and APK build,
  so it's your call when.

### BUG-016 — A failing wagered settlement blocks both players
- **Status:** Fixed — on the first refusal the room leaves the registry (both players can queue
  at once) and the settlement keeps retrying in the background with doubling backoff, giving
  up after 10 tries with a log line naming the match for a manual `apply_match_result`. Test:
  `server/tests/regression/settlement-retry.test.ts` (the "queue again" case failed for the
  right reason on the old code; the cap case pins the new bound, which the old fixed 5 s
  retry could not be observed against in test time).
- **Where:** `server/src/room.ts:572-585`.
- **What's wrong:** when `apply_match_result` fails for a wagered match, the room retries
  every 5 s with no limit and stays registered. Until it succeeds, both players' `queue` is
  refused with "already in a match". A permanent failure, such as a hold already settled
  elsewhere, never clears until the server restarts.
- **Proposed fix:** release the room from the player registry while the settlement keeps
  retrying, and give up and log loudly after a bounded number of tries.

### BUG-017 — Both captains away: the turn clock still runs
- **Status:** Fixed — the turn timer stops while every human is away and a fresh turn starts
  when one comes back. Test: `server/tests/regression/both-away-turn-clock.test.ts`.
- **Where:** `server/src/room.ts:234-246` (abandon), `:483` (`rearmTurnTimer`).
- **What's wrong:** when both humans disconnect, the room waits 20 s before abandoning, but
  the turn timer isn't paused. A player already on one timeout can be forfeited inside that
  window, so a match nobody was playing still gets a winner.
- **Proposed fix:** clear the turn timer while every human is away, and re-arm it on attach.

### BUG-018 — Sign-out drops an unpaid offline wager win
- **Status:** Fixed by BUG-001 — there are no offline wager wins any more. A stake an older
  build left pending is refunded on the next launch (`src/net/offlineWager.ts`); if the player
  signs out first, the stake stays held on the server and the next reservation hands it back
  (`reserve_point_wager` reuses an unmatched hold) rather than charging again.
- **Where:** `app/profile.tsx:125-132`, `src/state/points.ts:95`.
- **What's wrong:** `usePoints.clear()` throws away `pendingWagerSettlement`. If you win an
  offline wager while the server is unreachable and then sign out, the win is never paid.
- **Proposed fix:** try the settlement before clearing, or keep pending settlements keyed by
  account.

### BUG-019 — Guest store purchases leak to the next account
- **Status:** Fixed — the guest wallet is bound to the account the device signs in to next
  (added to anything it already bought there), including a guest wallet an older version left
  beside an already signed-in account. Test: `src/state/__tests__/locker.test.ts`.
- **Where:** `src/state/locker.ts:37-44`.
- **What's wrong:** `walletFor` falls back to the device's guest wallet for any account that
  has none. Sign-out doesn't clear it, so purchases made as a guest (before the first sync)
  can show up as the next account's items, and reduce that account's spendable coins.
- **Proposed fix:** adopt the guest wallet once, at first sync, or clear it on sign-out.

### BUG-020 — Leaderboard cache crosses accounts
- **Status:** Fixed — the cached page is kept against the account it was read for and is only
  shown to that account (none is kept without an account). Test:
  `tests/leaderboard/page-cache.test.ts`.
- **Where:** `app/leaderboard.tsx:56`.
- **What's wrong:** the last page, including the "you" row, is cached in a module variable.
  After switching accounts, the previous account's row shows until the refresh lands.
- **Proposed fix:** key the cache by user id, or clear it on sign-out.

### BUG-021 — Offline rewards hard-coded in SQL
- **Status:** Fixed with BUG-010 — 0015's `apply_offline_result` takes the coin amounts as
  parameters and the server passes `REWARD` from `src/engine/ranks.ts`.
- **Where:** `supabase/migrations/0007_offline_results.sql:45-48` vs `src/engine/ranks.ts:21-24`.
- **What's wrong:** `apply_offline_result` hard-codes 25/50/5/10. `CLAUDE.md` says the SQL
  never does that; it holds for `apply_match_result`, but not here. A future change to
  `REWARD` would drift between online and offline.
- **Proposed fix:** a new migration that takes the rewards as parameters, like
  `apply_match_result`. It needs a deploy, so this may be "Won't fix" for now.

### BUG-022 — The launch merge ignores unsynced offline results
- **Status:** Fixed — a merged cloud row keeps the coins of results still waiting to sync on
  top, as `settleResults` does. Since BUG-010 offline results pay coins only, so coins were
  the only number that dipped. Test: `src/state/__tests__/profile.test.ts`.
- **Where:** `src/features/auth/PrivyProfileSync.tsx:59`, `src/state/profile.ts:191`.
- **What's wrong:** every launch overwrites local rank, coins and battle counts with the
  cloud row. Offline results not yet synced aren't added back (`settleResults` does add
  them), so the menu shows lower numbers until the next sync. The server data is correct.
- **Proposed fix:** after `mergeRemote`, add back the rewards of still-pending results.

### BUG-023 — Realtime channel joined even when the server relays emotes
- **Status:** Needs decision — not changed. On a closer look the extra channel is deliberate:
  the commit that added server-relayed emotes (`43d6104`) wrote "Both are listened to; a
  sender uses exactly one" into `chat.ts`. Listening on Realtime is how this app still hears
  an opponent on an older APK, which only ever sends over Realtime. The cost is one private
  Realtime channel joined per online match, unused when both phones are current. What is
  wrong either way is `CLAUDE.md`, which says both "`chat.ts` listens to both" and "a phone
  whose server answered `emotes: true` never touches it". See question 6 below.
- **Where:** `src/net/chat.ts:52-81`, `:115`.
- **What's wrong:** `subscribeEmotes` always joins the private Supabase Realtime match
  channel. `CLAUDE.md` says a phone whose server relays emotes never touches Realtime, but
  every online match opens a channel it never uses.
- **Proposed fix:** open the Realtime channel only when the server doesn't relay emotes.

### BUG-024 — The app's coverage command never worked
- **Status:** Fixed — found in Phase 6 (Phase 2 didn't run coverage). `@vitest/coverage-v8`
  is now an app devDependency, on the same version as the app's vitest (5.0.0; the provider
  pins vitest's exact version), and `coverage/` is git-ignored in both packages. Installing it
  with npm 11 also dropped seven optional peer entries from `package-lock.json` (nested
  `utf-8-validate` copies and one nested `typescript`); none of them is required. Test:
  `tests/tooling/coverage-provider.test.ts`.
- **Where:** `package.json`, `vitest.config.ts:35`.
- **What's wrong:** `tests/README.md` gives `npm run test:coverage` for the app's coverage,
  and `vitest.config.ts` configures the v8 provider, but `@vitest/coverage-v8` was only a
  devDependency of the server. The command stopped at once with `MISSING DEPENDENCY`.
- **Proposed fix:** add the provider to the app's devDependencies.

---

## Decisions I need from you

Answered on 2026-10-05 and done as decided:

1. **BUG-001:** offline wagers removed; welcome points are tracked apart and never sellable.
2. **BUG-009:** you rotate the key; the app has its own restricted RPC variable.
3. **BUG-010:** only server-verified online matches count toward the ladder.
4. **BUG-011:** the match closes with no result; a wagered cancel refunds both stakes.
5. **BUG-015:** the Expo upgrades go on a separate branch later.

Still open:

6. **BUG-023:** keep listening on Realtime in online matches (hears opponents still on an
   older APK; costs a channel join per match), or skip the channel when the server relays
   emotes (an older-APK opponent's emotes are then not shown — they already can't see ours)?
   Either way I'll correct whichever `CLAUDE.md` sentence doesn't match.
7. **Offline coins (follows BUG-010):** offline AI and hot-seat games still pay coins
   (+50 win, +10 loss) on the device's word. Coins only buy cosmetic store items, which are
   device-local and never convert to points or SOL, so I left this alone. Keep it, or pay
   nothing for offline games?
8. **Ladder points already earned offline:** points that offline and hot-seat results
   earned before the BUG-010 fix are still on the ladder. A one-off correction could subtract
   them; I haven't written one. Want it?

## Checked and found sound

The rules engine (shot order, sinking and auto-reveal, mines, AA interception, every
arsenal resolver, the timeout and forfeit logic, masking), the event replay pipeline,
offline and hot-seat turn handover, placement validation, the result and reveal flows,
online reconnect and resync, the point buy and sell flows (idempotent, with signatures
de-duplicated), the wager SQL, and server auth. All of these read correctly, and the
existing tests cover them well.

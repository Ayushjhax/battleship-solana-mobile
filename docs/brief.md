# Empire of Bits: Ocean Warfare — Brief, Rules & Architecture

**CURRENT:** Privy is the mandatory front-door authentication layer and provides an
embedded Solana wallet. Optional 50-point wagers and the 100-point/0.001-SOL exchange
are server-authoritative; the server verifies buys on-chain and signs treasury payouts.

**Stack:** Expo SDK 57 development build · React Native · TypeScript strict · Privy Auth +
embedded Solana wallet · Supabase (Postgres + Auth + Realtime) · Node WebSocket match server · landscape mobile.

**Deadline:** 48 hours to a showcase build.
**Reference:** Ocean Warfare 2 by BYRIL (`com.byril.seabattle2`).

---

## 0. Read this first

Game *mechanics* aren't copyrightable — clone the ruleset freely. The *art* is. Don't rip sprites from the APK; make your own in the same "ballpoint pen on graph paper" idiom. Ship as **Empire of Bits: Ocean Warfare**, not "Ocean Warfare 2". The look is easy to reach legitimately (see `02-ASSET-GUIDE.md`); the exact assets aren't yours to take.

---

## 1. The decision that shapes everything else

**Use an Expo development build.** Privy's native mobile SDK and secure wallet modules
are required and are not available in Expo Go.

Keep the native surface constrained to the Expo 57-compatible dependencies in
`package.json`; engine and gameplay code remain pure TypeScript or existing Expo modules.

Build the native development client once, then use Metro for normal iteration. Changes
to native dependencies or configuration require rebuilding the client.

---

## 2. What the reference game is

(cite index="5-1">Ocean Warfare 2 is a Battleship adaptation in a hand-drawn blue-pen style where players pick a name and country, and battle points feed a rank ladder running from seaman recruit up to admiral</cite>. (cite index="1-1">The arsenal covers battleships, airplanes, submarines, mines and radar, with a classic mode that strips the extras and an advanced mode that keeps them</cite>.

Two rule changes matter more than anything else, and both apply **in classic mode too**: (cite index="8-1">ships aren't allowed to touch, so once you sink something the surrounding blank squares are revealed automatically; and as long as you hit something — by any method — you get another turn</cite>. The second rule is what makes matches fast and swingy.

Advanced mode adds a buy step: (cite index="14-1">after arranging your fleet there's a set-up phase where you purchase extra armament — four bomber types, all of which bomb several squares at once in a specific pattern and all of which can be nullified if the opponent put anti-air batteries in the right spot; mines, radar and the submarine reveal or hit multiple squares at a time</cite>. The submarine (cite index="5-1">can only be sent to free cells and launches two torpedoes vertically</cite>.

**Scope for 48 hours:** clone the match completely. Port city becomes one static screen. Skins, tournaments, trophy room — cut.

---

## 3. Exact rule spec — implement this literally

### 3.1 Board & fleet

Grid `10 × 10`. Rows `A–J` top to bottom, columns `1–10` left to right. Internally always `{r: 0..9, c: 0..9}`; letters are display only.

Fleet — the reference's ten ships (`IMG_9744`) minus two of the four one-cell boats,
which made placement fiddly and added little to the game:

| Class | Length | Count | Cells |
|---|---|---|---|
| Battleship | 4 | 1 | 4 |
| Cruiser | 3 | 2 | 6 |
| Destroyer | 2 | 3 | 6 |
| Boat | 1 | 2 | 2 |
| **Total** | | **8** | **18** |

### 3.2 Placement

1. Axis-aligned, horizontal or vertical.
2. Fully inside the grid.
3. **No touching, including diagonally.** Every ship carries an invisible 1-cell halo. Validate by expanding the footprint 1 cell in all 8 directions and testing for intersection with any other ship.
4. Arsenal items (AA gun, mine, radar) take exactly 1 empty cell each and are **exempt** from the halo rule — they can sit right next to your own ships.

### 3.3 Shot resolution

```
resolveShot(cell):
  already shot        -> reject. Illegal. Turn is NOT consumed.
  contains a MINE     -> MINE_TRIGGERED. Mark cell, consume mine,
                         attacker's turn ENDS immediately.
  contains ship part  -> HIT.
                         if that ship has 0 intact cells left:
                            SUNK + AUTO_REVEAL every 8-neighbour of the
                            whole ship as a miss.
                         Attacker KEEPS the turn.
  otherwise           -> MISS. Turn ENDS.
```

- **Win:** all 8 enemy ships sunk. Arsenal items never count toward the win.
- **Turn timer:** 20 seconds, counted down inside the turn triangle (your screenshots show 20, 23, 25). Two consecutive timeouts = forfeit.
- **First turn:** server coin flip from the match seed.

### 3.4 Arsenal — advanced mode

Fuel budget **260**. Prices and caps from the shop panel in `IMG_9767`.

| Item | Cost | Max | Placed | Effect |
|---|---|---|---|---|
| Torpedo Bomber | 20 | 2 | offensive | Pick an enemy row. Torpedo runs from the near edge along that row and hits the first ship cell it meets. |
| Double Torpedo Bomber | 35 | 2 | offensive | Two torpedoes down two adjacent rows. |
| Bomber | 30 | 2 | offensive | Pick a cell. Bombs it plus two more in a fixed T: target, target+right, target+down. |
| Atomic Bomber | 60 | 1 | offensive | Pick a cell. Destroys the full 3×3 around it. |
| AA Gun | 10 | 3 | own board | Any enemy aircraft crossing this gun's **row** is shot down and the whole attack is void. Can be hit by normal fire. Never counts toward the win. |
| Radar | 15 | 1 | own board | Pick a 3×3 on the enemy board. Returns the **count** of occupied cells — never which ones. |
| Mine | 5 | 5 | own board | If the enemy fires on it, their turn ends immediately. Mine is consumed. |
| Submarine | 10 | 1 | offensive | Pick a free enemy cell. Fires two torpedoes vertically, up and down, each running until it hits a ship or leaves the grid. |

**Aircraft rule.** Every bomber is an aircraft. Before resolving any aircraft attack, scan the target row(s) on the defender's board for an AA gun. If found: emit `AIRCRAFT_DOWNED`, consume the weapon, reveal the AA gun's cell to the attacker, end the attacker's turn, resolve nothing else.

**Turn effect.** Any arsenal attack landing ≥1 hit keeps the turn. An attack that hits nothing ends it.

### 3.5 Ranks

`IMG_9754` shows `10/100 Seaman Recruit` and `139/300 Seaman Apprentice`. Model as a table with cumulative thresholds:

| Rank | Points required |
|---|---|
| Seaman Recruit | 0 |
| Seaman Apprentice | 100 |
| Petty Officer Second Class | 400 |
| Chief Ship Petty Officer | 1000 |
| Captain | 3000 |
| Vice-admiral | 10000 |

Win = +25 points +50 coins. Loss = +5 points +10 coins. Losing should still move the bar a little.

---

## 4. Architecture

### 4.1 The one non-negotiable

Battleship is a **hidden-information** game. If the client holds the enemy board, anyone with a debugger wins. The server owns both boards and sends each player a **masked view** — their own board in full, plus only what they've learned about the enemy's. Every shot is a request; the server resolves and broadcasts the result.

There is no version of this that works with client-authoritative shots.

### 4.2 The picture

```
┌──────────────────────────────────────────────────────────┐
│  Expo development build (mobile, landscape)              │
│  expo-router · react-native-svg + roughjs · Reanimated   │
│  ┌────────────────────────────────────────────────────┐  │
│  │  src/engine/ — pure TS, zero RN imports            │  │
│  │  Deterministic reducer + seeded RNG + AI.          │  │
│  │  Runs identically in the app and on the server.    │  │
│  └────────────────────────────────────────────────────┘  │
└─────────┬──────────────────────────────┬─────────────────┘
          │ WebSocket (live match)       │ HTTPS (profile, history)
          ▼                              ▼
┌──────────────────────────┐   ┌──────────────────────────────┐
│  Node match server       │   │  Supabase                    │
│  Fastify + ws            │   │  Postgres + Auth + RLS       │
│  In-memory rooms         │──▶│  profiles · matches · ranks  │
│  Authoritative engine    │   │  Realtime: lobby + chat only │
│  Imports src/engine      │   │                              │
└──────────────────────────┘   └──────────────────────────────┘
```

**The engine is shared, not duplicated.** The server runs the exact reducer the client uses for offline AI matches and optimistic previews. One rule change, one place. Keep `src/engine/` free of every React Native import — no `react-native`, no `expo-*`, no `Dimensions`. It must run under plain Node and vitest with zero shims.

### 4.3 Who does what

| Concern | Owner |
|---|---|
| Match state, shot resolution, turn timer, board masking | Node WS server |
| Auth, profiles, avatars, rank, match history, leaderboard | Supabase Postgres + RLS |
| Lobby presence ("142 online"), chat and emotes | Supabase Realtime |
| Normal offline AI matches and hot-seat | The client, running the same engine |
| Online matches, wagered AI matches, point ledger and SOL exchange | Node WS/HTTP server + Postgres |

**Why not Supabase Realtime for the match itself?** It's a pub/sub relay — (cite index="37-1">you control access with RLS policies on `realtime.messages`, and enforcing private channels means disabling 'Allow public access' in Realtime Settings</cite> — but it forwards what clients send. It can't resolve a shot, mask a board, or run a turn timer. Use it for what it's excellent at: presence and chat. The Node server owns authority.

### 4.4 Supabase specifics that are current as of today

- (cite index="58-1">In Expo, import `expo-sqlite/localStorage/install` and pass `storage: localStorage` to `createClient`, with `detectSessionInUrl: false` since mobile has no URL to read a session from</cite>. (cite index="54-1">You do **not** need `react-native-url-polyfill` — Expo already installs a URL global</cite>. A lot of tutorials still tell you to; ignore them.
- (cite index="35-1">Supabase is deprecating the `anon` and `service_role` keys by the end of 2026 in favour of publishable (`sb_publishable_…`) and secret (`sb_secret_…`) keys</cite>. Use the new names from the start. Publishable in the app, secret on the Node server only.

### 4.5 Privy-backed gameplay session

Privy authentication is required on first launch using Google or email OTP. Privy creates
the embedded Solana wallet. The client then calls `/auth/privy/sync`; the Node server verifies
the Privy token, creates or finds a stable Supabase Auth/profile row for that Privy DID,
initializes the point account, and returns a one-use session handoff. Anonymous sign-in is
not part of the production flow, and the Supabase secret key never enters the app bundle.

Privy therefore recovers the same human identity, wallet, gameplay UUID and point balance
across installs. The progress chooser continues to compare local and cloud gameplay records.

---

## 5. Visual system

### 5.1 Tokens

```ts
export const color = {
  paper:     '#FBFCFE',  // the sheet
  gridMinor: '#CFE9F6',  // 1-cell rule
  gridMajor: '#A6D8EE',  // every 5th rule
  ruleRed:   '#E2453A',  // the red margin line near the top
  ink:       '#3E2FB8',  // primary ballpoint violet
  inkSoft:   '#6C5FD6',  // secondary strokes, sprite fills
  inkFaint:  '#B4ABEC',  // hatching, revealed cells
  inkRed:    '#C7261C',  // X marks, "Arsenal", danger
  inkGreen:  '#3E9B4F',  // your-turn triangle, confirm buttons
  desk:      '#6B4527',  // wood letterbox outside the sheet
  deskDark:  '#4E3119',
} as const;
```

### 5.2 Type

One family: **Bitter** (Google Fonts). Its numerals match the reference grid labels closely and it stays legible at 11dp on a phone held sideways. Weights `700` display, `600` buttons and labels, `500` body.

Modular scale, base 16, ratio 1.25: `11 · 13 · 16 · 20 · 25 · 31 · 39 · 49`

No second display face. No all-caps labels — the reference uses title case with a slab, and all-caps reads as generic game UI.

### 5.3 The hand-drawn look — use Rough.js, don't hand-roll it

`roughjs` is a 9kB pure-JS library that turns shapes into sketchy hand-drawn paths. Critically for React Native, (cite index="65-1">`rough.generator()` produces drawables without any drawing context — useful on a server or in a worker — and `generator.toPaths(drawable)` returns path info objects you render in order</cite>. Feed those `d` strings straight into `react-native-svg` `<Path>`.

It takes a `seed` option, so a given element wobbles identically on every render — no flickering, which is the trap when you write jitter yourself.

This is the single biggest time-saver in the build. Every border, frame, button, panel and hatch fill in the game comes from one `useRough` hook.

### 5.4 The virtual canvas

Every screen is composed against a fixed **800 × 360 dp** canvas and uniformly scaled to fit, letterboxed onto the wood desk. This is how the reference gets identical composition across devices, and it deletes an entire category of responsive bugs.

```
scale   = min(screenW / 800, screenH / 360)
offsetX = (screenW - 800 * scale) / 2
offsetY = (screenH - 360 * scale) / 2
```

Board geometry: cell **28 dp**, board **280 dp** square, two boards + 40 dp gutter = 600 dp, leaving 100 dp each side for labels and HUD.

### 5.5 Motion

Spend the budget in one place: the boot sequence. Paper falls onto the desk, the red margin rule draws left to right, the grid inks itself in, the logo appears. One orchestrated moment, ~1.8s, skippable.

Everywhere else motion only answers an action — shell arc on fire, ink splash on miss, stamped X on a reveal, the plane crossing on a bomber run. No ambient idle animation. It costs battery and reads as noise.

---

## 6. The 48-hour plan

Run **two Claude Code sessions in parallel** — one on the client, one on backend. They meet at `server/src/protocol.ts`, which gets written first and is then frozen.

### Day 1

| Slot | Session A — client | Session B — backend |
|---|---|---|
| 0–2h | P00 scaffold, P01 design system | idle → then P11 Supabase schema |
| 2–5h | P02 boot + menu, **P03 engine + tests** | P12 Node server against the P03 engine |
| 5–8h | P04 board render, P05 placement | P12 continued, deploy to Fly.io |
| 8–11h | P06 arsenal shop, P07 battle screen | P13 protocol hardening, reconnect |

**End of Day 1:** you can place a fleet and play a full match against the AI, offline, and it looks right.

### Day 2

| Slot | Session A | Session B |
|---|---|---|
| 0–3h | P08 arsenal in battle | P13 client netcode + matchmaking |
| 3–6h | P09 tutorial | P15 leaderboard, result, rewards |
| 6–8h | P10 name/avatar screens | Two-device online smoke test |
| 8–10h | P16 audio, haptics, polish | P14 hot-seat fallback |
| 10–12h | P17 build, demo mode, rehearsal | Buffer |

### The cut line

Behind at Day 2 hour 6? Cut in this order and don't negotiate:

1. Port city → static image, no interaction
2. Custom in-game keyboard → styled native `TextInput`
3. Double Torpedo Bomber + Radar → hide the cards
4. Chat and emotes → remove the button
5. Online multiplayer → **hot-seat two-player on one device** (P14), which demos nearly as well and cannot fail on stage

**Never cut:** the boot sequence, the placement drag, and the hit → sink → auto-reveal cascade. Those three are what people remember.

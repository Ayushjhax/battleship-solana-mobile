# REPO-MAP — the real tree, before Part 1

Written by reading the tree, not the design docs. Read-only pass: nothing was changed.

**Repo root is `my-app/`**, not `Battleship/`. `Battleship/` contains only `my-app/`.
Branch at the time of writing: `merge-session-work` @ `843a745`, clean tree, in sync with
`origin/merge-session-work`. `master` is `2bba5ee`, **10 behind `origin/master`** — check
upstream before branching off it.

Both suites are green as of this pass:

| Suite | Command | Result |
| --- | --- | --- |
| app | `npm test` (vitest 5.0.0) | **37 files, 410 tests, all passing** (26.9 s) |
| server | `cd server && npm test` (vitest 5.0.1) | **14 files, 138 tests, all passing** (23.5 s) |

---

## 1. ENGINE

### Where it lives

`src/engine/` — 11 source files, 2,001 lines, zero dependencies. `src/engine/package.json`
is a single line (`{"type": "module"}`) so Node resolves it as ESM.

| File | Lines | What |
| --- | --- | --- |
| [types.ts](../../../src/engine/types.ts) | 233 | the whole vocabulary |
| [board.ts](../../../src/engine/board.ts) | 96 | grid helpers, `halo()`, `coordKey()` |
| [fleet.ts](../../../src/engine/fleet.ts) | 86 | the fleet table, composition validation |
| [placement.ts](../../../src/engine/placement.ts) | 217 | placement rules, arsenal buy/place/sell, `autoPlaceFleet` |
| [shots.ts](../../../src/engine/shots.ts) | 219 | `resolveCell` / `resolveShot`, the `WorkingBoard` |
| [arsenal.ts](../../../src/engine/arsenal.ts) | 425 | `ARSENAL_SPEC` + one resolver per kind, AA interception |
| [match.ts](../../../src/engine/match.ts) | 408 | `reduce()` and `projectView()` |
| [ai.ts](../../../src/engine/ai.ts) | 203 | hunt/target AI, consumes a `PlayerView` only |
| [rng.ts](../../../src/engine/rng.ts) | 49 | mulberry32 seeded RNG |
| [ranks.ts](../../../src/engine/ranks.ts) | 51 | `RANKS`, `REWARD` |
| [index.ts](../../../src/engine/index.ts) | 14 | barrel — `export * from` each of the above |

Purity is enforced mechanically, not by convention:
[eslint.config.js:53-72](../../../eslint.config.js#L53-L72) applies `no-restricted-imports`
to `src/engine/**` banning `react`, `react-native*`, `expo*`, `@/*` and `../*`. There is no
`Math.random` or `Date.now` anywhere in `src/engine/` — confirmed by reading all 11 files.

### Exact types

All from [src/engine/types.ts](../../../src/engine/types.ts):

```ts
export const GRID_SIZE = 10;            // :12
export const TURN_SECONDS = 20;         // :15
export const MAX_CONSECUTIVE_TIMEOUTS = 2;  // :18
export const FUEL_BUDGET = 260;         // :21
```

**Cell** — there is no `Cell` type. A cell is a `Coord` ([:24](../../../src/engine/types.ts#L24)),
and what is *known* about it is a `CellState`:

```ts
export interface Coord { readonly r: number; readonly c: number; }   // 0..9 each
export type CellState = 'unknown' | 'miss' | 'hit' | 'sunk' | 'revealed' | 'mine';  // :73
export type Marks = Readonly<Record<string, CellState>>;             // :76, keyed by coordKey()
```

`coordKey({r,c})` is `` `${r},${c}` `` ([board.ts:15](../../../src/engine/board.ts#L15)). A
missing key means `'unknown'` — `'unknown'` is in the union but is never written as a value.

**Ship** ([:35](../../../src/engine/types.ts#L35)):

```ts
export interface Ship {
  readonly id: string;              // 'battleship-1', 'cruiser-2', ...
  readonly class: ShipClass;        // 'battleship' | 'cruiser' | 'destroyer' | 'boat'
  readonly len: number;
  readonly origin: Coord;           // first cell; extends right (h) or down (v)
  readonly orientation: Orientation;  // 'h' | 'v'
  readonly hits: readonly Coord[];
}
```

**Layout** — there is no `Layout` type in the engine. A layout is
`{ ships: readonly Ship[]; arsenal: readonly ArsenalItem[] }`, carried either as the
`SUBMIT_LAYOUT` action or as a `Board` ([:83](../../../src/engine/types.ts#L83)):

```ts
export interface Board {
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
  readonly marks: Marks;     // what the OPPONENT has learned about this board
}
```

The wire has its own name for it — `LayoutPayload`
([server/src/protocol.ts:59](../../../server/src/protocol.ts#L59)).

**Item** ([:60](../../../src/engine/types.ts#L60)) — one type for all eight kinds:

```ts
export interface ArsenalItem {
  readonly id: string;
  readonly kind: ArsenalKind;
  readonly at?: Coord;        // own-board kinds only (aaGun, mine, radar)
  readonly used?: boolean;
  readonly destroyed?: boolean;
  readonly revealed?: boolean;
}
```

`ArsenalKind` is `'torpedoBomber' | 'doubleTorpedoBomber' | 'bomber' | 'atomicBomber' |
'aaGun' | 'radar' | 'mine' | 'submarine'` ([:47](../../../src/engine/types.ts#L47)). Note the
engine's names differ from `NUMBERS.md`'s ("torpedo" → `torpedoBomber`, "aa gun" → `aaGun`,
"double torpedo" → `doubleTorpedoBomber`, "atomic" → `atomicBomber`).

**Mark** — `CellState`, above. Marks live on the *defender's* board and are written by the
attacker's shots. The doc comment at [:78-82](../../../src/engine/types.ts#L78-L82) is the
reason the whole enemy `marks` object can be shipped to a client.

**Shot result** — two layers.
`CellOutcome` ([shots.ts:91](../../../src/engine/shots.ts#L91)) for one cell:

```ts
export interface CellOutcome {
  readonly events: MatchEvent[];
  readonly hit: boolean;    // a ship part OR an own-board item
  readonly sunk: boolean;
  readonly mine: boolean;
}
```

`ShotOutcome` ([shots.ts:176](../../../src/engine/shots.ts#L176)) for a whole FIRE:
`{ state, events, keepsTurn, rejected? }`. Arsenal weapons return the parallel
`ArsenalOutcome` ([arsenal.ts:103](../../../src/engine/arsenal.ts#L103)), same four fields.

### How a shot is resolved

[`resolveShot`](../../../src/engine/shots.ts#L203) → guards bounds and "already marked", then
[`resolveCell`](../../../src/engine/shots.ts#L119) on a mutable `WorkingBoard` copy
(`openBoard()` / `sealBoard()`, :60 / :75 — callers never mutate `MatchState`). Order inside
`resolveCell`, which is the rule:

1. **live mine at the cell** → mark `'mine'`, `MINE_TRIGGERED`, `{ hit: false, mine: true }`
2. **ship at the cell** → mark `'hit'`, `HIT`; if `ship.hits.length >= ship.len`, mark every
   cell `'sunk'`, emit `SUNK`, then mark every still-unmarked `halo()` cell `'revealed'` and
   emit `AUTO_REVEAL` with only the newly revealed ones
3. **own-board item (AA gun, radar) at the cell** → `destroyed = true`, `revealed = true`,
   mark `'revealed'`, `ITEM_HIT`, and this **counts as a hit** so the turn is kept
4. **otherwise** → mark `'miss'`, `MISS`

### Where the turn rule lives

Three places, and they must agree:

- [shots.ts:217](../../../src/engine/shots.ts#L217) — `keepsTurn: outcome.hit && !outcome.mine`
- [arsenal.ts:248](../../../src/engine/arsenal.ts#L248) — `keepsTurn: tally.hits > 0 && !tally.mine`
- [match.ts:212-234](../../../src/engine/match.ts#L212-L234) — `afterAttack()` is the only
  place the turn actually changes:

```ts
const defender = next.players[index === 0 ? 1 : 0];
if (allSunk(defender)) { ... gameOver(next, attackerId, 'fleet') }
if (!keepsTurn) { const turn = opponentOf(next, attackerId); ... out.push({ type: 'TURN_CHANGED', turn }); }
```

`afterAttack` also resets `consecutiveTimeouts` to 0 and increments `moves`. A mine's
"turn ends" beats any hits in the same drop, because `mine` is checked with `&&` in both
`keepsTurn` expressions.

> **For Part 5:** the Minesweeper "never ends your turn" exception (CORRECTIONS §7) has **no
> home in the current shape.** `keepsTurn` is computed from the tally, not from the item, in
> both `finish()` and `resolveShot`. It needs a per-kind override on `ArsenalSpecEntry` or a
> special case in `useArsenal`.

### How arsenal items are resolved

[`useArsenal`](../../../src/engine/match.ts#L247) rejects classic mode, unknown/spent items,
and `aaGun`/`mine` ("works on its own; it cannot be used"), then `switch`es on `item.kind` to
one of six exported resolvers in `arsenal.ts`: `torpedoBomber` (:263), `doubleTorpedoBomber`
(:285), `bomber` (:308), `atomicBomber` (:335), `submarine` (:377), `radar` (:402). The item
is marked `used` **whatever happened, including being shot down** (match.ts:287-291).

The table is [`ARSENAL_SPEC`](../../../src/engine/arsenal.ts#L54) — a flat array of
`{ kind, cost, max, placement, isAircraft, target }`. It **matches `NUMBERS.md`'s existing
rows exactly**: torpedo 20/2, double 35/2, bomber 30/2, atomic 60/1, aaGun 10/3, radar 15/1,
mine 5/5, submarine 10/1. Sum at cap = 40+70+60+60+30+15+25+10 = **310**, confirming
CORRECTIONS §2.

Shared pieces: `drop()` (:174) resolves each unmarked footprint cell; `torpedo()` (:185) runs
a path and stops at the first `hasIntactShipAt` (so it is never wasted on a wreck);
`finish()` (:239) seals the board and computes `keepsTurn`. Footprints are exported so the UI
can preview them: `bomberFootprint` (:123), `atomicFootprint` (:128), `doubleTorpedoRows` (:139).

**AA interception** — [`intercept()`, arsenal.ts:154-171](../../../src/engine/arsenal.ts#L154-L171):

```ts
const gun = wb.arsenal.find(
  (i) => i.kind === 'aaGun' && !i.destroyed && i.at !== undefined && rows.includes(i.at.r),
);
if (!gun || !gun.at) return null;
gun.revealed = true;
return { state: ..., events: [{ type: 'AIRCRAFT_DOWNED', playerId: attackerId, kind, gunAt: gun.at }], keepsTurn: false };
```

Called by all four bomber variants *before* anything resolves, with the rows of the weapon's
footprint. Three properties worth knowing:

- it tests `!i.destroyed` but **not `!i.used`** — an AA gun has no "used" state, so a gun that
  has already downed a plane keeps intercepting forever. This is the Appendix C behaviour
  CORRECTIONS §4 says the Sonar Net must inherit.
- interception is **row-based only**, never column or cell. A gun anywhere in a targeted row
  stops the run.
- `find` returns the *first* matching gun in array order, so with two guns in range the
  revealed one is array-order-dependent, not geometric.

### Is the engine imported by both app and server?

Yes, **the same source files, not a build artifact or a copy.**

- **App** — via the `@engine/*` alias in [tsconfig.json:9](../../../tsconfig.json#L9)
  (`"@engine/*": ["./src/engine/*"]`), mirrored for tests in
  [vitest.config.ts:12](../../../vitest.config.ts#L12). App code imports
  `@engine/types`, `@engine/ranks`, `@engine/match`, etc.
- **Server** — [server/tsconfig.json:19-30](../../../server/tsconfig.json#L19-L30) maps
  `"@engine/*": ["../src/engine/*"]` **and puts `"../src/engine/**/*.ts"` in `include`**.
  `tsx` (dev and start) resolves the alias natively; vitest needs it restated, which
  [server/vitest.config.ts:20-24](../../../server/vitest.config.ts#L20-L24) does.
  [server/src/room.ts:16-34](../../../server/src/room.ts#L16-L34) imports
  `reduce`, `projectView`, `createMatch`, `createRng`, `autoPlaceFleet`, `chooseMove`, `REWARD`.

So the server has **no `node_modules` copy of the engine and no published package** — it
reaches up out of its own directory into the app's source tree. Anything added under
`src/engine/` is automatically visible to both.

---

## 2. SERVER

**Framework:** Fastify 5.6 for HTTP + raw `ws` 8.18 for the match socket, both on one port.
TypeScript run directly by `tsx` — **there is no build step**
([server/package.json:7-8](../../../server/package.json#L7-L8): `"dev": "tsx watch
src/index.ts"`, `"start": "tsx src/index.ts"`).

**Entry point:** [server/src/index.ts](../../../server/src/index.ts), 444 lines. It calls
`process.loadEnvFile()` three times before any import that reads env (`server/.env`, then
`../../.env.local`, then `../../.env`), each in its own `try`. `main()` (:402) verifies the
database, logs readiness, listens, then `attachWebSocketServer(app.server, ...)` (:416) — so
HTTP and WS share the same Node server on `PORT ?? 8080`, path `/ws`.

It only boots when it *is* the entry point ([:427-442](../../../server/src/index.ts#L427-L442),
`resolve(process.argv[1]) === fileURLToPath(import.meta.url)`), so route tests can `import
{ app }` and use Fastify's `inject` without opening a socket. `export { app, main }`.

HTTP routes: `GET /health`, `GET /ready`, `POST /auth/privy/sync`, `GET /points/quote`,
`POST /points/wager/{reserve,settle,cancel}`, `POST /points/{buy,sell}`, `POST /offline-results`.

### How a match room validates and applies an action

Two gates, in order.

**Gate 1 — the wire** ([server/src/ws.ts](../../../server/src/ws.ts)). Before a frame reaches a
room: rate limit (`RATE_LIMIT_MSGS = 10` per `RATE_LIMIT_WINDOW_MS = 1000`, :19-20 — over it
the socket is **closed**, code 4002), size cap (`MAX_MESSAGE_BYTES = 16 * 1024`, close 4003),
then `decode()` → `ClientMessageSchema.safeParse` (zod discriminated union on `t`,
[protocol.ts:81](../../../server/src/protocol.ts#L81)). Every message except `ping`/`hello`
requires `conn.playerId`, which is set **only** by verifying the JWT in `hello`. The client's
claimed identity is never read: `toMatchAction(playerId, payload)`
([protocol.ts:199](../../../server/src/protocol.ts#L199)) attaches the *verified* id.

Five violations (`MAX_ILLEGAL = 5`) close the socket with 4001 — `violate()` is called for
unparseable frames, pre-`hello` messages, and **every action the reducer rejects**.

**Gate 2 — the reducer** ([server/src/room.ts:429](../../../server/src/room.ts#L429)). This is
the *only* method that touches `this.state`:

```ts
private applyAction(action: MatchAction): HandleResult {
  if (this.finished) return { ok: false, reason: 'match is over' };
  const { state: nextState, events } = reduce(this.state, action);
  const rejected = events.find((e) => e.type === 'REJECTED');
  this.state = nextState;
  if (rejected) {
    this.send(action.playerId, { t: 'error', v: 1, code: 'illegal_action', message: rejected.reason });
    return { ok: false, reason: rejected.reason };
  }
  this.outSeq += 1;
  this.eventLog.push({ seq: this.outSeq, events: [...events] });
  void appendMatchEvent(this.id, this.outSeq, events);
  this.broadcastEvents(events); this.broadcastState();
  ...
}
```

There is **no server-side rule logic at all** — validation is `reduce()`, i.e. the same
function the client runs offline. `handleAction` (:412) dedupes by `seq` against
`seat.lastAppliedActionSeq` so a retried send after reconnect replays a snapshot instead of
re-applying.

Everything a player may see goes through `projectView()`: `snapshotFor` (:160) is the only
builder of a `state` message, and
[server/src/__tests__/leak.test.ts](../../../server/src/__tests__/leak.test.ts) exists to prove
no ship coordinate escapes.

### How state is persisted

**It mostly isn't.** `MatchState` lives in a process-memory `Map`
([room.ts:587](../../../server/src/room.ts#L587): `export const rooms = new Map<string, Room>()`,
plus `roomIdForPlayer`). Restarting the server loses every live match —
[render.yaml:7-11](../../../render.yaml#L7-L11) says in as many words that this must run as
exactly one instance and must never autoscale.

What *is* written to Postgres: a `matches` row at `start()`
([room.ts:338](../../../server/src/room.ts#L338)), one `match_events` row per `reduce()` cycle
(`appendMatchEvent`, fire-and-forget `void`), and the settlement at the end.

### Database and client library

**Supabase (Postgres) via `@supabase/supabase-js` 2.116**, one lazily-created client
([server/src/db.ts:20](../../../server/src/db.ts#L20)) using `SUPABASE_URL` +
**`SUPABASE_SECRET_KEY`** — the service-role key, which bypasses RLS entirely. That is what
lets the server write the score columns the trigger forbids clients from touching. The app
uses a different key (`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`); `db.ts` is the only reader of
the secret, and [scripts/check-bundle-secrets.mjs](../../../scripts/check-bundle-secrets.mjs)
guards that.

Tables (from `supabase/migrations/`): `profiles`, `matches`, `match_events`, `ranks`,
`offline_results`, `privy_accounts`, `point_accounts`, `point_ledger`, `point_wager_holds`,
`point_trades`, plus a `leaderboard` view. Types are generated into
[src/net/database.types.ts](../../../src/net/database.types.ts) and imported by the server via
a relative path (`../../src/net/database.types`), not the alias.

Multi-row/multi-table writes are **Postgres functions called by RPC**, not client-side
transactions: `apply_match_result`, `apply_offline_result`, `create_wagered_match`,
`abandon_match`, `reserve_point_wager`, `settle_offline_wager`, `sync_privy_account`,
`ensure_point_account`, `get_point_balance`.

### How auth works

One gate, [server/src/auth.ts:31](../../../server/src/auth.ts#L31):

```ts
const { payload } = await jwtVerify(token, jwksFor(supabaseUrl), {
  issuer, audience: 'authenticated',
});
```

A Supabase access token (ES256) verified against the project's JWKS with `jose`, which caches
and rate-limits its own fetches. `payload.sub` becomes the player id. That is the **only**
place identity is established for the socket; every later message is attributed to it.

Separately, **Privy** is the sign-in provider: the app authenticates with Privy, then posts
its Privy token to `/auth/privy/sync` ([index.ts:111](../../../server/src/index.ts#L111)),
which verifies it ([privy.ts](../../../server/src/privy.ts)), then creates/links a Supabase
gameplay user with admin rights and returns a one-use magiclink handoff
([privySession.ts](../../../server/src/privySession.ts)). So: Privy for identity, Supabase for
the session token the socket checks.

### How the profile (coins, rank points) is written

Only ever by the server, only ever through one RPC
([db.ts:248](../../../server/src/db.ts#L248)):

```ts
const { data, error } = await db().rpc('apply_match_result', {
  p_match_id: matchId, p_winner: winnerId, p_end_reason: endReason,
  p_win_points: reward.win.points, p_win_coins: reward.win.coins,
  p_loss_points: reward.loss.points, p_loss_coins: reward.loss.coins,
});
```

Called from `Room.settleAndNotify` ([room.ts:525](../../../server/src/room.ts#L525)) with
`REWARD` imported from `@engine/ranks` — **the reward numbers are passed in from the engine,
not hardcoded in SQL**, so `src/engine/ranks.ts` stays the single source. The function is
idempotent (a retry returns `false` and moves nothing), settles the match row and both
profiles in one transaction, and skips rows where `is_bot`.

Offline/hot-seat results take a parallel path: `POST /offline-results` →
`apply_offline_result` (0007), idempotent on a client-generated id.

The guard that makes this the only path is
[supabase/migrations/0001_profiles.sql:69-90](../../../supabase/migrations/0001_profiles.sql#L69-L90):

```sql
if public.jwt_role() in ('authenticated', 'anon') then
  if new.rank_points is distinct from old.rank_points
  or new.coins is distinct from old.coins
  or new.gems is distinct from old.gems
  ... then raise exception 'profile scores are written by the match server only' using errcode = '42501';
```

`jwt_role()` reads `request.jwt.claims`; the secret key sends no such claim, so the server and
migrations pass straight through.

> **`gems` and `buildings` already exist as guarded `profiles` columns** (:22, :24, defaults
> 10 and 0) — but **nothing anywhere writes them.** No server code, no migration, no RPC. They
> are read by the client and rendered. Part 1 inherits two ready-made, correctly-guarded
> columns with no write path.

### Migration system

Plain numbered SQL in [supabase/migrations/](../../../supabase/migrations/), `0001`–`0013`,
applied with `npx supabase db push`. **No migration runner, no migrations table of its own, no
`supabase/config.toml`** — ordering is the filename and idempotency is by hand (`create table
if not exists`, `create or replace function`, `drop policy if exists` then `create policy`).
[supabase/README.md](../../../supabase/README.md) is the operating manual.

Two verification paths exist: [supabase/verify-offline.mjs](../../../supabase/verify-offline.mjs)
(27 KB — runs every migration **twice** against in-process pglite, so re-runnability is
actually tested) and `server/scripts/verify-rls.ts` (live, creates and deletes temp users).

The server also probes at boot that the schema is not behind the code —
[`verifyDatabaseConnection`](../../../server/src/db.ts#L107) head-selects three tables and then
calls two RPCs with a nonexistent uuid purely to see whether the function exists,
raising `missingMigration('abandon_match', '0013_abandoned_matches.sql')` with the exact file
to apply.

### Feature-flag or remote-config mechanism

**There is none.** Searched `server/src`, `supabase/migrations`, `src`, `app` for
`feature`/`flag`/`remoteConfig`/`isEnabled`/`rollout` — zero hits. Behaviour is switched only
by environment variables, and only for test timing
([server/src/env.ts](../../../server/src/env.ts), `envMs(name, fallback)` for the room's
90 s/45 s/20 s clocks).

`00-OVERVIEW.md` §5 assumes twelve server-driven flags (`portCity.core`, `.raids`, …) and that
"a flag that is off means … no migration runs". **Part 1 has to build that mechanism from
nothing** — the config channel, the client cache, and the endpoint-level `feature-off` check.
The only existing server→client config precedent is `fuelBudget` (see §5 below).

### How errors are returned

Three unrelated shapes.

**Socket:** `{ t: 'error', v: 1, code: ErrorCode, message: string }` — `ErrorCode` is a closed
union ([protocol.ts:167](../../../server/src/protocol.ts#L167)): `bad_message |
unauthenticated | rate_limited | too_large | not_in_room | wrong_phase | illegal_action |
already_queued | insufficient_points | internal`. This is the typed-union convention the Port
City docs ask for — extend it rather than inventing a second one.

**Auth:** [server/src/errors.ts](../../../server/src/errors.ts) — an `AuthFailure` class
carrying its own `code`, `status` and `publicMessage`, with `STATUS` and `PUBLIC_MESSAGE`
lookup tables. The header comment is worth reading before designing any new error path: the
route used to classify by regex over `error.message`, which reported every Supabase outage as
"invalid Privy access token". `detailOf(error)` is explicitly "for logs, never for
classification".

**Other HTTP routes:** ad-hoc `reply.code(n).send({ error: '…' })`, and several still classify
by regex on the message text — e.g.
[index.ts:289-295](../../../server/src/index.ts#L289-L295) `if (/not confirmed yet/i.test(...))`.
`/points/*` and `/offline-results` have no typed codes at all. Do not copy this half.

**Engine rejections** are not errors but events: `{ type: 'REJECTED', playerId, reason }` with
a free-text English reason ("not your turn", "already shot") — never shown to the player
directly; the room turns it into `illegal_action`.

---

## 3. CLIENT

### Routing

**expo-router 57** file-based, on `app/`. Root layout
[app/_layout.tsx](../../../app/_layout.tsx) locks landscape
([:54](../../../app/_layout.tsx#L54)), loads Bitter + Inter and holds the splash until they
resolve, then wraps everything in `GestureHandlerRootView` → `SafeAreaProvider` →
`PrivyProvider` → `AuthBoundary` → `AuthenticatedApp`. The `Stack` has `headerShown: false`
and `animation: 'fade'` globally, with `slide_from_right` named per screen (:177-182).

Screens (13 routes + 2 dev):

| Route | File | Lines |
| --- | --- | --- |
| `/` | [app/index.tsx](../../../app/index.tsx) | 195 |
| `/menu` | [app/menu.tsx](../../../app/menu.tsx) | 237 |
| `/city` | [app/city.tsx](../../../app/city.tsx) | **557** |
| `/profile` · `/settings` · `/leaderboard` · `/points` · `/wallet` | | 194–353 |
| `/tutorial` | [app/tutorial.tsx](../../../app/tutorial.tsx) | 64 |
| `(onboarding)/name` · `/avatar` · `/progress` | | 181 / 207 / 311 |
| `(game)/placement` | [app/(game)/placement.tsx](../../../app/(game)/placement.tsx) | **1,652** |
| `(game)/battle` · `/result` · `/searching` · `/hotseat` · `/demo-battle` | | 161–692 |
| `(dev)/board-lab` · `/kitchen-sink` | | 140 / 199 |

`Port city` is reached from [app/menu.tsx:64](../../../app/menu.tsx#L64):
`{ label: 'Port city', href: '/city' }`.

Three global siblings hang outside the `Stack` (:184-190): `WelcomePointsModal`,
`ResumeMatchPrompt`, `BackendWakeGate`.

### Global state

**zustand 5**, one store per concern, all under [src/state/](../../../src/state/):

| Store | File | Persisted? |
| --- | --- | --- |
| `useProfile` | [profile.ts](../../../src/state/profile.ts) (242) | **yes** |
| `usePlacement` | [placement.ts](../../../src/state/placement.ts) (408) | no |
| `useBattle` | [battle.ts](../../../src/state/battle.ts) (~640) | no |
| `usePoints` | [points.ts](../../../src/state/points.ts) | partly |
| `useDemo` | [demo.ts](../../../src/state/demo.ts) | yes |
| `useBackendWake`, `useCloud`, `usePrivySync` | | no |
| `useFx` | [src/fx/fxStore.ts](../../../src/fx/fxStore.ts) | no |
| `useTutorial` | [src/tutorial/store.ts](../../../src/tutorial/store.ts) | no |
| `useMatchClient` | [src/net/match-client.ts](../../../src/net/match-client.ts) | no, module singleton |

### How the profile is cached offline

[src/state/profile.ts](../../../src/state/profile.ts) — zustand `persist` over
**expo-sqlite's synchronous `localStorage` shim**, imported for its side effect on line 9
(`import 'expo-sqlite/localStorage/install';`). Synchronous storage is the whole point: the
store is hydrated before the first screen renders. Key `'eob.profile'`, `version: 1`, and an
explicit `partialize` allow-list of 20 fields (:205-227) — **a new field that is not added
there is silently not persisted.**

`waitForProfileHydration()` (:232) exists for the rare async case.

Local-first write path: `queueResult()` (:140) applies the reward immediately *and* appends to
`pendingResults`; [src/net/offlineResults.ts](../../../src/net/offlineResults.ts) flushes that
queue to `POST /offline-results` on foreground and on regaining connectivity
([app/_layout.tsx:144-164](../../../app/_layout.tsx#L144-L164)); `settleResults(ids, totals)`
(:164) then replaces local totals with the server's **plus** whatever is still unsynced — the
reconciliation that stops a double count. `recordOnlineResult()` (:152) guards against a
re-mounted result screen using a rolling 20-entry `settledMatchIds`.

Cloud round-trip is [src/net/profileSync.ts](../../../src/net/profileSync.ts) +
[profileMerge.ts](../../../src/net/profileMerge.ts) (the pure half, testable under Node).
`pushProfile` (:79) has a **hand-written allow-list** of the five identity columns a player may
write; score fields are dropped before the request so RLS never has to reject them.

> Adding `steel` to the profile means touching five places: the `ProfileData` interface, the
> `partialize` list, `ProfileSchema` + `PROFILE_COLUMNS` in
> [src/net/api.ts:87-133](../../../src/net/api.ts#L87-L133), `CloudProfile`/`ProfilePatch` in
> `profileSync.ts`, and `localAsPatch`/`cloudAsLocal` in `profileMerge.ts`. Missing any one of
> them fails silently rather than loudly.

### How the placement screen builds a layout

[app/(game)/placement.tsx](../../../app/(game)/placement.tsx) — 1,652 lines, the biggest file
in the repo. It is a *view*: every committed mutation is delegated to
[src/state/placement.ts](../../../src/state/placement.ts), which in turn delegates to the pure
engine — its header says so outright ("The UI may preview freely, but every committed board
change is delegated to the pure placement engine"). The store imports `placeShip`,
`rotateShip`, `removeShip`, `autoPlaceFleet`, `purchaseArsenalItem`, `placeArsenalItem`,
`sellArsenalItem`, `arsenalFuelSpent`, `validateLayout`, `validatePlacement`.

Layout on the 800×360 canvas (:64-80): dock at `x=6` `w=62` (ships drawn at
`TRAY_SCALE = 0.5`), row letters, the 280 board at `x=96` (advanced) or centred (classic), shop
at `x=388` `400×226`. Drag is `react-native-gesture-handler` + Reanimated shared values;
`buildPlacementPreview()` (:374 of the store) returns per-cell `{ ok, reason, conflictCells }`
for the live tint.

The store carries **both hot-seat players' layouts** (`playerOneShips` / `playerTwoShips` /
…`Arsenal`, plus `hotseatPlayer: 1 | 2` and `handoffVisible`). The finished layout is checked
with the engine's own `validateSubmission(mode, ships, arsenal)`
([match.ts:137](../../../src/engine/match.ts#L137)) before it is submitted — the same function
the server runs.

### How the battle screen renders marks and animations

[app/(game)/battle.tsx](../../../app/(game)/battle.tsx) (619) draws
[`DualBoards`](../../../src/board/DualBoards.tsx) under a HUD strip, and **never inspects match
state to decide what to animate.** The mechanism is
[src/fx/EventPlayer.ts](../../../src/fx/EventPlayer.ts) (127 lines, pure TS, no React — so the
queue semantics are unit-testable under Node):

> "The engine returns MatchEvent[]. The UI never inspects match state to decide what to
> animate; it plays the event list as a timeline. Per event, strictly in order: await the
> animation (sound and haptic live inside it), then commit the state change. Input is locked
> while the queue is non-empty."

Three collaborators:

- **`EventEffects`** (:23) — `{ animate(event, player): Promise<void>; commit(event): void }`.
  The real implementation is
  [`createBattleEffects(deps)`](../../../src/fx/battleEffects.ts#L58), which owns the timing
  constants: `SHELL_MS = 340`, `REVEAL_STAGGER_MS = 40`, `TURN_FLIP_MS = 180`,
  `AIRCRAFT_RUN_MS = 1400`, `BOMB_STAGGER_MS = 120`, `TORPEDO_CELL_MS = 80`,
  `RADAR_SWEEP_MS = 520`, `RADAR_RESULT_MS = 2500`, `MATCH_OVER_HOLD_MS = 900`.
- **`applyEvent(view, event)`** ([src/fx/applyEvent.ts](../../../src/fx/applyEvent.ts)) — pure
  and idempotent, advances the *shown* `PlayerView` by one event. Its routing rule is the one
  thing to internalise: `actor === viewer → enemy board`, otherwise `→ your own board`.
- **`useFx`** ([src/fx/fxStore.ts](../../../src/fx/fxStore.ts)) — transient visuals only
  (`Shell`, `Burst`, `Aircraft`, `Bomb`, `TorpedoTrack`, `SubmarineFx`, `RadarFx`,
  `InterceptFx`, `Crosshair`), rendered by
  [FxLayer.tsx](../../../src/fx/FxLayer.tsx) (881 lines).

Marks themselves are [src/board/CellMark.tsx](../../../src/board/CellMark.tsx) —
`{ state: CellState; coord: Coord; animate?: boolean }`, one component per `CellState`.

`skip()` fast-forwards by resolving every in-flight `wait()` at once; effects check
`player.skipped` and tidy up. `SyntheticEvent` (`SHOT_FIRED`) is the client-only shell in
flight, enqueued optimistically by `act()` before the server answers — the *outcome* is only
ever what the server's events say.

### What the ink/stroke drawing kit exposes

**The generator.** [src/ui/roughCore.ts](../../../src/ui/roughCore.ts) is the React-free half
(so its guarantees are testable under Node); [src/ui/useRough.ts](../../../src/ui/useRough.ts)
is the React surface.

```ts
export function useRough(): RoughHelpers          // stable identity, safe in deps
export function hashString(key: string): number   // FNV-1a, clamped 1..2^31-1
export const ROUGH_DEFAULTS: Options = { roughness: 1.4, bowing: 1.2, strokeWidth: 1.6,
  stroke: color.ink, fillStyle: 'hachure', hachureAngle: -41, hachureGap: 4 };
```

Five helpers, all `(…dims, opts: RoughOpts) => readonly PathInfo[]`, all memoised by
`(shape, dims, seed, opts)` in a 1,200-entry LRU:
`roughRect(x,y,w,h,opts)`, `roughLine(x1,y1,x2,y2,opts)`, `roughPolygon(points,opts)`,
`roughCircle(cx,cy,d,opts)`, `roughPath(points,opts)` (open polyline — torpedo tracks, tally
marks, underlines).

`RoughOpts extends Omit<Options,'seed'> { seed: number }` — **seed is required, there is no
default**, because rough.js treats seed 0 as "use Math.random", which is exactly the flicker
being avoided. Always `seed: hashString('stable-key')`.

`<RoughShape paths opacity? dash? />` turns `PathInfo[]` into `<Path>` elements, **preserving
rough.js's order (fill sketch first, outline last) because that order is the drawing**.
`dash` applies to outline paths only.

**The canvas.** [src/ui/Scale.tsx](../../../src/ui/Scale.tsx) — `<Scale transparent? backdrop?>`
and `useScale(): ScaleValue`:

```ts
{ scale, ox, oy, s(n), toCanvas(x, y), canvasRef }
```

800 × 360 design units (`CANVAS_W` / `CANVAS_H` in tokens), `scale = min(availW/800,
availH/360)` after safe-area insets, letterboxed onto the desk. `canvasRef` is the canvas box
itself — measuring against it with `measureLayout` yields canvas units directly, which is what
the tutorial spotlight relies on (window coords carry an Android inset offset that breaks the
maths).

**The components** — [src/ui/](../../../src/ui/), 16 files, 3,142 lines. Props in full:

| Component | Props |
| --- | --- |
| `Paper` | `variant?: 'full' \| 'panel'`, `w?`, `h?`, `seedKey?`, `children?` |
| `MarginRule` | `w?`, `seedKey?` |
| `PaperBackdrop` | `width`, `height`, `scale`, `ox`, `oy`, `rules` |
| `InkPanel` | `w`, `h`, `seedKey`, `padding?`, `fill?: string \| 'none'`, `style?`, `children?` |
| `InkButton` | `label`, `onPress?`, `tone?: InkButtonTone`, `disabled?`, `w?`, `h?`, `size?: 'sm'\|'md'\|'lg'\|'xl'`, `seedKey?`, `style?`, `accessibilityLabel?`, `accessibilityRole?`, `accessibilityState?` |
| `InkIconButton` | `icon: InkIcon`, `onPress?`, `size?`, `accessibilityLabel` (required), `style?` |
| `InkTextInput` | `value`, `onChangeText`, `placeholder`, `seedKey`, `w`, `h?`, `keyboardType?`, + 12 picked `TextInputProps` |
| `InkKeyboard` | `value`, `onChange`, `onSubmit?`, `maxLength?`, `w?`, `h?` |
| `InkSpinner` | `size?`, `stroke?`, `strokeWidth?`, `periodMs?`, `seedKey?`, `style?` |
| `SpeechBubble` | `text`, `tail?: BubbleTail`, `tailAt?: number` (0..1), `w?`, `seedKey?`, `style?` |
| `TitleRibbon` | `title`, `w?`, `h?`, `size?: 'sm'\|'md'\|'lg'`, `seedKey?`, `style?` |
| `TurnTriangle` | `direction: 'left'\|'right'`, `state: TurnState`, `seconds?`, `snap?`, `size?`, `width?`, `seedKey?`, `style?` |
| `RankBadge` | `rank`, `name?`, `avatar?: { source?: Asset; tint: string }`, `onAvatarPress?`, `current?`, `total?`, `seedKey?`, `style?` |
| `CurrencyChip` | `kind: 'points' \| 'coins' \| 'gems'`, `value`, `w?`, `h?`, `style?` |
| `AssetSlot` | `source?: Asset`, `w`, `h`, `label`, `tintColor?: string \| null`, `style?` |
| `LogoMark` | `w?`, `h?`, `bleed?`, `subtitle?`, `style?` |

> `CurrencyChip` takes a **closed union of three kinds** — adding steel means editing it, and
> its `COIN_GOLD` sibling constant suggests each kind carries its own colour.

**Tokens** ([src/ui/tokens.ts](../../../src/ui/tokens.ts)): `color` (11 entries — `paper`,
`gridMinor`, `gridMajor`, `ruleRed`, `ink #3E2FB8`, `inkSoft`, `inkFaint`, `inkRed`,
`inkGreen`, `desk`, `deskDark`), `font` (3 Bitter weights), `type` (xxs 11 → xxxl 49, ratio
1.25), `space` (xxs 4 → xxl 48), `CANVAS_W/H`, `PAPER_GRID` (`unit: 28`, `major: 5`,
`anchorX: 100`, `anchorY: 40`, `ruleY: 34`), `AVATAR_TINTS` (10).

**Board geometry** ([src/board/layout.ts](../../../src/board/layout.ts), pure maths, 90 lines):
`CELL = 28`, `BOARD_SIZE = 280`, `GUTTER = 40`, `SIDE_MARGIN = 100`, `BOARD_TOP = 40`,
`BATTLE_BOARD_TOP = 78`, plus `cellToPoint`, `cellCentre`, `pointToCell`, `shipRect`,
`cellRect`, `boardOrigins(top)`. `GridBoard` takes 24 props and `DualBoards` 16 — both listed
in full in their files.

### How sounds and haptics are triggered

**Sound** — [src/audio/index.ts](../../../src/audio/index.ts) (277 lines) over `expo-audio`.
`SFX_SOURCES` (:16) is a closed record of **24 keys**, each a `require`d mp3 from
`assets/audio/sfx/` (`planeFlyby` is deliberately `null` — a missing source is silent, not a
crash). `SfxKey = keyof typeof SFX_SOURCES`. API: `initializeAudio()`, `play(id, options)` /
`playSfx` (alias), `setMusic('menu' | 'battle' | null)`, `duckMusic(bool)`,
`playCaptainVoice(n)`, `stopVoice()`, `refreshAudioSettings()`, `setAudioActive(bool)`.
[src/audio/sfx.ts](../../../src/audio/sfx.ts) is a 2-line re-export kept for call sites.

The whole pool is allocated and preloaded at boot
([app/_layout.tsx:104](../../../app/_layout.tsx#L104)) — "no gameplay path constructs a
player". Music switches on route: `pathname.includes('/battle') || pathname === '/tutorial'`
→ `battle`, else `menu` (:117-120). Volume/mute changes are picked up by a
`useProfile.subscribe` that calls `refreshAudioSettings()` when any of the four audio fields
changes (:105-114).

**Haptics** — [src/audio/haptics.ts](../../../src/audio/haptics.ts), 24 lines, one function:

```ts
export type HapticId = 'buttonPress' | 'shipPlaced' | 'miss' | 'hit' | 'sink' | 'mine' | 'rankUp' | 'invalidAction';
export function haptic(id: HapticId): void {
  if (!useProfile.getState().hapticsOn) return;
  ...
  void work.catch(() => {});
}
```

`rankUp` → `Success` notification, `invalidAction` → `Warning`, `sink`/`mine` → `Heavy`,
`hit`/`shipPlaced` → `Medium`, everything else → `Light`. It reads the profile toggle itself
and never throws, so callers never guard.

Both are invoked **inside the effect's `animate()`**, not by the screen — see the EventPlayer
header ("sound and haptic live inside it").

### How the tutorial and Captain tips are implemented

Four files, ~1,100 lines, driving the **real** placement and battle screens:

- [src/tutorial/script.ts](../../../src/tutorial/script.ts) (278) — the tutorial as data.
  `Step = { id, screen: 'battle'|'placement', say?: {text, side, voice?}, spotlight?,
  require?: Requirement, forceOutcome?: MatchEvent['type'][], auto?, prepare?, nudge? }`.
  `Requirement` is a union of `tap-cell` / `tap-element` / `drag-ship` / `place-item` / `wait`.
  Fourteen beats. **Nothing is faked** — outcomes are rigged by a fixed enemy layout plus a
  fixed shot script, and `forceOutcome` is *checked*, never forced:
  > "F5 must hit, E5 must sink, H8 must miss, the bomber at C4 must land one hit … so the
  > enemy fleet below is built to make exactly that happen."
- [src/tutorial/driver.ts](../../../src/tutorial/driver.ts) (210) — plays each beat's voice,
  performs `auto` actions, and **watches the real stores** (`useBattle`, `usePlacement`) for
  the required event. `WATCHDOG_MS = 20000` re-prompts so no beat can soft-lock;
  `warnIfUnexpected()` `console.warn`s when the engine does not produce the expected events.
- [src/tutorial/store.ts](../../../src/tutorial/store.ts) (113) — `active`, `stepIndex`,
  measured `targets`, `handNonce` (bumped on every wrong tap to restart the hand cursor),
  `nudge`, `wrongTaps`, `finished`.
- [src/tutorial/useTutorialTarget.ts](../../../src/tutorial/useTutorialTarget.ts) (89) —
  `useTutorialTarget(ref)` returns `{ ref, onLayout }` to spread onto any View; it measures
  **against `Scale`'s `canvasRef`**, re-measuring at `SETTLE_MS = [0, 250, 700]` and on every
  step. Costs nothing when the tutorial is inactive.
- [src/tutorial/TutorialOverlay.tsx](../../../src/tutorial/TutorialOverlay.tsx) (510) — the
  spotlight hole, the swallow layer, the hand cursor, and the Captain.

**"Captain tips" is not a system.** The Captain is an asset
(`AVATARS.captain`, [src/ui/assets.ts:63](../../../src/ui/assets.ts#L63)) plus a
`SpeechBubble`, re-implemented independently in three places:

1. `Captain()` in [TutorialOverlay.tsx:352](../../../src/tutorial/TutorialOverlay.tsx#L352) —
   slides in from the beat's side, tail tracks the bubble edge, optional voice line.
2. `Captain()` in
   [ConnectionOverlay.tsx:70](../../../src/features/battle/ConnectionOverlay.tsx#L70) — network
   states ("Lost contact. Trying to raise them.").
3. Inline in [app/city.tsx:475-482](../../../app/city.tsx#L475-L482) — **first visit only**,
   gated on `hasVisitedCity` in the profile store (:293, then `markCityVisited()` at :298).

If the Port City wants Captain-voiced error copy, there is a `SpeechBubble` and a voice player
to build on, but no shared "tip" component, no copy table, and no error-code→copy map.

---

## 4. TESTING

**One runner: vitest**, two projects, both `environment: 'node'`. No Jest, no
`jest-expo`, no `@testing-library/react-native`, no Detox, no Maestro.

### Commands

```bash
npm test              # app:    vitest run
npm run test:watch    # app
npm run test:coverage # app — BROKEN, see below
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
cd server && npm test            # server
cd server && npm run test:coverage
```

### App suite

[vitest.config.ts](../../../vitest.config.ts) — aliases `@engine` and `@`, and an **explicit
`include` list** (:17-31) rather than a glob over everything:

```
src/engine/**/*.test.ts, src/state/__tests__/*.test.ts, src/features/offline/**,
src/features/demo/**, src/features/battle/**, src/net/__tests__/*.test.ts,
src/wallet/__tests__/*.test.ts, tests/**/*.test.ts
```

The comments explain the boundary — only renderer-free code is included. One of them is a
warning worth heeding: *"src/wallet/__tests__/solana.test.ts existed but matched nothing here,
so it had never run once."* **A new test file outside those globs will not run and nothing
will tell you.**

Structure ([tests/README.md](../../../tests/README.md) is the authority):
`tests/regression/` (11 files, one per shipped bug, **named for the symptom, not the fix**),
`tests/net/`, `tests/board/`, `tests/ui/`, `tests/integration/`, plus co-located
`src/**/__tests__/`.

### Server suite

[server/vitest.config.ts](../../../server/vitest.config.ts) — `include: ['src/**/*.test.ts',
'tests/**/*.test.ts']`, with the `@engine` alias restated because "tsx resolves the path alias
from tsconfig.json natively; Vite/vitest does not".

`tests/unit/`, `tests/integration/` (real Fastify via `inject`; **two real sockets** against
the real ws + matchmaker + Room + engine stack via
[twoPlayerHarness.ts](../../../server/tests/helpers/twoPlayerHarness.ts)), `tests/regression/`,
plus `src/__tests__/` (room, protocol, privy, and the leak test).

### Integration and device tests

Integration tests exist and are real (two sockets server-side; two real `useMatchClient`
instances client-side in
[tests/integration/two-client-online-match.test.ts](../../../tests/integration/two-client-online-match.test.ts)).

**There are no device tests and no component render tests.** Nothing mounts a React tree. The
`00-OVERVIEW.md` §9 DoD item 5 ("render tests if the repo already has a component test
setup") — **it does not.** Item 6 (manual QA on a real device) is the only UI verification
path that exists; per memory, the user tests through the EAS-built APK, not Expo Go.

### CI

**There is none.** No `.github/`, no `.gitlab-ci.yml`, no CI config of any kind.
[render.yaml](../../../render.yaml) is a deploy blueprint, not CI — and per the EC2 note in
memory it may itself be stale. Every gate in the DoD is a local command someone has to
remember to run.

### Coverage

| Package | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| `server/src` | 60.22% (707/1174) | 50.46% (383/759) | 63.1% (118/187) | **62.7%** (644/1027) |
| app `src/**` | — | — | — | **not measurable** |

`npm run test:coverage` in the app package **fails**: `MISSING DEPENDENCY  Cannot find
dependency '@vitest/coverage-v8'`. It is in `server/package.json` devDependencies (:30) and
installed at `server/node_modules/@vitest/coverage-v8`, but **not in the app's
`package.json`**. `tests/README.md` quotes ~51% for the app, which is the last hand-recorded
figure, not something reproducible today.

Both configs report `['text-summary', 'json-summary']` and exclude `__tests__`, `*.d.ts`, and
the generated `src/net/database.types.ts`.

---

## 5. CONVENTIONS

**Lint** — ESLint 10 flat config ([eslint.config.js](../../../eslint.config.js), CommonJS,
73 lines). Only four general rules (`eqeqeq: 'warn'`, `no-var: 'error'`,
`prefer-const: 'warn'`, `no-restricted-imports: 'off'`). The real content is the two
engine-purity overrides. **There is no `typescript-eslint` plugin, no type-aware linting, and
no `no-explicit-any` rule** — the parser is installed but no plugin rules run. `00-OVERVIEW.md`
§9's "no new `any` in new files" is therefore a **manual** check today.

**Format** — Prettier 3.9: `semi: true`, `singleQuote: true`, `printWidth: 100`,
`tabWidth: 2`, `trailingComma: 'all'`, `arrowParens: 'always'`. **There is no `format`
script and no pre-commit hook.**

**TypeScript** — `~6.0.3` both sides, `strict: true` **and `noUncheckedIndexedAccess: true`**
in both tsconfigs. The latter shapes real code — see
[room.ts:360-365](../../../server/src/room.ts#L360-L365) ("A fixed-length array literal (not
.map, which loses tuple-ness) keeps this a real 2-tuple"). Root tsconfig **excludes
`server`**, so `npm run typecheck` at the root does not check the server; that needs
`npm run --prefix server typecheck`.

**Naming** — `camelCase` in TS, `snake_case` in SQL and on Supabase rows, with the boundary
mapped explicitly (`fromApi` in profileSync.ts, `cloudAsLocal` in profileMerge.ts). Files:
`PascalCase.tsx` for components, `camelCase.ts` for modules. Stores are `useX`. Engine ids are
readable and stable (`battleship-1`, `torpedoBomber-2`). Numbered SQL `NNNN_snake_name.sql`.
Regression tests are named for the **symptom**.

Module headers are a hard convention: nearly every file opens with a block comment stating the
invariant it owns and, where the brief was silent, the choice that was made. `CLAUDE.md`
§2 makes this binding — *"change the comment when you change the rule."*

**Error handling** — three-tier, described in §2 above. The typed-union `ErrorCode` on the
socket is the pattern to extend. `AuthFailure` is the pattern for anything carrying an HTTP
status. The regex-on-message style in `/points/*` is the anti-pattern its own sibling file
documents.

**i18n — there is none.** No `expo-localization`, no message catalogue, no `t()`. Every string
is an inline English literal. Port City copy will be inline too unless i18n is introduced.

**How config reaches the client from the server** — exactly one value, and it is not a config
system. `FUEL_BUDGET` is imported by the matchmaker from `@engine/types`
([matchmaker.ts:10](../../../server/src/matchmaker.ts#L10)), passed into `createRoom(...,
FUEL_BUDGET, ...)` (:399, :417), stored on the room, and sent in the `matched` frame
([room.ts:374-389](../../../server/src/room.ts#L374-L389) → `fuelBudget`), where
[match-client.ts:701](../../../src/net/match-client.ts#L701) reads it into the store. Since
both sides import the same constant it is really a re-assertion, but **the channel exists**:
`matched` is the one per-match config frame, and it is re-sent on reconnect (`sendMatched`
from `attach`). Everything else is build-time `EXPO_PUBLIC_*` env
([src/net/apiBase.ts](../../../src/net/apiBase.ts) derives the HTTP base from
`EXPO_PUBLIC_WS_URL` when `EXPO_PUBLIC_API_URL` is unset).

**Protocol version** — the constant exists and **is completely inert**:

```ts
export const PROTOCOL_VERSION = 1 as const;   // server/src/protocol.ts:18
export const PROTOCOL_VERSION = 1 as const;   // src/net/protocol.ts:28
```

Two independent declarations. Grep finds them only being **re-exported** (`room.ts:630`,
`ws.ts:262`) — never sent, never compared, never checked. What *is* on the wire is the
per-message `v: 1` literal, which zod enforces (`v: z.literal(1)` on every `ClientMessage`
member), so a client sending `v: 2` is rejected as `bad_message` with no useful signal.

There is **no `upgrade-required` error code**, no minimum-version gate, and no "New charts
available" screen. `00-OVERVIEW.md` §5's protocol-version mechanism has to be built for Part 6
before any new mark or item kind can go over the wire.

The protocol file is marked **FROZEN** at the top — *"Don't change a shape here without
updating both sides; add new message types instead of repurposing old ones."*

**Rate limits** — 10 messages/second per socket, and going over **closes the socket** (4002),
which is not the behaviour §5 wants for city actions ("a typed error, not a socket kill").
Also note `MAX_ILLEGAL = 5` counts *reducer rejections*, so a buggy client can get itself
disconnected by sending five invalid city actions.

**Idempotency** — exists in three unrelated forms, none of them the general `requestId` store
§5 describes: a `requestId` uuid on the points/wager HTTP routes (the hold row is the key), a
monotonic `seq` per seat in the room, and a unique `(match_id, seq)` on `match_events`. There
is **no "last 50 responses per user" replay cache**.

**Catalogue checksums** — §5 says "the rank ladder is already pinned this way — copy that
pattern". What actually exists
([src/engine/__tests__/ranks.test.ts:35-59](../../../src/engine/__tests__/ranks.test.ts#L35-L59))
is better than a checksum but different: the test `readFileSync`s
`supabase/migrations/0003_ranks.sql`, regex-parses its rows, and asserts they equal `RANKS`
exactly, in order — **a cross-file consistency test, not a checksum of a table**. There is no
checksum test anywhere in the repo. Copy the *idea* (pin the data against a second source of
truth), not the description.

---

## 6. RISKS — the five places Port City is most likely to break something that works

**1. `profiles` and the score-guard trigger.**
[0001_profiles.sql:69-90](../../../supabase/migrations/0001_profiles.sql#L69-L90) lists guarded
columns *by name*. A new `steel` column added without being added to that `if` is
**client-writable** — the guard fails open, silently, and no test covers it. Worse, the column
list is duplicated in four more places that all fail differently: `ProfileSchema` +
`PROFILE_COLUMNS` ([api.ts:87-133](../../../src/net/api.ts#L87-L133)) reject the row at
**parse** time if the shapes disagree (zod, so the whole profile read fails, not just the new
field); `partialize`
([profile.ts:205-227](../../../src/state/profile.ts#L205-L227)) silently stops persisting it;
`pushProfile`'s allow-list ([profileSync.ts:80-87](../../../src/net/profileSync.ts#L80-L87))
silently stops syncing it. Five edits, four distinct silent failure modes, one loud one.
*And this has bitten before* — a stale hardcoded fleet count of 10 wiped every offline board.

**2. `MAX_ILLEGAL = 5` and the 10 msg/s socket kill.**
[ws.ts:18-21](../../../server/src/ws.ts#L18-L21) closes the socket after five rejected actions
(4001) or eleven messages in a second (4002). Both counters are **per connection, shared with
the live match**. If city or raid traffic is put on the same socket, a player collecting from
four buildings in quick succession trips the rate limit **and drops their match**; five
`not-enough-steel` rejections disconnect them as a suspected cheat. §5 asks for city limits of
10 per 10 s and raid limits of 4 per second — both incompatible with the current shared
counters. Either give city traffic its own transport (the HTTP routes) or split the counters
before adding a single city message type.

**3. `reduce()` is the whole validation layer, and three things depend on its exact shape.**
Adding item kinds or marks for Part 5 touches `ArsenalKind`, `CellState`, `MatchEvent`,
`ARSENAL_SPEC` and the `switch` in `useArsenal` — and each has a silent consumer.
`ArsenalKindSchema` ([protocol.ts:32](../../../server/src/protocol.ts#L32)) is a **hand-copied
duplicate** of the engine union; miss it and the item is unusable online while working
perfectly offline. `CellMark.tsx` switches on `CellState`. `applyEvent.ts` and
`battleEffects.ts` switch on `MatchEvent['type']` — an unhandled event type means the
EventPlayer awaits an animation that never comes and **input stays locked for the rest of the
match**. And the minesweeper's never-ends-your-turn rule has nowhere to live in the current
`keepsTurn` computation (§1). The safety net that exists:
[src/engine/__tests__/view.test.ts](../../../src/engine/__tests__/view.test.ts) greps the enemy
half of every view for ship coordinates — CLAUDE.md says *"keep it green whenever `PlayerView`
grows a field."*

**4. Rooms are in-memory, single-instance, and the server has no persistence layer to copy.**
`rooms` is a plain `Map` ([room.ts:587](../../../server/src/room.ts#L587)) and
[render.yaml:7-11](../../../render.yaml#L7-L11) forbids a second instance. The Port City needs
the opposite: durable state, settle-on-read, offline raids against players who are not
connected. There is **no repository layer, no ORM, no transaction helper** — every multi-row
write is a bespoke Postgres function called by RPC (`apply_match_result`,
`create_wagered_match`, …). A city service built as ad-hoc `db().from(...)` calls will not be
atomic, and `settle(state, now)` running on a read means concurrent settles need locking that
nothing in the current codebase demonstrates. Copy the RPC-function pattern; do not invent a
client-side transaction.

**5. The `city.tsx` screen is a 557-line single-purpose map, and it is also the first-visit
Captain gate.** Its pan/zoom clamp runs in Reanimated **worklets** (`'worklet'` on `clamp` and
`centreOn`), the three `SLOTS` and `HARBOUR` are **hardcoded map-pixel rectangles** tied to
`city-port.png`'s 768×1024, and `MAP_H` is derived from those literals
([city.tsx:52-79](../../../app/city.tsx#L52-L79)). Turning it into a 15-building city means
replacing the coordinate model wholesale. Two quieter traps: the header states *"Nothing on
the map animates on its own — the brief's no-ambient-motion rule"*, which pen-drawn
construction must not break; and `hasVisitedCity` / `markCityVisited()` is a **persisted
profile field** whose only job today is suppressing the welcome line, so reusing or resetting
it changes behaviour for existing installs. Also note the screen is one of only two files
(with `placement.tsx`) that the root `BackHandler` handler does **not** defer to
([_layout.tsx:124-140](../../../app/_layout.tsx#L124-L140)) — a city that opens sub-screens
needs its own back handling.

---

## 7. GAPS — where `00-OVERVIEW.md` §4 disagrees with reality

**§4's table is, to my surprise, accurate.** Every row I could check holds:

| §4 claim | Reality |
| --- | --- |
| Engine shared by app and server → `src/engine/` | ✅ exact — same source, two tsconfig aliases |
| Server → `server/src/`, match rooms in `server/src/room.ts` | ✅ exact |
| Screens → `app/`, the city is `app/city.tsx` today | ✅ exact |
| Client state → `src/state/`, profile in `src/state/profile.ts` | ✅ exact |
| Ink primitives → "wherever the stroke generator and frames live today" | ✅ `src/ui/useRough.ts` + `roughCore.ts`; frames are `Paper`/`InkPanel` |
| This package → `docs/port-city/` | ✅ exact |
| New code → `src/engine/city/`, `/raid/`, `/items/`, `server/src/city/`, `/raid/` | n/a — none exist yet, as expected |

The one thing §4 **omits**: the repo root is `my-app/`, one level below the folder the package
is usually opened from, and `docs/port-city/` therefore lives at
`my-app/docs/port-city/`. `progress/` did not exist before this file.

### Where the docs *do* disagree with reality (outside §4)

These matter more than §4, because implementers will read them as settled:

1. **§5 "Feature flags. Server-driven config, one per part."** — **No flag mechanism of any
   kind exists.** Not server-side, not client-side, not in the database. Part 1 must build it
   before it can ship "behind its flag, default off".
2. **§5 "Protocol version. Bump `PROTOCOL_VERSION`; the server refuses to queue a client below
   the minimum with a typed `upgrade-required`."** — `PROTOCOL_VERSION` is declared **twice**
   (`server/src/protocol.ts:18`, `src/net/protocol.ts:28`) and **never sent, compared or
   checked**. There is no `upgrade-required` code in `ErrorCode`. Nothing to bump; it must be
   built.
3. **§5 "Catalogues are data … a test pins the table against a checksum (the rank ladder is
   already pinned this way — copy that pattern)."** — There is **no checksum test in the
   repo**. The rank ladder is protected by a *cross-file* test that parses
   `0003_ranks.sql` and compares it to `RANKS`. Good pattern, different mechanism.
4. **§5 "Idempotency … the server stores the last 50 per user with their responses and replays
   the stored response."** — No such store. Idempotency today is per-hold-row (points), per-seat
   `seq` (rooms), and a unique constraint (`match_events`).
5. **§5 "Rate limits … Over the limit is a typed error, not a socket kill (that rule stays for
   match sockets)."** — Today there is only *one* socket and it *is* killed (4002). See Risk 2.
6. **§9 DoD item 5, "render tests if the repo already has a component test setup"** — **it does
   not.** No React renderer is installed. Read that item as "not applicable" rather than
   going and adding one mid-part.
7. **§9 DoD item 1, "no new `any`"** — not enforceable by the current lint setup (no
   `typescript-eslint` plugin rules). Manual review only.
8. **§9 DoD items 1–9 have no CI to run them.** There is no `.github/`. Every gate is a local
   command.
9. **§10 "The reference implementation … with 80 passing tests."** — The reference contains
   **84** `it(` blocks (resolve 26, city 21, raid 21, new-items 16); `reference/README.md`'s
   per-file table says raid has 17, which is stale. Also `docs/port-city/reference/` has **no
   `node_modules`**, so `npm test` there needs `npm install` first, exactly as its README says.
10. **`NUMBERS.md` names items differently from the engine.** "torpedo"/"double
    torpedo"/"atomic"/"aa gun" are `torpedoBomber` / `doubleTorpedoBomber` / `atomicBomber` /
    `aaGun` in `ArsenalKind`. The *values* match exactly (310 at cap, confirming CORRECTIONS
    §2); only the labels differ. Pick the engine's names in code.
11. **CORRECTIONS §1 (the halo undercount) is confirmed against the shipped engine.**
    `halo()` ([board.ts:72](../../../src/engine/board.ts#L72)) excludes the ship's own cells
    (`if (own.has(key)…) continue`), so a 1×2 ship hatches **10**, not 12. The engine is right;
    the caption is wrong.
12. **`app/city.tsx`'s three "Coming soon" slots are labelled `Shipyard`, `Admiralty`,
    `Lighthouse`** ([city.tsx:70-74](../../../app/city.tsx#L70-L74)) — three of the fifteen
    buildings in §7's roster, already positioned on the map. Useful, and not mentioned in §4.
13. **`gems` and `buildings` already exist on `profiles`** (guarded, defaulted, read by the
    client, rendered on the progress screen) **with no write path anywhere.** §6 treats gems as
    "the green counter already in the HUD", which is true — but nothing has ever incremented it.

### Things I could not determine

- **Which deployment is live.** `render.yaml` + `server/Dockerfile` describe Render; session
  memory says the server moved to EC2/nginx/pm2 at `api.empireofbits.xyz`. `render.yaml` is
  still in the tree and may be stale. I did not check the running host.
- **Real app-side coverage.** Not measurable without installing `@vitest/coverage-v8`, which
  would have modified the tree.

---

## Summary — the ten things an implementer most needs to know

1. **Repo root is `my-app/`.** Current branch `merge-session-work` @ `843a745`; `master` is
   10 commits behind `origin/master`. Both suites pass: app 410 tests, server 138.
2. **The engine is genuinely shared source, not a package.** `server/tsconfig.json` maps
   `@engine/*` to `../src/engine/*` **and includes those files**; eslint bans every React/RN/
   Expo/`@/` import inside `src/engine/`. Put new pure rules there and both sides get them free.
3. **`reduce()` is the entire server-side validator.** `Room.applyAction`
   ([room.ts:429](../../../server/src/room.ts#L429)) calls it and does nothing else to state;
   `projectView()` is the only thing that ever reaches a client.
4. **The turn rule lives in three expressions** (`shots.ts:217`, `arsenal.ts:248`,
   `match.ts:228`) and is computed from the *tally*, not the item — so Part 5's
   never-ends-your-turn Minesweeper has no home yet and needs a per-kind override.
5. **AA interception is row-based, pre-resolution, and never expires** (`!i.destroyed`, no
   `!i.used`) — `arsenal.ts:154`. The Sonar Net must inherit exactly this (CORRECTIONS §4).
6. **Three of §5's assumed mechanisms do not exist: feature flags, protocol versioning, and a
   general idempotency store.** `PROTOCOL_VERSION` is declared twice and never sent. Budget for
   building all three; do not assume a hook is waiting.
7. **The one server→client config channel is the `matched` frame's `fuelBudget`** — re-sent on
   reconnect. Extend that, or add HTTP; there is nothing else.
8. **The socket kills on 10 msg/s and on 5 reducer rejections, per connection.** City traffic on
   that socket will drop players out of live matches. Split it before adding a message type.
9. **Adding a currency touches five files with four silent failure modes** — the SQL guard
   trigger, `ProfileSchema`/`PROFILE_COLUMNS`, `partialize`, `pushProfile`'s allow-list, and
   `profileMerge`. `gems` and `buildings` are already-guarded columns with no write path: start
   from them.
10. **The UI contract is fixed and cheap to follow:** author in 800×360 inside `<Scale>`, draw
    with `useRough()` helpers using `seed: hashString('stable-key')` (never a default seed),
    animate by enqueuing `MatchEvent`s on the `EventPlayer` rather than by inspecting state, and
    add tests to a path the `include` globs actually cover — otherwise they never run.

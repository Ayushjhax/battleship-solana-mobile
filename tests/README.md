# Test suite

Two vitest projects, one per package. Both are plain Node — no React Native
shims, no emulator, no live Supabase.

```bash
npm test                 # app suite
npm run test:coverage    # app suite + coverage summary

cd server
npm test                 # server suite
npm run test:coverage    # server suite + coverage summary
```

## Layout

```
my-app/
  tests/
    regression/   one file per shipped bug, named for the symptom
    net/          the network boundary (src/net/**)
    board/        board geometry (src/board/**)
    ui/           pure shape maths (src/ui/geometry.ts)
    helpers/      shared fakes and fixtures
  src/**/__tests__/   original co-located unit tests (engine, state, match client)

my-app/server/
  tests/
    regression/   one file per shipped bug
    unit/         one module under test, boundaries faked
    integration/  real Fastify routes through `inject`, and two real players
                  over real sockets against the real ws/matchmaker/Room stack
    helpers/      shared fakes (fakeSupabase.ts)
  src/__tests__/      original co-located unit tests (room, protocol, privy)
```

`regression/` is the important convention: every file there exists because the
bug it describes reached a user. The header comment states the symptom as it
was reported, then what actually caused it. Do not tidy those comments away —
they are why the assertions look the way they do.

## What is faked, and what is not

Faked only at the process edge:

| Boundary | How | Why |
|---|---|---|
| Supabase | `server/tests/helpers/fakeSupabase.ts` | Failure branches (admin refused, link without a token) cannot be produced on demand against a live project. |
| Privy SDK | `vi.mock('@privy-io/node')` | Needs real credentials and a network round trip. |
| Solana RPC | `Connection` class replaced; `Keypair`/`PublicKey` stay real | Keeps the key-matching branch genuinely exercised. |
| `fetch` | `vi.stubGlobal` | Client-side network boundary. |

### Two real clients end to end

`tests/integration/two-client-online-match.test.ts` runs **two real
`useMatchClient` instances against the real server** — the last gap that was
left when the server was only proven against raw sockets and the client only
against a fake server.

`useMatchClient` is a module-level singleton, so two instances need two module
graphs; `vi.resetModules()` between imports gives exactly that, and the first
test asserts the two stores really are independent rather than assuming it.

One trap: a `vi.mock` factory is **cached and does not re-run per graph**, so
the two clients cannot each close over their own identity. The token is
switched externally instead, and each client is walked to `queued` before the
next connects, which pins its hello to the right player.

### Two real players end to end

`server/tests/integration/two-player-match.test.ts` and
`two-player-resilience.test.ts` run two sockets against the real
`attachWebSocketServer` + matchmaker + Room + rules engine, via
`helpers/twoPlayerHarness.ts`. They cover pairing, seating, the layout
deadline, turn order, event fan-out, disconnect grace, resume, rate limiting
and a full match to a winner.

Two things to know when adding to them:

- **The socket path is `/ws`.** Anything else is a 400 at the upgrade.
- **The rate limit is 10 messages/second per socket and closes it outright**
  (code 4002, no grace), and the window counts the `hello`/`queue`/`ready`
  setup burst too. A test that machine-guns actions disconnects itself and
  then waits forever for a reply that can no longer come. Pace shots at
  150 ms+ and let the setup burst age out first.

Deliberately **not** faked: the rules engine, the wire protocol, Fastify's
routing and error handling, `jose`'s JWT verification (tests sign real ES256
tokens with a generated keypair and only the JWKS fetch is replaced), and the
match client's sockets — `src/net/__tests__/match-client.test.ts` runs real
WebSockets against a fake server that runs the real engine.

## Module identity

Several suites call `vi.resetModules()` so a module-level cache (the Privy
client, the treasury runtime, Fastify's app) is rebuilt per test. A static
`import { AuthFailure }` would then come from a *different* module graph than
the code under test, and `instanceof` would silently never match — every test
would pass for the wrong reason. Those files import the class from the same
fresh graph inside the test, e.g.:

```ts
beforeEach(async () => {
  vi.resetModules();
  ({ AuthFailure } = await import('../../src/errors'));
});
```

## Coverage

Line coverage at the time of writing:

| Package | Before | After |
|---|---|---|
| `server` | 40.9% | ~59% |
| app (`src/**`) | 38.6% | ~51% |

Mutation-checked: breaking the server's `projectView` masking makes the
client-side leak assertion fail, so that test is doing real work rather than
passing by construction.

Coverage is a floor, not a target — `regression/` matters more than the number.
Excluded from the report: `src/**/__tests__/**`, `*.d.ts`, and the generated
`src/net/database.types.ts`.

## The regression files

| File | Symptom it was reported as |
|---|---|
| `server/tests/regression/privy-sync-error-classification` | "invalid Privy access token" for a good token |
| `tests/regression/points-still-syncing` | "Your verified account is still syncing" on every buy |
| `tests/regression/arsenal-deploy-lag` | "Lagging of arsenal deployment, in game moves" |
| `tests/regression/arsenal-double-tap` | "Double tap of arsenal item messes up in the placement" |
| `tests/regression/stale-balance-after-transaction` | "Need to refresh sometimes to reflect sol balance" |
| `tests/regression/matchmaking-stuck-on-reveal` | "Matchmaking throws either player into in-game waiting" |
| `tests/regression/arsenal-inventory-desync` | Double-tap drops the count twice, places one — placement stuck |
| `tests/regression/hotseat-turn-handover` | "Turn Pass prompt ... repeatedly after every move" |
| `tests/regression/arsenal-missing-in-battle` | "i am not able to use my arsenals" — every weapon 0 in battle |
| `tests/regression/home-and-hud-fixes` | Sound toggle does nothing; tutorial duplicated; arsenal scrolls |
| `tests/regression/online-input-latency` | "no lag" — a tap must reach the network in the same tick |

Each was checked by reverting its fix and confirming the suite goes red — a
regression test that passes against the broken code is worse than none.

## Adding a test for a new bug

1. Put it in `regression/`, named for the symptom (`points-still-syncing`),
   not the fix.
2. Open with the report in the user's words, then the real cause.
3. Assert the thing that was wrong — for a misclassified error, assert both
   that the right code comes back *and* that the wrong message does not.

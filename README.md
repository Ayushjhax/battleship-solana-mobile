# Empire of Bits: Ocean Warfare

Battleship in a ballpoint-pen-on-graph-paper style. Expo SDK 57 · TypeScript strict ·
Android/iOS · landscape only · Privy authentication and embedded Solana wallet.

Privy uses native modules, so the app now requires an Expo development build; it
does not run in Expo Go.

Read [CLAUDE.md](CLAUDE.md) first — it holds the rules that must survive the build.
The full spec is in [docs/brief.md](docs/brief.md), the build order in
[docs/prompts.md](docs/prompts.md), and every art/audio drop point in
[docs/assets.md](docs/assets.md). **Setup, env vars, server, migrations, the APK build and
the known limitations are in [docs/README.md](docs/README.md); the stage script and the
final checklist are in [docs/DEMO.md](docs/DEMO.md).**

## Run it

```bash
npm install
cp .env.example .env        # fill Supabase, Privy client and Solana RPC values
npm run android             # first build: compile, install, and start Metro
npm run android:metro       # later JS/TS-only sessions (uses the installed build)
```

Match server (separate install, shares `src/engine` via `@engine/*`):

```bash
cd server && npm install && cd ..
npm run server              # http://localhost:8080/health · ws://localhost:8080/ws
```

Before running the app:

1. Apply every SQL file in `supabase/migrations/`, including
   `0009_privy_accounts.sql` and `0010_points_wallet_and_wagers.sql`.
2. In Privy Dashboard, enable Email and Google login, create a native/mobile app
   client, enable Solana embedded wallets, and allow the app scheme
   `empireofbits`.
3. Put the public app/client IDs in `EXPO_PUBLIC_PRIVY_APP_ID` and
   `EXPO_PUBLIC_PRIVY_CLIENT_ID`. Put `PRIVY_APP_ID` and `PRIVY_APP_SECRET` only
   on the server. Put `SOLANA_RPC_URL`, `TREASURY_PUBLIC_KEY`, and
   `TREASURY_PRIVATE_KEY` only on the server. Use a private authenticated Solana RPC for production.
4. Rebuild the development app whenever Privy native dependencies or native
   configuration changes.

Point the app at it with `EXPO_PUBLIC_WS_URL` in `.env`:
- **Android emulator:** `ws://10.0.2.2:8080/ws` and `EXPO_PUBLIC_API_URL=http://10.0.2.2:8080`.
- **Local network** (development build on a phone, dev machine running the server): `ws://<your-lan-ip>:8080/ws` — plain `ws://` is fine, the phone and server share a trusted network.
- **Production / anything off your LAN**: `wss://<deployed-host>/ws` — never plain `ws://` once traffic leaves the local network; it carries the Supabase access token in the `hello` message.

### Deploying the match server (Render)

`server/Dockerfile` + `render.yaml` (repo root — the build context has to include
`../src/engine`, see the comment in the Dockerfile). `/health` returns
`{ok, rooms, queued, uptime}`.

1. Connect the GitHub repo in the Render dashboard.
2. If Render offers **"New Blueprint Instance"**, take it — `render.yaml` fills in
   everything below automatically. Otherwise, pick **New Web Service** and set these
   fields by hand:

   | Field | Value |
   |---|---|
   | Environment | Docker |
   | Dockerfile Path | `server/Dockerfile` |
   | Docker Build Context Directory | `.` (repo root, **not** `server`) |
   | Health Check Path | `/health` |
   | Plan | `Free` to try it, `Starter` for real players — see below |
   | Instances | **1**, no autoscaling |

3. Set env vars in the dashboard (never commit these): `SUPABASE_URL`,
   `SUPABASE_SECRET_KEY`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and optionally
   `PRIVY_JWT_VERIFICATION_KEY`, `SOLANA_RPC_URL`, `TREASURY_PUBLIC_KEY`, and
   `TREASURY_PRIVATE_KEY`. Don't set `PORT` — Render injects it, and the server already
   reads `process.env.PORT` and binds `0.0.0.0`.
4. Once live, Render gives you `https://<name>.onrender.com`; the match socket is at
   `wss://<name>.onrender.com/ws` (Render terminates TLS and proxies WebSocket upgrades
   transparently — no extra config needed).

**Never autoscale.** Match state (rooms, matchmaking queues) lives in process memory, so
a second instance can't see the first one's rooms and matches would randomly land on a
server that's never heard of them. One instance is a hard requirement.

**What the Free plan costs.** Free instances suspend after ~15 minutes without inbound
traffic. Two consequences, both handled but neither free:

- A match in progress when it suspends is lost. Clients see the socket close, the
  reconnect fails, and the 45-second grace forfeits it. Nothing is corrupted — the
  result settlement is one atomic transaction and wagers are held in Postgres, not in
  memory — but that game is over.
- The first request after a suspension pays for a container cold start, tens of seconds.
  The app expects this: `src/net/wake.ts` polls `/health` until the server answers and
  `BackendWakeGate` holds onboarding, the welcome bonus and the menu behind a loader
  until the account handoff actually lands, so nobody types a name into a screen that
  can't save it. A warm server answers the first ping in well under a second and the
  loader never appears.

`Starter` removes both, and needs no code change — flip `plan` in `render.yaml`.

## Checks

| | |
|---|---|
| `npm run typecheck` | app, strict + `noUncheckedIndexedAccess` |
| `npm test` | vitest, `src/engine` + placement store + the match client over real sockets, no RN shims |
| `npm run lint` | eslint flat config, includes the engine-purity rule |
| `npx expo-doctor` | must stay at 21/21 |

## Status

P00 scaffold, P01 design system, P02 boot + menu, P03 engine, P04 board, P07 battle, P09 tutorial, P10 onboarding + settings, P11 Supabase, P12 match server, P13 online client, P14 result / leaderboard / city and P17 ship (EAS preview APK, demo menu, hard offline, seed script) complete.
`src/engine` is the full rules engine (90 tests): placement, shots, arsenal, reducer,
masking, AI. `server/` is the authoritative Fastify + ws match server (7 tests,
including the leak test that proves no un-hit enemy ship coordinate ever reaches a
client) — it owns both boards; clients only ever see `projectView()`'s masked output.
`src/net/match-client.ts` is the app's side of the wire (reconnect with backoff, resume,
optimistic shots that never guess a verdict), driven from `app/(game)/searching.tsx` and the
battle store; `src/net/protocol.ts` is the hand-kept mirror of the frozen server protocol.
`src/ui` and `src/board` are typed placeholders that P01/P04 replace.

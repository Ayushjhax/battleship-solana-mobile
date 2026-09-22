# Setup, environment, server, migrations, limitations

The operator's manual. The root [README.md](../README.md) is the short version; the rules
of the codebase are in [CLAUDE.md](../CLAUDE.md); the stage script is [DEMO.md](DEMO.md).

## Local setup

Requirements: Node 22 (the server image is `node:22-alpine`; `process.loadEnvFile` needs
≥ 20.12), npm, and an Expo development build on a phone. Privy's native authentication
and wallet modules are not available in Expo Go.

```bash
git clone <repo> && cd my-app
npm install
cp .env.example .env            # fill in the values below
npx expo run:android            # first native development build
npm start -- --dev-client       # Metro for subsequent sessions

cd server && npm install && cd ..
npm run server                  # the match server on :8080 (reads the root .env)
```

Checks, all of which must stay green:

| | |
|---|---|
| `npm run typecheck` | `tsc --noEmit`, strict + `noUncheckedIndexedAccess` |
| `npm test` | vitest: engine, placement store, offline match, demo rig, match client over real sockets |
| `npm run lint` | eslint flat config, includes the engine-purity rule |
| `npx expo-doctor` | 21/21 |
| `npm --prefix server run typecheck && npm --prefix server test` | the server, incl. the leak test |
| `node supabase/verify-offline.mjs` | every migration twice against an in-process Postgres (needs `npm i --no-save @electric-sql/pglite`) |
| `npm run check:bundle` | exports the Android bundle and proves no server secret is in it |

## Environment variables

One file, `.env` at the repo root (`.env.example` is the template; `.env*` is git-ignored).
Expo inlines only the `EXPO_PUBLIC_*` names into the app bundle; the server reads the rest.

| Name | Where | What |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | app | `https://<ref>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | app | `sb_publishable_…` — public by design, RLS does the protecting |
| `EXPO_PUBLIC_WS_URL` | app | `ws://10.0.2.2:8080/ws` in Android Emulator, `ws://<lan-ip>:8080/ws` on a phone, `wss://<host>/ws` elsewhere |
| `EXPO_PUBLIC_API_URL` | app | optional HTTP base; otherwise derived from the WebSocket URL |
| `EXPO_PUBLIC_PRIVY_APP_ID` | app | public Privy application id |
| `EXPO_PUBLIC_PRIVY_CLIENT_ID` | app | public native/mobile app client id |
| `EXPO_PUBLIC_SOLANA_RPC_URL` | app | authenticated RPC recommended in production |
| `EXPO_PUBLIC_SOLANA_CLUSTER` | app | `devnet`, `testnet`, or `mainnet-beta` |
| `SUPABASE_URL` | server | same project |
| `SUPABASE_SECRET_KEY` | server | `sb_secret_…` — bypasses RLS; **never** under `app/` or `src/`, `server/src/db.ts` is the only reader |
| `PRIVY_APP_ID` | server | same Privy app id, used for access-token verification |
| `PRIVY_APP_SECRET` | server | Privy server secret; never use an `EXPO_PUBLIC_*` name |
| `PRIVY_JWT_VERIFICATION_KEY` | server | optional dashboard verification-key override |
| `SOLANA_RPC_URL` | server | authenticated mainnet RPC used to verify buys and broadcast treasury payouts |
| `TREASURY_PUBLIC_KEY` | server | point-exchange treasury address |
| `TREASURY_PRIVATE_KEY` | server | JSON 64-byte signing key; never public or committed |
| `SELL_POINTS_COST` / `SELL_SOL_PAYOUT` | server | fixed supported quote: `100` / `0.001` |
| `PORT` | server | default 8080; Render injects its own |

Never put the secret key in an `EXPO_PUBLIC_*` name. `npm run check:bundle` scans the
exported bundle for it by value and by shape and fails the build if it ever leaks.

The EAS build profiles (`eas.json`) carry the three public values for the cloud build;
`EXPO_PUBLIC_WS_URL` there must be the **deployed** `wss://` address — plain `ws://`
carries the Supabase access token in the clear once traffic leaves your LAN.

## Supabase

Everything is in `supabase/migrations/`, numbered and idempotent
(see [supabase/README.md](../supabase/README.md) for the schema and what RLS enforces).

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push                                                  # applies migrations in order
npx supabase gen types typescript --linked > src/net/database.types.ts   # after every new migration
npx supabase migration list --linked                                  # what is applied where
```

Two Supabase dashboard toggles the SQL cannot set: **Auth → Providers → Anonymous
sign-ins: on** (this remains the internal gameplay session behind Privy) and **Realtime →
Settings → Allow public access: off**. In Privy Dashboard enable Email and Google login,
create a mobile app client, enable Solana embedded wallets, and allow the `empireofbits`
app scheme.

Verify: `node supabase/verify-offline.mjs` (no project needed) and, against the live
project, `npm --prefix server run verify:rls`.

## The match server

`server/` is a Fastify + `ws` process that imports the rules engine from `../src/engine`
(never copies it). It owns both boards; clients only ever receive `projectView()` output.
`GET /health` → `{ok, rooms, queued, uptime}`; the socket is `/ws`.

Run locally with `npm run server` from the root. Deploy with `server/Dockerfile` +
`render.yaml` (Render, one always-on **Starter** instance, never Free and never two — match
state lives in process memory; the root README has the dashboard walkthrough). Set
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`,
`SOLANA_RPC_URL`, `TREASURY_PUBLIC_KEY`, and `TREASURY_PRIVATE_KEY` in the
service's environment. Once live, the
socket is `wss://<service>.onrender.com/ws`; put that in `eas.json` and in `.env` for any
phone off your LAN.

Seeding for a demo (needs the secret key in `server/.env`):

```bash
cd server && npm run seed:demo -- <your-user-id>     # the demo menu shows the id
```

## Building the APK

```bash
npx eas-cli login                         # once
npx eas-cli build -p android --profile preview      # APK, R8-minified, internal distribution
```

The `preview` profile in `eas.json` produces an installable `.apk` (not an `.aab`), minified
via `expo-build-properties`, with the public env values baked in. The first build generates
and stores an Android keystore on EAS. Download the artifact from the build page,
`adb install app.apk` (or copy it to a USB stick — see DEMO.md).

Gotcha met on the first build: the `expo-splash-screen` plugin **must** be given an `image`
— without one, Android's generated styles still reference `drawable/splashscreen_logo` and
`processReleaseResources` fails. `app.json` points it at `assets/images/brand/logo.png`.

The universal APK is ~115 MB because it carries all four ABIs (arm64-v8a, armeabi-v7a,
x86, x86_64) — fine for a USB stick. A Play build would use the `production` profile (AAB).

## Known limitations

- **Android remains the tested target.** Privy and app configuration support iOS, but no
  iOS build is currently part of CI.
- **Landscape only**, on every screen. `app.json` pins it and `_layout.tsx` locks it again.
- **Two identity layers.** Privy recovers the human account and embedded wallet. The
  frozen gameplay/RLS layer still uses its existing per-install Supabase session, mapped
  to the verified Privy DID by migration 0009. Reinstalling restores the Privy wallet but
  does not yet merge old gameplay progress into the new internal profile.
- **One match server instance.** Rooms and queues are in memory; a restart ends every
  in-progress match (clients see "The match ended while you were away").
- **Development build required.** Privy authentication and wallet native modules do not
  run in Expo Go.
- **Assets that have not landed** draw as labelled placeholders (`src/ui/assets.ts`,
  `src/audio/sfx.ts`); the app never waits on them.

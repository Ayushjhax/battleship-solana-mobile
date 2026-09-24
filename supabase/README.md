# Supabase

Everything the project needs is in `migrations/`, numbered and idempotent. Nothing is
configured by clicking in the dashboard except the one Realtime toggle noted below.

## Apply

With the CLI (recommended):

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push                 # applies migrations/ in order
npx supabase db reset --linked       # from scratch, if you ever need it
npx supabase gen types typescript --linked > src/net/database.types.ts
```

Without the CLI: paste each file into the SQL editor in numeric order. Every file can be
run again safely.

## The one manual step

Dashboard → Realtime → Settings → turn **off** "Allow public access". `0005_realtime.sql`
puts RLS on `realtime.messages`; with public access off, every channel must be private
and pass those policies. The client always subscribes with `{ private: true }`.

Anonymous sign-ins are not required. After Privy authentication, the app calls the match
server's `/auth/privy/sync` route. The server verifies Privy, creates or finds the stable
Supabase gameplay user with its secret key, and returns a one-use session handoff for RLS.

## Keys

- App: `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`)
- Match server only: `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (`sb_secret_…`)

The secret key never appears under `app/` or `src/`; `server/src/db.ts` is the only reader.

## What the schema enforces

| Table | Read | Write |
|---|---|---|
| `profiles` | any signed-in user | own row: `name`, `avatar_id`, `avatar_color`, `country_code`, `has_completed_tutorial`. Scores are rejected by a BEFORE UPDATE trigger unless the caller is the server (no user JWT). |
| `matches` | your own matches | server only |
| `match_events` | replay log of your own matches | server only |
| `privy_accounts` | server only | server-only verified Privy sync; clients have no grants or RLS policy |
| `point_accounts`, `point_ledger` | server only | one balance per verified Privy DID; append-only welcome, wager and exchange ledger. 0025 adds `platform_fee` rows on a reserved `platform:fee` account for the 5% cut of online human-vs-human pots. |
| `point_wager_holds`, `point_trades` | server only | idempotent wager reservations and replay-protected SOL trades |
| `ranks` | public | — |
| `leaderboard` (view) | signed-in users; only `name, avatar_id, avatar_color, country_code, rank_points, battles_won` | — |
| `realtime.messages` | `lobby:{mode}` presence for everyone signed in; `match:{id}` broadcast for the two players | same |

## Verify

Offline, against a real Postgres engine in-process (no project needed) — runs every
migration twice and the acceptance scenarios:

```bash
npm install --no-save @electric-sql/pglite && node supabase/verify-offline.mjs
```

Live RLS verification still creates and deletes two temporary anonymous test users, so
enable Anonymous sign-ins only in a disposable project before running this optional script:

```bash
npm run --prefix server verify:rls
```

# Solana wallets: login identity, payment wallet, buying and selling points

Status as of 2026-10-10, branch `feat/solana-wallet-login`.

## What is built

| Part | State |
|---|---|
| Server: verified wallets per account, payment-wallet choice, ownership conflicts | **Done** (migration 0018, `server/src/db.ts`, `GET /wallets`, `POST /wallets/payment`) |
| Server: wallet-only users (`authProvider: 'solana_wallet'`, `loginMethods`, `wallets`) | **Done** (`server/src/privy.ts`) |
| Server: buy orders that fix the payer before payment, credit verification, reconcile | **Done** (`POST /points/buy/order`, `POST /points/buy`, `POST /points/buy/reconcile`) |
| Server: payouts to the account's payment wallet, destination fixed per sale | **Done** (`POST /points/sell`) |
| Server: transaction history | **Done** (`GET /points/trades`) |
| App: MWA session service — authorize, sign message, sign-and-send, cached auth token, disconnect | **Done** (`src/wallet/mwaCore.ts`, `mwa.ts`, `mwaTransport.android.ts`) |
| App: wallet login (Privy SIWS over MWA), Android | **Done** (`src/features/auth/walletAuth.ts`, `PrivyLoginScreen.tsx`) |
| App: linking a wallet to a Google/email account; unlink with a last-login-method guard | **Done** (`app/wallets.tsx`, `privyUser.ts`) |
| App: choosing the payment wallet among server-verified wallets | **Done** (`app/wallets.tsx`) |
| App: buying with the external wallet (details shown first, wallet approves, server credits) | **Done** (`app/points.tsx`, `purchase.ts`, `transfer.ts`, `confirmations.ts`) |
| App: buying with the embedded (Privy) wallet, crash-safe | **Done**, unchanged in behaviour |
| App: sales show points, net SOL, full destination and network before confirming | **Done** (`confirmations.ts`) |
| App: History tab with pending/done/failed status and explorer links | **Done** |
| Verified on a real device, a real wallet or mainnet | **Not yet** — see "Device test plan" |

Nothing in the app holds a key or signs on its own: the wallet app shows every
request and the player approves it there. Sign-in never involves a payment.

## The model

- **Login identity** is Privy's: Google, email OTP, or a Solana wallet through
  Sign In With Solana. An identity can have several (`loginMethods`).
- **Verified wallets** are every Solana wallet Privy reports for the identity —
  read by the match server from Privy's API on each `/auth/privy/sync`, never
  taken from the app. Each is `embedded` (Privy holds the key) or `external`
  (the player's own wallet app). An address belongs to one identity: another
  identity reporting it is a **conflict** (recoverable — nothing moves), and it
  is only released when Privy stops reporting it for its owner.
- **Payment wallet** pays for points and receives a sale's SOL. Unset, it is
  the embedded wallet, or else the account's only external wallet. A chosen
  wallet that is no longer verified never falls back: payments refuse until the
  player chooses again.
- **Network**: the server reads its RPC's genesis hash and reports
  `mainnet-beta`, `devnet`, `testnet` or `unknown`. The app refuses to pay when
  that differs from `EXPO_PUBLIC_SOLANA_CLUSTER`. The MWA chain is derived from
  the same setting (`mainnet-beta` → `solana:mainnet`).

Economics are unchanged: 100 points ⇄ 0.001 SOL (1,000,000 lamports), native
SOL, server-held treasury keypair, welcome points never sellable (0014).

## The app side

### Mobile Wallet Adapter (`src/wallet/mwaCore.ts`)

Pure, with the native `transact`, secure storage, clock and foreground state
injected (tests: `tests/wallet/mwaCore.test.ts`).

- The package is imported only from `src/wallet/mwaTransport.android.ts`, and
  required there on first use: iOS never bundles it, and an Android build
  without the native module still starts. `mwaTransport.ts` (every other
  platform) refuses with "needs the Android version". Enforced by
  `tests/tooling/mwa-imports.test.ts`.
- One session at a time; a second tap is refused, and the lock is held until
  the native session really ends. The game must be in the foreground.
- The wallet's `auth_token` is cached in `expo-secure-store`, for one Privy
  user, one address and one chain, for at most 7 days. A token the wallet
  refuses is discarded and authorization asked once more (MWA spec). Sign-out
  and a change of Privy user clear it without opening the wallet.
- **Disconnect** clears it and asks the wallet to `deauthorize` (opens the
  wallet briefly). It does not unlink anything.
- Transfers go through `signAndSendTransactions` (mandatory in MWA 2.0;
  `signTransactions` is deprecated and optional). Every failure says whether
  anything can have been sent: only a decline (`-3`), or a failure before the
  wallet was asked to send, is "nothing sent".
- Wallet names come from the wallet (`label`, and `wallet_uri_base` → e.g.
  `phantom`); no wallet is labelled "Seeker", and `privy` is never used
  (the server reads it as the embedded wallet).

### Sign In With Solana (`src/features/auth/walletAuth.ts`)

1. MWA `authorize` on `solana:mainnet`; the account's base64 address → base58.
2. `useLoginWithSiws().generateMessage` (or `useLinkWithSiws()`), domain
   `empireofbits.xyz`, uri `https://empireofbits.xyz`.
3. The wallet `signMessages` those exact bytes. MWA returns `message ||
   signature` (spec) and some wallets the 64-byte signature alone; both are
   reduced to the detached signature and **verified locally** (Ed25519 against
   the address) before Privy sees it.
4. `login` / `link` with `{ message, signature (base64 of 64 bytes),
   wallet: { walletClientType, connectorType: 'mobile_wallet_protocol' } }` —
   Privy's documented fields. Privy is called after the wallet session closed.
5. Login: Privy's session mounts the app and `PrivyProfileSync` runs the sync
   and the usual post-login route. Link: `refreshUser()` then a re-sync, after
   which the wallets screen waits for the server to list the wallet (or report
   it held by another account).

Privy itself refuses `login` while signed in and `link` while signed out, so a
link can never switch accounts; `linked_to_another_user` is shown in plain
words and nothing is merged.

### Buying with the external wallet (`app/points.tsx`)

`buyPoints()` (`src/features/points/purchase.ts`) with `signerKind: 'external'`:

1. The purchase is saved, then the order is made on the server.
2. Refused, with nothing paid, unless: the order is for the external wallet,
   its payer is the chosen address, its network is the app's, its treasury and
   amount are what the desk showed (`expected`), and it is open.
3. The details are shown (amount, full payer and treasury addresses, network,
   the RPC's own fee estimate via `getFeeForMessage` — or "shown by your
   wallet" — and the expiry). Cancel pays nothing.
4. MWA authorizes; the account must be the payer, or nothing is sent. A fresh
   blockhash is fetched, the expiry re-checked, and the transaction checked to
   be exactly one System transfer payer → treasury (`transfer.ts`).
5. The wallet signs and sends; its signature is saved at once; the app waits
   for `confirmed`, then the server verifies and credits once.

A failure that may have sent keeps the purchase: "Finish credit" re-reports the
signature or has the server look on chain (`reconcile`) — never pays again. A
signature still unconfirmed 5 minutes after its order expired falls back to
`reconcile` too, then is given up. The embedded wallet never pays an external
order, and vice versa.

### Payouts

`POST /points/sell` as before. The confirmation names the points redeemed, the
net SOL (the treasury pays the fee), the full destination and the network. A
pending sale keeps the destination it was made with, whatever is selected
later.

### Wallets screen (`app/wallets.tsx`)

From the points desk ("Manage wallets") or the profile ("Manage"). Lists the
server's verified wallets; **Use to pay** (`POST /wallets/payment`, confirmed
first), **Link Solana wallet** (Android), **Disconnect wallet app**, and
**Unlink** — refused while the wallet is the only way to sign in or is the
payment wallet. The points desk re-reads its quote whenever it comes back into
view.

## Server API (all need `Authorization: Bearer <gameplay JWT>`)

| Route | Body | Result |
|---|---|---|
| `GET /wallets` | — | `{ wallets: [{ address, kind, walletClient, verifiedAt }], paymentWallet, network }` |
| `POST /wallets/payment` | `{ address \| null }` | `{ paymentWallet }`; 409 `wallet_conflict` / `wallet_not_verified` |
| `GET /points/quote` | — | as before, plus `network` and `paymentWallet` |
| `POST /points/buy/order` | `{ requestId }` | `{ order: { requestId, status, points, lamports, sol, treasuryAddress, network, payer: { address, kind }, expiresAt, signature } }`; 409 with `payment_wallet_unavailable` / `payment_wallet_not_chosen` / `no_payment_wallet` |
| `POST /points/buy` | `{ requestId, signature }` | credits once; 409 still confirming; 422 wrong payer/amount/destination/failed/replayed |
| `POST /points/buy/reconcile` | `{ requestId }` | `{ status: 'confirmed' \| 'awaiting_payment', balance, signature }` |
| `POST /points/sell` | `{ requestId }` | `{ status, balance, signature, destination }`; destination is the server's choice |
| `GET /points/trades` | — | `{ trades: [...], network }` (no signed transactions or internal fields) |

`POST /points/buy` without an order still works for APKs from before 0018
(payer must be the embedded wallet), and `POST /points/sell` keeps its shape.
Against a server without orders the app refuses external purchases.

### What the server verifies before crediting a purchase

The transaction must be found at `confirmed` commitment on the server's RPC
(its network), must not have failed, and must contain a System Program
transfer of exactly the order's lamports from the order's payer to the
treasury. The order and the signature can each credit once
(`credit_point_buy_order`, `point_trades.signature` unique). A signature alone
proves nothing; a client "success" never credits.

### Payouts

The treasury signs a transfer to the sale's `destination_address`, fixed when
the points are reserved. The signed transaction is stored before broadcast; a
retry rebroadcasts that same transaction or settles it, never signs a new one.
Ambiguous payouts stay `broadcasting` until the signature status or blockhash
expiry decides them; points come back only on a definite failure. The
recipient never needs to sign to receive.

## Configuration

**Privy dashboard** (required before wallet login/linking work):
- Login methods: enable external **Wallet** login with **Solana**.
- Allow linking wallets to existing accounts (default on).
- Allow the SIWS domain `empireofbits.xyz` (Privy checks the message's domain).
- The app shows "Wallet sign-in is not switched on" for `disallowed_login_method`.

**MWA app identity** (`src/wallet/mwaCore.ts`): name `Empire of Bits`, uri
`https://empireofbits.xyz`, icon `favicon.ico` (resolves after the apex's
redirect to `www`). Wallets may verify the app against
`https://empireofbits.xyz/.well-known/assetlinks.json` — **currently 404** —
which must list package `com.empireofbits.seabattle` and the release
certificate's SHA-256, served at that exact host without a redirect.

**Network (mainnet only)**: `EXPO_PUBLIC_SOLANA_CLUSTER=mainnet` (or
`mainnet-beta`; both normalise to `mainnet-beta` — anything unrecognised falls
back to devnet, and the app then refuses to pay a mainnet order).
`EXPO_PUBLIC_SOLANA_APP_RPC_URL` and the server's `SOLANA_RPC_URL` must both be
mainnet endpoints; the server reports its network from the genesis hash.
Explorer links carry no `?cluster=` on mainnet.
On 2026-10-10 the app's `EXPO_PUBLIC_SOLANA_APP_RPC_URL` in `.env.local` was the
same Helius URL and key as the server's `SOLANA_RPC_URL`, so that key ships in
the APK (it did in the 2026-10-06 build too). `npm run check:bundle` does not
see it because it reads only the app's env files. Give the app its own
restricted key (or leave it unset for the public endpoint), and rotate the
server's key.

**Treasury**: unchanged — `TREASURY_PUBLIC_KEY`, `TREASURY_PRIVATE_KEY`,
`SELL_POINTS_COST=100`, `SELL_SOL_PAYOUT=0.001`, server-side only. Keep
`TREASURY_PRIVATE_KEY` out of the app's `.env.local` (only `EXPO_PUBLIC_*` is
bundled, but the app has no use for it).

## Deploy order

1. Apply the migrations through `supabase/migrations/0018_payment_wallets.sql`
   (non-destructive; 0018 backfills every existing embedded and external Solana
   wallet so no account's payments stop). Verify offline first:
   `node supabase/verify-offline.mjs`.
2. Deploy the server; its `/ready` probe checks for 0018. On 2026-10-10 the
   deployed `/ready` still checked for `settle_offline_wager` (removed from the
   probe by the BUG-001 fix), so production runs a server older than this
   branch and reported `supabase_schema` failing.
3. Ship the app. An app ahead of the server stays safe: without orders it
   refuses external purchases with nothing charged.

## Android builds and signing

The MWA package is a native module: the development client and any APK must be
rebuilt after installing it (an older dev client says the wallet connector is
missing instead of crashing).

```bash
npx expo run:android                 # rebuild and install the dev client
npm start -- --dev-client            # Metro
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a   # release APK
```

Run `CI=1 npx expo prebuild --platform android --no-install` first if
`app.json` changed. iOS builds never include the package.

`android/app/build.gradle` signs release builds with the **public Android
debug key** (`android/app/debug.keystore`, SHA-256 `FA:C6:17:45:…:3B:9C`). That
APK updates the 2026-10-06 sideloaded build in place, but it is a development
build: anyone can sign with that key, and the Solana dApp Store requires the
app's own key. To move to a private release key **without** breaking in-place
updates, rotate with an APK Signature Scheme v3 lineage (Android 9+):

```bash
keytool -genkeypair -v -keystore ~/secure/empire-of-bits-release.jks -alias empireofbits -keyalg RSA -keysize 4096 -validity 10000
apksigner rotate --out ~/secure/eob-rotation.lineage \
  --old-signer --ks android/app/debug.keystore --ks-key-alias androiddebugkey --ks-pass pass:android \
  --new-signer --ks ~/secure/empire-of-bits-release.jks --ks-key-alias empireofbits
apksigner sign --ks android/app/debug.keystore --ks-key-alias androiddebugkey --ks-pass pass:android \
  --next-signer --ks ~/secure/empire-of-bits-release.jks --ks-key-alias empireofbits \
  --lineage ~/secure/eob-rotation.lineage --rotation-min-sdk-version 28 \
  --out dist/empire-of-bits-release.apk <unsigned-or-debug-signed>.apk
```

Back up the keystore and passwords; every later update needs them. EAS builds
use a different, EAS-managed key (the 2026-09-29 APK) and cannot update a
debug-signed install.

## Tests

- App (`npm test`): `tests/wallet/mwaCore.test.ts` (signature formats, error
  shapes, login/link/decline/cancel, busy lock, backstop timeout, account and
  chain mismatch, stale-token retry, sign-out mid-request, cache scoping and
  expiry, disconnect), `tests/auth/walletAuth.test.ts`,
  `tests/auth/privyUser.test.ts` (unlink guard), `tests/points/purchase.test.ts`
  (external signer, no embedded fallback, quote mismatch, may-have-sent
  recovery, dead-signature recovery), `tests/points/transfer.test.ts`,
  `tests/points/confirmations.test.ts`, `tests/wallet/paymentWallets.test.ts`,
  `tests/tooling/mwa-imports.test.ts` (iOS startup safety), plus
  `tests/points/history.test.ts` and `tests/net/points.test.ts`.
- Server (`cd server && npm test`): `points.payment-wallet.test.ts`,
  `wallet-routes.test.ts`, `privy.verify.test.ts`.
- Database: `node supabase/verify-offline.mjs`; opt-in
  `supabase/verify-concurrency.sh` (real PostgreSQL races; 18/18 on 2026-10-10).

## Device test plan (Seeker, mainnet — needs explicit approval for each paid step)

No step below has been run. Steps 5 and 7 move real SOL.

1. Install the APK over the existing build (same key; no uninstall).
2. Signed out: Google, email and **Connect Solana wallet** all present. Tap the
   wallet button → the wallet shows "Empire of Bits" → approve → sign the
   message. Expect the menu after the account sync. Repeat with cancel and with
   decline: an error line, still signed out.
3. Google account: Profile → Manage → **Link Solana wallet** → approve and
   sign. Expect it listed as verified. Try a wallet already used by another
   account: expect the conflict message, nothing changed.
4. **Use to pay** on the linked wallet; the desk shows "External wallet
   xxxx…xxxx" and its SOL balance.
5. **Buy (paid)**: 0.001 SOL (1,000,000 lamports) from the chosen wallet to
   treasury `HfYqSJrCeWwzKU2JMboEb7dPmQhT23Trqat1ch4ZwiUd` on mainnet-beta,
   plus the network fee the details dialog and the wallet show (the base fee is
   5,000 lamports per signature; the wallet may add a priority fee). Expect 100
   points after confirmation and a "Credited" history row.
6. Interrupt a purchase (close the wallet after approving): "Finish credit"
   must find it without a second payment.
7. **Sell (treasury payout)**: 100 bought points → 1,000,000 lamports from the
   treasury to the selected wallet; the treasury pays the fee.
8. Disconnect, Unlink (refused while it pays / is the only login), sign out
   (the next purchase asks the wallet to connect again).

# Net Worth Tracker

A personal net-worth dashboard. Tracks cash, bank, stocks, crypto and other
assets in any currency, normalises everything to one base currency with live FX
rates, and charts net worth over time, allocation and per-category trends. Also
has transactions, spending, a privacy "bare mode" and optional Freedom24
brokerage sync.

Next.js 16 · React 19 · Tailwind v4 · Recharts · Zustand · Supabase.

## What it does

- **One number for everything you own.** Cash, bank, brokerage, crypto and
  anything else, each in its own currency, converted with live FX.
- **Syncs on its own.** Revolut through Open Banking, Freedom24 positions through
  the broker API, and watch-only wallets read straight from public chain RPCs on
  Bitcoin, Solana and eight EVM chains. No keys that can move money.
- **Card statements.** Drop the PDF a card app exports and it becomes a ledger.
- **Spending.** Imported transactions are categorised by merchant rules you can
  extend, with hand edits always winning.
- **Wallet map.** A force-directed map of who your wallets paid and got paid by,
  with address-poisoning lookalikes flagged.
- **Private by default.** A passkey login, a one-tap "bare mode" that hides
  every figure, and several skins for the same data.

## Single-user by design: run your own copy

There is **no multi-user support**. One deployment holds exactly one person's
finances in one Supabase row, behind one owner login (passkeys plus a
password). Do not point two people at the same deployment, because they would both
read and write the same data.

To use it, deploy your own instance with your own Supabase project. Your data
never touches anyone else's. It lives only in your database, and only you have
the login. No financial figures are stored in this repository.

## Setup

### 1. Supabase (your own project)

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run [`supabase/setup.sql`](supabase/setup.sql).
   It creates the two tables the app needs (`app_state`, `networth_snapshots`)
   and locks both down with row-level security.
   - The daily-snapshot cron at the bottom of that file is **optional**. If you
     want it, deploy the Edge Function first (`supabase functions deploy
     daily-snapshot`), then replace `<PROJECT_REF>` and `<SERVICE_ROLE_KEY>` and
     run that block. Without it, snapshots are recorded while the app is open.
3. Copy your project URL and `service_role` key from Settings → API.

### 2. Configure

```bash
cp .env.example .env.local
```

Fill in at minimum `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USER`,
`ADMIN_PASSWORD` and `AUTH_SECRET` (`openssl rand -base64 48`). Every variable
is documented in `.env.example`. Without the three login variables the app
fails closed, and every route answers 401.

If the Supabase variables are missing, `/api/state` and `/api/snapshots`
return 502; the build itself no longer needs them.

### 3. Run

```bash
npm install
npm run dev      # http://localhost:3000
```

### 4. Deploy

Any Next.js host works; Vercel is the easy path. Import the repo, then add the
same environment variables under Settings → Environment Variables for both
Production and Preview. Redeploy after adding them.

## Connections

- **Freedom24** (broker): server-side API keys, see `.env.example`.
- **Crypto wallets** (Assets page): paste a watch-only address on Bitcoin,
  Ethereum, Base, Arbitrum, Polygon or Solana. The server reads the native
  coin plus USDC/USDT on the EVM chains from public RPCs, prices them via
  CoinGecko, and the result shows under Crypto. No keys, nothing can move money.
- **Revolut** (Assets page): Open Banking through Enable Banking. Set the three
  `ENABLE_BANKING_*` / `APP_URL` variables, then press *Connect Revolut* and
  approve read access in the Revolut app. Every currency pocket becomes a bank
  asset and every movement a transaction (uncategorized, replaced on each sync).
  The bank is asked at most every 4 hours; consent lasts 90 days.

## Security notes

- **Login.** `/login` signs the owner in with a passkey (Touch ID / Face ID)
  or, as the fallback, `ADMIN_USER` / `ADMIN_PASSWORD`. Either one sets a
  30-day signed, httpOnly session cookie (`lib/auth.ts`, keyed by
  `AUTH_SECRET`). After a password sign-in the page offers to add a passkey
  for that device; visit `/login` while signed in to list, add or remove
  passkeys, or sign out. Passkeys are bound to the host they were made on, so
  preview URLs and localhost use the password.
- **Two layers.** `proxy.ts` (Next 16's name for middleware) sends signed-out
  browsers to `/login` and answers 401 on `/api/*`. Every API route also calls
  `requireSession()` itself, because the proxy is a redirect layer, not the
  security boundary. Open without a session: `/login`, `/api/auth/*`, and
  `/api/cron/*` (it checks `CRON_SECRET` itself).
- Ten wrong passwords in 15 minutes shut password sign-in for the rest of that
  window. Passkeys keep working.
- `DELETE /api/state` is refused even when signed in; the app never needs it.
- The Supabase `service_role` key never reaches the browser. All database access
  goes through server-side API routes.
- Both tables have RLS enabled with no policies, so the anon key cannot read them
  even if it leaks.
- `NEXT_PUBLIC_*` variables are compiled into the client bundle. Never put a
  secret in one.
- Freedom24 keys are per-deployment and server-side. Use your own: whoever's
  keys are configured is whose portfolio gets synced.
- The mobile fingerprint lock (`LockGate`) is a device-level convenience, not a
  server-side check. The `/login` session is the real gate.

## Commands

```bash
npm run dev      # dev server
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint
```

npm only. There is no test runner configured.

## Architecture

- **State.** The whole app state is one JSON row in Supabase (`app_state`) behind
  `/api/state`, cached in localStorage. Writes carry a state version, so a tab
  running an older build cannot overwrite a newer save.
- **Money.** Every asset keeps its own currency and is converted to the base
  currency with live FX (proxied through `/api/fx`).
- **History.** One snapshot per calendar day (`networth_snapshots`), written by
  the open app or by the nightly cron.

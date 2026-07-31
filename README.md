# Physique Coach

## Run locally
```
npm install
npm run dev
```

## One-time setup

### 1. Supabase (accounts + database)
1. Create a free project at supabase.com.
2. Go to the SQL Editor and run everything in `supabase-schema.sql` (creates the `profiles` and `app_state` tables with proper access rules).
3. Go to Project Settings → API. Copy the Project URL and the `anon` `public` key (→ `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) and the `service_role` key (→ `SUPABASE_SERVICE_ROLE_KEY`, keep this one secret, server-side only).
4. (Optional) Settings → Authentication → Providers → Email: turn "Confirm email" off if you want people to get in instantly instead of confirming via email first.

### 2. Stripe (subscriptions)
1. Create a Stripe account, and a Product with a recurring monthly Price (Products → Add Product). Copy the Price ID (→ `STRIPE_PRICE_ID`).
2. Get your secret key from Developers → API keys (→ `STRIPE_SECRET_KEY`). Use the test key while testing.
3. Once deployed (step below), go to Developers → Webhooks → Add endpoint, URL = `https://your-deployed-url/api/stripe-webhook`, and select these events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret (→ `STRIPE_WEBHOOK_SECRET`).

### 3. Anthropic (AI features)
Get a key from console.anthropic.com/settings/keys (→ `ANTHROPIC_API_KEY`). Billed separately from any claude.ai subscription.

## Deploy (Vercel)
1. Push this folder to a GitHub repo.
2. vercel.com → New Project → import the repo (Vite auto-detected).
3. Add every environment variable listed in `.env.example` (Project Settings → Environment Variables).
4. Deploy. Then go back into Stripe's webhook setup (step 2.3 above) using your live Vercel URL, and re-add the `STRIPE_WEBHOOK_SECRET` env var in Vercel if it changed.

## How it fits together
- Accounts and all app data (program, logs, coach chat) live in Supabase — real, cross-device, and you can see every signup in the Supabase Table Editor.
- New users hit a paywall screen until `profiles.subscribed = true`. Stripe Checkout + the `/api/stripe-webhook` function flip that flag automatically when payment succeeds, and flip it back off if they cancel.
- The AI Coach, meal suggestions, and photo analysis call `/api/claude`, which holds your Anthropic key server-side.

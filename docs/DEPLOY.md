# Deploying Quorum

Quorum is a single Node process: Express serves the API, the WebSocket, and the built client on
one port (`PORT`, default `5001`). It needs PostgreSQL and an OpenRouter key.

## 1. Replit (Reserved VM or Autoscale)

The repository ships `.replit` with the build and run commands pre-wired.

1. **Create the Repl** from the GitHub repo (`0-CYBERDYNE-SYSTEMS-0/quorum`). Choose **Node.js**
   and a **Reserved VM** (recommended) or **Autoscale**. Node 24 is required; select it in the
   Repl's language/module picker so the `nodejs-24` module resolves.
2. **Add a database.** In Tools → Database, create PostgreSQL. Replit injects `DATABASE_URL`.
   Autoscale needs a database that accepts the platform's network; Replit's managed Postgres does.
3. **Set secrets** (Tools → Secrets). Required:
   - `SESSION_SECRET` — `openssl rand -hex 32`
   - `OPENROUTER_API_KEY` — house key used by directors
   - `ENCRYPTION_KEY` — `openssl rand -base64 32` (encrypts BYOK keys at rest)
   Optional:
   - `DEFAULT_AUX_MODEL` (must be a paid slug on paid tiers), `OPENROUTER_REASONING_EFFORT`
   - `OPENROUTER_PROVIDER_IGNORE` (comma-separated; defaults to `Relace`)
   - `PRO_MONTHLY_AI_BUDGET_USD` (default 8), `BOARDROOM_MONTHLY_AI_BUDGET_USD` (default 35)
   - Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_PRO_ANNUAL`,
     `STRIPE_PRICE_ID_BOARDROOM`, `STRIPE_PRICE_ID_BOARDROOM_ANNUAL`,
     `STRIPE_PRICE_ID_SESSION_FAST`, `STRIPE_PRICE_ID_SESSION_BOARDROOM`,
     `STRIPE_WEBHOOK_SECRET`
   - `PERPLEXITY_API_KEY`
   AI budgets are graceful and paid-only above zero: once a paid tier's monthly
   budget is spent, directors continue on the paid fallback model
   (`deepseek/deepseek-v4.1-flash`, then `openai/gpt-6-luna`) up to 25% over
   budget, then calls stop until the 1st with the `ai_budget_exhausted`
   message. Paying customers are never downgraded to a `:free` model, and
   `$5/$15` session credits run their helper calls on `z-ai/glm-5.3-flash`
   (fallback `openai/gpt-6-luna`).
4. **Deploy.** The deployment run command is:
   ```
   node scripts/migrate.mjs && npm start
   ```
   The migration script creates the schema on a fresh database and applies only pending
   migrations on later boots. It needs only production dependencies.
   The first deploy takes ~3 minutes (npm ci + Vite build).
5. **Smoke test** (all must pass):
   - `GET /api/health` → `{"status":"ok","database":"ok"}`
   - Landing page renders (no auth) and `/auth` accepts a registration.
   - Create a session, seat 3 directors, send a decision — tokens stream and a director finishes.
   - Open the Decision record: stances appear, export transcript downloads.

### Notes

- The Repl uses port `5001` externally mapped to 80. If your deployment target insists on `3000`,
  set `PORT=3000` in Secrets and change the port mapping — the app reads `PORT`.
- Autoscale sleeps. Paused sessions survive because orchestrator snapshots are in Postgres; an
  in-flight stream does not.
- Never deploy with `DATABASE_URL` empty: the app falls back to in-memory storage and loses
  everything on restart.

## 2. Docker Compose (self-hosted)

```bash
cp .env.production.example .env.production   # POSTGRES_* + app secrets
docker compose up -d --build
# The app container applies the schema on boot; to run it manually:
docker compose exec app node scripts/migrate.mjs
```

The compose file starts Postgres 16, the app, and an optional Ollama profile. Set
`DATABASE_URL` in `.env.production`; compose rewrites it to the internal `db` hostname.

Health check: `curl http://localhost:5001/api/health`.

## 3. Any Node host (Fly, Render, Railway, a VPS)

```bash
npm ci
npm run build          # Vite client + esbuild server bundle → dist/
node scripts/migrate.mjs   # creates the schema or applies pending migrations
NODE_ENV=production node dist/index.js
```

Behind a reverse proxy, forward WebSocket upgrades on `/ws`. The client reconnects automatically
and replays the session state, but deliberating turns need a stable connection.

## Custom domain (two hosts, one deployment)

The same deployment can answer on the Replit host and on a custom domain.

1. Add the domain in Replit (or your reverse proxy / Node host) and point DNS at it. TLS is
   terminated by the platform; the app trusts one proxy hop (`trust proxy`).
2. Set `ALLOWED_ORIGIN` to a **comma-separated list** with every public origin, no trailing
   slashes:
   ```
   ALLOWED_ORIGIN=https://quorum.desmond-digital.com,https://quorum-scrimwiggins.replit.app
   ```
   The first entry is the fallback for Stripe return URLs when a request carries no Origin.
3. CORS accepts requests from either origin (and same-origin/no-Origin requests). The session
   cookie is host-only (`SameSite=Lax`, no `Domain` attribute), so signing in on one host does not
   leak the cookie to the other; sign in on each host you use.
4. Checkout success/cancel URLs are derived from the request origin only when it is in
   `ALLOWED_ORIGIN`. An unknown origin falls back to the first allowed origin, so an attacker
   cannot redirect a Stripe return to their own site.
5. Smoke test both hosts: `/api/health`, register, open a session, and start a checkout (the
   Stripe return must land on the host you started from).

## Stripe (optional)

Billing fails closed: with no price IDs, accounts remain on Associate and only the affected
checkout option returns the readable "billing is not configured" message.

### Prices to create

Create one product per plan (or one product with several prices) in Stripe:

| Option | Amount | Env var |
|---|---|---|
| Pro monthly | $29 / month recurring | `STRIPE_PRICE_ID_PRO` |
| Pro yearly | $290 / year recurring | `STRIPE_PRICE_ID_PRO_ANNUAL` |
| Boardroom monthly | $99 / month recurring | `STRIPE_PRICE_ID_BOARDROOM` |
| Boardroom yearly | $990 / year recurring | `STRIPE_PRICE_ID_BOARDROOM_ANNUAL` |
| Single Session | $5 one-time | `STRIPE_PRICE_ID_SESSION_FAST` |
| Boardroom Session | $15 one-time | `STRIPE_PRICE_ID_SESSION_BOARDROOM` |

Display amounts live in `shared/pricing.ts` (one module, for A/B tests later). Stripe ids are
never hardcoded — only read from these env vars.

### Webhook

Add `https://<host>/api/webhook` and subscribe to:

- `checkout.session.completed` — sets the plan from metadata, or grants one session credit
  (idempotent on the Checkout Session id)
- `customer.subscription.updated` — maps the price id back to Pro/Boardroom; `past_due` keeps the
  plan while Stripe retries, `canceled`/`unpaid`/`incomplete_expired` downgrade to Free
- `customer.subscription.deleted` — downgrades to Free
- `invoice.payment_succeeded` — keeps the plan active
- `invoice.payment_failed` — marks the subscription `past_due`

Put the signing secret in `STRIPE_WEBHOOK_SECRET`.

### Plan changes and the customer portal

- An active subscriber who chooses the other plan is switched in place
  (`subscriptions.update` with proration). No second Checkout session is created, so a user can
  never hold two live subscriptions.
- `POST /api/billing-portal` opens Stripe's customer portal (cards, invoices, cancellation).
  Enable the portal in the Stripe Dashboard → Settings → Billing → Customer portal; the default
  configuration is enough.

### Migration

`migrations/20261103_001_pricing_session_credits.sql` adds the `session_credits` table and
`conversations.session_credit_id`. It is additive and idempotent; run it with
`node scripts/migrate.mjs` before deploying the new build.

## Release checklist

- [ ] `npm run check` clean
- [ ] `npm test` green
- [ ] `npm run build` succeeds
- [ ] `/api/health` reports `database: ok`
- [ ] A real deliberation streams, records stances, and closes with a memo
- [ ] Transcript export downloads
- [ ] No `.env` or uploads in git history

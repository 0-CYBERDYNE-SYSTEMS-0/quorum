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
   - `DEFAULT_AUX_MODEL`, `OPENROUTER_REASONING_EFFORT`
   - `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_PRO_ANNUAL`, `STRIPE_WEBHOOK_SECRET`
   - `PERPLEXITY_API_KEY`
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

## Stripe (optional)

Billing fails closed: with no price IDs, accounts remain on Associate and checkout returns a
readable "billing is not configured" message.

To enable Executive:

1. Create two recurring prices on the same product: $10/month and $96/year.
2. Put their IDs in `STRIPE_PRICE_ID_PRO` and `STRIPE_PRICE_ID_PRO_ANNUAL`.
3. Add the webhook endpoint `https://<host>/api/webhook` for
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.

## Release checklist

- [ ] `npm run check` clean
- [ ] `npm test` green
- [ ] `npm run build` succeeds
- [ ] `/api/health` reports `database: ok`
- [ ] A real deliberation streams, records stances, and closes with a memo
- [ ] Transcript export downloads
- [ ] No `.env` or uploads in git history

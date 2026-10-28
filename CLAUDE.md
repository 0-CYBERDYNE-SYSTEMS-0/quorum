# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                          # tsx server/index.ts; Express + Vite middleware on :5001
npm run check                        # tsc (strict) — CI runs `tsc --noEmit`
npm test                             # vitest run (all tests)
npx vitest run tests/orchestrator.test.ts          # one file
npx vitest run -t "partial test name"              # one test by name
npm run build                        # vite build (client) + esbuild bundle of server -> dist/
npm start                            # serve dist/ (loads .env)
npm run db:init                      # scripts/migrate.mjs: baseline on fresh DB, else pending migrations
```

`npm run check`, `npm test`, and `npm run build` must all pass before a PR. Tests force `DATABASE_URL=""` (see `vitest.config.ts`), so they run against in-memory storage and need no Postgres. Requires Node 24+, PostgreSQL 14+ for real runs. There is no ESLint config (CI lint step skips).

In dev, `/auth` offers a seeded `developer` sign-in, gated by `NODE_ENV !== "production"`. CI fails if `DEVELOPMENT_MODE = true` is hardcoded in `server/` or `client/src/`.

## Architecture

Quorum is an "AI boardroom": a Chair (the user) convenes AI directors who deliberate on a decision in rounds and produce a decision memo. It is a rebuild of `ff-roundtable`; `docs/SPEC.md` and `docs/DESIGN.md` are the product/visual references.

- `server/orchestrator.ts` (largest file) — per-session state machine: picks the next speaker from the state of the argument (not round-robin), pause/resume, autonomous bounded runs, `@[Role]` directing, snapshots of paused sessions to storage so they survive restarts. `turn-fairness.ts`, `response-hygiene.ts`, `text-similarity.ts` support it (fairness, output cleanup, near-duplicate detection).
- `server/ai.ts` — prompts, streaming, stance parsing (agree/conditional/disagree/abstain + confidence), closing memo synthesis. `ai-providers.ts` handles provider/model routing (OpenRouter house key, user-supplied keys, optional local OpenAI-compatible endpoint, aux-model fallback by tier).
- `server/expert-tools.ts` — text-protocol research tools plus deliverable parsing, versioning, and ownership. `artifact-*.ts` extract charts/tables (Vega) from model output.
- `server/routes.ts` — REST, Stripe webhooks, and the authenticated WebSocket. `tiers.ts` / `usage-caps.ts` / `billing-errors.ts` implement Associate vs Executive limits; without Stripe config everyone stays Associate and billing fails closed.
- `server/storage.ts` — `IStorage` with `MemStorage` and `PostgresStorage`.
- `shared/` — Drizzle schema (`schema.ts`), the board/seat catalog and default model slugs (`expert-catalog.ts`), mentions, chart artifacts, and other pure helpers used by both sides (aliases: `@shared`, `@`→`client/src`).
- `client/` — React 18 + Vite + Tailwind, wouter, TanStack Query. `hooks/use-board-room.ts` owns the WebSocket subscription.

Data flow: the client subscribes to one session over a WebSocket; tokens stream into a transient map, completed turns land in the query cache, and the server owns all state and replays it on reconnect.

Schema changes: add a timestamped `migrations/*.sql` plus matching `.down.sql`; `000_baseline.sql` is the full current schema for fresh DBs (`migrate.mjs` records existing migrations as applied after baseline, so keep it in sync).

## Conventions that aren't obvious

- **Server owns state.** Don't add optimistic client state the server can't replay on reconnect.
- **Storage parity.** Every `IStorage` method must be implemented in both `MemStorage` and `PostgresStorage`; tests only exercise memory, so Postgres can silently drift.
- **Naming.** User-visible copy says "Chair" and "directors". Legacy internal names (`farmerJustSpoke`, `farmerText`) remain — don't rename them in feature work.
- **No new UI libraries.** Use primitives in `client/src/components/design.tsx` and tokens in `client/src/index.css`.
- **Model slugs** live only in `shared/expert-catalog.ts`; defaults are free OpenRouter slugs that retire without notice (a mid-session 404 is the usual symptom). Verify a new default actually streams.
- **Honesty over polish.** Never invent numbers in prompts, examples, or docs; charts must use only numbers supplied or retrieved in-session.
- Commit style: `feat(scope): …`, `fix(scope): …`, `docs: …`, `ui(scope): …`; imperative, under 72 chars.

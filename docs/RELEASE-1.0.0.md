# Quorum 1.0.0

The first public release of Quorum — an AI boardroom for consequential business decisions.

## What's in it

- **A board, not a chatbot.** Fourteen functional director seats (CFO, CSO, CMO, CRO, COO, CTO,
  GC, Risk, People, Data, Research, CorpDev, Customer, Chief of Staff), each with a standing brief,
  handoffs, and a professional boundary. Four presets: Growth, Capital, Operating, Full.
- **Deliberation with a record.** Rounds routed from the state of the argument, named cross-talk,
  a stance and confidence for every director, and a decision memo that separates the decision from
  the dissent.
- **Chair controls.** Pause, resume, direct a seat with `@[Role]`, answer open questions, bound the
  turn budget, or call the question and close with the memo.
- **Company context.** Stage, headcount, revenue band, model, markets, constraints, and risk
  appetite are injected into every director prompt.
- **Artifacts and deliverables.** Charts (Vega-Lite, inline data only), tables, and versioned
  deliverables produced by the Chief of Staff.
- **A real interface.** Warm paper/ink/bronze design system, editorial serif, hairline UI, dark
  mode, command palette, mobile layout, and a marketing site.
- **Deployable.** Baseline schema with an idempotent migration runner, Docker + Compose, Replit
  config, Render blueprint, GHCR image workflow, and CI.

## Verification

- `npm run check` — strict TypeScript, clean
- `npm test` — 703 tests across 39 files
- `npm run build` — client and server bundles
- CI (typecheck, lint, test, build, security check) green on `main`
- Docker image built and pushed by the Deploy workflow
- Local production smoke test: `/api/health` reports `{"status":"ok","database":"ok"}`; a real
  four-director session streamed stances and produced a decision memo; transcript export worked.

## Quick start

```bash
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/quorum.git
cd quorum && npm install
cp .env.example .env    # DATABASE_URL, SESSION_SECRET, OPENROUTER_API_KEY
createdb quorum_dev && npm run db:init
npm run dev             # http://localhost:5001
```

## Known limits

- Directors give advice, not legal, tax, or investment fact.
- Default free model slugs can retire upstream; they are verified at release time.
- Billing is optional and fails closed without Stripe price IDs.
- Replit deployment requires an authenticated Replit account; the repo ships the config, not access.

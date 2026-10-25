# Contributing

Quorum is a small, opinionated codebase. Read `docs/SPEC.md` and `docs/DESIGN.md` before changing
product behavior or visuals.

## Setup

```bash
npm install
cp .env.example .env
createdb quorum_dev
npm run db:init
npm run dev
```

Requirements: Node 24+, PostgreSQL 14+.

## Before you open a PR

```bash
npm run check     # tsc, strict
npm test          # vitest; no database required
npm run build     # client + server bundle
```

All three must pass. CI runs the same commands on Node 24.

## Conventions

- **Server owns state.** The client renders what the server broadcasts; do not add optimistic
  state that the server cannot replay on reconnect.
- **Storage parity.** Every `IStorage` method is implemented in both `MemStorage` and
  `PostgresStorage`. Tests run against memory.
- **User-visible copy** calls the operator "Chair" and the AI participants "directors". The
  codebase retains legacy internal names (`farmerJustSpoke`, `farmerText`) — do not rename them in
  a feature PR.
- **No new UI libraries.** Use the primitives in `client/src/components/design.tsx` and the tokens
  in `client/src/index.css`.
- **Model slugs** live in `shared/expert-catalog.ts`. Verify a new default streams before shipping
  it (free slugs retire without notice).
- **Honesty over polish.** Never invent numbers in prompts, examples, or docs, and never claim a
  verification you did not run.

## Commit style

`feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `ui(scope): ...`. Keep the subject imperative
and under 72 characters. Describe user-visible behavior in the body when it changes.

## Security

See `SECURITY.md`. Do not open public issues for vulnerabilities.

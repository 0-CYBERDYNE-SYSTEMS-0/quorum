# Quorum — Product Spec (business edition)

Quorum is an AI boardroom for consequential business decisions. The operator (the **Chair**)
convenes a small board of AI directors, states a decision, and the board deliberates in
structured rounds — each director argues from their function, agrees/disagrees with a stated
confidence, and the session closes with a written **decision memo**.

Lineage: a ground-up business rebuild of `ff-roundtable` (FarmFriend Roundtable). Same proven
engine (streaming deliberation, turn fairness, artifacts, deliverables, open questions),
new domain, new information architecture, new design system, and a marketing surface.

## Audience

Operators and leadership teams at 10–500 person companies: founders, CEOs, CFOs, heads of
function. They already use ChatGPT/Claude for one-shot answers and want a *deliberation*
with functional tension, a record, and artifacts they can circulate.

## Product principles

1. **Decision first.** Every session starts from a decision question, not a chat prompt.
2. **Disagreement is the product.** Directors must state stance + confidence; the board
   surfaces dissent, not consensus theater.
3. **A record, not a transcript.** The right rail holds the decision record: position,
   dissent, risks, open questions, artifacts.
4. **Enterprise restraint.** No confetti, no gamification, no chat-bubble toy. Legal-pad
   typography, hairline rule, quiet motion.
5. **Honest about limits.** Advisors are advice, not legal/financial fact. Cite or say so.

## Core objects

- **Company profile** (per user): companyName, industry, stage (pre-seed…public/PE),
  headcount band, revenue band, businessModel, markets[], constraints, riskAppetite.
  Injected into every director prompt.
- **Board session** (conversation): title, charter (decision question + guardrails, ≤2000 chars),
  turnBudget, orchestrator state.
- **Director** (expert): a seat on the board — role, name, model, custom instructions, avatar.
- **Minute** (message): chair brief or director contribution, with stance, mentions, artifacts.
- **Deliverable** (file): memo, action plan, risk register, 30-60-90, model table.
- **Open question**: a fact only the Chair can supply; answerable later.

## Board roles (catalog)

See `shared/expert-catalog.ts`. Categories: Strategy, Finance, Growth, Operations,
Legal & Risk, People, Research, Support. Default recommended board: Chief Strategy Officer,
CFO, CMO, General Counsel, Chief of Staff.

Presets (client-side): Growth Board, Capital Board, Operating Board, Full Board.

## Tiers

- Associate (free): 3 seats, 40 chair briefs/mo, house models.
- Executive (pro): 8 seats, 600 briefs/mo, bring-your-own OpenRouter key.
- Enterprise: unlimited seats, SSO/audit, self-host or dedicated.

Internal tier keys stay `free | pro | enterprise`.

## API contract (frozen for the client)

- `GET/PUT /api/protected/company-profile` → `{ profile: CompanyProfile | null }`
- `GET /api/protected/company-profile` also returns `{ profile }` only (no weather).
- Conversations/experts/messages/open-questions/insights/files endpoints unchanged.
- Deliverables endpoints unchanged.
- Chat question line prefix: `Board question:` (replaces `Farmer question:`).

## Non-goals (v1)

Calendar/ICS scheduling, weather, farm operations, mobile native app, voice.

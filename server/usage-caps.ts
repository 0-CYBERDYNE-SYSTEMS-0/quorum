/**
 * Plan caps for pricing v1: Pro $29/mo ($290/yr, $8 AI budget) and Boardroom
 * $99/mo ($990/yr, $35 AI budget), plus one-time session credits.
 *
 * Definitions:
 * - A "message" is ONE Chair (user) message stored in a conversation,
 *   including answers to open questions and explicit /restart topics.
 *   Expert replies, tool-planning calls, insights and autonomous turns do
 *   NOT count as messages. Limits reset each UTC calendar month — except on
 *   a one-time session credit, whose 25-chair-message cap belongs to that
 *   single conversation and never resets.
 * - "AI spend" is the OpenRouter-reported cost (usage.cost) of calls made
 *   with the house OPENROUTER_API_KEY. Calls made with the user's own
 *   (BYOK) key never count and are never blocked by budget or allowlist.
 */
import { getTierLimits, sessionCreditLimits, type SessionCreditLimits } from "./tiers";
import type { SessionKind } from "@shared/pricing";
import {
  HOUSE_KEY_PAID_MODEL_ALLOWLIST,
  BOARDROOM_FRONTIER_MODEL_ALLOWLIST,
  MODEL_LABELS as FRONTIER_MODEL_LABELS_MAP,
  isFastHouseKeyModel,
  isFrontierModel,
  isHouseKeyAllowedModel as sharedIsHouseKeyAllowedModel,
  houseKeyModelsForTier,
} from "@shared/models";

// Re-exported so existing server imports (and tests) keep working while the
// canonical catalog lives in shared/models.ts for the client too.
export { HOUSE_KEY_PAID_MODEL_ALLOWLIST, BOARDROOM_FRONTIER_MODEL_ALLOWLIST, isFastHouseKeyModel, isFrontierModel, houseKeyModelsForTier };

/** Display labels for the client's model picker (frontier subset kept for compatibility). */
export const FRONTIER_MODEL_LABELS: Record<string, string> = Object.fromEntries(
  BOARDROOM_FRONTIER_MODEL_ALLOWLIST.map((slug) => [slug, FRONTIER_MODEL_LABELS_MAP[slug] ?? slug]),
);

/**
 * Output cap for ordinary expert replies. Reasoning tokens count against this
 * same budget, and mandatory-reasoning models (z-ai/glm-5.3-flash) spend a
 * large share of it before writing. 1200 produced finish_reason=length with
 * empty or truncated answers in the 2026-11-02 live run; 8192 leaves room for
 * both reasoning and a full reply.
 */
export const EXPERT_REPLY_MAX_TOKENS = 8192;
/** Output cap for the Moderator's closing decision memo (seven short sections). */
export const CLOSING_MEMO_MAX_TOKENS = 8192;

/**
 * Default model for the pre-answer tool-planning call on paid tiers. The
 * previous code default was a free preview model that could spend its whole
 * budget on hidden reasoning and end with "Response reached the output limit."
 * This small paid slug is stable and allowlisted.
 */
export const DEFAULT_AUX_MODEL_SLUG = "z-ai/glm-5.3-flash";
/** Second paid aux choice when the default aux model fails. */
export const DEFAULT_AUX_MODEL_FALLBACK_SLUG = "openai/gpt-6-luna";

/**
 * Paid model experts use once a PAID tier's monthly AI budget is spent. Paying
 * customers never fall back to a ':free' model (owner rule, 2026-11-03): the
 * fallback is a small paid slug that is already in the fast allowlist.
 */
export const BUDGET_FALLBACK_MODEL = "deepseek/deepseek-v4.1-flash";
/** Paid second choice if the primary budget-fallback model fails. */
export const BUDGET_FALLBACK_MODEL_FALLBACK = "openai/gpt-6-luna";

/**
 * Free tier keeps its existing free budget model — pricing v1 behaviour is
 * unchanged, and no new ':free' slug is introduced.
 */
export const FREE_TIER_BUDGET_MODEL = "dots-studio/dots-3-note-preview:free";

/**
 * How far past the monthly AI budget a paid tier may keep running on the paid
 * fallback model before calls are refused. 25% of the tier budget.
 */
export const BUDGET_OVERAGE_RATIO = 0.25;

export const BUDGET_EXHAUSTED_NOTICE = "You've used this month's included AI budget. Experts continue on the included fallback model up to 25% over budget, then pause until the 1st (or add your own OpenRouter key).";

/** The model a tier falls back to when its budget is spent: paid for paid tiers. */
export function budgetFallbackModelForTier(tier: string | null | undefined): string {
  const t = tier || "free";
  return t === "pro" || t === "boardroom" || t === "enterprise"
    ? BUDGET_FALLBACK_MODEL
    : FREE_TIER_BUDGET_MODEL;
}

/** Hard ceiling on monthly AI spend: the tier budget plus the overage allowance. */
export function monthlyAiBudgetCeilingUsd(tier: string | null | undefined): number {
  const budget = monthlyAiBudgetUsd(tier);
  if (!Number.isFinite(budget)) return budget;
  return budget * (1 + BUDGET_OVERAGE_RATIO);
}

/** Tier-aware house-key allowlist check (canonical logic in shared/models.ts). */
export function isHouseKeyAllowedModel(model: string, tier?: string | null): boolean {
  return sharedIsHouseKeyAllowedModel(model, tier);
}

export function currentUsagePeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function envBudget(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  return raw?.trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Monthly house-key AI budget in USD by tier. Pro defaults to $8
 * (PRO_MONTHLY_AI_BUDGET_USD), Boardroom to $35
 * (BOARDROOM_MONTHLY_AI_BUDGET_USD). Free is $0 (free models only).
 */
export function monthlyAiBudgetUsd(tier: string | null | undefined): number {
  const t = tier || "free";
  if (t === "enterprise") return Number.POSITIVE_INFINITY;
  if (t === "boardroom") return envBudget("BOARDROOM_MONTHLY_AI_BUDGET_USD", 35);
  if (t === "pro") return envBudget("PRO_MONTHLY_AI_BUDGET_USD", 8);
  return 0;
}

export type CapDenial = { status: 402 | 429; code: string; message: string; upgradeUrl?: string };

/** Conversation context for a one-time session credit. */
export type CreditCapsContext = {
  kind: SessionKind;
  /** Chair messages already sent inside this credit conversation. */
  usedMessages?: number;
  /** House-key spend inside this credit conversation. */
  spentUsd?: number;
};

export function creditLimitsFor(kind: SessionKind): SessionCreditLimits {
  return sessionCreditLimits(kind);
}

export function checkMessageAllowance(
  tier: string | null | undefined,
  usedThisMonth: number,
  credit?: CreditCapsContext,
): CapDenial | null {
  if (credit) {
    const limits = creditLimitsFor(credit.kind);
    const used = credit.usedMessages ?? 0;
    if (used < limits.maxMessages) return null;
    return {
      status: 429,
      code: "session_credit_message_limit_reached",
      message: `This one-time session includes ${limits.maxMessages} chair briefs, and all ${limits.maxMessages} are used. Subscribe to Pro ($${getTierLimits("pro").monthlyUsd}/month) for ${getTierLimits("pro").maxMessages} briefs a month.`,
      upgradeUrl: "/subscribe",
    };
  }

  const limits = getTierLimits(tier || "free");
  if (usedThisMonth < limits.maxMessages) return null;
  const isFree = (tier || "free") === "free";
  return {
    status: isFree ? 402 : 429,
    code: "message_limit_reached",
    message: isFree
      ? `You've used all ${limits.maxMessages} messages on the Free plan this month. Upgrade to Pro ($${getTierLimits("pro").monthlyUsd}/month) for ${getTierLimits("pro").maxMessages} messages a month, or Boardroom ($${getTierLimits("boardroom").monthlyUsd}/month) for ${getTierLimits("boardroom").maxMessages}.`
      : `You've used all ${limits.maxMessages} ${limits.name} messages this month. Your limit resets on the 1st, or contact us about Enterprise.`,
    upgradeUrl: isFree ? "/subscribe" : undefined,
  };
}

export class UsageCapError extends Error {
  constructor(public readonly denial: CapDenial) {
    super(denial.message);
    this.name = "UsageCapError";
  }
}

/**
 * Decide whether a house-key call to `model` may run. BYOK calls skip this.
 * `credit` scopes the gate to a one-time session credit instead of a plan.
 */
export function checkHouseKeyCall(
  tier: string | null | undefined,
  model: string,
  spentUsd: number,
  credit?: CreditCapsContext,
): CapDenial | null {
  const t = tier || "free";
  if (model.endsWith(":free")) return null;
  if (t === "enterprise" && !credit) return null;

  const creditLimits = credit ? creditLimitsFor(credit.kind) : null;
  const allowPaid = creditLimits ? true : getTierLimits(t).allowPaidModels;
  const allowFrontier = creditLimits ? creditLimits.allowFrontierModels : getTierLimits(t).allowFrontierModels;

  if (!allowPaid) {
    return {
      status: 402,
      code: "paid_model_requires_pro",
      message: "Upgrade to Pro for paid models, or buy a Single Session for one roundtable.",
      upgradeUrl: "/subscribe",
    };
  }

  if (isFrontierModel(model) && !allowFrontier) {
    return {
      status: 402,
      code: "boardroom_model_required",
      message: `Boardroom model. Upgrade to Boardroom or buy a Boardroom Session to run ${model}.`,
      upgradeUrl: "/subscribe",
    };
  }

  if (!isHouseKeyAllowedModel(model, allowFrontier ? "boardroom" : t)) {
    const allowed = creditLimits
      ? [...HOUSE_KEY_PAID_MODEL_ALLOWLIST, ...(allowFrontier ? BOARDROOM_FRONTIER_MODEL_ALLOWLIST : [])]
      : houseKeyModelsForTier(t);
    return {
      status: 402,
      code: "model_requires_own_key",
      message: `${model} isn't included in ${creditLimits ? creditLimits.name : getTierLimits(t).name}. Pick an included model (${allowed.join(", ")}) or add your own OpenRouter key in Settings.`,
    };
  }

  // Budget exhaustion is graceful: callers fall back to the tier's fallback
  // model (see OpenRouterProvider.authorizeCall) instead of erroring, up to a
  // hard 25% overage ceiling for paid tiers. A one-time session credit has a
  // hard cap with no overage.
  if (creditLimits && credit) {
    const spent = credit.spentUsd ?? 0;
    if (spent >= creditLimits.aiCapUsd) {
      return {
        status: 429,
        code: "ai_budget_exhausted",
        message: `This one-time session's $${creditLimits.aiCapUsd} AI allowance is spent. Subscribe to Pro for a monthly AI budget, or add your own OpenRouter key.`,
        upgradeUrl: "/subscribe",
      };
    }
    return null;
  }

  const budget = monthlyAiBudgetUsd(t);
  const ceiling = monthlyAiBudgetCeilingUsd(t);
  if (spentUsd >= ceiling) {
    return {
      status: 429,
      code: "ai_budget_exhausted",
      message: "You've used this month's included AI budget. Switch experts to free models, add your own OpenRouter key, or wait for the reset on the 1st.",
    };
  }
  if (spentUsd >= budget) {
    // Graceful overage: keep answering on the tier's fallback model.
    return {
      status: 429,
      code: "ai_budget_overage",
      message: BUDGET_EXHAUSTED_NOTICE,
    };
  }
  return null;
}

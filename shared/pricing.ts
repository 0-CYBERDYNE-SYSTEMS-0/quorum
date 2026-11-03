/**
 * Pricing v1 — the ONE place display amounts live.
 *
 * Stripe price ids are never stored here: they come from the environment
 * (see server/routes.ts). This module only carries what the UI and the copy
 * strings show, so a future price test can change the numbers in one file
 * without touching checkout or the webhook.
 *
 * Server limits (server/tiers.ts) read the same plan table, so a displayed
 * expert/message cap can never drift from the enforced one.
 */

export type PlanKey = "free" | "pro" | "boardroom";
export type BillingInterval = "month" | "year";
export type SessionKind = "fast" | "boardroom";

export type PlanPricing = {
  /** Public plan name used in copy and checkout. */
  name: string;
  /** Short label for compact UI (tier chips, account menu). */
  shortName: string;
  monthlyUsd: number;
  annualUsd: number;
  maxExperts: number;
  maxMessages: number;
  /** Monthly house-key AI budget in USD. */
  aiBudgetUsd: number;
  tagline: string;
  features: readonly string[];
};

export const PLAN_PRICING: Record<PlanKey, PlanPricing> = {
  free: {
    name: "Associate",
    shortName: "Free",
    monthlyUsd: 0,
    annualUsd: 0,
    maxExperts: 3,
    maxMessages: 100,
    aiBudgetUsd: 0,
    tagline: "Free forever. The board on the house.",
    features: [
      "3 seated directors",
      "100 chair briefs a month",
      "Free models on the house key",
      "Decision memos and transcript export",
    ],
  },
  pro: {
    name: "Executive",
    shortName: "Pro",
    monthlyUsd: 29,
    annualUsd: 290,
    maxExperts: 8,
    maxMessages: 1000,
    aiBudgetUsd: 8,
    tagline: "For operators in the chair weekly.",
    features: [
      "8 seated directors",
      "1,000 chair briefs a month",
      "Fast paid models included ($8/mo AI budget)",
      "Bring your own OpenRouter key",
      "Decision memos, artifacts, deliverable versioning",
    ],
  },
  boardroom: {
    name: "Boardroom",
    shortName: "Boardroom",
    monthlyUsd: 99,
    annualUsd: 990,
    maxExperts: 12,
    maxMessages: 3000,
    aiBudgetUsd: 35,
    tagline: "Best models. The full table.",
    features: [
      "12 seated directors",
      "3,000 chair briefs a month",
      "Frontier models (Claude, GPT, Gemini, Grok, DeepSeek)",
      "$35/mo AI budget included",
      "Everything in Executive",
    ],
  },
};

export type SessionPricing = {
  name: string;
  priceUsd: number;
  maxExperts: number;
  maxMessages: number;
  aiCapUsd: number;
  allowFrontierModels: boolean;
  blurb: string;
};

/**
 * One-time session credits. A credit buys ONE new roundtable conversation;
 * its limits apply for the life of that conversation and are consumed when
 * the conversation is created.
 */
export const SESSION_PRICING: Record<SessionKind, SessionPricing> = {
  fast: {
    name: "Single Session",
    priceUsd: 5,
    maxExperts: 5,
    maxMessages: 25,
    aiCapUsd: 1,
    allowFrontierModels: false,
    blurb: "One roundtable · up to 5 directors · fast models · 25 chair briefs",
  },
  boardroom: {
    name: "Boardroom Session",
    priceUsd: 15,
    maxExperts: 8,
    maxMessages: 25,
    aiCapUsd: 4,
    allowFrontierModels: true,
    blurb: "One roundtable · up to 8 directors · frontier models · 25 chair briefs",
  },
};

/** Yearly billing is ten months' price: two months free. */
export const YEARLY_MONTHS_FREE = 2;

export function planDisplayName(tier: string | null | undefined): string {
  if (tier === "pro") return PLAN_PRICING.pro.name;
  if (tier === "boardroom") return PLAN_PRICING.boardroom.name;
  if (tier === "enterprise") return "Enterprise";
  return PLAN_PRICING.free.name;
}

export function planPriceFor(plan: PlanKey, interval: BillingInterval): number {
  return interval === "year" ? PLAN_PRICING[plan].annualUsd : PLAN_PRICING[plan].monthlyUsd;
}

export function formatUsd(amount: number): string {
  return `$${amount}`;
}

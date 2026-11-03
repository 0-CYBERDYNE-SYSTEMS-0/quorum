import { PLAN_PRICING, SESSION_PRICING, type PlanKey, type SessionKind } from "@shared/pricing";

/**
 * Enforced plan limits. Displayed amounts live in shared/pricing.ts; the
 * expert/message caps are mirrored from the same table so UI copy and the
 * gates can never disagree.
 *
 * Quorum has no free plan. There is no `free` entry: a stored tier of "free"
 * (or anything unknown) is a legacy "no plan" account, which may not open a
 * board except through a one-time session credit.
 */
export const TIERS = {
  pro: {
    ...PLAN_PRICING.pro,
    allowPaidModels: true,
    allowFrontierModels: false,
  },
  boardroom: {
    ...PLAN_PRICING.boardroom,
    allowPaidModels: true,
    allowFrontierModels: true,
  },
  enterprise: {
    name: "Enterprise",
    shortName: "Enterprise",
    monthlyUsd: 0,
    annualUsd: 0,
    maxExperts: 999,
    maxMessages: 999999,
    aiBudgetUsd: Number.POSITIVE_INFINITY,
    tagline: "Unlimited seats, private deployment.",
    features: [],
    allowPaidModels: true,
    allowFrontierModels: true,
  },
} as const;

export type TierKey = keyof typeof TIERS;

/** Limits for an account with no active plan: it cannot open or run a board. */
export const NO_PLAN_LIMITS = {
  name: "No plan",
  shortName: "No plan",
  maxExperts: 0,
  maxMessages: 0,
  allowPaidModels: false,
  allowFrontierModels: false,
} as const;

export type TierLimits = {
  maxExperts: number;
  maxMessages: number;
  allowPaidModels: boolean;
  allowFrontierModels: boolean;
  name: string;
  monthlyUsd?: number;
  annualUsd?: number;
  aiBudgetUsd?: number;
};

export function getTierLimits(tier: string): TierLimits {
  const key = tier as TierKey;
  const t = TIERS[key];
  if (t) return { ...t } as TierLimits;
  return { ...NO_PLAN_LIMITS };
}

export function isKnownTier(tier: string | null | undefined): tier is PlanKey | "enterprise" {
  return tier === "pro" || tier === "boardroom" || tier === "enterprise";
}

/** A board may only be created or run by a paid plan or a session credit. */
export const PLAN_REQUIRED_DENIAL = {
  status: 402 as const,
  code: "plan_required",
  message: "Choose Pro or Boardroom to open a board, or buy a one-time $5 or $15 session.",
  upgradeUrl: "/subscribe",
};

/** Session credits a no-plan account can spend one at a time. */
export const SESSION_CREDIT_LIMITS = SESSION_PRICING;

export type SessionCreditLimits = {
  maxExperts: number;
  maxMessages: number;
  aiCapUsd: number;
  allowFrontierModels: boolean;
  name: string;
};

export function sessionCreditLimits(kind: string): SessionCreditLimits {
  const key = kind as SessionKind;
  return (SESSION_CREDIT_LIMITS[key] ?? SESSION_CREDIT_LIMITS.fast) as SessionCreditLimits;
}

export function isSessionKind(kind: unknown): kind is SessionKind {
  return kind === "fast" || kind === "boardroom";
}

export function isPaidModel(modelId: string): boolean {
  return !modelId.endsWith(":free");
}

export function isFreeModel(modelId: string): boolean {
  return modelId.endsWith(":free");
}

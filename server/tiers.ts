import { PLAN_PRICING, SESSION_PRICING, type PlanKey, type SessionKind } from "@shared/pricing";

/**
 * Enforced plan limits. Displayed amounts live in shared/pricing.ts; the
 * expert/message caps are mirrored from the same table so UI copy and the
 * gates can never disagree.
 */
export const TIERS = {
  free: {
    ...PLAN_PRICING.free,
    allowPaidModels: false,
    allowFrontierModels: false,
  },
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
  const t = TIERS[key] ?? TIERS.free;
  return { ...t } as TierLimits;
}

export function isKnownTier(tier: string | null | undefined): tier is PlanKey | "enterprise" {
  return tier === "free" || tier === "pro" || tier === "boardroom" || tier === "enterprise";
}

/** Session credits a Free account can spend one at a time. */
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

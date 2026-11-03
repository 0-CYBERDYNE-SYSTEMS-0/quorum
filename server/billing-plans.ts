/**
 * Pricing v1 checkout plumbing — pure, testable helpers.
 *
 * Price amounts and Stripe price ids never appear in this module: ids always
 * come from the environment, and the client only ever sends a plan/interval
 * or a session kind.
 */
import type { BillingInterval, SessionKind } from "@shared/pricing";

export type SubscriptionPlan = "pro" | "boardroom";

export type CheckoutRequest =
  | { mode: "subscription"; plan: SubscriptionPlan; interval: BillingInterval }
  | { mode: "payment"; sessionKind: SessionKind };

export const SUBSCRIPTION_PRICE_ENV: Record<SubscriptionPlan, Record<BillingInterval, string>> = {
  pro: {
    month: "STRIPE_PRICE_ID_PRO",
    year: "STRIPE_PRICE_ID_PRO_ANNUAL",
  },
  boardroom: {
    month: "STRIPE_PRICE_ID_BOARDROOM",
    year: "STRIPE_PRICE_ID_BOARDROOM_ANNUAL",
  },
};

export const SESSION_PRICE_ENV: Record<SessionKind, string> = {
  fast: "STRIPE_PRICE_ID_SESSION_FAST",
  boardroom: "STRIPE_PRICE_ID_SESSION_BOARDROOM",
};

export const PLAN_DISPLAY: Record<SubscriptionPlan, string> = {
  pro: "Pro",
  boardroom: "Boardroom",
};

export const SESSION_DISPLAY: Record<SessionKind, string> = {
  fast: "Single Session",
  boardroom: "Boardroom Session",
};

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return value === "pro" || value === "boardroom";
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === "month" || value === "year";
}

/**
 * Validate a checkout body.
 * - `{ plan, interval }` → subscription. A missing plan keeps backward
 *   compatibility with the old Pro-only endpoint (plan defaults to pro).
 * - `{ session }` → one-time session credit (mode "payment").
 */
export function parseCheckoutRequest(body: unknown): { ok: true; value: CheckoutRequest } | { ok: false; message: string } {
  const input = (body ?? {}) as Record<string, unknown>;

  if (input.session !== undefined) {
    if (input.plan !== undefined) {
      return { ok: false, message: 'Send either { plan } or { session }, not both.' };
    }
    if (input.session !== "fast" && input.session !== "boardroom") {
      return { ok: false, message: 'session must be "fast" or "boardroom"' };
    }
    return { ok: true, value: { mode: "payment", sessionKind: input.session } };
  }

  const plan = input.plan ?? "pro";
  if (!isSubscriptionPlan(plan)) {
    return { ok: false, message: 'plan must be "pro" or "boardroom"' };
  }
  const interval = input.interval ?? "month";
  if (!isBillingInterval(interval)) {
    return { ok: false, message: 'interval must be "month" or "year"' };
  }
  return { ok: true, value: { mode: "subscription", plan, interval } };
}

export function subscriptionPriceEnvName(plan: SubscriptionPlan, interval: BillingInterval): string {
  return SUBSCRIPTION_PRICE_ENV[plan][interval];
}

export function resolveSubscriptionPriceId(
  plan: SubscriptionPlan,
  interval: BillingInterval,
  env: NodeJS.ProcessEnv = process.env,
): { envName: string; priceId: string | undefined } {
  const envName = subscriptionPriceEnvName(plan, interval);
  const priceId = env[envName]?.trim() || undefined;
  return { envName, priceId };
}

export function resolveSessionPriceId(
  kind: SessionKind,
  env: NodeJS.ProcessEnv = process.env,
): { envName: string; priceId: string | undefined } {
  const envName = SESSION_PRICE_ENV[kind];
  const priceId = env[envName]?.trim() || undefined;
  return { envName, priceId };
}

/**
 * Map a Stripe recurring price id back to a plan key. Unknown or unset ids
 * return undefined so a webhook never invents a plan.
 */
export function tierForSubscriptionPriceId(
  priceId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): SubscriptionPlan | undefined {
  if (!priceId) return undefined;
  for (const plan of ["pro", "boardroom"] as const) {
    for (const interval of ["month", "year"] as const) {
      const configured = env[SUBSCRIPTION_PRICE_ENV[plan][interval]]?.trim();
      if (configured && configured === priceId) return plan;
    }
  }
  return undefined;
}

/** Parsed, normalized ALLOWED_ORIGIN list. Falls back to the local dev client. */
export function allowedOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.ALLOWED_ORIGIN ?? "";
  const origins = raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return origins.length ? origins : ["http://localhost:5173"];
}

export function isAllowedOrigin(origin: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin) return false;
  const normalized = origin.trim().replace(/\/+$/, "");
  return allowedOriginsFromEnv(env).includes(normalized);
}

/**
 * Stripe success/cancel URLs must land back on the host the Chair used, but
 * only when that host is configured. Unknown origins fall back to the first
 * allowed origin — never to an attacker-supplied value.
 */
export function resolveReturnOrigin(origin: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (origin && isAllowedOrigin(origin, env)) return origin.trim().replace(/\/+$/, "");
  return allowedOriginsFromEnv(env)[0];
}

export function checkoutUrls(origin: string, checkout: "success" | "cancel"): { successUrl: string; cancelUrl: string } {
  return {
    successUrl: `${origin}/?checkout=${checkout === "success" ? "success" : "cancel"}`,
    cancelUrl: `${origin}/subscribe?checkout=cancel`,
  };
}

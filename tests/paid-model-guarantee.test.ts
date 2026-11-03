/**
 * Owner rule (2026-11-03): no free models for paying customers.
 *
 * 1. The paid-tier budget fallback is a PAID slug.
 * 2. $5/$15 session-credit roundtables resolve every helper call (planning,
 *    next speaker, insights, moderator, closing memo) to the paid aux model.
 * 3. Paid tiers keep running gracefully past the monthly budget on that paid
 *    fallback, with a hard 25% overage ceiling.
 * 4. No paid-tier or session path can resolve to a ':free' model id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { store } = vi.hoisted(() => ({
  store: {
    getUser: vi.fn(),
    getUserApiKey: vi.fn(),
    getMonthlyUsage: vi.fn(),
    addMonthlyAiSpend: vi.fn(),
    addSessionCreditSpend: vi.fn(),
    getSessionCreditByConversationId: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: store }));

import {
  closingSynthesisFallbackModel,
  paidAuxModelFor,
  planningModelsForTier,
  resolveAuxModelForUser,
} from "../server/ai";
import { OpenRouterProvider } from "../server/ai-providers";
import {
  BUDGET_FALLBACK_MODEL,
  BUDGET_FALLBACK_MODEL_FALLBACK,
  DEFAULT_AUX_MODEL_FALLBACK_SLUG,
  DEFAULT_AUX_MODEL_SLUG,
  budgetFallbackModelsForTier,
  UsageCapError,
} from "../server/usage-caps";
import {
  EXPERT_CATALOG,
  defaultExpertModelForTier,
  resolveExpertModelForContext,
} from "../shared/expert-catalog";
import { HOUSE_KEY_PAID_MODEL_ALLOWLIST, BOARDROOM_FRONTIER_MODEL_ALLOWLIST } from "../shared/models";

const FREE_SLUG = "google/gemma-4-31b-it:free";
const messages = [{ role: "user" as const, content: "hello" }];
const okResponse = (cost: number) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { role: "assistant", content: "hi" } }], usage: { cost } }),
});

const PAID_TIERS = ["pro", "boardroom", "enterprise"] as const;
const SESSION_KINDS = ["fast", "boardroom"] as const;

describe("paid-tier model fallback", () => {
  it("uses a PAID model, with a paid second choice, once the budget is spent", () => {
    expect(BUDGET_FALLBACK_MODEL).toBe("deepseek/deepseek-v4.1-flash");
    expect(BUDGET_FALLBACK_MODEL.endsWith(":free")).toBe(false);
    expect(BUDGET_FALLBACK_MODEL_FALLBACK).toBe("openai/gpt-6-luna");
    expect(BUDGET_FALLBACK_MODEL_FALLBACK.endsWith(":free")).toBe(false);
  });

  it("has no free tier: a legacy 'free' account gets the paid fallback chain", () => {
    expect(budgetFallbackModelsForTier("free")).toEqual([BUDGET_FALLBACK_MODEL, BUDGET_FALLBACK_MODEL_FALLBACK]);
    expect(planningModelsForTier("free")).toEqual([DEFAULT_AUX_MODEL_SLUG, DEFAULT_AUX_MODEL_FALLBACK_SLUG]);
  });
});

describe("helper calls (planning, insights, moderator, closing memo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEFAULT_AUX_MODEL;
    delete process.env.TOOL_PLANNING_MODEL;
    store.getUserApiKey.mockResolvedValue(null);
    store.getMonthlyUsage.mockResolvedValue({ messageCount: 0, aiSpendUsd: 0 });
    store.addMonthlyAiSpend.mockResolvedValue(undefined);
    store.addSessionCreditSpend.mockResolvedValue(undefined);
    store.getSessionCreditByConversationId.mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete process.env.DEFAULT_AUX_MODEL;
    delete process.env.TOOL_PLANNING_MODEL;
  });

  it("plans tool calls on the paid aux chain for every paid or credit context", () => {
    for (const tier of [...PAID_TIERS, "free", undefined]) {
      const chain = planningModelsForTier(tier, true);
      expect(chain).toEqual([DEFAULT_AUX_MODEL_SLUG, DEFAULT_AUX_MODEL_FALLBACK_SLUG]);
      expect(chain.every(model => !model.endsWith(":free"))).toBe(true);
    }
    for (const tier of PAID_TIERS) {
      expect(planningModelsForTier(tier).every(model => !model.endsWith(":free"))).toBe(true);
    }
  });

  it("upgrades a paid account's free Moderator model to the paid aux model", async () => {
    store.getUser.mockResolvedValue({ id: 1, tier: "pro" });
    expect(await resolveAuxModelForUser(FREE_SLUG, null, 1, 10)).toBe(DEFAULT_AUX_MODEL_SLUG);
    expect(await resolveAuxModelForUser(null, FREE_SLUG, 1, 10)).toBe(DEFAULT_AUX_MODEL_SLUG);
  });

  it("keeps a paid Moderator model the Chair already chose", async () => {
    store.getUser.mockResolvedValue({ id: 1, tier: "boardroom" });
    expect(await resolveAuxModelForUser("deepseek/deepseek-v4.1-flash", FREE_SLUG, 1, 10)).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("routes a $5/$15 session-credit roundtable to the paid aux model even on the Free plan", async () => {
    store.getUser.mockResolvedValue({ id: 2, tier: "free" });
    for (const kind of SESSION_KINDS) {
      store.getSessionCreditByConversationId.mockResolvedValue({ id: 9, kind });
      expect(await resolveAuxModelForUser(FREE_SLUG, FREE_SLUG, 2, 77)).toBe(DEFAULT_AUX_MODEL_SLUG);
      expect(await resolveAuxModelForUser(null, null, 2, 77)).toBe(DEFAULT_AUX_MODEL_SLUG);
    }
  });

  it("keeps a legacy no-plan helper call on a paid model, never a ':free' one", async () => {
    store.getUser.mockResolvedValue({ id: 3, tier: "free" });
    store.getSessionCreditByConversationId.mockResolvedValue(undefined);
    // No free plan and no free models: a configured paid model stays, and a
    // ':free' slug is upgraded to the paid aux model.
    expect(await resolveAuxModelForUser("z-ai/glm-5.3-flash", null, 3, 11)).toBe("z-ai/glm-5.3-flash");
    expect(await resolveAuxModelForUser(FREE_SLUG, null, 3, 11)).toBe(DEFAULT_AUX_MODEL_SLUG);
  });

  it("keeps the configured model when there is no billing context at all", async () => {
    expect(await resolveAuxModelForUser("z-ai/glm-5.3-flash", null)).toBe("z-ai/glm-5.3-flash");
    expect(await resolveAuxModelForUser(FREE_SLUG, null)).toBe(DEFAULT_AUX_MODEL_SLUG);
    expect(store.getUser).not.toHaveBeenCalled();
    expect(store.getSessionCreditByConversationId).not.toHaveBeenCalled();
  });

  it("never resolves a paid tier or session path to a ':free' model", async () => {
    const resolved: string[] = [];
    // Expert seat defaults, fallbacks and helper chains for every paid and
    // session-credit context.
    const expertContexts = [
      { tier: "pro", context: { paid: true, allowFrontier: false }, allowed: HOUSE_KEY_PAID_MODEL_ALLOWLIST },
      { tier: "boardroom", context: { paid: true, allowFrontier: true }, allowed: [...HOUSE_KEY_PAID_MODEL_ALLOWLIST, ...BOARDROOM_FRONTIER_MODEL_ALLOWLIST] },
      { tier: "enterprise", context: { paid: true, allowFrontier: true }, allowed: [...HOUSE_KEY_PAID_MODEL_ALLOWLIST, ...BOARDROOM_FRONTIER_MODEL_ALLOWLIST] },
      { tier: "fast-session", context: { paid: true, allowFrontier: false }, allowed: HOUSE_KEY_PAID_MODEL_ALLOWLIST },
      { tier: "boardroom-session", context: { paid: true, allowFrontier: true }, allowed: [...HOUSE_KEY_PAID_MODEL_ALLOWLIST, ...BOARDROOM_FRONTIER_MODEL_ALLOWLIST] },
    ] as const;
    for (const { context, allowed } of expertContexts) {
      resolved.push(resolveExpertModelForContext(FREE_SLUG, context));
      for (const expert of EXPERT_CATALOG) {
        const seat = resolveExpertModelForContext(expert.defaultModel, context);
        resolved.push(seat);
        expect((allowed as readonly string[]).includes(seat), `${context.allowFrontier}: ${expert.role}`).toBe(true);
      }
    }
    for (const tier of PAID_TIERS) {
      resolved.push(defaultExpertModelForTier(tier));
      resolved.push(...budgetFallbackModelsForTier(tier));
      store.getUser.mockResolvedValue({ id: 1, tier });
      store.getSessionCreditByConversationId.mockResolvedValue(undefined);
      resolved.push((await resolveAuxModelForUser(FREE_SLUG, FREE_SLUG, 1, 10))!);
      resolved.push((await resolveAuxModelForUser(null, null, 1, 10))!);
      resolved.push(...planningModelsForTier(tier));
    }
    store.getUser.mockResolvedValue({ id: 2, tier: "free" });
    for (const kind of SESSION_KINDS) {
      store.getSessionCreditByConversationId.mockResolvedValue({ id: 9, kind });
      resolved.push(defaultExpertModelForTier(kind === "boardroom" ? "boardroom" : "pro"));
      resolved.push((await resolveAuxModelForUser(FREE_SLUG, null, 2, 77))!);
      resolved.push(...planningModelsForTier("free", true));
    }
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.filter(model => model.endsWith(":free"))).toEqual([]);
    expect(budgetFallbackModelsForTier("pro")).toEqual([BUDGET_FALLBACK_MODEL, BUDGET_FALLBACK_MODEL_FALLBACK]);
    // Closing-memo retry never dials a free slug.
    expect(closingSynthesisFallbackModel(DEFAULT_AUX_MODEL_SLUG)).toBe(DEFAULT_AUX_MODEL_FALLBACK_SLUG);
    expect(closingSynthesisFallbackModel(FREE_SLUG)).toBe(DEFAULT_AUX_MODEL_FALLBACK_SLUG);
  });

  it("uses the paid default whenever the preferred aux model is free", () => {
    expect(paidAuxModelFor(FREE_SLUG)).toBe(DEFAULT_AUX_MODEL_SLUG);
    expect(paidAuxModelFor(null)).toBe(DEFAULT_AUX_MODEL_SLUG);
    expect(paidAuxModelFor("  ")).toBe(DEFAULT_AUX_MODEL_SLUG);
    expect(paidAuxModelFor("z-ai/glm-5.3-flash")).toBe("z-ai/glm-5.3-flash");
  });
});

describe("provider enforcement for paid and session-credit calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "sk-or-house";
    store.getUserApiKey.mockResolvedValue(null);
    store.getMonthlyUsage.mockResolvedValue({ messageCount: 0, aiSpendUsd: 0 });
    store.addMonthlyAiSpend.mockResolvedValue(undefined);
    store.addSessionCreditSpend.mockResolvedValue(undefined);
    store.getSessionCreditByConversationId.mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("runs a session-credit helper call on the paid aux model and bills the credit", async () => {
    store.getUser.mockResolvedValue({ id: 2, tier: "free" });
    store.getSessionCreditByConversationId.mockResolvedValue({ id: 5, kind: "fast", aiSpendUsd: 0.1 });
    mockFetch.mockResolvedValue(okResponse(0.01));
    await new OpenRouterProvider(null).chat(messages, DEFAULT_AUX_MODEL_SLUG, 2, false, { conversationId: 77 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe(DEFAULT_AUX_MODEL_SLUG);
    expect(body.model.endsWith(":free")).toBe(false);
    await vi.waitFor(() => expect(store.addSessionCreditSpend).toHaveBeenCalledWith(5, 0.01));
  });

  it("never swaps a credit roundtable onto a free model when its AI cap is spent", async () => {
    store.getUser.mockResolvedValue({ id: 2, tier: "free" });
    store.getSessionCreditByConversationId.mockResolvedValue({ id: 5, kind: "fast", aiSpendUsd: 1 });
    const error = await new OpenRouterProvider(null).chat(messages, DEFAULT_AUX_MODEL_SLUG, 2, false, { conversationId: 77 }).catch(e => e);
    expect(error).toBeInstanceOf(UsageCapError);
    expect(error.denial).toMatchObject({ status: 429, code: "ai_budget_exhausted" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rewrites a stored ':free' expert model on a paid tier before the request", async () => {
    store.getUser.mockResolvedValue({ id: 1, tier: "pro" });
    mockFetch.mockResolvedValue(okResponse(0.01));
    await new OpenRouterProvider(null).chat(messages, FREE_SLUG, 1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model.endsWith(":free")).toBe(false);
    expect(body.model).toBe(resolveExpertModelForContext(FREE_SLUG, { paid: true, allowFrontier: false }));
  });

  it("rewrites a stored ':free' expert model on a session-credit board", async () => {
    store.getUser.mockResolvedValue({ id: 2, tier: "free" });
    store.getSessionCreditByConversationId.mockResolvedValue({ id: 5, kind: "boardroom", aiSpendUsd: 0 });
    mockFetch.mockResolvedValue(okResponse(0.01));
    await new OpenRouterProvider(null).chat(messages, FREE_SLUG, 2, false, { conversationId: 77 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model.endsWith(":free")).toBe(false);
    expect(body.model).toBe(resolveExpertModelForContext(FREE_SLUG, { paid: true, allowFrontier: true }));
  });

  it("refuses a no-plan call before the provider is dialed", async () => {
    store.getUser.mockResolvedValue({ id: 3, tier: "free" });
    mockFetch.mockResolvedValue(okResponse(0));
    const error = await new OpenRouterProvider(null).chat(messages, FREE_SLUG, 3).catch(e => e);
    expect(error).toBeInstanceOf(UsageCapError);
    expect(error.denial).toMatchObject({ status: 402, code: "plan_required" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("runs the paid fallback model past the budget and refuses past the ceiling", async () => {
    store.getUser.mockResolvedValue({ id: 1, tier: "pro" });
    store.getMonthlyUsage.mockResolvedValue({ messageCount: 1, aiSpendUsd: 9 });
    mockFetch.mockResolvedValue(okResponse(0.5));
    await new OpenRouterProvider(null).chat(messages, "z-ai/glm-5.3-flash", 1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).model).toBe(BUDGET_FALLBACK_MODEL);

    mockFetch.mockClear();
    store.getMonthlyUsage.mockResolvedValue({ messageCount: 1, aiSpendUsd: 10 });
    const error = await new OpenRouterProvider(null).chat(messages, "z-ai/glm-5.3-flash", 1).catch(e => e);
    expect(error).toBeInstanceOf(UsageCapError);
    expect(error.denial.message).toMatch(/included AI budget/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("no ':free' model ids in shipped code", () => {
  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(ts|tsx|json)$/.test(entry.name) ? [full] : [];
    });
  }

  it("contains no ':free' slug under server/ or shared/", () => {
    const slugPattern = /\b[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*:free\b/gi;
    const hits = ["server", "shared"].flatMap((root) =>
      walk(path.join(process.cwd(), root)).flatMap((file) =>
        (fs.readFileSync(file, "utf8").match(slugPattern) ?? []).map((match) => `${path.relative(process.cwd(), file)}: ${match}`),
      ),
    );
    expect(hits).toEqual([]);
  });
});

/**
 * Pricing caps (Pro $20): message allowance, house-key model allowlist,
 * monthly AI budget, BYOK exemption, and per-user monthly usage storage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { store } = vi.hoisted(() => ({
  store: {
    getUser: vi.fn(),
    getUserApiKey: vi.fn(),
    getMonthlyUsage: vi.fn(),
    addMonthlyAiSpend: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: store }));

import {
  checkMessageAllowance,
  checkHouseKeyCall,
  currentUsagePeriod,
  monthlyAiBudgetUsd,
  monthlyAiBudgetCeilingUsd,
  budgetFallbackModelForTier,
  isHouseKeyAllowedModel,
  HOUSE_KEY_PAID_MODEL_ALLOWLIST,
  BOARDROOM_FRONTIER_MODEL_ALLOWLIST,
  UsageCapError,
  BUDGET_FALLBACK_MODEL,
  BUDGET_FALLBACK_MODEL_FALLBACK,
  FREE_TIER_BUDGET_MODEL,
  EXPERT_REPLY_MAX_TOKENS,
} from "../server/usage-caps";
import { SESSION_CREDIT_LIMITS } from "../server/tiers";
import { OpenRouterProvider, FREE_MODEL_FALLBACKS } from "../server/ai-providers";

const okResponse = (cost: number) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { role: "assistant", content: "hi" } }], usage: { cost } }),
});

describe("usage caps: pure rules", () => {
  afterEach(() => { delete process.env.PRO_MONTHLY_AI_BUDGET_USD; });

  it("uses UTC calendar-month periods", () => {
    expect(currentUsagePeriod(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(currentUsagePeriod(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });

  it("allows Free 100 and Pro 1000 messages a month, then denies with upgrade hints", () => {
    expect(checkMessageAllowance("free", 99)).toBeNull();
    expect(checkMessageAllowance("free", 100)).toMatchObject({ status: 402, code: "message_limit_reached", upgradeUrl: "/subscribe" });
    expect(checkMessageAllowance(null, 100)?.status).toBe(402);
    expect(checkMessageAllowance("pro", 999)).toBeNull();
    expect(checkMessageAllowance("pro", 1000)).toMatchObject({ status: 429, code: "message_limit_reached" });
  });

  it("keeps the free tier's existing free budget model and gives paid tiers a paid fallback", () => {
    expect(FREE_MODEL_FALLBACKS).toContain(FREE_TIER_BUDGET_MODEL);
    expect(FREE_TIER_BUDGET_MODEL.endsWith(":free")).toBe(true);
    expect(FREE_MODEL_FALLBACKS).not.toContain(BUDGET_FALLBACK_MODEL);
    expect(BUDGET_FALLBACK_MODEL).toBe("deepseek/deepseek-v4.1-flash");
    expect(BUDGET_FALLBACK_MODEL.endsWith(":free")).toBe(false);
    expect(BUDGET_FALLBACK_MODEL_FALLBACK).toBe("openai/gpt-6-luna");
    expect(isHouseKeyAllowedModel(BUDGET_FALLBACK_MODEL)).toBe(true);
    expect(isHouseKeyAllowedModel(BUDGET_FALLBACK_MODEL_FALLBACK)).toBe(true);
    expect(budgetFallbackModelForTier("pro")).toBe(BUDGET_FALLBACK_MODEL);
    expect(budgetFallbackModelForTier("boardroom")).toBe(BUDGET_FALLBACK_MODEL);
    expect(budgetFallbackModelForTier("free")).toBe(FREE_TIER_BUDGET_MODEL);
  });

  it("admits included paid models and every free model, and nothing else", () => {
    expect(isHouseKeyAllowedModel("z-ai/glm-5.3-flash")).toBe(true);
    expect(isHouseKeyAllowedModel("openai/gpt-6-luna")).toBe(true);
    expect(isHouseKeyAllowedModel("google/gemma-4-31b-it:free")).toBe(true);
    expect(isHouseKeyAllowedModel("openai/o1-pro")).toBe(false);
    expect(HOUSE_KEY_PAID_MODEL_ALLOWLIST.every((model) => !model.endsWith(":free"))).toBe(true);
  });

  it("budgets Pro at $8 by default, overridable by env; Free has no paid budget", () => {
    expect(monthlyAiBudgetUsd("pro")).toBe(8);
    process.env.PRO_MONTHLY_AI_BUDGET_USD = "5";
    expect(monthlyAiBudgetUsd("pro")).toBe(5);
    expect(monthlyAiBudgetUsd("free")).toBe(0);
  });

  it("budgets Boardroom at $35 by default, overridable by env", () => {
    delete process.env.BOARDROOM_MONTHLY_AI_BUDGET_USD;
    expect(monthlyAiBudgetUsd("boardroom")).toBe(35);
    process.env.BOARDROOM_MONTHLY_AI_BUDGET_USD = "40";
    expect(monthlyAiBudgetUsd("boardroom")).toBe(40);
    delete process.env.BOARDROOM_MONTHLY_AI_BUDGET_USD;
  });

  it("gates house-key calls by tier, allowlist and budget", () => {
    expect(checkHouseKeyCall("free", "nvidia/nemotron-3-super-120b-a12b:free", 0)).toBeNull();
    expect(checkHouseKeyCall("free", "z-ai/glm-5.3-flash", 0)?.code).toBe("paid_model_requires_pro");
    expect(checkHouseKeyCall("pro", "z-ai/glm-5.3-flash", 7.99)).toBeNull();
    expect(checkHouseKeyCall("pro", "openai/o1-pro", 0)?.code).toBe("model_requires_own_key");
    // Graceful overage: the tier budget is spent but the 25% ceiling is not.
    expect(checkHouseKeyCall("pro", "z-ai/glm-5.3-flash", 8)?.code).toBe("ai_budget_overage");
    expect(checkHouseKeyCall("pro", "z-ai/glm-5.3-flash", 9.99)?.code).toBe("ai_budget_overage");
    // Past 25% overage the call is refused with the existing message.
    expect(checkHouseKeyCall("pro", "z-ai/glm-5.3-flash", 10)?.code).toBe("ai_budget_exhausted");
    expect(checkHouseKeyCall("pro", "z-ai/glm-5.3-flash", 10)?.message).toContain("included AI budget");
    expect(checkHouseKeyCall("pro", "google/gemma-4-31b-it:free", 100)).toBeNull();
    expect(checkHouseKeyCall("enterprise", "openai/o1-pro", 1e6)).toBeNull();
  });

  it("caps the paid overage at 25% of the tier budget", () => {
    expect(monthlyAiBudgetCeilingUsd("pro")).toBe(10);
    expect(monthlyAiBudgetCeilingUsd("boardroom")).toBe(43.75);
    expect(monthlyAiBudgetCeilingUsd("enterprise")).toBe(Number.POSITIVE_INFINITY);
    expect(monthlyAiBudgetCeilingUsd("free")).toBe(0);
    expect(checkHouseKeyCall("boardroom", "z-ai/glm-5.3-flash", 43.74)?.code).toBe("ai_budget_overage");
    expect(checkHouseKeyCall("boardroom", "z-ai/glm-5.3-flash", 43.75)?.code).toBe("ai_budget_exhausted");
    // Overage never applies to a one-time session credit: its cap is hard.
    const credit = { kind: "fast" as const, spentUsd: 1 };
    expect(checkHouseKeyCall("free", "z-ai/glm-5.3-flash", 0, credit)?.code).toBe("ai_budget_exhausted");
  });

  it("gates boardroom-only frontier models (Pro gets a 402 upgrade message)", () => {
    const frontier = BOARDROOM_FRONTIER_MODEL_ALLOWLIST[0];
    expect(BOARDROOM_FRONTIER_MODEL_ALLOWLIST).toHaveLength(6);
    expect(isHouseKeyAllowedModel(frontier, "pro")).toBe(false);
    expect(isHouseKeyAllowedModel(frontier, "boardroom")).toBe(true);
    expect(isHouseKeyAllowedModel(frontier)).toBe(false);

    const proDenial = checkHouseKeyCall("pro", frontier, 0);
    expect(proDenial).toMatchObject({ status: 402, code: "boardroom_model_required" });
    expect(proDenial?.message).toMatch(/Boardroom model.*Boardroom Session/i);
    expect(checkHouseKeyCall("boardroom", frontier, 0)).toBeNull();
    expect(checkHouseKeyCall("enterprise", frontier, 0)).toBeNull();
    // A free account must not reach frontier models either.
    expect(checkHouseKeyCall("free", frontier, 0)?.code).toBe("paid_model_requires_pro");
  });

  it("applies the fast session credit's limits for its conversation", () => {
    const credit = { kind: "fast" as const, usedMessages: 0, spentUsd: 0 };
    expect(SESSION_CREDIT_LIMITS.fast).toMatchObject({ maxExperts: 5, maxMessages: 25, aiCapUsd: 1 });
    expect(SESSION_CREDIT_LIMITS.boardroom).toMatchObject({ maxExperts: 8, maxMessages: 25, aiCapUsd: 4 });

    // A free Chair on a fast credit may run fast paid models, not frontier.
    expect(checkHouseKeyCall("free", "z-ai/glm-5.3-flash", 0, credit)).toBeNull();
    expect(checkHouseKeyCall("free", BOARDROOM_FRONTIER_MODEL_ALLOWLIST[0], 0, credit)?.code).toBe("boardroom_model_required");
    // The credit's own $1 AI cap applies instead of a monthly budget.
    expect(checkHouseKeyCall("free", "z-ai/glm-5.3-flash", 0, { ...credit, spentUsd: 1 })?.code).toBe("ai_budget_exhausted");
    // A boardroom credit unlocks frontier models and has a $4 cap.
    const boardroomCredit = { kind: "boardroom" as const, spentUsd: 0 };
    expect(checkHouseKeyCall("free", BOARDROOM_FRONTIER_MODEL_ALLOWLIST[0], 0, boardroomCredit)).toBeNull();
    expect(checkHouseKeyCall("free", BOARDROOM_FRONTIER_MODEL_ALLOWLIST[0], 0, { ...boardroomCredit, spentUsd: 4 })?.code).toBe("ai_budget_exhausted");
  });

  it("caps a session-credit conversation at 25 chair messages, not the monthly cap", () => {
    const credit = { kind: "boardroom" as const, usedMessages: 24 };
    expect(checkMessageAllowance("free", 999, credit)).toBeNull();
    const denial = checkMessageAllowance("free", 999, { ...credit, usedMessages: 25 });
    expect(denial).toMatchObject({ status: 429, code: "session_credit_message_limit_reached" });
    expect(denial?.message).toContain("25");
  });

  it("mentions the pricing v1 amounts, not the retired $10 plan", () => {
    const message = checkMessageAllowance("free", 100)?.message ?? "";
    expect(message).toContain("$29");
    expect(message).toContain("$99");
    expect(message).not.toContain("$10");
  });
});

describe("usage caps: OpenRouterProvider enforcement", () => {
  const messages = [{ role: "user" as const, content: "hello" }];
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "sk-or-house";
    store.getUserApiKey.mockResolvedValue(null);
    store.getMonthlyUsage.mockResolvedValue({ messageCount: 0, aiSpendUsd: 0 });
    store.addMonthlyAiSpend.mockResolvedValue(undefined);
  });

  it("blocks a non-allowlisted model on the house key before any request", async () => {
    store.getUser.mockResolvedValue({ id: 1, tier: "pro" });
    await expect(new OpenRouterProvider(null).chat(messages, "openai/o1-pro", 1)).rejects.toBeInstanceOf(UsageCapError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("falls back to the PAID fallback model (not a free model) once the Pro budget is spent", async () => {
    store.getUser.mockResolvedValue({ id: 1, tier: "pro" });
    store.getMonthlyUsage.mockResolvedValue({ messageCount: 3, aiSpendUsd: 8.01 });
    mockFetch.mockResolvedValue(okResponse(0.02));
    const res = await new OpenRouterProvider(null).chat(messages, "z-ai/glm-5.3-flash", 1);
    expect(res.message.content).toBe("hi");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe(BUDGET_FALLBACK_MODEL);
    expect(body.model.endsWith(":free")).toBe(false);
    // Overage spend is still counted, so the ceiling is reachable.
    await vi.waitFor(() => expect(store.addMonthlyAiSpend).toHaveBeenCalledWith(1, currentUsagePeriod(), 0.02));
  });

  it("refuses paid-tier calls past the 25% overage ceiling with ai_budget_exhausted", async () => {
    store.getUser.mockResolvedValue({ id: 1, tier: "pro" });
    store.getMonthlyUsage.mockResolvedValue({ messageCount: 3, aiSpendUsd: 10.01 });
    const error = await new OpenRouterProvider(null).chat(messages, "z-ai/glm-5.3-flash", 1).catch(e => e);
    expect(error).toBeInstanceOf(UsageCapError);
    expect(error.denial).toMatchObject({ status: 429, code: "ai_budget_exhausted" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("caps expert replies at the requested max_tokens", async () => {
    store.getUser.mockResolvedValue({ id: 1, tier: "pro" });
    mockFetch.mockResolvedValue(okResponse(0.001));
    await new OpenRouterProvider(null).chat(messages, "z-ai/glm-5.3-flash", 1, false, { maxTokens: EXPERT_REPLY_MAX_TOKENS });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).max_tokens).toBe(8192);
    mockFetch.mockClear();
    await new OpenRouterProvider(null).chat(messages, "z-ai/glm-5.3-flash", 1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).max_tokens).toBe(8192);
  });

  it("records house-key spend per user per month", async () => {
    store.getUser.mockResolvedValue({ id: 1, tier: "pro" });
    mockFetch.mockResolvedValue(okResponse(0.0123));
    await new OpenRouterProvider(null).chat(messages, "z-ai/glm-5.3-flash", 1);
    await vi.waitFor(() => expect(store.addMonthlyAiSpend).toHaveBeenCalledWith(1, currentUsagePeriod(), 0.0123));
  });

  it("never caps or counts calls made with the user's own key", async () => {
    store.getUserApiKey.mockResolvedValue("sk-or-user");
    mockFetch.mockResolvedValue(okResponse(5));
    await new OpenRouterProvider(null).chat(messages, "openai/o1-pro", 1);
    expect(store.getUser).not.toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 10));
    expect(store.addMonthlyAiSpend).not.toHaveBeenCalled();
  });
});

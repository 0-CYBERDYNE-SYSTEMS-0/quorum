import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_OUTPUT_TOKENS, PAID_BUDGET_FALLBACKS, maxOutputTokens, modelRouting } from "../server/ai-providers";
import { BUDGET_FALLBACK_MODEL, BUDGET_FALLBACK_MODEL_FALLBACK } from "../server/usage-caps";

describe("model routing and output cap", () => {
  afterEach(() => { delete process.env.OPENROUTER_MAX_OUTPUT_TOKENS; });
  it("has no free fallback chain: a paid model is routed alone", () => {
    expect(modelRouting("openai/gpt-6-luna")).toEqual({ model: "openai/gpt-6-luna" });
    expect(modelRouting("z-ai/glm-5.3-flash")).toEqual({ model: "z-ai/glm-5.3-flash" });
  });
  it("never adds a ':free' fallback even for a legacy free-looking slug", () => {
    const r = modelRouting("google/gemma-4-31b-it:free");
    expect(r).toEqual({ model: "google/gemma-4-31b-it:free" });
    expect(r.models).toBeUndefined();
  });
  it("routes a failed paid budget fallback to the second paid slug", () => {
    expect(PAID_BUDGET_FALLBACKS).toEqual([BUDGET_FALLBACK_MODEL, BUDGET_FALLBACK_MODEL_FALLBACK]);
    expect(modelRouting(BUDGET_FALLBACK_MODEL)).toEqual({
      model: BUDGET_FALLBACK_MODEL,
      models: [BUDGET_FALLBACK_MODEL, BUDGET_FALLBACK_MODEL_FALLBACK],
    });
    expect(modelRouting(BUDGET_FALLBACK_MODEL).models!.some(m => m.endsWith(":free"))).toBe(false);
  });
  it("defaults to 8192 and honours a sane override up to the ceiling", () => {
    expect(maxOutputTokens()).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(8192);
    process.env.OPENROUTER_MAX_OUTPUT_TOKENS = "2048"; expect(maxOutputTokens()).toBe(2048);
    process.env.OPENROUTER_MAX_OUTPUT_TOKENS = "16384"; expect(maxOutputTokens()).toBe(16384);
    process.env.OPENROUTER_MAX_OUTPUT_TOKENS = "9999999"; expect(maxOutputTokens()).toBe(8192);
    process.env.OPENROUTER_MAX_OUTPUT_TOKENS = "abc"; expect(maxOutputTokens()).toBe(8192);
  });
});

/**
 * Live CSO stream resilience.
 *
 * The 2026-11-02 deploy showed expert streams that returned HTTP 200 and then
 * failed before any token (upstream_transport). These tests cover the retry
 * ladder: two backoff retries, the last one non-streaming, one error row when
 * the seat still fails, and the paid planning-model defaults.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  callExpertStreamWithResilience,
  expertRetryDelayMs,
  PLANNING_MAX_TOKENS,
  planningModelsForTier,
  providerFailureLogDetail,
} from "../server/ai";
import { BUDGET_FALLBACK_MODEL, DEFAULT_AUX_MODEL_FALLBACK_SLUG, DEFAULT_AUX_MODEL_SLUG, isHouseKeyAllowedModel } from "../server/usage-caps";
import { OUTPUT_LIMIT_ERROR } from "../server/ai-providers";
import type { AIModelResponse } from "../server/ai";

const reply = (content: string, model = "z-ai/glm-5.3-flash"): AIModelResponse => ({
  message: { role: "assistant", content },
  providerModel: model,
});

const streamFailure = (message = "stream reset") =>
  Object.assign(new Error(message), { isProviderError: true });

function deps(stream: ReturnType<typeof vi.fn>, chat: ReturnType<typeof vi.fn>) {
  return { stream: stream as any, chat: chat as any };
}

describe("expert stream resilience", () => {
  const sleep = vi.fn(async () => {});

  beforeEach(() => {
    sleep.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DEFAULT_AUX_MODEL;
    delete process.env.TOOL_PLANNING_MODEL;
  });

  it("retries twice with exponential backoff and answers the last attempt non-streaming", async () => {
    const stream = vi.fn()
      .mockRejectedValueOnce(streamFailure())
      .mockRejectedValueOnce(streamFailure());
    const chat = vi.fn().mockResolvedValue(reply("Recovered answer"));
    const tokens: string[] = [];

    const response = await callExpertStreamWithResilience(
      [{ role: "user", content: "Assess the pilot" }],
      "z-ai/glm-5.3-flash",
      token => tokens.push(token),
      undefined,
      false,
      { maxTokens: 1200 },
      deps(stream, chat),
      { sleep },
    );

    expect(response.message.content).toBe("Recovered answer");
    expect(stream).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(tokens).toEqual(["Recovered answer"]);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([800, 1600]);
    // The final attempt reuses the same model and options.
    expect(chat.mock.calls[0][1]).toBe("z-ai/glm-5.3-flash");
    expect(chat.mock.calls[0][4]).toEqual({ maxTokens: 1200 });
  });

  it("buffers a retried stream and flushes it once, so a failed attempt leaves no partial text", async () => {
    const stream = vi.fn()
      .mockRejectedValueOnce(streamFailure())
      .mockImplementationOnce(async (_messages, _model, onToken: (token: string) => void) => {
        onToken("Buffered ");
        onToken("answer");
        return reply("Buffered answer");
      });
    const chat = vi.fn();
    const tokens: string[] = [];

    const response = await callExpertStreamWithResilience(
      [{ role: "user", content: "Assess the pilot" }],
      "z-ai/glm-5.3-flash",
      token => tokens.push(token),
      undefined,
      false,
      {},
      deps(stream, chat),
      { sleep },
    );

    expect(response.message.content).toBe("Buffered answer");
    expect(chat).not.toHaveBeenCalled();
    expect(tokens).toEqual(["Buffered answer"]);
  });

  it("retries an empty length failure with a larger output budget", async () => {
    const lengthFailure = () =>
      Object.assign(new Error(OUTPUT_LIMIT_ERROR), { isProviderError: true, finishReason: "length" });
    const stream = vi.fn()
      .mockRejectedValueOnce(lengthFailure())
      .mockImplementationOnce(async (_messages: unknown, _model: string, onToken: (token: string) => void) => {
        onToken("Full answer");
        return reply("Full answer");
      });
    const chat = vi.fn();
    const tokens: string[] = [];

    const response = await callExpertStreamWithResilience(
      [{ role: "user", content: "Assess the pilot" }],
      "z-ai/glm-5.3-flash",
      token => tokens.push(token),
      undefined,
      false,
      { maxTokens: 8192 },
      deps(stream, chat),
      { sleep },
    );

    expect(response.message.content).toBe("Full answer");
    expect(tokens).toEqual(["Full answer"]);
    expect(stream.mock.calls[0][5]).toEqual({ maxTokens: 8192 });
    // Mandatory reasoning shares the budget, so the retry asks for 16k tokens.
    expect(stream.mock.calls[1][5]).toEqual({ maxTokens: 16384 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("retrying with 16384 output tokens"));
  });

  it("marks an exhausted seat so the orchestrator records exactly one error row", async () => {
    const stream = vi.fn().mockRejectedValue(streamFailure());
    const chat = vi.fn().mockRejectedValue(streamFailure("final attempt failed"));

    const error = await callExpertStreamWithResilience(
      [{ role: "user", content: "Assess the pilot" }],
      "deepseek/deepseek-v4.1-flash",
      () => {},
      undefined,
      false,
      {},
      deps(stream, chat),
      { sleep },
    ).catch(caught => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ providerRetriesExhausted: true, providerAttempts: 3 });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([800, 1600]);
  });

  it("does not retry configuration failures or streams that already reached the client", async () => {
    const configFailure = Object.assign(new Error("bad key"), { statusCode: 401, isProviderError: true });
    const configStream = vi.fn().mockRejectedValue(configFailure);
    const configChat = vi.fn();
    await expect(callExpertStreamWithResilience(
      [{ role: "user", content: "Assess the pilot" }], "z-ai/glm-5.3-flash", () => {},
      undefined, false, {}, deps(configStream, configChat), { sleep },
    )).rejects.toBe(configFailure);
    expect(configStream).toHaveBeenCalledTimes(1);
    expect(configChat).not.toHaveBeenCalled();

    const partialStream = vi.fn().mockImplementation(async (_m, _model, onToken: (token: string) => void) => {
      onToken("Partial answer");
      throw streamFailure();
    });
    const partialChat = vi.fn();
    const error = await callExpertStreamWithResilience(
      [{ role: "user", content: "Assess the pilot" }], "z-ai/glm-5.3-flash", () => {},
      undefined, false, {}, deps(partialStream, partialChat), { sleep },
    ).catch(caught => caught);
    expect((error as Error).message).toBe("stream reset");
    expect(error).not.toHaveProperty("providerRetriesExhausted");
    expect(partialStream).toHaveBeenCalledTimes(1);
    expect(partialChat).not.toHaveBeenCalled();
  });

  it("uses an 800ms base delay and doubles it", () => {
    expect(expertRetryDelayMs(0)).toBe(800);
    expect(expertRetryDelayMs(1)).toBe(1600);
    expect(expertRetryDelayMs(2)).toBe(3200);
    expect(expertRetryDelayMs(1, 250)).toBe(500);
  });

  it("describes a provider failure for the [STREAM] line without keys and with a bounded excerpt", () => {
    process.env.OPENROUTER_API_KEY = "secret-value-123456";
    const error = Object.assign(new Error("upstream died"), {
      provider: "Relace",
      statusCode: 200,
      nativeFinishReason: "error",
      providerErrorText: `body secret-value-123456 ${"y".repeat(900)}`,
    });

    const detail = providerFailureLogDetail(error);

    expect(detail).toContain("provider=Relace");
    expect(detail).toContain("httpStatus=200");
    expect(detail).toContain("nativeFinishReason=error");
    expect(detail).not.toContain("secret-value-123456");
    expect(detail.length).toBeLessThan(1200);
    delete process.env.OPENROUTER_API_KEY;
  });
});

describe("planning model defaults", () => {
  beforeEach(() => {
    delete process.env.TOOL_PLANNING_MODEL;
  });
  afterEach(() => {
    delete process.env.TOOL_PLANNING_MODEL;
  });

  it("uses the paid aux default plus one paid fallback on paid tiers", () => {
    expect(planningModelsForTier("pro")).toEqual([DEFAULT_AUX_MODEL_SLUG, DEFAULT_AUX_MODEL_FALLBACK_SLUG]);
    expect(planningModelsForTier("enterprise")).toEqual([DEFAULT_AUX_MODEL_SLUG, DEFAULT_AUX_MODEL_FALLBACK_SLUG]);
    expect(DEFAULT_AUX_MODEL_SLUG).toBe("z-ai/glm-5.3-flash");
    expect(DEFAULT_AUX_MODEL_FALLBACK_SLUG).toBe("openai/gpt-6-luna");
    expect(isHouseKeyAllowedModel(DEFAULT_AUX_MODEL_SLUG)).toBe(true);
    expect(isHouseKeyAllowedModel(DEFAULT_AUX_MODEL_FALLBACK_SLUG)).toBe(true);
  });

  it("keeps free tiers on the free budget slug", () => {
    expect(planningModelsForTier("free")).toEqual([BUDGET_FALLBACK_MODEL]);
    expect(planningModelsForTier(undefined)).toEqual([BUDGET_FALLBACK_MODEL]);
  });

  it("honors TOOL_PLANNING_MODEL as a single override", () => {
    process.env.TOOL_PLANNING_MODEL = "  z-ai/glm-5.3-flash  ";
    expect(planningModelsForTier("free")).toEqual(["z-ai/glm-5.3-flash"]);
  });

  it("leaves headroom for the planning reply plus mandatory reasoning", () => {
    expect(PLANNING_MAX_TOKENS).toBeGreaterThanOrEqual(4096);
  });
});

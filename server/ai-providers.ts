import { checkHouseKeyCall, currentUsagePeriod, UsageCapError, budgetFallbackModelForTier, FREE_TIER_BUDGET_MODEL } from "./usage-caps";
import { MAX_LOGGED_PROVIDER_TEXT, redactAndTruncateLogText } from "./log-redaction";
import type { AIMessage, AIModelResponse } from './ai';
import { randomUUID } from 'crypto';

const AI_REQUEST_TIMEOUT_MS = 120_000;
export const OUTPUT_LIMIT_ERROR = "Response reached the output limit. Please ask for a shorter response or split the request into smaller parts.";
export { MAX_LOGGED_PROVIDER_TEXT };
/**
 * Providers excluded from OpenRouter routing by default; override with
 * OPENROUTER_PROVIDER_IGNORE. OpenRouter matches provider *slugs*, which are
 * lowercase (`relace`, not `Relace`), so the default is normalized.
 */
export const DEFAULT_PROVIDER_IGNORE = ["relace"] as const;
// Output ceiling per call. 1024 truncated File Creator SOPs mid-document.
// Reasoning models (z-ai/glm-5.3-flash, openai/gpt-6-luna) bill reasoning
// against this same budget, so a small cap produced finish_reason=length with
// little or no visible text. 8192 leaves room for ~1,000 reasoning tokens and
// a full memo; 4096 planning replies are plenty. Override with
// OPENROUTER_MAX_OUTPUT_TOKENS (a retry may escalate up to the ceiling).
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
/** Hard ceiling for an explicitly escalated retry budget. */
export const MAX_OUTPUT_TOKENS_CEILING = 32768;

/**
 * Reasoning request field. `none` means "do not ask for extra reasoning": the
 * field is omitted entirely. Sending `{ enabled: false }` or `effort: "none"`
 * is rejected by mandatory-reasoning endpoints — z-ai/glm-5.3-flash answers
 * HTTP 400 "Reasoning is mandatory for this endpoint and cannot be disabled."
 * Providers accept an omitted reasoning field, so omission is the safe form.
 */
function reasoningParam(override?: string): { reasoning?: { effort: string } } {
  const effort = (override ?? process.env.OPENROUTER_REASONING_EFFORT ?? "").trim();
  if (!effort || effort.toLowerCase() === "none") return {};
  return { reasoning: { effort } };
}

export function maxOutputTokens(): number {
  const parsed = Number(process.env.OPENROUTER_MAX_OUTPUT_TOKENS);
  return Number.isInteger(parsed) && parsed >= 256 && parsed <= MAX_OUTPUT_TOKENS_CEILING
    ? parsed
    : DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Next output budget for a finish_reason=length retry. Doubles the failed
 * budget (at least +2048 tokens) without exceeding the hard ceiling.
 */
export function escalatedOutputTokens(current?: number): number {
  const base = current && current > 0 ? current : maxOutputTokens();
  return Math.min(Math.max(base * 2, base + 2048), MAX_OUTPUT_TOKENS_CEILING);
}

/** True for the OpenRouter 400 that rejects a disabled reasoning setting. */
export const MANDATORY_REASONING_PATTERN = /reasoning is mandatory[\s\S]{0,120}(?:cannot be disabled|must be enabled)/i;

export function isMandatoryReasoningError(status: number | undefined, body: string): boolean {
  return status === 400 && MANDATORY_REASONING_PATTERN.test(body);
}
// Free OpenRouter models come and go; when a :free model is requested,
// OpenRouter's `models` array lets it fall through to these (verified live 2026-10-16).
export const FREE_MODEL_FALLBACKS = [
  "dots-studio/dots-3-note-preview:free",
];
export function modelRouting(model: string): { model: string; models?: string[] } {
  if (!model.endsWith(":free")) return { model };
  return { model, models: [model, ...FREE_MODEL_FALLBACKS.filter(m => m !== model)].slice(0, 3) };
}

/**
 * OpenRouter provider preferences for every house-key call. "relace" routed
 * live expert streams that returned HTTP 200 and then failed before any token,
 * so it is ignored unless OPENROUTER_PROVIDER_IGNORE says otherwise (comma
 * separated; set it to an empty string to allow every provider). Provider
 * preferences are provider slugs and case-sensitive to OpenRouter's lowercase
 * slug list, so every name is normalized here.
 */
export function providerPreferences(env: NodeJS.ProcessEnv = process.env): { ignore?: string[]; allow_fallbacks: boolean } {
  const raw = env.OPENROUTER_PROVIDER_IGNORE;
  const names = Array.from(new Set((raw === undefined ? DEFAULT_PROVIDER_IGNORE.join(",") : raw)
    .split(",")
    .map(name => name.trim().toLowerCase())
    .filter(Boolean)));
  return { ...(names.length ? { ignore: names } : {}), allow_fallbacks: true };
}

/** Truncate and redact provider error text before it reaches a log line. */
export function sanitizeProviderErrorText(value: unknown): string | undefined {
  return redactAndTruncateLogText(value);
}
const SPEND_CAP_PER_REQUEST_USD = 0.4;

export class OpenRouterSpendLimitError extends Error {
  constructor() {
    super("The OpenRouter verification spend limit has been reached. Keep the saved work and retry only after reviewing usage.");
    this.name = "OpenRouterSpendLimitError";
  }
}

type OpenRouterAttempt = {
  id: string;
  model: string;
  requestModel?: string;
  routedModels?: string[];
  startedAt: number;
  reservedUsd: number;
  maxTokens: number;
  houseKeyUserId?: number;
  usagePeriod?: string;
  /** One-time session credit funding this conversation, when any. */
  sessionCreditId?: number;
  providerPriceLimit?: { prompt: number; completion: number };
  settled: boolean;
};

export type OpenRouterUsageSnapshot = {
  capUsd: number | null;
  spentUsd: number;
  reservedUsd: number;
  attempts: Array<{
    requestId: string;
    generationId?: string;
    model: string;
    attemptedModel: string;
    requestModel?: string;
    routedModels?: string[];
    fallbackModels?: string[];
    fallbackUsed?: boolean;
    responseModel?: string;
    provider?: string;
    elapsedMs: number;
    result: "success" | "failed";
    costUsd: number | null;
    httpStatus?: number;
    providerStatus?: number;
    failureCategory?: "timeout" | "rate_limit" | "configuration" | "upstream_transport";
    finishReason?: string;
    nativeFinishReason?: string;
    providerError?: string;
  }>;
};

type ProviderFailureCategory = "timeout" | "rate_limit" | "configuration" | "upstream_transport";
type ProviderErrorDiagnostics = { provider?: string; providerStatus?: number };

function safeProviderIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const provider = value.trim();
  return provider.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(provider) ? provider : undefined;
}

function providerErrorDiagnostics(error: unknown): ProviderErrorDiagnostics {
  if (typeof error !== "object" || error === null) return {};
  const details = error as { code?: unknown; metadata?: unknown };
  const metadata = typeof details.metadata === "object" && details.metadata !== null
    ? details.metadata as { provider_name?: unknown }
    : {};
  const provider = safeProviderIdentifier(metadata.provider_name);
  const providerStatus = typeof details.code === "number" && Number.isInteger(details.code) && details.code >= 100 && details.code <= 599
    ? details.code
    : undefined;
  return {
    ...(provider ? { provider } : {}),
    ...(providerStatus === undefined ? {} : { providerStatus }),
  };
}

function providerErrorDiagnosticsFromBody(body: string): ProviderErrorDiagnostics {
  try {
    return providerErrorDiagnostics(JSON.parse(body)?.error);
  } catch {
    return {};
  }
}

function providerFailureCategory(error: unknown, httpStatus?: number, providerCode?: number): ProviderFailureCategory {
  const details = typeof error === "object" && error !== null
    ? error as { name?: unknown; code?: unknown; cause?: unknown; message?: unknown }
    : {};
  const cause = typeof details.cause === "object" && details.cause !== null
    ? details.cause as { name?: unknown; code?: unknown }
    : {};
  const codes = [details.code, cause.code].map(value => String(value ?? ""));
  const names = [details.name, cause.name].map(value => String(value ?? ""));

  if (httpStatus === 408 || providerCode === 408 ||
      names.some(name => /^(?:TimeoutError|APIConnectionTimeoutError)$/i.test(name)) ||
      codes.some(code => /^(?:ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)$/i.test(code))) return "timeout";
  if (httpStatus === 429 || providerCode === 429) return "rate_limit";
  const errorStatus = providerCode ?? httpStatus;
  if ((errorStatus !== undefined && errorStatus >= 400 && errorStatus < 500 && errorStatus !== 425) ||
      /OpenRouter API key not provided|UsageCapError|SpendLimitError/i.test(`${names.join(" ")} ${details.message ?? ""}`)) {
    return "configuration";
  }
  return "upstream_transport";
}

/**
 * Transport failures (a reset mid-stream, an unclassified network error) are
 * recoverable, but the raw error may carry no HTTP status or known code. Mark
 * them the same way as provider errors so the orchestrator's single retry can
 * run. Output-limit failures are also retryable for expert replies: the retry
 * asks for a concise answer instead of persisting an empty turn. Configuration
 * failures stay non-retryable.
 */
function markRetryableProviderFailure(error: unknown, failureCategory: ProviderFailureCategory): void {
  if (failureCategory === "configuration" || !(error instanceof Error)) return;
  if ((error as { isProviderError?: boolean }).isProviderError === true) return;
  Object.assign(error, { isProviderError: true });
}

function configuredSpendCap(): number | null {
  const raw = process.env.OPENROUTER_SPEND_CAP_USD;
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function numericCost(usage: any): number | undefined {
  const value = usage?.cost ?? usage?.total_cost ?? usage?.totalCost;
  const cost = typeof value === "string" ? Number(value) : value;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

const UNSUPPORTED_IMAGE_ERROR = /(?:image|vision|modalit|multimodal)[\s\S]{0,100}(?:not\s+support|unsupport\w*|reject\w*|invalid|disabled|not\s+allowed|can(?:not|'t)|unable)|(?:not\s+support|unsupport\w*|reject\w*|invalid|disabled|not\s+allowed|can(?:not|'t)|unable)[\s\S]{0,100}(?:image|vision|modalit|multimodal)|support\s+(?:[\w-]+\s+){0,2}(?:image|vision|multimodal|modalit)/i;

function safeOpenRouterError(
  status: number | undefined,
  providerDetail?: unknown,
  diagnostics: ProviderErrorDiagnostics = {},
): Error {
  let detail = "";
  try {
    detail = typeof providerDetail === "string" ? providerDetail : JSON.stringify(providerDetail ?? "");
  } catch {
    detail = "";
  }
  const unsupportedImage = status === 413 ||
    ((status === undefined || [400, 404, 422].includes(status)) && UNSUPPORTED_IMAGE_ERROR.test(detail.slice(0, 4096)));
  const message = unsupportedImage
    ? "This model does not support image input."
    : status === 401
    ? "OpenRouter authentication failed. Contact the account operator."
    : status === 402
      ? "The OpenRouter account needs credits. Contact the account operator."
      : status === 429
        ? "OpenRouter is temporarily rate-limited. Try again later."
        : `OpenRouter could not complete this request${status === undefined ? "" : ` (${status})`}. Retry or continue with available work.`;
  return Object.assign(
    new Error(message),
    status === undefined ? {} : { statusCode: status },
    { isProviderError: true },
    diagnostics,
    providerDetail === undefined ? {} : { providerErrorText: sanitizeProviderErrorText(providerDetail) },
  );
}

/** Attach log-only diagnostics to the error without changing its message. */
function attachProviderLogDetails(error: unknown, details: {
  provider?: string;
  finishReason?: string;
  nativeFinishReason?: string;
  providerErrorText?: string;
}): void {
  if (typeof error !== "object" || error === null) return;
  const cleaned = Object.fromEntries(Object.entries(details).filter(([, value]) => typeof value === "string" && value.length > 0));
  Object.assign(error, cleaned);
}

// ─── Provider Interface ───────────────────────────────────────────────────────

/** Per-call options. maxTokens overrides the default output cap (e.g. expert replies). */
export type ChatOptions = {
  maxTokens?: number;
  /** Per-call OpenRouter reasoning effort; overrides OPENROUTER_REASONING_EFFORT. */
  reasoningEffort?: string;
  /**
   * Conversation this call belongs to. Lets the caps layer apply a one-time
   * session credit's own AI cap and model allowlist instead of the plan's.
   */
  conversationId?: number;
};

export interface AIProvider {
  chat(messages: AIMessage[], model: string, userId?: number, webSearch?: boolean, options?: ChatOptions): Promise<AIModelResponse>;
  chatStream(
    messages: AIMessage[],
    model: string,
    onToken: (token: string) => void,
    userId?: number,
    webSearch?: boolean,
    options?: ChatOptions
  ): Promise<AIModelResponse>;
}

// ─── OpenRouter Provider ───────────────────────────────────────────────────────

export class OpenRouterProvider implements AIProvider {
  private readonly spendCapUsd: number | null;
  private spentUsd = 0;
  private reservedUsd = 0;
  private attempts: OpenRouterUsageSnapshot["attempts"] = [];

  constructor(spendCapUsd?: number | null) {
    this.spendCapUsd = spendCapUsd === undefined ? configuredSpendCap() : spendCapUsd;
  }

  getUsageSnapshot(): OpenRouterUsageSnapshot {
    return {
      capUsd: this.spendCapUsd,
      spentUsd: Number(this.spentUsd.toFixed(8)),
      reservedUsd: Number(this.reservedUsd.toFixed(8)),
      attempts: this.attempts.map(attempt => ({ ...attempt })),
    };
  }

  private beginAttempt(model: string, messages: AIMessage[], maxTokensOverride?: number): OpenRouterAttempt {
    // An explicit per-call budget (expert turn, synthesis, or an escalated
    // length retry) may exceed the env default; only the hard ceiling clamps it.
    const maxTokens = maxTokensOverride && maxTokensOverride > 0
      ? Math.min(maxTokensOverride, MAX_OUTPUT_TOKENS_CEILING)
      : maxOutputTokens();
    const attempt: OpenRouterAttempt = {
      id: randomUUID(),
      model,
      startedAt: Date.now(),
      reservedUsd: 0,
      maxTokens,
      settled: false,
    };
    if (this.spendCapUsd === null) return attempt;

    const remainingUsd = this.spendCapUsd - this.spentUsd - this.reservedUsd;
    if (remainingUsd < 0.002) throw new OpenRouterSpendLimitError();
    const reservation = Math.min(SPEND_CAP_PER_REQUEST_USD, remainingUsd);
    const estimatedInputTokens = Math.max(1, Math.ceil(JSON.stringify(messages).length * 2));
    attempt.reservedUsd = reservation;
    attempt.maxTokens = maxTokens;
    attempt.providerPriceLimit = {
      prompt: Number(((reservation * 0.45 * 1_000_000) / estimatedInputTokens).toFixed(8)),
      completion: Number(((reservation * 0.45 * 1_000_000) / attempt.maxTokens).toFixed(8)),
    };
    this.reservedUsd += reservation;
    return attempt;
  }

  private settleAttempt(
    attempt: OpenRouterAttempt,
    result: "success" | "failed",
    usage?: unknown,
    metadata: {
      generationId?: string;
      responseModel?: string;
      provider?: string;
      httpStatus?: number;
      providerStatus?: number;
      failureCategory?: ProviderFailureCategory;
      finishReason?: string;
      nativeFinishReason?: string;
      providerError?: string;
    } = {},
  ): void {
    if (attempt.settled) return;
    attempt.settled = true;
    const costUsd = numericCost(usage);
    if (attempt.houseKeyUserId && attempt.usagePeriod && costUsd) {
      const { houseKeyUserId, usagePeriod, sessionCreditId } = attempt;
      void import("./storage")
        .then(({ storage }) => Promise.all([
          storage.addMonthlyAiSpend(houseKeyUserId, usagePeriod, costUsd),
          sessionCreditId ? storage.addSessionCreditSpend(sessionCreditId, costUsd) : Promise.resolve(),
        ]))
        .catch(err => console.error("[CAPS] failed to record AI spend:", (err as Error).message));
    }
    if (attempt.reservedUsd > 0) {
      this.reservedUsd = Math.max(0, this.reservedUsd - attempt.reservedUsd);
      // When the provider omits cost, conservatively consume the reservation
      // so later calls cannot turn missing telemetry into unbounded spend.
      this.spentUsd += costUsd ?? attempt.reservedUsd;
    } else if (costUsd !== undefined) {
      this.spentUsd += costUsd;
    }
    const record: OpenRouterUsageSnapshot["attempts"][number] = {
      requestId: attempt.id,
      ...(metadata.generationId ? { generationId: metadata.generationId } : {}),
      model: attempt.model,
      attemptedModel: attempt.model,
      ...(attempt.requestModel ? { requestModel: attempt.requestModel } : {}),
      ...(attempt.routedModels ? {
        routedModels: [...attempt.routedModels],
        ...(attempt.routedModels.length > 1 ? { fallbackModels: attempt.routedModels.slice(1) } : {}),
      } : {}),
      ...(metadata.responseModel && attempt.routedModels?.length
        ? { fallbackUsed: attempt.routedModels.slice(1).includes(metadata.responseModel) ||
          (attempt.requestModel !== attempt.model && metadata.responseModel === attempt.requestModel) }
        : {}),
      ...(metadata.responseModel ? { responseModel: metadata.responseModel } : {}),
      ...(metadata.provider ? { provider: metadata.provider } : {}),
      elapsedMs: Date.now() - attempt.startedAt,
      result,
      costUsd: costUsd ?? null,
      ...(metadata.httpStatus === undefined ? {} : { httpStatus: metadata.httpStatus }),
      ...(metadata.providerStatus === undefined ? {} : { providerStatus: metadata.providerStatus }),
      ...(metadata.failureCategory ? { failureCategory: metadata.failureCategory } : {}),
      ...(metadata.finishReason ? { finishReason: metadata.finishReason } : {}),
      ...(metadata.nativeFinishReason ? { nativeFinishReason: metadata.nativeFinishReason } : {}),
      ...(metadata.providerError ? { providerError: metadata.providerError } : {}),
    };
    this.attempts.push(record);
    if (this.attempts.length > 100) this.attempts.splice(0, this.attempts.length - 100);
    console.info(`OPENROUTER_ATTEMPT ${JSON.stringify({
      ...record,
      ...(attempt.reservedUsd ? { reservedUsd: attempt.reservedUsd } : {}),
      usageKnown: costUsd !== undefined,
      sessionSpentUsd: Number(this.spentUsd.toFixed(8)),
      sessionCapUsd: this.spendCapUsd,
    })}`);
  }

  private requestBudget(attempt: OpenRouterAttempt) {
    return {
      max_tokens: attempt.maxTokens,
      provider: {
        ...providerPreferences(),
        ...(attempt.providerPriceLimit ? { max_price: attempt.providerPriceLimit } : {}),
      },
    };
  }

  private requestPayload(args: {
    routing: { model: string; models?: string[] };
    messages: AIMessage[];
    attempt: OpenRouterAttempt;
    options: ChatOptions;
    webSearch: boolean;
    stream: boolean;
    includeReasoning: boolean;
  }): Record<string, unknown> {
    return {
      ...args.routing,
      messages: args.messages,
      temperature: 0.7,
      ...this.requestBudget(args.attempt),
      usage: { include: true },
      ...(args.includeReasoning ? reasoningParam(args.options.reasoningEffort) : {}),
      ...(args.webSearch ? { plugins: [{ id: "web", max_results: 3 }] } : {}),
      ...(args.stream ? { stream: true } : {}),
    };
  }

  /**
   * POST one chat completion. When a reasoning-disable setting triggers the
   * mandatory-reasoning 400, retry once with the reasoning field omitted. The
   * error body is returned when it was consumed so the caller can still log it.
   */
  private async postChatCompletion(args: {
    model: string;
    routing: { model: string; models?: string[] };
    messages: AIMessage[];
    attempt: OpenRouterAttempt;
    options: ChatOptions;
    webSearch: boolean;
    stream: boolean;
    openRouterKey: string;
  }): Promise<{ response: Response; errorBody?: string }> {
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const send = (includeReasoning: boolean) => fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${args.openRouterKey}`,
        "HTTP-Referer": "https://github.com/0-CYBERDYNE-SYSTEMS-0/quorum",
        "X-Title": "Quorum"
      },
      body: JSON.stringify(this.requestPayload({ ...args, includeReasoning })),
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    });
    const sendsReasoning = Object.keys(reasoningParam(args.options.reasoningEffort)).length > 0;
    let response = await send(sendsReasoning);
    if (response.ok || response.status !== 400 || !sendsReasoning) return { response };

    const body = await response.text().catch(() => "");
    if (!isMandatoryReasoningError(response.status, body)) return { response, errorBody: body };

    console.warn(`[OPENROUTER] ${args.model} requires reasoning; retrying ${args.stream ? "stream" : "call"} without the reasoning field`);
    response = await send(false);
    if (response.ok || response.status !== 400) return { response };
    return { response, errorBody: await response.text().catch(() => "") };
  }

  private async getApiKey(userId?: number): Promise<string> {
    return (await this.resolveKey(userId)).key;
  }

  /**
   * Resolve the key for a call and enforce pricing caps on house-key calls
   * (server/usage-caps.ts): tier gate, model allowlist (fast for Pro,
   * fast + frontier for Boardroom), monthly budget — or, when the
   * conversation runs on a one-time session credit, that credit's allowlist
   * and AI cap. BYOK calls are never capped and never counted.
   */
  private async authorizeCall(
    attempt: OpenRouterAttempt,
    model: string,
    userId?: number,
    options: ChatOptions = {},
  ): Promise<{ key: string; model: string }> {
    const { key, byok } = await this.resolveKey(userId);
    if (byok || !userId) return { key, model };
    const { storage } = await import("./storage");
    const user = await storage.getUser(userId);
    const period = currentUsagePeriod();
    const usage = await storage.getMonthlyUsage(userId, period);
    const credit = options.conversationId
      ? await storage.getSessionCreditByConversationId(options.conversationId)
      : undefined;
    const creditContext = credit
      ? {
          kind: credit.kind as "fast" | "boardroom",
          spentUsd: credit.aiSpendUsd,
        }
      : undefined;
    const denial = checkHouseKeyCall(user?.tier, model, usage.aiSpendUsd, creditContext);
    if (denial?.code === "ai_budget_overage") {
      // Graceful paid overage: keep answering on the tier's PAID fallback model
      // (never a ':free' slug for paying customers). Past the 25% ceiling
      // checkHouseKeyCall returns ai_budget_exhausted instead and the call is
      // refused with the existing message. The call still counts against the
      // monthly spend, otherwise the ceiling could never be reached.
      const fallback = budgetFallbackModelForTier(user?.tier);
      console.info(`[CAPS] user ${userId} over AI budget — ${model} -> ${fallback}`);
      attempt.houseKeyUserId = userId;
      attempt.usagePeriod = period;
      return { key, model: fallback };
    }
    if (denial?.code === "ai_budget_exhausted") {
      if (creditContext) throw new UsageCapError(denial);
      if (user?.tier !== "pro" && user?.tier !== "boardroom" && user?.tier !== "enterprise") {
        // Free tier keeps its existing behaviour: keep answering on the free
        // budget model (free calls are never billed).
        console.info(`[CAPS] user ${userId} AI budget spent — ${model} -> ${FREE_TIER_BUDGET_MODEL}`);
        return { key, model: FREE_TIER_BUDGET_MODEL };
      }
      // Paid tiers are past the overage ceiling: surface ai_budget_exhausted.
      throw new UsageCapError(denial);
    }
    if (denial) throw new UsageCapError(denial);
    attempt.houseKeyUserId = userId;
    attempt.usagePeriod = period;
    if (credit) attempt.sessionCreditId = credit.id;
    return { key, model };
  }

  private async resolveKey(userId?: number): Promise<{ key: string; byok: boolean }> {
    // If a userId is provided, try to use their stored BYOK key first
    if (userId) {
      try {
        const { storage } = await import("./storage");
        const userKey = await storage.getUserApiKey(userId);
        if (userKey) {
          console.log(`[BYOK] Using user-provided API key for user ${userId}`);
          return { key: userKey, byok: true };
        }
      } catch (err) {
        console.warn("[BYOK] Failed to retrieve user API key:", (err as Error).message);
      }
    }

    // Fall back to platform key. Trim: secrets pasted into a host dashboard
    // routinely carry a trailing newline, which OpenRouter rejects.
    const platformKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!platformKey) {
      throw new Error("OpenRouter API key not provided");
    }
    return { key: platformKey, byok: false };
  }

  async chat(messages: AIMessage[], model: string, userId?: number, webSearch = false, options: ChatOptions = {}): Promise<AIModelResponse> {
    const attempt = this.beginAttempt(model, messages, options.maxTokens);
    let requestStarted = false;
    let usage: unknown;
    let generationId: string | undefined;
    let provider: string | undefined;
    let responseModel: string | undefined;
    let httpStatus: number | undefined;
    let finishReason: string | undefined;
    let nativeFinishReason: string | undefined;
    try {
      const authorized = await this.authorizeCall(attempt, model, userId, options);
      const openRouterKey = authorized.key;
      model = authorized.model;
      const routing = modelRouting(model);
      attempt.requestModel = model;
      attempt.routedModels = routing.models ?? [routing.model];

      requestStarted = true;
      const { response, errorBody } = await this.postChatCompletion({
        model,
        routing,
        messages,
        attempt,
        options,
        webSearch,
        stream: false,
        openRouterKey,
      });
      httpStatus = response.status;

      if (!response.ok) {
        const body = errorBody ?? await response.text().catch(() => "");
        throw safeOpenRouterError(response.status, body, providerErrorDiagnosticsFromBody(body));
      }

      const data = await response.json() as any;
      usage = data?.usage;
      generationId = typeof data?.id === "string" ? data.id : undefined;
      provider = typeof data?.provider === "string" ? data.provider : undefined;
      responseModel = typeof data?.model === "string" ? data.model : undefined;

      if (data && data.error) {
        throw safeOpenRouterError(
          Number.isInteger(data.error.code) ? data.error.code : undefined,
          data.error,
          providerErrorDiagnostics(data.error),
        );
      }

      if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0 || !data.choices[0] || !data.choices[0].message) {
        throw new Error("Invalid response format from OpenRouter API");
      }

      finishReason = typeof data.choices[0].finish_reason === "string" ? data.choices[0].finish_reason : undefined;
      nativeFinishReason = typeof data.choices[0].native_finish_reason === "string" ? data.choices[0].native_finish_reason : undefined;

      if (data.choices[0].finish_reason === "length") {
        throw new Error(OUTPUT_LIMIT_ERROR);
      }

      this.settleAttempt(attempt, "success", usage, {
        generationId, responseModel, provider, httpStatus, finishReason, nativeFinishReason,
      });
      return {
        message: data.choices[0].message,
        ...(Array.isArray(data.citations) ? { citations: data.citations.filter((value: unknown): value is string => typeof value === "string") } : {}),
        ...(usage && typeof usage === "object" ? { usage } : {}),
        ...(generationId ? { providerGenerationId: generationId } : {}),
        ...(responseModel ? { providerModel: responseModel } : {}),
        ...(provider ? { providerName: provider } : {}),
      };
    } catch (error: unknown) {
      const providerCode = typeof (error as any)?.statusCode === "number" ? (error as any).statusCode : undefined;
      const diagnostics = typeof error === "object" && error !== null ? error as ProviderErrorDiagnostics : {};
      const logged = typeof error === "object" && error !== null
        ? error as { finishReason?: string; nativeFinishReason?: string; providerErrorText?: string }
        : {};
      const failureCategory = providerFailureCategory(error, httpStatus, providerCode);
      markRetryableProviderFailure(error, failureCategory);
      attachProviderLogDetails(error, {
        provider: diagnostics.provider ?? provider,
        finishReason: finishReason ?? logged.finishReason,
        nativeFinishReason: nativeFinishReason ?? logged.nativeFinishReason,
      });
      this.settleAttempt(attempt, "failed", requestStarted ? usage : { cost: 0 }, {
        generationId,
        responseModel,
        provider: diagnostics.provider ?? provider,
        httpStatus,
        providerStatus: diagnostics.providerStatus,
        failureCategory,
        finishReason: finishReason ?? logged.finishReason,
        nativeFinishReason: nativeFinishReason ?? logged.nativeFinishReason,
        providerError: logged.providerErrorText,
      });
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error("OpenRouter could not complete this request. Retry or continue with available work.");
      }
    }
  }

  async chatStream(
    messages: AIMessage[],
    model: string,
    onToken: (token: string) => void,
    userId?: number,
    webSearch = false,
    options: ChatOptions = {}
  ): Promise<AIModelResponse> {
    const attempt = this.beginAttempt(model, messages, options.maxTokens);
    let requestStarted = false;
    let usage: unknown;
    let generationId: string | undefined;
    let provider: string | undefined;
    let responseModel: string | undefined;
    let httpStatus: number | undefined;
    let streamFinishReason: string | undefined;
    let nativeFinishReason: string | undefined;
    try {
      const authorized = await this.authorizeCall(attempt, model, userId, options);
      const openRouterKey = authorized.key;
      model = authorized.model;
      const routing = modelRouting(model);
      attempt.requestModel = model;
      attempt.routedModels = routing.models ?? [routing.model];

      requestStarted = true;
      const { response, errorBody } = await this.postChatCompletion({
        model,
        routing,
        messages,
        attempt,
        options,
        webSearch,
        stream: true,
        openRouterKey,
      });
      httpStatus = response.status;

      if (!response.ok) {
        const body = errorBody ?? await response.text().catch(() => "");
        throw safeOpenRouterError(response.status, body, providerErrorDiagnosticsFromBody(body));
      }

      if (!response.body) {
        throw new Error("No response body for streaming");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            let parsed: any;
            try {
              parsed = JSON.parse(data);
            } catch {
              // Skip unparseable chunks
              continue;
            }

            if (parsed?.id && typeof parsed.id === "string") generationId = parsed.id;
            if (parsed?.provider && typeof parsed.provider === "string") provider = parsed.provider;
            if (parsed?.model && typeof parsed.model === "string") responseModel = parsed.model;
            if (parsed?.usage) usage = parsed.usage;

            if (parsed?.error) {
              throw safeOpenRouterError(
                Number.isInteger(parsed.error.code) ? parsed.error.code : undefined,
                parsed.error,
                providerErrorDiagnostics(parsed.error),
              );
            }

            const choice = parsed?.choices?.[0];
            if (typeof choice?.finish_reason === "string") {
              streamFinishReason = choice.finish_reason;
            }
            if (typeof choice?.native_finish_reason === "string") {
              nativeFinishReason = choice.native_finish_reason;
            } else if (typeof parsed?.native_finish_reason === "string") {
              nativeFinishReason = parsed.native_finish_reason;
            }
            const content = choice?.delta?.content;
            if (content) {
              fullContent += content;
              onToken(content);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (streamFinishReason === "length") {
        throw Object.assign(new Error(OUTPUT_LIMIT_ERROR), {
          finishReason: streamFinishReason,
          nativeFinishReason,
        });
      }

      // An OpenRouter stream can close cleanly after an upstream provider
      // stops early: HTTP 200, no error frame, no finish reason, no content.
      // Surface it as a provider failure so the expert resilience retry runs.
      if (!fullContent.trim() && !streamFinishReason) {
        throw Object.assign(
          new Error("The provider stream ended without content or a finish reason."),
          { isProviderError: true, nativeFinishReason },
        );
      }

      this.settleAttempt(attempt, "success", usage, {
        generationId, responseModel, provider, httpStatus, finishReason: streamFinishReason, nativeFinishReason,
      });

      return {
        message: { role: "assistant", content: fullContent },
        ...(usage && typeof usage === "object" ? { usage } : {}),
        ...(generationId ? { providerGenerationId: generationId } : {}),
        ...(responseModel ? { providerModel: responseModel } : {}),
        ...(provider ? { providerName: provider } : {}),
      };
    } catch (error: unknown) {
      const providerCode = typeof (error as any)?.statusCode === "number" ? (error as any).statusCode : undefined;
      const diagnostics = typeof error === "object" && error !== null ? error as ProviderErrorDiagnostics : {};
      const logged = typeof error === "object" && error !== null
        ? error as { finishReason?: string; nativeFinishReason?: string; providerErrorText?: string }
        : {};
      const failureCategory = providerFailureCategory(error, httpStatus, providerCode);
      markRetryableProviderFailure(error, failureCategory);
      attachProviderLogDetails(error, {
        provider: diagnostics.provider ?? provider,
        finishReason: streamFinishReason ?? logged.finishReason,
        nativeFinishReason: nativeFinishReason ?? logged.nativeFinishReason,
      });
      this.settleAttempt(attempt, "failed", requestStarted ? usage : { cost: 0 }, {
        generationId,
        responseModel,
        provider: diagnostics.provider ?? provider,
        httpStatus,
        providerStatus: diagnostics.providerStatus,
        failureCategory,
        finishReason: streamFinishReason ?? logged.finishReason,
        nativeFinishReason: nativeFinishReason ?? logged.nativeFinishReason,
        providerError: logged.providerErrorText,
      });
      if (error instanceof Error) throw error;
      throw new Error("OpenRouter could not complete this request. Retry or continue with available work.");
    }
  }
}

// ─── Local OpenAI-compatible Provider (ollama / LM Studio / llama.cpp) ─────────

export class LocalOpenAIProvider implements AIProvider {
  private getBaseUrl(): string {
    return process.env.LOCAL_AI_BASE_URL || 'http://localhost:11434/v1';
  }

  private getApiKey(): string | undefined {
    return process.env.LOCAL_AI_API_KEY || undefined;
  }

  private getActualModel(model: string): string {
    return resolveLocalModel(model);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = this.getApiKey();
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  async chat(messages: AIMessage[], model: string, _userId?: number): Promise<AIModelResponse> {
    const baseUrl = this.getBaseUrl();
    const actualModel = this.getActualModel(model);

    console.log(`[DEBUG] Entering LocalOpenAIProvider.chat for model: ${actualModel} at ${baseUrl}`);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: actualModel,
          messages: messages,
          temperature: 0.7,
          max_tokens: maxOutputTokens(),
          stream: false,
        }),
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
      });

      console.log(`[DEBUG] Local AI fetch completed. Status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[DEBUG] Local AI API Error Response Text: ${errorText}`);
        throw new Error(`Local AI API Error (${response.status}): ${errorText}`);
      }

      console.log("[DEBUG] Local AI response OK. Parsing JSON...");
      const data = await response.json();
      console.log("[DEBUG] Local AI JSON parsed successfully.");

      if (data && data.error) {
        console.error(`[DEBUG] Local AI returned error object:`, JSON.stringify(data.error));
        const errorMsg = data.error.message || JSON.stringify(data.error);
        throw new Error(`Local AI Provider Error: ${errorMsg}`);
      }

      if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0 || !data.choices[0] || !data.choices[0].message) {
        console.error("[DEBUG] Invalid/Incomplete response structure from Local AI:", JSON.stringify(data));
        throw new Error("Invalid response format from Local AI API");
      }

      console.log("[DEBUG] Local AI response structure validated. Returning message.");
      return {
        message: data.choices[0].message
      };
    } catch (error: unknown) {
      console.error("[DEBUG] Error caught within LocalOpenAIProvider.chat:", error);
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error(`Unknown error in LocalOpenAIProvider.chat: ${String(error)}`);
      }
    }
  }

  async chatStream(
    messages: AIMessage[],
    model: string,
    onToken: (token: string) => void,
    _userId?: number
  ): Promise<AIModelResponse> {
    const baseUrl = this.getBaseUrl();
    const actualModel = this.getActualModel(model);

    console.log(`[STREAM] Starting local stream for model: ${actualModel} at ${baseUrl}`);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: actualModel,
          messages: messages,
          temperature: 0.7,
          max_tokens: maxOutputTokens(),
          stream: true,
        }),
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Local AI API Error (${response.status}): ${errorText}`);
      }

      if (!response.body) {
        throw new Error("No response body for local streaming");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed?.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                onToken(content);
              }
            } catch {
              // Skip unparseable chunks
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      console.log(`[STREAM] Local complete for ${actualModel}. ${fullContent.length} chars`);

      return {
        message: { role: "assistant", content: fullContent }
      };
    } catch (error: unknown) {
      console.error("[STREAM] Local Error:", error);
      if (error instanceof Error) throw error;
      throw new Error(`Unknown error in LocalOpenAIProvider.chatStream: ${String(error)}`);
    }
  }
}

// ─── Singleton instances ──────────────────────────────────────────────────────

const openRouterProvider = new OpenRouterProvider();
const localOpenAIProvider = new LocalOpenAIProvider();

/**
 * Return the appropriate AI provider for a given model ID.
 * Models prefixed with "local/" use the local OpenAI-compatible provider
 * (ollama, LM Studio, llama.cpp). All others use OpenRouter.
 */
export function isLocalOnlyMode(): boolean {
  return /^(1|true|yes)$/i.test(process.env.OLLAMA_ENABLED ?? "");
}

/**
 * Map a requested model to the model name sent to the local server.
 * In local-only mode (OLLAMA_ENABLED=true) every expert uses OLLAMA_MODEL
 * (default "llama3"), so a self-hoster needs no paid keys at all.
 */
export function resolveLocalModel(model: string): string {
  if (isLocalOnlyMode()) return process.env.OLLAMA_MODEL || "llama3";
  const stripped = model.replace(/^local\//, '');
  return stripped === "default" ? (process.env.OLLAMA_MODEL || "llama3") : stripped;
}

export function getProvider(modelId: string): AIProvider {
  if (isLocalOnlyMode() || modelId.startsWith('local/')) {
    return localOpenAIProvider;
  }
  return openRouterProvider;
}

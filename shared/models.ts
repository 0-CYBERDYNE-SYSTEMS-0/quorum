/**
 * Model catalogs shared by the server gates and the client's model options.
 *
 * Slugs were verified against the live public catalog
 * (https://openrouter.ai/api/v1/models) on 2026-11-03. Never invent a slug:
 * an id that is not in that catalog fails at call time for the Chair.
 *
 * - Fast paid models are included with Pro and Boardroom.
 * - Frontier models are Boardroom only (plan or a Boardroom Session credit).
 * - Any model may be used with the Chair's own OpenRouter key (BYOK).
 */

/** Fast paid models included with Pro and Boardroom. */
export const HOUSE_KEY_PAID_MODEL_ALLOWLIST = [
  "z-ai/glm-5.3-flash",
  "deepseek/deepseek-v4.1-flash",
  "xiaomi/mimo-v2.6-flash",
  "openai/gpt-6-luna",
] as const;

/** Boardroom-only frontier models (newest flagship per lab). */
export const BOARDROOM_FRONTIER_MODEL_ALLOWLIST = [
  "anthropic/claude-opus-5.5",
  "anthropic/claude-sonnet-5.5",
  "openai/gpt-6.1-terra-pro",
  "google/gemini-4-argon",
  "x-ai/grok-4.7",
  "deepseek/deepseek-v4-pro-0813",
] as const;

export const MODEL_LABELS: Record<string, string> = {
  "z-ai/glm-5.3-flash": "GLM 5.3 Flash",
  "deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
  "xiaomi/mimo-v2.6-flash": "MiMo 2.6 Flash",
  "openai/gpt-6-luna": "GPT-6 Luna",
  "anthropic/claude-opus-5.5": "Claude Opus 5.5",
  "anthropic/claude-sonnet-5.5": "Claude Sonnet 5.5",
  "openai/gpt-6.1-terra-pro": "GPT-6.1 Terra Pro",
  "google/gemini-4-argon": "Gemini 4 Argon",
  "x-ai/grok-4.7": "Grok 4.7",
  "deepseek/deepseek-v4-pro-0813": "DeepSeek V4 Pro",
};

export function modelLabel(modelId: string): string {
  return MODEL_LABELS[modelId] ?? modelId.split("/").pop() ?? modelId;
}

export function isFastHouseKeyModel(model: string): boolean {
  return (HOUSE_KEY_PAID_MODEL_ALLOWLIST as readonly string[]).includes(model);
}

export function isFrontierModel(model: string): boolean {
  return (BOARDROOM_FRONTIER_MODEL_ALLOWLIST as readonly string[]).includes(model);
}

/**
 * True when the house key may run `model` for this tier. Frontier slugs are
 * Boardroom-only; passing no tier means "fast paid tier" (legacy callers).
 */
export function isHouseKeyAllowedModel(model: string, tier?: string | null): boolean {
  if (model.endsWith(":free")) return true;
  if (isFastHouseKeyModel(model)) return true;
  if (isFrontierModel(model)) return tier === "boardroom" || tier === "enterprise";
  return false;
}

/** Models a plan may pick on the house key, for UI copy. */
export function houseKeyModelsForTier(tier: string | null | undefined): string[] {
  const t = tier || "free";
  const fast = t === "free" ? [] : [...HOUSE_KEY_PAID_MODEL_ALLOWLIST];
  const frontier = t === "boardroom" || t === "enterprise" ? [...BOARDROOM_FRONTIER_MODEL_ALLOWLIST] : [];
  return [...fast, ...frontier];
}

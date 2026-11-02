/**
 * Shared log hygiene for provider diagnostics. Log lines may carry upstream
 * error text, but never request headers or API keys, and never more than a
 * short, greppable excerpt.
 */
export const MAX_LOGGED_PROVIDER_TEXT = 500;

/** Provider keys that must never appear in a diagnostic line. */
const SECRET_ENV_KEYS = ["OPENROUTER_API_KEY", "LOCAL_AI_API_KEY", "PERPLEXITY_API_KEY"] as const;

function redactConfiguredSecrets(text: string): string {
  return SECRET_ENV_KEYS.reduce((current, name) => {
    const secret = process.env[name]?.trim();
    return secret && secret.length >= 8 ? current.split(secret).join("[REDACTED]") : current;
  }, text);
}

export function redactAndTruncateLogText(value: unknown): string | undefined {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  } catch {
    return undefined;
  }
  const sanitized = redactConfiguredSecrets(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized) return undefined;
  return sanitized.length > MAX_LOGGED_PROVIDER_TEXT
    ? `${sanitized.slice(0, MAX_LOGGED_PROVIDER_TEXT)}…`
    : sanitized;
}

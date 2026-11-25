import type { WorkspaceSettings } from "../settings";

export type ModelTier = "fast" | "standard" | "advanced";

export interface ResolvedModels {
  primary: string | null;
  fallback: string | null;
  fast: string | null;
  advanced: string | null;
  embedding: string;
}

/**
 * Model resolution order: workspace override → environment → (for tiers) primary.
 * Nothing is assumed to exist: verifyModelAccess() checks against the account's model list.
 */
export function resolveModels(settings?: Pick<WorkspaceSettings, "models">): ResolvedModels {
  const m = settings?.models ?? {};
  const primary = m.primary || process.env.OPENAI_MODEL || null;
  return {
    primary,
    fallback: m.fallback || process.env.OPENAI_FALLBACK_MODEL || null,
    fast: m.fast || process.env.OPENAI_FAST_MODEL || primary,
    advanced: m.advanced || process.env.OPENAI_ADVANCED_MODEL || primary,
    embedding: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  };
}

export function modelForTier(models: ResolvedModels, tier: ModelTier): string | null {
  if (tier === "fast") return models.fast ?? models.primary;
  if (tier === "advanced") return models.advanced ?? models.primary;
  return models.primary;
}

/** USD per 1M tokens [input, output]. Estimates only; override with NEXUS_MODEL_PRICING JSON. */
const DEFAULT_PRICING: Array<[prefix: string, input: number, output: number]> = [
  ["gpt-5-nano", 0.05, 0.4],
  ["gpt-5-mini", 0.25, 2.0],
  ["gpt-5", 1.25, 10.0],
  ["gpt-4.1-nano", 0.1, 0.4],
  ["gpt-4.1-mini", 0.4, 1.6],
  ["gpt-4.1", 2.0, 8.0],
  ["gpt-4o-mini", 0.15, 0.6],
  ["gpt-4o", 2.5, 10.0],
  ["o4-mini", 1.1, 4.4],
  ["o3", 2.0, 8.0],
  ["text-embedding-3-small", 0.02, 0],
  ["text-embedding-3-large", 0.13, 0],
];

function pricingTable(): Array<[string, number, number]> {
  const raw = process.env.NEXUS_MODEL_PRICING;
  if (raw) {
    try {
      const obj = JSON.parse(raw) as Record<string, [number, number]>;
      return [...Object.entries(obj).map(([k, v]) => [k, v[0], v[1]] as [string, number, number]), ...DEFAULT_PRICING];
    } catch {
      /* ignore malformed override */
    }
  }
  return DEFAULT_PRICING;
}

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const entry = pricingTable()
    .filter(([p]) => model.startsWith(p))
    .sort((a, b) => b[0].length - a[0].length)[0];
  if (!entry) return 0;
  return (promptTokens * entry[1] + completionTokens * entry[2]) / 1_000_000;
}

/** Rough token estimate (~4 chars/token for Latin, ~2.5 for Arabic). Used for context budgeting. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  return Math.ceil((text.length - arabic) / 4 + arabic / 2.5);
}

/** Trim text to an approximate token budget. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "\n…[truncated]";
}

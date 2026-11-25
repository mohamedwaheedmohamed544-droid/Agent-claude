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
 * Model resolution order: workspace override → environment → default.
 * Default is Claude Opus 5.5 for every tier; tiers differ by reasoning effort (see effortForTier),
 * and can be pointed at other Claude models with ANTHROPIC_FAST_MODEL / ANTHROPIC_ADVANCED_MODEL.
 * Nothing is assumed to exist: verifyModelAccess() checks against the account's model list.
 */
export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_EMBEDDING_MODEL = "voyage-4";

export function resolveModels(settings?: Pick<WorkspaceSettings, "models">): ResolvedModels {
  const m = settings?.models ?? {};
  const primary = m.primary || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  return {
    primary,
    fallback: m.fallback || process.env.ANTHROPIC_FALLBACK_MODEL || null,
    fast: m.fast || process.env.ANTHROPIC_FAST_MODEL || primary,
    advanced: m.advanced || process.env.ANTHROPIC_ADVANCED_MODEL || primary,
    embedding: process.env.VOYAGE_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
  };
}

export function modelForTier(models: ResolvedModels, tier: ModelTier): string | null {
  if (tier === "fast") return models.fast ?? models.primary;
  if (tier === "advanced") return models.advanced ?? models.primary;
  return models.primary;
}

/** Reasoning effort per tier (Claude `output_config.effort`). */
export function effortForTier(tier: ModelTier): "low" | "medium" | "high" {
  return tier === "fast" ? "low" : tier === "advanced" ? "high" : "medium";
}

/** USD per 1M tokens [input, output]. Estimates only; override with NEXUS_MODEL_PRICING JSON. */
const DEFAULT_PRICING: Array<[prefix: string, input: number, output: number]> = [
  ["claude-fable-5-2", 8, 40],
  ["claude-fable-5", 10, 50],
  ["claude-opus-5-5", 4, 20],
  ["claude-opus-5", 5, 25],
  ["claude-opus-4", 5, 25],
  ["claude-sonnet-5", 2, 10],
  ["claude-sonnet-4", 3, 15],
  ["claude-haiku-5-5", 0.1, 0.5],
  ["claude-haiku-4-5", 1, 5],
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

/**
 * Estimated cost. Cache reads bill at ~0.1× and cache writes at ~1.25× the input rate.
 * `extraUsd` covers server-tool fees (e.g. web search at $10 per 1,000 searches).
 */
export function estimateCostUsd(
  model: string, inputTokens: number, outputTokens: number,
  cache: { read?: number; write?: number } = {}, extraUsd = 0,
): number {
  const entry = pricingTable()
    .filter(([p]) => model.startsWith(p))
    .sort((a, b) => b[0].length - a[0].length)[0];
  if (!entry) return extraUsd;
  const inRate = entry[1] / 1_000_000;
  return inputTokens * inRate + (cache.read ?? 0) * inRate * 0.1 + (cache.write ?? 0) * inRate * 1.25 +
    outputTokens * (entry[2] / 1_000_000) + extraUsd;
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

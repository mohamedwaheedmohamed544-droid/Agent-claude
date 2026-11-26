import { workspaceRoute } from "@/lib/api";
import { anthropic, isMockMode } from "@/lib/ai/llm";
import { DEFAULT_MODEL } from "@/lib/ai/models";

export const dynamic = "force-dynamic";
let cache: { at: number; models: Array<{ id: string; displayName: string }> } | null = null;

/** Claude models available to this account (Models API), cached for 10 minutes. */
export const GET = workspaceRoute(async () => {
  if (isMockMode()) return { models: [{ id: DEFAULT_MODEL, displayName: "Claude Opus 5.5" }, { id: "claude-sonnet-5-5", displayName: "Claude Sonnet 5.5" }, { id: "claude-haiku-5-5", displayName: "Claude Haiku 5.5" }], defaultModel: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, checked: true };
  if (!process.env.ANTHROPIC_API_KEY) return { models: [], defaultModel: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, checked: false };
  if (!cache || Date.now() - cache.at > 600_000) {
    try {
      const models: Array<{ id: string; displayName: string }> = [];
      for await (const m of anthropic().models.list()) models.push({ id: m.id, displayName: m.display_name });
      cache = { at: Date.now(), models };
    } catch {
      return { models: [], defaultModel: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, checked: false };
    }
  }
  return { models: cache.models, defaultModel: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, checked: true };
});

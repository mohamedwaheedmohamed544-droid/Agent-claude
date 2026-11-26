import type { ModelTier } from "../ai/models";
import { getAgentRuntime, listRuntimes, type AgentRuntime } from "./runtime";
import { ensureWorkspaceSeeded, getAgentRecord, setLifecycle, syncCatalog, updateAgent } from "./registry";

/**
 * Engine-facing view of an agent, produced by the Runtime Factory from database configuration.
 * `active` = may receive new work; `runnable` = may finish already-assigned work.
 */
export type AgentConfig = AgentRuntime & {
  active: boolean;
  name: string;
  icon: string;
};

function view(rt: AgentRuntime): AgentConfig {
  return { ...rt, active: rt.assignable, name: rt.nameEn, icon: "bot" };
}

/** Kept for compatibility with earlier callers/tests: syncs the built-in skills/templates catalogue. */
export async function ensureSystemAgents(force = false): Promise<void> {
  void force;
  await syncCatalog();
}

export async function listAgents(workspaceId: string, opts: { includeArchived?: boolean } = {}): Promise<AgentConfig[]> {
  await ensureWorkspaceSeeded(workspaceId);
  return (await listRuntimes(workspaceId, opts)).map(view);
}

export async function getAgent(workspaceId: string, slug: string): Promise<AgentConfig | null> {
  await ensureWorkspaceSeeded(workspaceId);
  const rt = await getAgentRuntime(workspaceId, slug);
  return rt ? view(rt) : null;
}

/** Agents the orchestrator may plan work for (discovered from the database, never hardcoded). */
export async function assignableAgents(workspaceId: string): Promise<AgentConfig[]> {
  return (await listAgents(workspaceId)).filter((a) => a.assignable && !a.isOrchestrator);
}

/** Compatibility wrapper used by older code paths and tests. */
export async function updateWorkspaceAgent(
  workspaceId: string, slug: string, userId: string,
  patch: { systemPrompt?: string; allowedTools?: string[]; tier?: ModelTier; modelOverride?: string | null; active?: boolean },
): Promise<AgentConfig> {
  const rec = await getAgentRecord(workspaceId, slug);
  if (!rec) throw new Error("Agent not found");
  const cfg: Record<string, unknown> = {};
  if (patch.systemPrompt !== undefined) cfg.responsibilities = { ...rec.responsibilities, instructions: patch.systemPrompt };
  if (patch.allowedTools !== undefined) cfg.tools = patch.allowedTools;
  if (patch.tier !== undefined || patch.modelOverride !== undefined) cfg.ai = { ...rec.ai, tier: patch.tier ?? rec.ai.tier, model: patch.modelOverride === undefined ? rec.ai.model : patch.modelOverride };
  if (Object.keys(cfg).length) await updateAgent(workspaceId, userId, slug, cfg);
  if (patch.active !== undefined && patch.active !== (rec.lifecycle === "active")) {
    await setLifecycle(workspaceId, userId, slug, patch.active ? "activate" : "deactivate");
  }
  return (await getAgent(workspaceId, slug))!;
}

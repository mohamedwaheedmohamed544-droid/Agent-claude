import { query, queryOne, transaction } from "../db";
import type { ModelTier } from "../ai/models";
import { AGENTS } from "./definitions";

export interface AgentConfig {
  id: string;
  slug: string;
  name: string;
  nameAr: string | null;
  description: string;
  descriptionAr: string | null;
  icon: string;
  color: string;
  capabilities: string[];
  isSystem: boolean;
  active: boolean;
  workspaceScoped: boolean;
  version: number;
  systemPrompt: string;
  allowedTools: string[];
  tier: ModelTier;
  modelOverride: string | null;
}

let ensured = false;

/**
 * Idempotently seeds built-in agents. A new version is created only when the built-in
 * definition changes, so prompt history is preserved in agent_versions.
 */
export async function ensureSystemAgents(force = false): Promise<void> {
  if (ensured && !force) return;
  for (const def of AGENTS) {
    await transaction(async (c) => {
      let agent = await queryOne<{ id: string }>(
        "SELECT id FROM agents WHERE workspace_id IS NULL AND slug=$1 FOR UPDATE",
        [def.slug], c,
      );
      if (!agent) {
        agent = await queryOne<{ id: string }>(
          `INSERT INTO agents(workspace_id, slug, name, name_ar, description, description_ar, icon, color, capabilities, is_system)
           VALUES (NULL,$1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`,
          [def.slug, def.name, def.nameAr, def.description, def.descriptionAr, def.icon, def.color, def.capabilities], c,
        );
      } else {
        await query(
          `UPDATE agents SET name=$2, name_ar=$3, description=$4, description_ar=$5, icon=$6, color=$7, capabilities=$8, updated_at=now() WHERE id=$1`,
          [agent.id, def.name, def.nameAr, def.description, def.descriptionAr, def.icon, def.color, def.capabilities], c,
        );
      }
      const cur = await queryOne<{ version: number; system_prompt: string; allowed_tools: string[]; model_tier: string }>(
        `SELECT v.version, v.system_prompt, v.allowed_tools, v.model_tier FROM agents a
           JOIN agent_versions v ON v.id = a.current_version_id WHERE a.id=$1`,
        [agent!.id], c,
      );
      const same = cur && cur.system_prompt === def.prompt && cur.model_tier === def.tier &&
        JSON.stringify([...cur.allowed_tools].sort()) === JSON.stringify([...def.tools].sort());
      if (!same) {
        const next = await queryOne<{ n: number }>("SELECT COALESCE(MAX(version),0)+1 AS n FROM agent_versions WHERE agent_id=$1", [agent!.id], c);
        const v = await queryOne<{ id: string }>(
          `INSERT INTO agent_versions(agent_id, version, system_prompt, allowed_tools, model_tier) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [agent!.id, next!.n, def.prompt, def.tools, def.tier], c,
        );
        await query("UPDATE agents SET current_version_id=$2 WHERE id=$1", [agent!.id, v!.id], c);
      }
    });
  }
  ensured = true;
}

type AgentRow = {
  id: string; workspace_id: string | null; slug: string; name: string; name_ar: string | null; description: string;
  description_ar: string | null; icon: string; color: string; capabilities: string[]; is_system: boolean; active: boolean;
  version: number; system_prompt: string; allowed_tools: string[]; model_tier: ModelTier; model_override: string | null;
};

function toConfig(r: AgentRow): AgentConfig {
  return {
    id: r.id, slug: r.slug, name: r.name, nameAr: r.name_ar, description: r.description, descriptionAr: r.description_ar,
    icon: r.icon, color: r.color, capabilities: r.capabilities, isSystem: r.is_system, active: r.active,
    workspaceScoped: r.workspace_id !== null, version: r.version, systemPrompt: r.system_prompt,
    allowedTools: r.allowed_tools, tier: r.model_tier, modelOverride: r.model_override,
  };
}

const SELECT_AGENT = `SELECT a.id, a.workspace_id, a.slug, a.name, a.name_ar, a.description, a.description_ar, a.icon, a.color,
       a.capabilities, a.is_system, a.active, v.version, v.system_prompt, v.allowed_tools, v.model_tier, v.model_override
  FROM agents a JOIN agent_versions v ON v.id = a.current_version_id`;

/** Workspace-level customisations (rows with workspace_id) override built-in agents with the same slug. */
export async function listAgents(workspaceId: string): Promise<AgentConfig[]> {
  await ensureSystemAgents();
  const rows = await query<AgentRow>(
    `SELECT DISTINCT ON (a.slug) x.* FROM (${SELECT_AGENT} WHERE a.workspace_id IS NULL OR a.workspace_id=$1) x
       JOIN agents a ON a.id = x.id ORDER BY a.slug, (a.workspace_id IS NULL)`,
    [workspaceId],
  );
  const order = AGENTS.map((a) => a.slug);
  return rows.map(toConfig).sort((a, b) => (order.indexOf(a.slug) + 1 || 99) - (order.indexOf(b.slug) + 1 || 99));
}

export async function getAgent(workspaceId: string, slug: string): Promise<AgentConfig | null> {
  return (await listAgents(workspaceId)).find((a) => a.slug === slug) ?? null;
}

/**
 * Customise an agent for one workspace. Creates a workspace-scoped copy on first edit, then
 * appends a new version — history is never overwritten.
 */
export async function updateWorkspaceAgent(
  workspaceId: string, slug: string, userId: string,
  patch: { systemPrompt?: string; allowedTools?: string[]; tier?: ModelTier; modelOverride?: string | null; active?: boolean },
): Promise<AgentConfig> {
  const base = await getAgent(workspaceId, slug);
  if (!base) throw new Error("Agent not found");
  const onlyActive = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined).every((k) => k === "active");
  if (onlyActive && base.workspaceScoped && patch.active !== undefined) {
    await query("UPDATE agents SET active=$2, updated_at=now() WHERE id=$1", [base.id, patch.active]);
    return (await getAgent(workspaceId, slug))!;
  }
  await transaction(async (c) => {
    let agentId = base.workspaceScoped ? base.id : null;
    if (!agentId) {
      const row = await queryOne<{ id: string }>(
        `INSERT INTO agents(workspace_id, slug, name, name_ar, description, description_ar, icon, color, capabilities, is_system, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10) RETURNING id`,
        [workspaceId, slug, base.name, base.nameAr, base.description, base.descriptionAr, base.icon, base.color, base.capabilities, patch.active ?? base.active], c,
      );
      agentId = row!.id;
    } else if (patch.active !== undefined) {
      await query("UPDATE agents SET active=$2, updated_at=now() WHERE id=$1", [agentId, patch.active], c);
    }
    const next = await queryOne<{ n: number }>("SELECT COALESCE(MAX(version),0)+1 AS n FROM agent_versions WHERE agent_id=$1", [agentId], c);
    const v = await queryOne<{ id: string }>(
      `INSERT INTO agent_versions(agent_id, version, system_prompt, allowed_tools, model_tier, model_override, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [agentId, next!.n, patch.systemPrompt ?? base.systemPrompt, patch.allowedTools ?? base.allowedTools,
        patch.tier ?? base.tier, patch.modelOverride === undefined ? base.modelOverride : patch.modelOverride, userId], c,
    );
    await query("UPDATE agents SET current_version_id=$2, updated_at=now() WHERE id=$1", [agentId, v!.id], c);
  });
  return (await getAgent(workspaceId, slug))!;
}

/** Removes the workspace customisation, reverting to the built-in agent. */
export async function resetWorkspaceAgent(workspaceId: string, slug: string): Promise<void> {
  await query("DELETE FROM agents WHERE workspace_id=$1 AND slug=$2", [workspaceId, slug]);
}

export async function agentVersions(agentId: string) {
  return query<{ id: string; version: number; system_prompt: string; allowed_tools: string[]; model_tier: string; created_at: string }>(
    "SELECT id, version, system_prompt, allowed_tools, model_tier, created_at FROM agent_versions WHERE agent_id=$1 ORDER BY version DESC",
    [agentId],
  );
}

import { query, queryOne } from "../db";
import { allTools, getTool } from "../tools/registry";
import { SAFETY_POLICY } from "./definitions";
import type { AgentDefinitionInput, AgentLifecycle, AgentPermissions, ModelTier, SkillRecord } from "./types";

/**
 * Agent Runtime Factory.
 *   configuration (agents + agent_versions.config) → registry lookup → skills → authorised tools →
 *   compiled instructions → cached runtime (keyed by version) → used by the orchestrator/engine.
 * A new version invalidates the cached runtime automatically; running steps keep the runtime they
 * started with, future steps pick up the new version.
 */
export interface AgentRuntime {
  id: string;
  slug: string;
  workspaceId: string;
  version: number;
  versionId: string;
  isOrchestrator: boolean;
  lifecycle: AgentLifecycle;
  /** May receive NEW work (planner/assign/meetings). */
  assignable: boolean;
  /** May still execute already-assigned work (active or deactivated, not archived/deleted). */
  runnable: boolean;
  nameAr: string;
  nameEn: string;
  roleTitle: string;
  description: string;
  descriptionAr: string | null;
  color: string;
  capabilities: string[];
  departmentKey: string | null;
  config: AgentDefinitionInput;
  skills: SkillRecord[];
  systemPrompt: string;
  /** Tools this agent may actually call: configured tools ∩ registry ∩ risk ceiling ∩ category restrictions. */
  allowedTools: string[];
  blockedTools: Array<{ name: string; reason: string }>;
  missingTools: string[];
  missingSkills: string[];
  permissions: AgentPermissions;
  tier: ModelTier;
  modelOverride: string | null;
  builtAt: string;
}

type Row = {
  id: string; workspace_id: string; slug: string; name: string; name_ar: string | null; role_title: string; description: string;
  description_ar: string | null; color: string; capabilities: string[]; is_orchestrator: boolean; lifecycle: AgentLifecycle;
  deleted_at: string | null; version: number; version_id: string; config: AgentDefinitionInput | null; system_prompt: string;
  allowed_tools: string[]; model_tier: ModelTier; model_override: string | null; department_key: string | null;
};

const cache = new Map<string, AgentRuntime>();

export function invalidateRuntime(workspaceId: string, slug?: string) {
  for (const k of cache.keys()) if (k.startsWith(`${workspaceId}:`) && (!slug || k === `${workspaceId}:${slug}`)) cache.delete(k);
}

export async function loadSkills(workspaceId: string, keys: string[]): Promise<SkillRecord[]> {
  if (!keys.length) return [];
  return query<SkillRecord>(
    `SELECT DISTINCT ON (key) key, name, name_ar AS "nameAr", description, category, instructions, required_tools AS "requiredTools",
            depends_on AS "dependsOn", (workspace_id IS NULL) AS builtin
       FROM skills WHERE (workspace_id=$1 OR workspace_id IS NULL) AND key = ANY($2) ORDER BY key, (workspace_id IS NULL)`,
    [workspaceId, keys],
  );
}

/** Pure compilation step (also used for previews and validation). */
export function compileAgent(config: AgentDefinitionInput, skills: SkillRecord[], opts: { isOrchestrator?: boolean; agentDirectory?: Array<{ slug: string; nameAr: string; roleTitle: string }> } = {}) {
  const perms = config.permissions;
  const allowed: string[] = [];
  const blocked: Array<{ name: string; reason: string }> = [];
  for (const name of [...new Set(config.tools)]) {
    const t = getTool(name);
    if (!t) { blocked.push({ name, reason: "Unknown tool" }); continue; }
    if (t.riskLevel > perms.maxRiskLevel) { blocked.push({ name, reason: `Risk level ${t.riskLevel} exceeds the agent's ceiling (${perms.maxRiskLevel})` }); continue; }
    if (perms.restrictedCategories.includes(t.category)) { blocked.push({ name, reason: `Category "${t.category}" is restricted for this agent` }); continue; }
    allowed.push(name);
  }
  const skillKeys = new Set(skills.map((s) => s.key));
  const missingTools = [...new Set(skills.flatMap((s) => s.requiredTools).filter((t) => !allowed.includes(t)))];
  const missingSkills = [...new Set(skills.flatMap((s) => s.dependsOn).filter((k) => !skillKeys.has(k)))];

  const r = config.responsibilities;
  const dir = (slugs: string[]) => slugs.map((s) => opts.agentDirectory?.find((a) => a.slug === s)).filter(Boolean).map((a) => `${a!.nameAr} (${a!.slug}, ${a!.roleTitle})`).join(", ");
  const lines = [
    `You are ${config.nameAr} (${config.nameEn}), ${config.roleTitle}${config.roleTitleAr ? ` / ${config.roleTitleAr}` : ""}.`,
    config.description && `About you: ${config.description}`,
    config.personality && `Personality and tone: ${config.personality}`,
    r.main && `Main responsibility: ${r.main}`,
    r.expertise.length && `Areas of expertise: ${r.expertise.join(", ")}.`,
    r.deliverables.length && `Expected deliverables: ${r.deliverables.join("; ")}.`,
    r.methodology && `Working methodology: ${r.methodology}`,
    r.successCriteria.length && `Success criteria: ${r.successCriteria.join("; ")}.`,
    r.instructions && `Detailed instructions:\n${r.instructions}`,
    skills.length && `Skills you apply:\n${skills.map((s) => `- ${s.name}: ${s.instructions}`).join("\n")}`,
    config.relationships.supervisor && opts.agentDirectory && `You report to ${dir([config.relationships.supervisor]) || config.relationships.supervisor}.`,
    config.relationships.collaboratesWith.length > 0 && opts.agentDirectory && `You collaborate with: ${dir(config.relationships.collaboratesWith)}.`,
    `Permission ceiling: you may use tools up to risk level ${perms.maxRiskLevel}; modifying and external actions are gated by user approval.`,
    config.ai.systemInstructions && `Additional instructions:\n${config.ai.systemInstructions}`,
  ].filter(Boolean);
  const systemPrompt = `${SAFETY_POLICY}\n\n${lines.join("\n\n")}`;
  return { systemPrompt, allowedTools: allowed, blockedTools: blocked, missingTools, missingSkills, isOrchestrator: Boolean(opts.isOrchestrator) };
}

const SELECT = `SELECT a.id, a.workspace_id, a.slug, a.name, a.name_ar, a.role_title, a.description, a.description_ar, a.color, a.capabilities,
    a.is_orchestrator, a.lifecycle, a.deleted_at, v.version, v.id AS version_id, v.config, v.system_prompt, v.allowed_tools, v.model_tier,
    v.model_override, d.key AS department_key
  FROM agents a JOIN agent_versions v ON v.id = a.current_version_id LEFT JOIN departments d ON d.id = a.department_id`;

/** Returns the runtime for one agent, rebuilding it when its configuration version changed. */
export async function getAgentRuntime(workspaceId: string, slug: string): Promise<AgentRuntime | null> {
  const head = await queryOne<{ version_id: string }>(
    "SELECT current_version_id AS version_id FROM agents WHERE workspace_id=$1 AND slug=$2 AND deleted_at IS NULL", [workspaceId, slug],
  );
  if (!head) return null;
  const key = `${workspaceId}:${slug}`;
  const hit = cache.get(key);
  if (hit && hit.versionId === head.version_id) {
    // Lifecycle changes do not create versions — refresh cheaply.
    const lc = await queryOne<{ lifecycle: AgentLifecycle }>("SELECT lifecycle FROM agents WHERE id=$1", [hit.id]);
    if (lc && lc.lifecycle !== hit.lifecycle) Object.assign(hit, lifecycleFlags(lc.lifecycle));
    return hit;
  }
  const row = await queryOne<Row>(`${SELECT} WHERE a.workspace_id=$1 AND a.slug=$2 AND a.deleted_at IS NULL`, [workspaceId, slug]);
  if (!row) return null;
  const rt = await buildRuntime(row);
  cache.set(key, rt);
  return rt;
}

function lifecycleFlags(lifecycle: AgentLifecycle) {
  return { lifecycle, assignable: lifecycle === "active", runnable: lifecycle === "active" || lifecycle === "inactive" };
}

async function buildRuntime(row: Row): Promise<AgentRuntime> {
  const config = row.config ?? legacyConfig(row);
  const skills = await loadSkills(row.workspace_id, config.skills.map((s) => s.key));
  const directory = await query<{ slug: string; nameAr: string; roleTitle: string }>(
    `SELECT slug, COALESCE(name_ar, name) AS "nameAr", role_title AS "roleTitle" FROM agents WHERE workspace_id=$1 AND deleted_at IS NULL`, [row.workspace_id],
  );
  const c = compileAgent(config, skills, { isOrchestrator: row.is_orchestrator, agentDirectory: directory });
  return {
    id: row.id, slug: row.slug, workspaceId: row.workspace_id, version: row.version, versionId: row.version_id, isOrchestrator: row.is_orchestrator,
    ...lifecycleFlags(row.lifecycle),
    nameAr: config.nameAr, nameEn: config.nameEn, roleTitle: config.roleTitle, description: config.description, descriptionAr: config.descriptionAr || null,
    color: config.color, capabilities: config.capabilities, departmentKey: row.department_key, config, skills,
    systemPrompt: c.systemPrompt, allowedTools: c.allowedTools, blockedTools: c.blockedTools, missingTools: c.missingTools, missingSkills: c.missingSkills,
    permissions: config.permissions, tier: config.ai.tier, modelOverride: config.ai.model, builtAt: new Date().toISOString(),
  };
}

/** For rows created before configs were versioned as JSON. */
function legacyConfig(row: Row): AgentDefinitionInput {
  return {
    nameAr: row.name_ar ?? row.name, nameEn: row.name, roleTitle: row.role_title || row.name, roleTitleAr: "", description: row.description,
    descriptionAr: row.description_ar ?? "", personality: "", color: row.color, capabilities: row.capabilities,
    responsibilities: { main: row.description, instructions: row.system_prompt, expertise: [], deliverables: [], methodology: "", successCriteria: [] },
    ai: { provider: "anthropic", model: row.model_override, tier: row.model_tier, temperature: null, systemInstructions: "", memory: { useWorkspaceMemory: true, useAgentMemory: true, useKnowledgeBase: true, maxContextTokens: 90_000 } },
    tools: row.allowed_tools,
    permissions: { maxRiskLevel: 4, alwaysApproveModify: false, restrictedCategories: [], memoryAccess: "own" },
    relationships: { supervisor: "orchestrator", delegatesTo: [], collaboratesWith: [], canJoinMeetings: true, canInitiateCollaboration: true },
    office: { departmentKey: row.department_key ?? "research", workstationId: null, avatarPreset: "custom", appearance: { gender: "neutral", skin: "#b07c60", outfit: "turtleneck", outfitColor: "#24303f", headwear: "none", headwearColor: "#000000", hairColor: "#221a16", accessory: "laptop", height: 1.72 }, defaultAnimation: "idle", preferredMeetingRoom: null, visible: true },
    skills: [],
  };
}

/** All agents of a workspace that may be shown/used (archived & deleted excluded unless asked). */
export async function listRuntimes(workspaceId: string, opts: { includeArchived?: boolean } = {}): Promise<AgentRuntime[]> {
  const rows = await query<{ slug: string }>(
    `SELECT slug FROM agents WHERE workspace_id=$1 AND deleted_at IS NULL ${opts.includeArchived ? "" : "AND lifecycle <> 'archived'"}
      ORDER BY is_orchestrator DESC, created_at`, [workspaceId],
  );
  const out: AgentRuntime[] = [];
  for (const r of rows) {
    const rt = await getAgentRuntime(workspaceId, r.slug);
    if (rt) out.push(rt);
  }
  return out;
}

/** Records one execution of an agent (for runtime history / auditing). */
export async function startRuntimeSession(rt: AgentRuntime, taskId: string | null, stepId: string | null): Promise<string | null> {
  try {
    const row = await queryOne<{ id: string }>(
      "INSERT INTO agent_runtime_sessions(workspace_id, agent_slug, agent_version, task_id, step_id) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [rt.workspaceId, rt.slug, rt.version, taskId, stepId],
    );
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function endRuntimeSession(id: string | null, status: "completed" | "failed" | "interrupted") {
  if (!id) return;
  await query("UPDATE agent_runtime_sessions SET status=$2, ended_at=now() WHERE id=$1", [id, status]).catch(() => {});
}

export function toolCatalog() {
  return allTools().map((t) => ({ name: t.name, description: t.description, category: t.category, riskLevel: t.riskLevel, integration: t.integration ?? null }));
}

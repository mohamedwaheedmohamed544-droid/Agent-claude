import { z } from "zod";
import type { PoolClient } from "pg";
import { query, queryOne, transaction, type Queryable } from "../db";
import { audit } from "../audit";
import { AppError, badRequest, conflict, forbidden, notFound } from "../errors";
import { getTool } from "../tools/registry";
import { emitEvent, refreshPresence } from "../office/events";
import { AVATAR_BY_KEY } from "../office/avatars";
import { BUILTIN_SKILLS, BUILTIN_TEMPLATES, SEED_DEPARTMENTS, defaultConfig, starterWorkforce } from "./catalog";
import { compileAgent, invalidateRuntime, loadSkills } from "./runtime";
import type {
  AgentDefinitionInput, AgentLifecycle, AgentRecord, AgentValidation, AgentVersionRecord, DepartmentRecord, SkillRecord, TemplateRecord,
} from "./types";

// ───────────────────────── Schema (server-side validation) ─────────────────────────

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a hex colour like #4f46e5");
const short = (max: number) => z.string().trim().max(max);
const list = (max: number, item = 300) => z.array(z.string().trim().min(1).max(item)).max(max);

export const AgentConfigSchema = z.object({
  nameAr: z.string().trim().min(1, "Arabic name is required").max(60),
  nameEn: z.string().trim().min(1, "English name is required").max(60),
  roleTitle: short(120),
  roleTitleAr: short(120),
  description: short(2000),
  descriptionAr: short(2000),
  personality: short(1000),
  color: hex,
  capabilities: list(20, 80),
  responsibilities: z.object({
    main: short(1000), instructions: short(20_000), expertise: list(30, 120), deliverables: list(30), methodology: short(4000), successCriteria: list(30),
  }),
  ai: z.object({
    provider: z.literal("anthropic"),
    model: z.string().trim().max(100).regex(/^[a-z0-9][a-z0-9.\-]*$/i, "invalid model id").nullable(),
    tier: z.enum(["fast", "standard", "advanced"]),
    temperature: z.number().min(0).max(1).nullable(),
    systemInstructions: short(20_000),
    memory: z.object({
      useWorkspaceMemory: z.boolean(), useAgentMemory: z.boolean(), useKnowledgeBase: z.boolean(),
      maxContextTokens: z.number().int().min(8_000).max(400_000),
    }),
  }),
  tools: z.array(z.string().max(80)).max(60),
  permissions: z.object({
    maxRiskLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    alwaysApproveModify: z.boolean(),
    restrictedCategories: z.array(z.string().max(40)).max(20),
    memoryAccess: z.enum(["own", "shared"]),
  }),
  relationships: z.object({
    supervisor: z.string().max(80).nullable(),
    delegatesTo: z.array(z.string().max(80)).max(50),
    collaboratesWith: z.array(z.string().max(80)).max(50),
    canJoinMeetings: z.boolean(),
    canInitiateCollaboration: z.boolean(),
  }),
  office: z.object({
    departmentKey: z.string().max(80),
    workstationId: z.string().nullable(),
    avatarPreset: z.string().max(80),
    appearance: z.object({
      gender: z.enum(["male", "female", "neutral"]),
      skin: hex, outfit: z.enum(["thobe", "suit", "abaya", "blazer", "shirt", "turtleneck", "cardigan"]), outfitColor: hex,
      headwear: z.enum(["ghutra", "shemagh", "hijab", "none"]), headwearColor: hex, hairColor: hex,
      accessory: z.enum(["glasses", "headset", "tablet", "pen", "watch", "laptop", "folder", "none"]),
      height: z.number().min(1.5).max(2.0),
    }),
    defaultAnimation: z.enum(["idle", "working", "reading", "thinking"]),
    preferredMeetingRoom: z.string().max(80).nullable(),
    visible: z.boolean(),
  }),
  skills: z.array(z.object({ key: z.string().max(80), mandatory: z.boolean() })).max(40),
});

/** Deep-merges a partial update into a full configuration (arrays replace). */
export function mergeConfig(base: AgentDefinitionInput, patch: Partial<AgentDefinitionInput>): AgentDefinitionInput {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === undefined) continue;
    const cur = (base as unknown as Record<string, unknown>)[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)
      ? { ...(cur as object), ...(v as object), ...(k === "ai" && (v as { memory?: object }).memory ? { memory: { ...(cur as { memory: object }).memory, ...(v as { memory: object }).memory } } : {}) }
      : v;
  }
  return out as unknown as AgentDefinitionInput;
}

// ───────────────────────── Catalogue sync & workspace seeding ─────────────────────────

let catalogSynced = false;
export async function syncCatalog(): Promise<void> {
  if (catalogSynced) return;
  for (const s of BUILTIN_SKILLS) {
    await query(
      `INSERT INTO skills(workspace_id, key, name, name_ar, description, category, instructions, required_tools, depends_on)
       VALUES (NULL,$1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), key) DO UPDATE SET name=EXCLUDED.name, name_ar=EXCLUDED.name_ar,
         description=EXCLUDED.description, category=EXCLUDED.category, instructions=EXCLUDED.instructions, required_tools=EXCLUDED.required_tools,
         depends_on=EXCLUDED.depends_on, updated_at=now()`,
      [s.key, s.name, s.nameAr, s.description, s.category, s.instructions, s.requiredTools, s.dependsOn],
    );
  }
  for (const t of BUILTIN_TEMPLATES) {
    await query(
      `INSERT INTO agent_templates(workspace_id, key, name, name_ar, description, category, config) VALUES (NULL,$1,$2,$3,$4,$5,$6)
       ON CONFLICT (COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), key) DO UPDATE SET name=EXCLUDED.name, name_ar=EXCLUDED.name_ar,
         description=EXCLUDED.description, category=EXCLUDED.category, config=EXCLUDED.config`,
      [t.key, t.name, t.nameAr, t.description, t.category, t.config],
    );
  }
  catalogSynced = true;
}

const seeded = new Set<string>();
/**
 * Seeds a workspace once with departments, office zones and the starter workforce. Afterwards the
 * workforce is entirely admin-managed. Existing per-workspace customisations of starter agents are
 * upgraded in place (same slug → history stays linked).
 */
export async function ensureWorkspaceSeeded(workspaceId: string): Promise<void> {
  if (seeded.has(workspaceId)) return;
  await syncCatalog();
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`seed:${workspaceId}`]);
    const ws = await queryOne<{ agents_seeded_at: string | null }>("SELECT agents_seeded_at FROM workspaces WHERE id=$1", [workspaceId], c);
    if (!ws || ws.agents_seeded_at) return;
    for (const [i, d] of SEED_DEPARTMENTS.entries()) {
      await query(
        `INSERT INTO departments(workspace_id, key, name, name_ar, color, kind, sort) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [workspaceId, d.key, d.name, d.nameAr, d.color, d.kind, i], c,
      );
    }
    await query(
      `INSERT INTO office_zones(workspace_id, key, kind, name, name_ar, floor, seats) VALUES
         ($1,'meeting_room','meeting_room','Main meeting room','قاعة الاجتماعات الرئيسية',0,9), ($1,'lounge','lounge','Lounge','الاستراحة',0,6)
       ON CONFLICT DO NOTHING`, [workspaceId], c,
    );
    for (const a of starterWorkforce()) {
      const existing = await queryOne<{ id: string }>("SELECT id FROM agents WHERE workspace_id=$1 AND slug=$2", [workspaceId, a.slug], c);
      let config = a.config;
      if (existing) {
        // Preserve a previous workspace customisation of the prompt/tools.
        const v = await queryOne<{ system_prompt: string; allowed_tools: string[]; model_tier: "fast" | "standard" | "advanced"; model_override: string | null; active: boolean }>(
          `SELECT v.system_prompt, v.allowed_tools, v.model_tier, v.model_override, a.active FROM agents a JOIN agent_versions v ON v.id=a.current_version_id WHERE a.id=$1`, [existing.id], c,
        );
        if (v) config = mergeConfig(config, { tools: v.allowed_tools, responsibilities: { ...config.responsibilities, instructions: v.system_prompt }, ai: { ...config.ai, tier: v.model_tier, model: v.model_override } });
        await writeAgent(c, workspaceId, null, { slug: a.slug, config, isOrchestrator: a.isOrchestrator, lifecycle: v && !v.active ? "inactive" : "active", existingId: existing.id, note: "Upgraded to database-driven configuration" });
      } else {
        await writeAgent(c, workspaceId, null, { slug: a.slug, config, isOrchestrator: a.isOrchestrator, lifecycle: "active", note: "Starter workforce" });
      }
    }
    await query("UPDATE workspaces SET agents_seeded_at=now() WHERE id=$1", [workspaceId], c);
  });
  seeded.add(workspaceId);
}

// ───────────────────────── Low-level write ─────────────────────────

async function departmentId(c: Queryable, workspaceId: string, key: string): Promise<string> {
  const d = await queryOne<{ id: string }>("SELECT id FROM departments WHERE workspace_id=$1 AND key=$2", [workspaceId, key], c);
  if (!d) throw badRequest(`Department "${key}" does not exist`);
  return d.id;
}

/** Gives the agent a workstation in its department, reusing a free desk or creating a new one. */
async function allocateWorkstation(c: Queryable, workspaceId: string, agentId: string, deptId: string): Promise<string> {
  const current = await queryOne<{ id: string; department_id: string }>("SELECT id, department_id FROM office_workstations WHERE agent_id=$1", [agentId], c);
  if (current?.department_id === deptId) return current.id;
  if (current) await query("UPDATE office_workstations SET agent_id=NULL WHERE id=$1", [current.id], c);
  const free = await queryOne<{ id: string }>(
    "SELECT id FROM office_workstations WHERE department_id=$1 AND agent_id IS NULL ORDER BY idx LIMIT 1 FOR UPDATE", [deptId], c,
  );
  if (free) {
    await query("UPDATE office_workstations SET agent_id=$2 WHERE id=$1", [free.id, agentId], c);
    return free.id;
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO office_workstations(workspace_id, department_id, idx, agent_id)
     VALUES ($1,$2,(SELECT COALESCE(MAX(idx)+1,0) FROM office_workstations WHERE department_id=$2),$3) RETURNING id`,
    [workspaceId, deptId, agentId], c,
  );
  return row!.id;
}

async function releaseWorkstation(c: Queryable, agentId: string) {
  await query("UPDATE office_workstations SET agent_id=NULL WHERE agent_id=$1", [agentId], c);
}

interface WriteOpts { slug: string; config: AgentDefinitionInput; isOrchestrator?: boolean; lifecycle: AgentLifecycle; existingId?: string; note?: string | null; templateKey?: string | null }

async function writeAgent(c: PoolClient, workspaceId: string, userId: string | null, o: WriteOpts): Promise<string> {
  const cfg = o.config;
  const deptId = await departmentId(c, workspaceId, cfg.office.departmentKey);
  const skills = await loadSkills(workspaceId, cfg.skills.map((s) => s.key));
  const compiled = compileAgent(cfg, skills, { isOrchestrator: o.isOrchestrator });
  let agentId = o.existingId ?? null;
  const identity = [cfg.nameEn, cfg.nameAr, cfg.description, cfg.descriptionAr || null, cfg.color, cfg.capabilities, cfg.roleTitle, cfg.roleTitleAr, cfg.personality, deptId, cfg.relationships.supervisor, cfg.office];
  if (!agentId) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO agents(workspace_id, slug, name, name_ar, description, description_ar, color, capabilities, role_title, role_title_ar, personality,
                          department_id, supervisor_slug, office, lifecycle, is_orchestrator, is_system, active, template_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,false,$17,$18,$19) RETURNING id`,
      [workspaceId, o.slug, ...identity, o.lifecycle, Boolean(o.isOrchestrator), o.lifecycle === "active", o.templateKey ?? null, userId], c,
    );
    agentId = row!.id;
  } else {
    await query(
      `UPDATE agents SET name=$2, name_ar=$3, description=$4, description_ar=$5, color=$6, capabilities=$7, role_title=$8, role_title_ar=$9, personality=$10,
              department_id=$11, supervisor_slug=$12, office=$13, lifecycle=$14, active=$15, is_orchestrator=$16, updated_at=now() WHERE id=$1`,
      [agentId, ...identity, o.lifecycle, o.lifecycle === "active", Boolean(o.isOrchestrator)], c,
    );
  }
  const wsId = o.lifecycle === "archived" ? null : await allocateWorkstation(c, workspaceId, agentId, deptId);
  const stored: AgentDefinitionInput = { ...cfg, office: { ...cfg.office, workstationId: wsId } };
  await query("UPDATE agents SET office=$2 WHERE id=$1", [agentId, stored.office], c);
  const next = await queryOne<{ n: number }>("SELECT COALESCE(MAX(version),0)+1 AS n FROM agent_versions WHERE agent_id=$1", [agentId], c);
  const v = await queryOne<{ id: string }>(
    `INSERT INTO agent_versions(agent_id, version, system_prompt, allowed_tools, model_tier, model_override, created_by, config, change_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [agentId, next!.n, compiled.systemPrompt, compiled.allowedTools, cfg.ai.tier, cfg.ai.model, userId, stored, o.note ?? null], c,
  );
  await query("UPDATE agents SET current_version_id=$2 WHERE id=$1", [agentId, v!.id], c);
  await query("DELETE FROM agent_skills WHERE agent_id=$1", [agentId], c);
  for (const s of cfg.skills) await query("INSERT INTO agent_skills(agent_id, skill_key, mandatory) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [agentId, s.key, s.mandatory], c);
  await query("DELETE FROM agent_relationships WHERE workspace_id=$1 AND agent_slug=$2", [workspaceId, o.slug], c);
  for (const r of cfg.relationships.delegatesTo) await query("INSERT INTO agent_relationships VALUES ($1,$2,$3,'delegates_to') ON CONFLICT DO NOTHING", [workspaceId, o.slug, r], c);
  for (const r of cfg.relationships.collaboratesWith) await query("INSERT INTO agent_relationships VALUES ($1,$2,$3,'collaborates_with') ON CONFLICT DO NOTHING", [workspaceId, o.slug, r], c);
  return agentId;
}

// ───────────────────────── Read ─────────────────────────

type AgentRow = {
  id: string; slug: string; is_orchestrator: boolean; lifecycle: AgentLifecycle; version: number; template_key: string | null;
  created_at: string; updated_at: string; archived_at: string | null; config: AgentDefinitionInput | null; office: AgentDefinitionInput["office"];
};
const AGENT_SELECT = `SELECT a.id, a.slug, a.is_orchestrator, a.lifecycle, v.version, a.template_key, a.created_at, a.updated_at, a.archived_at, v.config, a.office
  FROM agents a JOIN agent_versions v ON v.id=a.current_version_id`;

function toRecord(r: AgentRow): AgentRecord {
  const cfg = r.config ?? defaultConfig({ nameAr: r.slug, nameEn: r.slug });
  return {
    ...cfg, office: { ...cfg.office, workstationId: r.office?.workstationId ?? cfg.office.workstationId },
    id: r.id, slug: r.slug, isOrchestrator: r.is_orchestrator, lifecycle: r.lifecycle, version: r.version, templateKey: r.template_key,
    createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at,
  };
}

export async function getAgentRecord(workspaceId: string, slug: string): Promise<AgentRecord | null> {
  await ensureWorkspaceSeeded(workspaceId);
  const r = await queryOne<AgentRow>(`${AGENT_SELECT} WHERE a.workspace_id=$1 AND a.slug=$2 AND a.deleted_at IS NULL`, [workspaceId, slug]);
  return r ? toRecord(r) : null;
}

export async function listAgentRecords(workspaceId: string, opts: { lifecycle?: AgentLifecycle | "all"; department?: string; q?: string } = {}): Promise<AgentRecord[]> {
  await ensureWorkspaceSeeded(workspaceId);
  const params: unknown[] = [workspaceId];
  let where = "a.workspace_id=$1 AND a.deleted_at IS NULL";
  if (!opts.lifecycle) where += " AND a.lifecycle <> 'archived'";
  else if (opts.lifecycle !== "all") { params.push(opts.lifecycle); where += ` AND a.lifecycle=$${params.length}`; }
  if (opts.department) { params.push(opts.department); where += ` AND a.department_id=(SELECT id FROM departments WHERE workspace_id=$1 AND key=$${params.length})`; }
  if (opts.q) { params.push(`%${opts.q}%`); where += ` AND (a.name ILIKE $${params.length} OR a.name_ar ILIKE $${params.length} OR a.slug ILIKE $${params.length} OR a.role_title ILIKE $${params.length})`; }
  const rows = await query<AgentRow>(`${AGENT_SELECT} WHERE ${where} ORDER BY a.is_orchestrator DESC, a.created_at`, params);
  return rows.map(toRecord);
}

export async function listVersions(workspaceId: string, slug: string): Promise<AgentVersionRecord[]> {
  return query<AgentVersionRecord>(
    `SELECT v.version, v.created_at AS "createdAt", u.name AS "createdByName", v.change_note AS "changeNote"
       FROM agent_versions v JOIN agents a ON a.id=v.agent_id LEFT JOIN users u ON u.id=v.created_by
      WHERE a.workspace_id=$1 AND a.slug=$2 ORDER BY v.version DESC LIMIT 50`, [workspaceId, slug],
  );
}

// ───────────────────────── Validation ─────────────────────────

function hasCycle(edges: Map<string, string[]>): string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string): string[] | null => {
    if (state.get(n) === 1) return [...stack.slice(stack.indexOf(n)), n];
    if (state.get(n) === 2) return null;
    state.set(n, 1); stack.push(n);
    for (const m of edges.get(n) ?? []) { const c = visit(m); if (c) return c; }
    stack.pop(); state.set(n, 2);
    return null;
  };
  for (const n of edges.keys()) { const c = visit(n); if (c) return c; }
  return null;
}

export async function validateAgentConfig(workspaceId: string, raw: unknown, slug?: string | null): Promise<{ config: AgentDefinitionInput | null; validation: AgentValidation }> {
  await ensureWorkspaceSeeded(workspaceId);
  const errors: AgentValidation["errors"] = [];
  const warnings: AgentValidation["warnings"] = [];
  const parsed = AgentConfigSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) errors.push({ field: i.path.join("."), message: i.message });
    return { config: null, validation: { errors, warnings, missingTools: [], missingSkills: [] } };
  }
  const cfg = parsed.data as AgentDefinitionInput;
  for (const t of cfg.tools) {
    const tool = getTool(t);
    if (!tool) errors.push({ field: "tools", message: `Unknown tool "${t}"` });
    else if (tool.riskLevel > cfg.permissions.maxRiskLevel) warnings.push({ field: "tools", message: `"${t}" (risk ${tool.riskLevel}) is above the risk ceiling and will be blocked` });
    else if (cfg.permissions.restrictedCategories.includes(tool.category)) warnings.push({ field: "tools", message: `"${t}" is in restricted category "${tool.category}" and will be blocked` });
  }
  const skillRecs = await loadSkills(workspaceId, cfg.skills.map((s) => s.key));
  for (const s of cfg.skills) if (!skillRecs.some((r) => r.key === s.key)) errors.push({ field: "skills", message: `Unknown skill "${s.key}"` });
  const compiled = compileAgent(cfg, skillRecs);
  const mandatory = new Set(cfg.skills.filter((s) => s.mandatory).map((s) => s.key));
  for (const s of skillRecs) {
    const miss = s.requiredTools.filter((t) => !compiled.allowedTools.includes(t));
    if (miss.length) (mandatory.has(s.key) ? errors : warnings).push({ field: "skills", message: `Skill "${s.name}" needs tool(s) the agent may not use: ${miss.join(", ")}` });
  }
  for (const k of compiled.missingSkills) warnings.push({ field: "skills", message: `A skill depends on "${k}", which is not assigned` });

  const dept = await queryOne("SELECT 1 FROM departments WHERE workspace_id=$1 AND key=$2", [workspaceId, cfg.office.departmentKey]);
  if (!dept) errors.push({ field: "office.departmentKey", message: `Department "${cfg.office.departmentKey}" does not exist` });
  if (cfg.office.preferredMeetingRoom) {
    const room = await queryOne("SELECT 1 FROM office_zones WHERE workspace_id=$1 AND key=$2 AND kind='meeting_room'", [workspaceId, cfg.office.preferredMeetingRoom]);
    if (!room) warnings.push({ field: "office.preferredMeetingRoom", message: "Preferred meeting room does not exist; the default room will be used" });
  }
  if (cfg.office.avatarPreset !== "custom" && !AVATAR_BY_KEY.has(cfg.office.avatarPreset)) warnings.push({ field: "office.avatarPreset", message: "Unknown avatar preset; the custom appearance is used" });
  if (cfg.ai.temperature !== null) warnings.push({ field: "ai.temperature", message: "Temperature is not supported by current Claude models and is ignored" });

  // Relationships: existence, self-reference, cycles (supervisor hierarchy and delegation graph).
  const others = await query<{ slug: string; supervisor_slug: string | null; lifecycle: string }>(
    "SELECT slug, supervisor_slug, lifecycle FROM agents WHERE workspace_id=$1 AND deleted_at IS NULL", [workspaceId],
  );
  const known = new Set(others.map((o) => o.slug));
  const self = slug ?? "__new__";
  const rel = cfg.relationships;
  if (rel.supervisor) {
    if (rel.supervisor === self) errors.push({ field: "relationships.supervisor", message: "An agent cannot supervise itself" });
    else if (!known.has(rel.supervisor)) errors.push({ field: "relationships.supervisor", message: `Unknown supervisor "${rel.supervisor}"` });
  }
  for (const f of ["delegatesTo", "collaboratesWith"] as const) {
    for (const s of rel[f]) {
      if (s === self) errors.push({ field: `relationships.${f}`, message: "An agent cannot reference itself" });
      else if (!known.has(s)) errors.push({ field: `relationships.${f}`, message: `Unknown agent "${s}"` });
    }
  }
  const sup = new Map(others.map((o) => [o.slug, o.supervisor_slug ? [o.supervisor_slug] : []]));
  sup.set(self, rel.supervisor ? [rel.supervisor] : []);
  const supCycle = hasCycle(sup);
  if (supCycle) errors.push({ field: "relationships.supervisor", message: `Circular reporting line: ${supCycle.join(" → ")}` });
  const del = new Map<string, string[]>();
  for (const r of await query<{ agent_slug: string; related_slug: string }>("SELECT agent_slug, related_slug FROM agent_relationships WHERE workspace_id=$1 AND kind='delegates_to'", [workspaceId])) {
    if (r.agent_slug === self) continue;
    del.set(r.agent_slug, [...(del.get(r.agent_slug) ?? []), r.related_slug]);
  }
  del.set(self, rel.delegatesTo);
  const delCycle = hasCycle(del);
  if (delCycle) errors.push({ field: "relationships.delegatesTo", message: `Circular delegation: ${delCycle.join(" → ")}` });

  return { config: cfg, validation: { errors, warnings, missingTools: compiled.missingTools, missingSkills: compiled.missingSkills } };
}

// ───────────────────────── Commands (admin) ─────────────────────────

async function uniqueSlug(workspaceId: string, nameEn: string): Promise<string> {
  const base = (nameEn.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "agent").replace(/^(\d)/, "a_$1");
  const taken = new Set((await query<{ slug: string }>("SELECT slug FROM agents WHERE workspace_id=$1 AND slug LIKE $2", [workspaceId, `${base}%`])).map((r) => r.slug));
  const reserved = new Set(["orchestrator", "models", "import", "validate", "draft", "bulk", "new"]);
  if (!taken.has(base) && !reserved.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

function throwIfInvalid(v: AgentValidation) {
  if (v.errors.length) throw new AppError(400, "invalid_agent", v.errors.map((e) => `${e.field}: ${e.message}`).join("; "), v);
}

async function emitWorkforce(workspaceId: string, slug: string, type: "agent_created" | "agent_updated" | "agent_activated" | "agent_deactivated" | "agent_archived" | "agent_restored" | "agent_deleted" | "agent_moved", summary: string) {
  await emitEvent({ workspaceId, agent: slug, type, summary, payload: { slug } });
  await refreshPresence(workspaceId).catch(() => {});
}

export async function createAgent(workspaceId: string, userId: string, raw: unknown, opts: { lifecycle?: "draft" | "active"; templateKey?: string | null; ip?: string } = {}): Promise<AgentRecord> {
  const { config, validation } = await validateAgentConfig(workspaceId, raw, null);
  throwIfInvalid(validation);
  const slug = await uniqueSlug(workspaceId, config!.nameEn);
  await transaction((c) => writeAgent(c, workspaceId, userId, { slug, config: config!, lifecycle: opts.lifecycle ?? "active", note: "Created", templateKey: opts.templateKey }));
  await audit({ workspaceId, userId, actorType: "user", action: "agent.created", targetType: "agent", targetId: slug, metadata: { lifecycle: opts.lifecycle ?? "active", template: opts.templateKey ?? null }, ip: opts.ip });
  await emitWorkforce(workspaceId, slug, "agent_created", config!.nameAr);
  return (await getAgentRecord(workspaceId, slug))!;
}

export async function updateAgent(workspaceId: string, userId: string, slug: string, patch: Partial<AgentDefinitionInput>, note?: string | null, ip?: string): Promise<AgentRecord> {
  const current = await getAgentRecord(workspaceId, slug);
  if (!current) throw notFound("Agent not found");
  const base: AgentDefinitionInput = stripRecord(current);
  const merged = mergeConfig(base, patch);
  const { config, validation } = await validateAgentConfig(workspaceId, merged, slug);
  throwIfInvalid(validation);
  const moved = config!.office.departmentKey !== current.office.departmentKey;
  await transaction((c) => writeAgent(c, workspaceId, userId, { slug, config: config!, isOrchestrator: current.isOrchestrator, lifecycle: current.lifecycle, existingId: current.id, note: note ?? "Updated" }));
  invalidateRuntime(workspaceId, slug);
  await audit({ workspaceId, userId, actorType: "user", action: "agent.updated", targetType: "agent", targetId: slug, metadata: { fields: Object.keys(patch ?? {}), note: note ?? null }, ip });
  await emitWorkforce(workspaceId, slug, moved ? "agent_moved" : "agent_updated", config!.nameAr);
  return (await getAgentRecord(workspaceId, slug))!;
}

export function stripRecord(r: AgentRecord): AgentDefinitionInput {
  const { id: _id, slug: _slug, isOrchestrator: _o, lifecycle: _l, version: _v, templateKey: _t, createdAt: _c, updatedAt: _u, archivedAt: _a, ...cfg } = r;
  void _id; void _slug; void _o; void _l; void _v; void _t; void _c; void _u; void _a;
  return cfg;
}

export async function activeTasksFor(workspaceId: string, slug: string) {
  return query<{ id: string; title: string; status: string }>(
    `SELECT DISTINCT t.id, t.title, t.status FROM tasks t JOIN task_steps s ON s.task_id=t.id
      WHERE t.workspace_id=$1 AND t.status IN ('planned','running','waiting_approval','paused')
        AND s.status IN ('pending','running','waiting_approval') AND (s.agent_slug=$2 OR $2 = ANY(s.participants))`, [workspaceId, slug],
  );
}

export async function setLifecycle(
  workspaceId: string, userId: string, slug: string, action: "activate" | "deactivate" | "archive" | "restore", opts: { force?: boolean; ip?: string } = {},
): Promise<{ agent: AgentRecord; affectedTasks: Array<{ id: string; title: string; status: string }> }> {
  const a = await getAgentRecord(workspaceId, slug);
  if (!a) throw notFound("Agent not found");
  if (a.isOrchestrator && action !== "activate") throw forbidden("The main orchestrator cannot be deactivated or archived");
  const active = await activeTasksFor(workspaceId, slug);
  let next: AgentLifecycle = a.lifecycle;
  let affected: typeof active = [];
  if (action === "activate") {
    if (a.lifecycle === "archived") throw conflict("Restore the agent before activating it");
    next = "active";
  } else if (action === "deactivate") {
    if (a.lifecycle === "archived") throw conflict("Archived agents are already inactive");
    next = "inactive"; // already-assigned steps may finish; no new work is planned for it
    affected = active;
  } else if (action === "archive") {
    if (active.length && !opts.force) throw new AppError(409, "active_tasks", "This agent has active tasks. Archive anyway to cancel them, or wait until they finish.", { activeTasks: active });
    if (active.length) {
      const { controlTask } = await import("../orchestrator/engine");
      for (const t of active) await controlTask(workspaceId, t.id, "cancel", userId).catch(() => {});
      affected = active;
    }
    next = "archived";
  } else if (action === "restore") {
    if (a.lifecycle !== "archived") throw conflict("Only archived agents can be restored");
    next = "inactive";
  }
  await transaction(async (c) => {
    await query(`UPDATE agents SET lifecycle=$2, active=$3, archived_at = CASE WHEN $2='archived' THEN now() ELSE NULL END, updated_at=now() WHERE id=$1`, [a.id, next, next === "active"], c);
    if (next === "archived") await releaseWorkstation(c, a.id);
    else {
      const ws = await allocateWorkstation(c, workspaceId, a.id, await departmentId(c, workspaceId, a.office.departmentKey));
      await query("UPDATE agents SET office = jsonb_set(office, '{workstationId}', to_jsonb($2::text)) WHERE id=$1", [a.id, ws], c);
    }
  });
  invalidateRuntime(workspaceId, slug);
  await audit({ workspaceId, userId, actorType: "user", action: `agent.${action}d`, targetType: "agent", targetId: slug, metadata: { from: a.lifecycle, to: next, affectedTasks: affected.map((t) => t.id) }, ip: opts.ip });
  const ev = { activate: "agent_activated", deactivate: "agent_deactivated", archive: "agent_archived", restore: "agent_restored" } as const;
  await emitWorkforce(workspaceId, slug, ev[action], a.nameAr);
  return { agent: (await getAgentRecord(workspaceId, slug))!, affectedTasks: affected };
}

/** Soft delete: the row stays as a tombstone so task/message history and the slug remain valid. */
export async function deleteAgent(workspaceId: string, userId: string, slug: string, confirm: string, ip?: string): Promise<void> {
  const a = await getAgentRecord(workspaceId, slug);
  if (!a) throw notFound("Agent not found");
  if (a.isOrchestrator) throw forbidden("The main orchestrator cannot be deleted");
  if (confirm !== slug) throw badRequest("Confirmation does not match the agent ID");
  const active = await activeTasksFor(workspaceId, slug);
  if (active.length) throw new AppError(409, "active_tasks", "This agent has active tasks. Archive it (and cancel them) first.", { activeTasks: active });
  await transaction(async (c) => {
    await query("UPDATE agents SET deleted_at=now(), lifecycle='archived', active=false, archived_at=COALESCE(archived_at, now()) WHERE id=$1", [a.id], c);
    await releaseWorkstation(c, a.id);
    await query("DELETE FROM agent_relationships WHERE workspace_id=$1 AND (agent_slug=$2 OR related_slug=$2)", [workspaceId, slug], c);
    await query("UPDATE agents SET supervisor_slug='orchestrator' WHERE workspace_id=$1 AND supervisor_slug=$2", [workspaceId, slug], c);
    await query("UPDATE departments SET manager_slug=NULL WHERE workspace_id=$1 AND manager_slug=$2", [workspaceId, slug], c);
  });
  invalidateRuntime(workspaceId, slug);
  await audit({ workspaceId, userId, actorType: "user", action: "agent.deleted", targetType: "agent", targetId: slug, metadata: { nameAr: a.nameAr, nameEn: a.nameEn }, ip });
  await emitWorkforce(workspaceId, slug, "agent_deleted", a.nameAr);
}

export async function duplicateAgent(workspaceId: string, userId: string, slug: string, names: { nameAr?: string; nameEn?: string } = {}, ip?: string): Promise<AgentRecord> {
  const a = await getAgentRecord(workspaceId, slug);
  if (!a) throw notFound("Agent not found");
  const cfg = stripRecord(a);
  const copy: AgentDefinitionInput = { ...cfg, nameAr: names.nameAr ?? `${cfg.nameAr} (نسخة)`.slice(0, 60), nameEn: names.nameEn ?? `${cfg.nameEn} Copy`.slice(0, 60), office: { ...cfg.office, workstationId: null } };
  if (a.isOrchestrator) copy.relationships = { ...copy.relationships, supervisor: "orchestrator" };
  return createAgent(workspaceId, userId, copy, { lifecycle: "draft", ip });
}

// ───────────────────────── Skills ─────────────────────────

export async function listSkills(workspaceId: string): Promise<SkillRecord[]> {
  await ensureWorkspaceSeeded(workspaceId);
  return query<SkillRecord>(
    `SELECT DISTINCT ON (s.key) s.key, s.name, s.name_ar AS "nameAr", s.description, s.category, s.instructions, s.required_tools AS "requiredTools",
            s.depends_on AS "dependsOn", (s.workspace_id IS NULL) AS builtin,
            (SELECT count(*)::int FROM agent_skills x JOIN agents a ON a.id=x.agent_id WHERE x.skill_key=s.key AND a.workspace_id=$1 AND a.deleted_at IS NULL) AS "agentCount"
       FROM skills s WHERE s.workspace_id=$1 OR s.workspace_id IS NULL ORDER BY s.key, (s.workspace_id IS NULL)`, [workspaceId],
  );
}

export const SkillSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/).optional(),
  name: z.string().trim().min(2).max(80), nameAr: z.string().trim().min(1).max(80), description: z.string().trim().max(500),
  category: z.string().trim().min(2).max(40).default("general"), instructions: z.string().trim().min(5).max(8000),
  requiredTools: z.array(z.string().max(80)).max(20).default([]), dependsOn: z.array(z.string().max(60)).max(20).default([]),
});

export async function saveSkill(workspaceId: string, userId: string, raw: unknown, existingKey?: string): Promise<SkillRecord> {
  await ensureWorkspaceSeeded(workspaceId);
  const s = SkillSchema.parse(raw);
  for (const t of s.requiredTools) if (!getTool(t)) throw badRequest(`Unknown tool "${t}"`);
  const key = existingKey ?? s.key ?? (s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || `skill_${Date.now()}`);
  const builtin = await queryOne("SELECT 1 FROM skills WHERE workspace_id IS NULL AND key=$1", [key]);
  if (builtin) throw conflict(existingKey ? "Built-in skills cannot be edited" : `A built-in skill named "${key}" already exists`);
  const skills = await listSkills(workspaceId);
  for (const d of s.dependsOn) if (!skills.some((x) => x.key === d) || d === key) throw badRequest(`Invalid dependency "${d}"`);
  if (existingKey) {
    const r = await queryOne("UPDATE skills SET name=$3, name_ar=$4, description=$5, category=$6, instructions=$7, required_tools=$8, depends_on=$9, updated_at=now() WHERE workspace_id=$1 AND key=$2 RETURNING id",
      [workspaceId, key, s.name, s.nameAr, s.description, s.category, s.instructions, s.requiredTools, s.dependsOn]);
    if (!r) throw notFound("Skill not found");
  } else {
    const exists = await queryOne("SELECT 1 FROM skills WHERE workspace_id=$1 AND key=$2", [workspaceId, key]);
    if (exists) throw conflict(`A skill with key "${key}" already exists`);
    await query("INSERT INTO skills(workspace_id, key, name, name_ar, description, category, instructions, required_tools, depends_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [workspaceId, key, s.name, s.nameAr, s.description, s.category, s.instructions, s.requiredTools, s.dependsOn, userId]);
  }
  invalidateRuntime(workspaceId);
  await audit({ workspaceId, userId, actorType: "user", action: existingKey ? "skill.updated" : "skill.created", targetType: "skill", targetId: key });
  return (await listSkills(workspaceId)).find((x) => x.key === key)!;
}

export async function deleteSkill(workspaceId: string, userId: string, key: string): Promise<void> {
  const used = await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM agent_skills x JOIN agents a ON a.id=x.agent_id WHERE a.workspace_id=$1 AND x.skill_key=$2 AND a.deleted_at IS NULL", [workspaceId, key]);
  if (used && used.n > 0) throw conflict(`This skill is assigned to ${used.n} agent(s); remove it from them first`);
  const r = await queryOne("DELETE FROM skills WHERE workspace_id=$1 AND key=$2 RETURNING id", [workspaceId, key]);
  if (!r) throw notFound("Custom skill not found (built-in skills cannot be deleted)");
  await audit({ workspaceId, userId, actorType: "user", action: "skill.deleted", targetType: "skill", targetId: key });
}

// ───────────────────────── Templates ─────────────────────────

export async function listTemplates(workspaceId: string): Promise<TemplateRecord[]> {
  await ensureWorkspaceSeeded(workspaceId);
  return query<TemplateRecord>(
    `SELECT key, name, name_ar AS "nameAr", description, category, (workspace_id IS NULL) AS builtin, config
       FROM agent_templates WHERE workspace_id=$1 OR workspace_id IS NULL ORDER BY (workspace_id IS NULL) DESC, name`, [workspaceId],
  );
}

export async function saveTemplate(workspaceId: string, userId: string, input: { fromAgent?: string; config?: unknown; name: string; nameAr: string; description?: string; category?: string }): Promise<TemplateRecord> {
  let config: AgentDefinitionInput;
  if (input.fromAgent) {
    const a = await getAgentRecord(workspaceId, input.fromAgent);
    if (!a) throw notFound("Agent not found");
    config = { ...stripRecord(a), office: { ...a.office, workstationId: null } };
  } else {
    const v = await validateAgentConfig(workspaceId, input.config, null);
    throwIfInvalid(v.validation);
    config = v.config!;
  }
  const key = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "template"}_${Date.now().toString(36)}`;
  await query("INSERT INTO agent_templates(workspace_id, key, name, name_ar, description, category, config, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [workspaceId, key, input.name.slice(0, 80), input.nameAr.slice(0, 80), (input.description ?? "").slice(0, 500), input.category ?? "custom", config, userId]);
  await audit({ workspaceId, userId, actorType: "user", action: "template.created", targetType: "template", targetId: key, metadata: { fromAgent: input.fromAgent ?? null } });
  return (await listTemplates(workspaceId)).find((t) => t.key === key)!;
}

export async function deleteTemplate(workspaceId: string, userId: string, key: string) {
  const r = await queryOne("DELETE FROM agent_templates WHERE workspace_id=$1 AND key=$2 RETURNING id", [workspaceId, key]);
  if (!r) throw notFound("Custom template not found (built-in templates cannot be deleted)");
  await audit({ workspaceId, userId, actorType: "user", action: "template.deleted", targetType: "template", targetId: key });
}

// ───────────────────────── Departments ─────────────────────────

export async function listDepartments(workspaceId: string): Promise<DepartmentRecord[]> {
  await ensureWorkspaceSeeded(workspaceId);
  return query<DepartmentRecord>(
    `SELECT d.id, d.key, d.name, d.name_ar AS "nameAr", d.color, d.kind, d.manager_slug AS "managerSlug", d.meeting_room_key AS "meetingRoomKey", d.sort,
            (SELECT count(*)::int FROM agents a WHERE a.department_id=d.id AND a.deleted_at IS NULL AND a.lifecycle <> 'archived') AS "agentCount"
       FROM departments d WHERE d.workspace_id=$1 ORDER BY d.sort, d.created_at`, [workspaceId],
  );
}

export const DepartmentSchema = z.object({
  name: z.string().trim().min(2).max(80), nameAr: z.string().trim().min(1).max(80), color: hex,
  managerSlug: z.string().max(80).nullable().optional(), meetingRoomKey: z.string().max(80).nullable().optional(), sort: z.number().int().min(0).max(1000).optional(),
});

async function checkDeptRefs(workspaceId: string, d: { managerSlug?: string | null; meetingRoomKey?: string | null }) {
  if (d.managerSlug && !(await queryOne("SELECT 1 FROM agents WHERE workspace_id=$1 AND slug=$2 AND deleted_at IS NULL", [workspaceId, d.managerSlug]))) throw badRequest("Unknown manager agent");
  if (d.meetingRoomKey && !(await queryOne("SELECT 1 FROM office_zones WHERE workspace_id=$1 AND key=$2 AND kind='meeting_room'", [workspaceId, d.meetingRoomKey]))) throw badRequest("Unknown meeting room");
}

export async function createDepartment(workspaceId: string, userId: string, raw: unknown): Promise<DepartmentRecord> {
  await ensureWorkspaceSeeded(workspaceId);
  const d = DepartmentSchema.parse(raw);
  await checkDeptRefs(workspaceId, d);
  let key = d.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "department";
  if (["meeting_room", "lounge"].some((p) => key.startsWith(p))) key = `dept_${key}`;
  const taken = new Set((await query<{ key: string }>("SELECT key FROM departments WHERE workspace_id=$1", [workspaceId])).map((r) => r.key));
  for (let i = 2; taken.has(key); i++) key = `${key.replace(/_\d+$/, "")}_${i}`;
  const sort = (await queryOne<{ n: number }>("SELECT COALESCE(MAX(sort)+1,0) AS n FROM departments WHERE workspace_id=$1", [workspaceId]))!.n;
  await query("INSERT INTO departments(workspace_id, key, name, name_ar, color, manager_slug, meeting_room_key, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [workspaceId, key, d.name, d.nameAr, d.color, d.managerSlug ?? null, d.meetingRoomKey ?? null, d.sort ?? sort]);
  await audit({ workspaceId, userId, actorType: "user", action: "department.created", targetType: "department", targetId: key });
  await emitEvent({ workspaceId, agent: "orchestrator", type: "office_layout_changed", summary: `Department created: ${d.nameAr}`, payload: { department: key } });
  return (await listDepartments(workspaceId)).find((x) => x.key === key)!;
}

export async function updateDepartment(workspaceId: string, userId: string, key: string, raw: unknown): Promise<DepartmentRecord> {
  const d = DepartmentSchema.partial().parse(raw);
  await checkDeptRefs(workspaceId, d);
  const r = await queryOne(
    `UPDATE departments SET name=COALESCE($3,name), name_ar=COALESCE($4,name_ar), color=COALESCE($5,color),
            manager_slug=CASE WHEN $8 THEN $6 ELSE manager_slug END, meeting_room_key=CASE WHEN $9 THEN $7 ELSE meeting_room_key END,
            sort=COALESCE($10,sort), updated_at=now() WHERE workspace_id=$1 AND key=$2 RETURNING id`,
    [workspaceId, key, d.name ?? null, d.nameAr ?? null, d.color ?? null, d.managerSlug ?? null, d.meetingRoomKey ?? null, d.managerSlug !== undefined, d.meetingRoomKey !== undefined, d.sort ?? null],
  );
  if (!r) throw notFound("Department not found");
  await audit({ workspaceId, userId, actorType: "user", action: "department.updated", targetType: "department", targetId: key, metadata: { fields: Object.keys(d) } });
  await emitEvent({ workspaceId, agent: "orchestrator", type: "office_layout_changed", summary: `Department updated: ${key}`, payload: { department: key } });
  return (await listDepartments(workspaceId)).find((x) => x.key === key)!;
}

export async function deleteDepartment(workspaceId: string, userId: string, key: string): Promise<void> {
  const d = (await listDepartments(workspaceId)).find((x) => x.key === key);
  if (!d) throw notFound("Department not found");
  if (d.kind === "executive") throw forbidden("The executive department cannot be deleted");
  const members = await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM agents WHERE department_id=$1 AND deleted_at IS NULL", [d.id]);
  if (members && members.n > 0) throw conflict("Only empty departments can be deleted. Move or delete its agents first (archived agents count too).");
  await query("DELETE FROM departments WHERE id=$1", [d.id]);
  await audit({ workspaceId, userId, actorType: "user", action: "department.deleted", targetType: "department", targetId: key });
  await emitEvent({ workspaceId, agent: "orchestrator", type: "office_layout_changed", summary: `Department deleted: ${key}`, payload: { department: key } });
}

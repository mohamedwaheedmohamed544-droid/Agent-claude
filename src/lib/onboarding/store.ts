/**
 * Onboarding persistence and workforce generation (Blueprint §5.5–5.6).
 *
 * Flow: save answers per step → generate proposal (versioned) → customer edits (hash changes) →
 * approve with the hash the customer reviewed → generate the workforce through the normal agent
 * registry (so validation, versioning, permissions, audit and the live office all apply).
 * Nothing external is activated: integrations are only listed for the customer to connect.
 */
import { query, queryOne, transaction } from "../db";
import { AppError, badRequest, conflict, forbidden, notFound } from "../errors";
import { audit } from "../audit";
import { emitEvent, refreshPresence } from "../office/events";
import { AVATAR_BY_KEY } from "../office/avatars";
import { BUILTIN_TEMPLATES, defaultConfig } from "../agents/catalog";
import { createAgent, ensureWorkspaceSeeded, getAgentRecord, listAgentRecords, listDepartments, setLifecycle, stripRecord, updateAgent, updateDepartment, validateAgentConfig } from "../agents/registry";
import type { AgentDefinitionInput } from "../agents/types";
import { getWorkspaceSettings } from "../settings";
import { ROLE_RANK, type Role } from "../auth/session";
import { STEPS, cleanStep, isComplete, type Answers, type PartialAnswers, type StepKey } from "./schema";
import { ENGINE_VERSION, applyEdit, blueprintHash, buildOperatingProfile, generateBlueprint, BlueprintEditError } from "./engine";
import type { BlueprintEdit, BlueprintRecord, BlueprintStatus, GenerationReport, OnboardingState, WorkforceBlueprint } from "./types";

type Row = {
  id: string; version: number; status: BlueprintStatus; engine: string; blueprint: WorkforceBlueprint; blueprint_hash: string;
  edits: BlueprintRecord["edits"]; revision_note: string | null; decision_note: string | null; generation_report: GenerationReport | null;
  created_at: string; decided_at: string | null; applied_at: string | null;
};
const COLS = "id, version, status, engine, blueprint, blueprint_hash, edits, revision_note, decision_note, generation_report, created_at, decided_at, applied_at";
const toRecord = (r: Row): BlueprintRecord => ({
  id: r.id, version: r.version, status: r.status, engine: r.engine, blueprint: r.blueprint, hash: r.blueprint_hash, edits: r.edits,
  revisionNote: r.revision_note, decisionNote: r.decision_note, report: r.generation_report, createdAt: r.created_at, decidedAt: r.decided_at, appliedAt: r.applied_at,
});

const hasRole = (role: Role, min: Role) => ROLE_RANK[role] >= ROLE_RANK[min];

function requireManager(role: Role) {
  if (!hasRole(role, "admin")) throw forbidden("Only workspace owners and admins can set up the workforce");
}

async function setStatus(workspaceId: string, status: OnboardingState["status"]) {
  await query("UPDATE workspaces SET onboarding_status=$2, updated_at=now() WHERE id=$1", [workspaceId, status]);
}

async function loadAnswers(workspaceId: string): Promise<{ answers: PartialAnswers; currentStep: string; profile: unknown } | null> {
  const r = await queryOne<{ answers: PartialAnswers; current_step: string; profile: unknown }>("SELECT answers, current_step, profile FROM company_profiles WHERE workspace_id=$1", [workspaceId]);
  return r ? { answers: r.answers, currentStep: r.current_step, profile: r.profile } : null;
}

/** Re-validates every step in order (later steps depend on earlier answers). Returns the first invalid step. */
function validateAll(a: PartialAnswers): { answers: Answers | null; invalidStep: StepKey | null } {
  const out: PartialAnswers = {};
  for (const s of STEPS) {
    if (a[s] === undefined) return { answers: null, invalidStep: s };
    try { (out as Record<string, unknown>)[s] = cleanStep(s, a[s], out); } catch { return { answers: null, invalidStep: s }; }
  }
  return isComplete(out) ? { answers: out, invalidStep: null } : { answers: null, invalidStep: "identity" };
}

export async function getOnboardingState(workspaceId: string, role: Role): Promise<OnboardingState> {
  const ws = await queryOne<{ onboarding_status: OnboardingState["status"] }>("SELECT onboarding_status FROM workspaces WHERE id=$1", [workspaceId]);
  const stored = await loadAnswers(workspaceId);
  const latest = await queryOne<Row>(`SELECT ${COLS} FROM workforce_blueprints WHERE workspace_id=$1 ORDER BY version DESC LIMIT 1`, [workspaceId]);
  const history = await query<{ id: string; version: number; status: BlueprintStatus; createdAt: string }>(
    `SELECT id, version, status, created_at AS "createdAt" FROM workforce_blueprints WHERE workspace_id=$1 ORDER BY version DESC LIMIT 20`, [workspaceId]);
  const v = validateAll(stored?.answers ?? {});
  return {
    status: ws?.onboarding_status ?? "not_started",
    answers: (stored?.answers ?? {}) as Record<string, unknown>,
    currentStep: stored?.currentStep ?? "identity",
    profile: (stored?.profile as OnboardingState["profile"]) ?? null,
    complete: Boolean(v.answers),
    blueprint: latest ? toRecord(latest) : null,
    history,
    canManage: hasRole(role, "admin"),
  };
}

export async function saveStep(p: { workspaceId: string; userId: string; role: Role; step: string; data: unknown; ip?: string }): Promise<OnboardingState> {
  requireManager(p.role);
  if (!(STEPS as readonly string[]).includes(p.step)) throw badRequest("Unknown step");
  const step = p.step as StepKey;
  const stored = (await loadAnswers(p.workspaceId))?.answers ?? {};
  const context: PartialAnswers = { ...stored };
  const cleaned = cleanStep(step, p.data, context);
  const answers: PartialAnswers = { ...stored, [step]: cleaned };
  const next = STEPS[Math.min(STEPS.indexOf(step) + 1, STEPS.length - 1)];
  const v = validateAll(answers);
  const profile = v.answers ? buildOperatingProfile(v.answers) : null;
  await query(
    `INSERT INTO company_profiles(workspace_id, answers, profile, current_step, updated_by, completed_at)
     VALUES ($1,$2,$3,$4,$5, CASE WHEN $6 THEN now() END)
     ON CONFLICT (workspace_id) DO UPDATE SET answers=$2, profile=$3, current_step=$4, updated_by=$5, updated_at=now(),
       completed_at = CASE WHEN $6 THEN COALESCE(company_profiles.completed_at, now()) ELSE NULL END`,
    [p.workspaceId, answers, profile, next, p.userId, Boolean(v.answers)],
  );
  await query("UPDATE workspaces SET onboarding_status='in_progress' WHERE id=$1 AND onboarding_status IN ('not_started','skipped')", [p.workspaceId]);
  await audit({ workspaceId: p.workspaceId, userId: p.userId, actorType: "user", action: "onboarding.step_saved", targetType: "onboarding", targetId: step, ip: p.ip });
  return getOnboardingState(p.workspaceId, p.role);
}

export async function skipOnboarding(workspaceId: string, userId: string, role: Role): Promise<void> {
  requireManager(role);
  await query("UPDATE workspaces SET onboarding_status='skipped' WHERE id=$1 AND onboarding_status IN ('not_started','in_progress')", [workspaceId]);
  await audit({ workspaceId, userId, actorType: "user", action: "onboarding.skipped", targetType: "onboarding" });
}

export async function createProposal(p: { workspaceId: string; userId: string; role: Role; revisionNote?: string | null; ip?: string }): Promise<BlueprintRecord> {
  requireManager(p.role);
  const stored = await loadAnswers(p.workspaceId);
  const v = validateAll(stored?.answers ?? {});
  if (!v.answers) throw new AppError(400, "onboarding_incomplete", `Please complete the "${v.invalidStep}" step first`, { step: v.invalidStep });
  const bp = generateBlueprint(v.answers);
  const profile = buildOperatingProfile(v.answers);
  const row = await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`blueprint:${p.workspaceId}`]);
    if (await queryOne("SELECT 1 FROM workforce_blueprints WHERE workspace_id=$1 AND status IN ('approved','applying')", [p.workspaceId], c)) {
      throw conflict("A workforce is being generated right now. Try again in a moment.");
    }
    await query("UPDATE workforce_blueprints SET status='superseded', updated_at=now() WHERE workspace_id=$1 AND status IN ('proposed','failed')", [p.workspaceId], c);
    const n = (await queryOne<{ n: number }>("SELECT COALESCE(MAX(version),0)+1 AS n FROM workforce_blueprints WHERE workspace_id=$1", [p.workspaceId], c))!.n;
    return queryOne<Row>(
      `INSERT INTO workforce_blueprints(workspace_id, version, engine, profile, blueprint, blueprint_hash, revision_note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLS}`,
      [p.workspaceId, n, ENGINE_VERSION, profile, bp, blueprintHash(bp), p.revisionNote?.trim().slice(0, 2000) || null, p.userId], c,
    );
  });
  await query("UPDATE workspaces SET onboarding_status='proposed' WHERE id=$1 AND onboarding_status <> 'active'", [p.workspaceId]);
  await audit({ workspaceId: p.workspaceId, userId: p.userId, actorType: "user", action: "blueprint.proposed", targetType: "blueprint", targetId: row!.id,
    metadata: { version: row!.version, agents: bp.agents.length, departments: bp.departments.length, revision: Boolean(p.revisionNote) }, ip: p.ip });
  return toRecord(row!);
}

async function getProposed(workspaceId: string, id: string): Promise<Row> {
  const r = await queryOne<Row>(`SELECT ${COLS} FROM workforce_blueprints WHERE id=$1 AND workspace_id=$2`, [id, workspaceId]);
  if (!r) throw notFound("Blueprint not found");
  return r;
}

export async function editBlueprint(p: { workspaceId: string; userId: string; role: Role; id: string; edit: BlueprintEdit; baseHash: string; ip?: string }): Promise<BlueprintRecord> {
  requireManager(p.role);
  const r = await getProposed(p.workspaceId, p.id);
  if (r.status !== "proposed") throw conflict(`This proposal is ${r.status} and can no longer be edited`);
  if (r.blueprint_hash !== p.baseHash) throw new AppError(409, "blueprint_changed", "The proposal changed since you loaded it. Reload and try again.");
  const stored = await loadAnswers(p.workspaceId);
  const v = validateAll(stored?.answers ?? {});
  if (!v.answers) throw new AppError(400, "onboarding_incomplete", "Your answers changed and are incomplete; regenerate the proposal");
  let next: WorkforceBlueprint;
  try { next = applyEdit(r.blueprint, p.edit, v.answers); } catch (e) {
    if (e instanceof BlueprintEditError) throw badRequest(e.message);
    throw e;
  }
  const edits = [...r.edits, { at: new Date().toISOString(), by: p.userId, edit: p.edit }];
  const updated = await queryOne<Row>(
    `UPDATE workforce_blueprints SET blueprint=$3, blueprint_hash=$4, edits=$5, updated_at=now()
      WHERE id=$1 AND workspace_id=$2 AND status='proposed' AND blueprint_hash=$6 RETURNING ${COLS}`,
    [p.id, p.workspaceId, next, blueprintHash(next), JSON.stringify(edits), p.baseHash],
  );
  if (!updated) throw new AppError(409, "blueprint_changed", "The proposal changed concurrently. Reload and try again.");
  await audit({ workspaceId: p.workspaceId, userId: p.userId, actorType: "user", action: "blueprint.edited", targetType: "blueprint", targetId: p.id, metadata: { edit: p.edit }, ip: p.ip });
  return toRecord(updated);
}

export async function rejectBlueprint(p: { workspaceId: string; userId: string; role: Role; id: string; note?: string | null; ip?: string }): Promise<BlueprintRecord> {
  requireManager(p.role);
  const r = await queryOne<Row>(
    `UPDATE workforce_blueprints SET status='rejected', decided_by=$3, decided_at=now(), decision_note=$4, updated_at=now()
      WHERE id=$1 AND workspace_id=$2 AND status='proposed' RETURNING ${COLS}`, [p.id, p.workspaceId, p.userId, p.note?.trim().slice(0, 2000) || null]);
  if (!r) throw conflict("Only a pending proposal can be rejected");
  await query("UPDATE workspaces SET onboarding_status='in_progress' WHERE id=$1 AND onboarding_status='proposed'", [p.workspaceId]);
  await audit({ workspaceId: p.workspaceId, userId: p.userId, actorType: "user", action: "blueprint.rejected", targetType: "blueprint", targetId: p.id, metadata: { note: p.note ?? null }, ip: p.ip });
  return toRecord(r);
}

// ───────────────────────── Approval + generation ─────────────────────────

/**
 * Approves the exact proposal the customer reviewed (bound by hash) and generates the workforce.
 * Safe to retry: a failed generation can be approved again and continues where it stopped.
 */
export async function approveAndGenerate(p: { workspaceId: string; userId: string; role: Role; id: string; hash: string; ip?: string }): Promise<BlueprintRecord> {
  requireManager(p.role);
  const claimed = await queryOne<Row>(
    `UPDATE workforce_blueprints SET status='applying', decided_by=$3, decided_at=COALESCE(decided_at, now()), updated_at=now()
      WHERE id=$1 AND workspace_id=$2 AND status IN ('proposed','failed') AND blueprint_hash=$4 RETURNING ${COLS}`,
    [p.id, p.workspaceId, p.userId, p.hash],
  );
  if (!claimed) {
    const r = await getProposed(p.workspaceId, p.id);
    if (r.blueprint_hash !== p.hash) throw new AppError(409, "blueprint_changed", "The proposal changed since you reviewed it. Please review it again.");
    throw conflict(`This proposal is already ${r.status}`);
  }
  await audit({ workspaceId: p.workspaceId, userId: p.userId, actorType: "user", action: "blueprint.approved", targetType: "blueprint", targetId: p.id, metadata: { version: claimed.version, hash: p.hash }, ip: p.ip });

  const report: GenerationReport = claimed.generation_report ?? {
    departmentsCreated: [], departmentsReused: [], departmentsRemoved: [], agents: [], deactivated: [], integrationsToConnect: [],
    settings: claimed.blueprint.settings, validation: [],
  };
  delete report.error;
  const save = () => query("UPDATE workforce_blueprints SET generation_report=$2, updated_at=now() WHERE id=$1", [p.id, report]);
  try {
    await generateWorkforce(p.workspaceId, p.userId, claimed.blueprint, report, save, p.ip);
  } catch (e) {
    report.error = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
    await query("UPDATE workforce_blueprints SET status='failed', generation_report=$2, updated_at=now() WHERE id=$1", [p.id, report]);
    await audit({ workspaceId: p.workspaceId, userId: p.userId, actorType: "system", action: "blueprint.generation_failed", targetType: "blueprint", targetId: p.id, metadata: { error: report.error } });
    throw new AppError(500, "generation_failed", `Workforce generation stopped: ${report.error}. Nothing was lost — approve again to continue.`);
  }
  const done = await transaction(async (c) => {
    await query("UPDATE workforce_blueprints SET status='superseded', updated_at=now() WHERE workspace_id=$1 AND status='applied' AND id<>$2", [p.workspaceId, p.id], c);
    return queryOne<Row>(`UPDATE workforce_blueprints SET status='applied', applied_at=now(), generation_report=$2, updated_at=now() WHERE id=$1 RETURNING ${COLS}`, [p.id, report], c);
  });
  await setStatus(p.workspaceId, "active");
  await audit({ workspaceId: p.workspaceId, userId: p.userId, actorType: "user", action: "workforce.generated", targetType: "blueprint", targetId: p.id,
    metadata: { agents: report.agents.length, deactivated: report.deactivated.length, departmentsCreated: report.departmentsCreated }, ip: p.ip });
  await emitEvent({ workspaceId: p.workspaceId, agent: "orchestrator", type: "office_layout_changed", summary: "Workforce generated from the approved blueprint", payload: { blueprint: p.id } });
  await refreshPresence(p.workspaceId).catch(() => {});
  return toRecord(done!);
}

const STARTER_SLUGS = new Set(["research", "business_development", "documents", "writing", "analytics", "operations", "marketing"]);

/** Active agents a new blueprint may deactivate: starter agents and agents generated by earlier blueprints. */
async function replaceableAgents(workspaceId: string, keep: Set<string>): Promise<Array<{ slug: string; name: string }>> {
  const earlier = new Set((await query<{ slug: string }>(
    `SELECT DISTINCT a->>'slug' AS slug FROM workforce_blueprints b, jsonb_array_elements(COALESCE(b.generation_report->'agents','[]'::jsonb)) a
      WHERE b.workspace_id=$1 AND b.status IN ('applied','superseded')`, [workspaceId])).map((r) => r.slug));
  return (await listAgentRecords(workspaceId, { lifecycle: "active" }))
    .filter((a) => !a.isOrchestrator && !keep.has(a.slug) && (STARTER_SLUGS.has(a.slug) || earlier.has(a.slug)))
    .map((a) => ({ slug: a.slug, name: a.nameAr }));
}

/** What approving this blueprint will change — shown to the customer before they confirm. */
export async function previewImpact(workspaceId: string, bp: WorkforceBlueprint) {
  await ensureWorkspaceSeeded(workspaceId);
  const reuse: Array<{ key: string; slug: string; name: string }> = [];
  const create: Array<{ key: string; name: string }> = [];
  for (const ag of bp.agents) {
    const r = ag.reuse ? await getAgentRecord(workspaceId, ag.reuse) : null;
    if (r) reuse.push({ key: ag.key, slug: r.slug, name: ag.nameAr });
    else create.push({ key: ag.key, name: ag.nameAr });
  }
  const deactivate = await replaceableAgents(workspaceId, new Set(reuse.map((r) => r.slug)));
  const depts = new Set((await listDepartments(workspaceId)).map((d) => d.key));
  return { reconfigure: reuse, create, deactivate, newDepartments: bp.departments.filter((d) => !depts.has(d.key)).map((d) => d.key) };
}

const ROLE_AVATAR: Record<string, string> = {
  collections_coordinator: "analyst_blazer_hijab", hr_coordinator: "manager_blazer_hijab", recruiter: "consultant_suit",
};

function agentConfig(bp: WorkforceBlueprint, key: string, base: AgentDefinitionInput, slugOf: Map<string, string>, withRelations: boolean): AgentDefinitionInput {
  const ag = bp.agents.find((x) => x.key === key)!;
  const lang = bp.company.language === "ar" ? "ar" : "en";
  const duties = ag.customDuties ? ag.customDuties.split(/\n+/).map((s) => s.trim()).filter(Boolean) : ag.duties.map((d) => d[lang]);
  const boundaries = ag.boundaries.map((b) => `- ${b.en}`).join("\n");
  const slug = (k: string) => (k === "orchestrator" ? "orchestrator" : slugOf.get(k));
  return {
    ...base,
    nameEn: ag.nameEn, nameAr: ag.nameAr, roleTitle: ag.title.en, roleTitleAr: ag.title.ar,
    description: ag.summary.en, descriptionAr: ag.summary.ar,
    responsibilities: { ...base.responsibilities, main: ag.customDuties ? duties.join("; ") : ag.summary.en, deliverables: duties.slice(0, 12) },
    ai: { ...base.ai, tier: ag.tier, systemInstructions: `Operating boundaries set during onboarding for ${bp.company.name}:\n${boundaries}`.slice(0, 4000) },
    tools: ag.tools,
    skills: ag.skills.map((s, i) => ({ key: s, mandatory: i === 0 })),
    permissions: { ...base.permissions, maxRiskLevel: ag.maxRiskLevel, alwaysApproveModify: ag.alwaysApproveModify },
    relationships: {
      ...base.relationships,
      supervisor: withRelations ? slug(ag.supervisorKey) ?? "orchestrator" : "orchestrator",
      delegatesTo: withRelations ? ag.delegatesTo.map(slug).filter((s): s is string => Boolean(s)) : [],
      collaboratesWith: withRelations ? ag.collaboratesWith.map(slug).filter((s): s is string => Boolean(s)) : [],
      canJoinMeetings: true, canInitiateCollaboration: true,
    },
    office: { ...base.office, departmentKey: ag.departmentKey, workstationId: null },
  };
}

function baseConfigFor(ag: WorkforceBlueprint["agents"][number]): AgentDefinitionInput {
  const tpl = ag.templateKey ? BUILTIN_TEMPLATES.find((t) => t.key === ag.templateKey) : undefined;
  if (tpl) return structuredClone(tpl.config);
  const cfg = defaultConfig({ nameAr: ag.nameAr, nameEn: ag.nameEn });
  const preset = AVATAR_BY_KEY.get(ROLE_AVATAR[ag.roleKey] ?? "neutral_blazer")!;
  return { ...cfg, office: { ...cfg.office, avatarPreset: preset.key, appearance: preset.appearance } };
}

async function generateWorkforce(workspaceId: string, userId: string, bp: WorkforceBlueprint, report: GenerationReport, save: () => Promise<unknown>, ip?: string) {
  await ensureWorkspaceSeeded(workspaceId);

  // 1. Departments (fixed keys; reuse seeded ones, aligning their names with the approved blueprint).
  const existing = new Map((await listDepartments(workspaceId)).map((d) => [d.key, d]));
  for (const [i, d] of bp.departments.entries()) {
    if (existing.has(d.key)) {
      const cur = existing.get(d.key)!;
      if (cur.name !== d.name.en || cur.nameAr !== d.name.ar) await updateDepartment(workspaceId, userId, d.key, { name: d.name.en, nameAr: d.name.ar });
      if (!report.departmentsReused.includes(d.key)) report.departmentsReused.push(d.key);
    } else {
      await query(`INSERT INTO departments(workspace_id, key, name, name_ar, color, kind, sort) VALUES ($1,$2,$3,$4,$5,'department',$6) ON CONFLICT (workspace_id, key) DO NOTHING`,
        [workspaceId, d.key, d.name.en, d.name.ar, d.color, 10 + i]);
      await audit({ workspaceId, userId, actorType: "user", action: "department.created", targetType: "department", targetId: d.key, metadata: { source: "blueprint" } });
      await emitEvent({ workspaceId, agent: "orchestrator", type: "office_layout_changed", summary: `Department created: ${d.name.ar}`, payload: { department: d.key } });
      if (!report.departmentsCreated.includes(d.key)) report.departmentsCreated.push(d.key);
    }
  }
  await save();

  // 2. Agents — first pass without relationships (targets may not exist yet), leads first.
  const slugOf = new Map(report.agents.map((x) => [x.key, x.slug]));
  const ordered = [...bp.agents].sort((x, y) => Number(x.supervisorKey !== "orchestrator") - Number(y.supervisorKey !== "orchestrator"));
  for (const ag of ordered) {
    if (slugOf.has(ag.key)) continue;
    const reused = ag.reuse ? await getAgentRecord(workspaceId, ag.reuse) : null;
    if (reused) {
      if (reused.lifecycle === "archived") await setLifecycle(workspaceId, userId, reused.slug, "restore", { ip });
      const cfg = agentConfig(bp, ag.key, stripRecord(reused), slugOf, false);
      await updateAgent(workspaceId, userId, reused.slug, cfg, `Reconfigured by approved workforce blueprint`, ip);
      if ((await getAgentRecord(workspaceId, reused.slug))!.lifecycle !== "active") await setLifecycle(workspaceId, userId, reused.slug, "activate", { ip });
      report.agents.push({ key: ag.key, slug: reused.slug, action: "reconfigured", name: ag.nameAr });
      slugOf.set(ag.key, reused.slug);
    } else {
      const cfg = agentConfig(bp, ag.key, baseConfigFor(ag), slugOf, false);
      const rec = await createAgent(workspaceId, userId, cfg, { lifecycle: "active", templateKey: ag.templateKey, ip });
      report.agents.push({ key: ag.key, slug: rec.slug, action: "created", name: ag.nameAr });
      slugOf.set(ag.key, rec.slug);
    }
    await save();
  }

  // 3. Second pass: reporting lines and collaboration (all targets now exist).
  for (const ag of bp.agents) {
    const slug = slugOf.get(ag.key)!;
    const cur = (await getAgentRecord(workspaceId, slug))!;
    const cfg = agentConfig(bp, ag.key, stripRecord(cur), slugOf, true);
    const same = cfg.relationships.supervisor === cur.relationships.supervisor
      && JSON.stringify(cfg.relationships.delegatesTo) === JSON.stringify(cur.relationships.delegatesTo)
      && JSON.stringify(cfg.relationships.collaboratesWith) === JSON.stringify(cur.relationships.collaboratesWith);
    if (!same) await updateAgent(workspaceId, userId, slug, { relationships: cfg.relationships }, "Reporting lines from approved workforce blueprint", ip);
  }

  // 4. Starter agents and agents from an earlier blueprint that are not in the approved workforce are
  //    deactivated (reversible), never deleted. Agents the customer built themselves are left untouched.
  for (const a of await replaceableAgents(workspaceId, new Set(slugOf.values()))) {
    await setLifecycle(workspaceId, userId, a.slug, "deactivate", { ip });
    if (!report.deactivated.some((d) => d.slug === a.slug)) report.deactivated.push({ slug: a.slug, name: a.name });
  }
  await save();

  // 5. Approval policy → workspace settings.
  const current = await getWorkspaceSettings(workspaceId);
  const nextSettings = { ...current, autoApproveLevel3: bp.settings.autoApproveLevel3, autoApproveAgentMemories: bp.settings.autoApproveAgentMemories };
  await query("UPDATE workspaces SET settings=$2, updated_at=now() WHERE id=$1", [workspaceId, nextSettings]);
  await audit({ workspaceId, userId, actorType: "user", action: "settings.updated", targetType: "workspace", targetId: workspaceId, metadata: { source: "blueprint", autoApproveLevel3: nextSettings.autoApproveLevel3, autoApproveAgentMemories: false } });
  report.settings = bp.settings;

  // 6. Integrations are prepared, never activated.
  report.integrationsToConnect = bp.integrations.filter((i) => i.status === "available" && i.decision === "accepted").map((i) => ({ key: i.key, name: i.name }));

  // 7. Configuration validation of the generated workforce.
  report.validation = [];
  for (const slug of slugOf.values()) {
    const a = (await getAgentRecord(workspaceId, slug))!;
    const { validation } = await validateAgentConfig(workspaceId, stripRecord(a), slug);
    if (validation.errors.length) throw new Error(`Generated agent ${slug} failed validation: ${validation.errors.map((e) => e.message).join("; ")}`);
    if (validation.warnings.length) report.validation.push({ slug, warnings: validation.warnings.map((w) => w.message) });
  }
  await save();
}

export function isOnboardingStatus(v: string): v is OnboardingState["status"] {
  return ["not_started", "in_progress", "proposed", "active", "skipped"].includes(v);
}

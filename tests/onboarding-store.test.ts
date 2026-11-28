import { describe, it, expect, beforeAll } from "vitest";
import { query, queryOne } from "@/lib/db";
import { STEPS } from "@/lib/onboarding/schema";
import { approveAndGenerate, createProposal, editBlueprint, getOnboardingState, previewImpact, rejectBlueprint, saveStep } from "@/lib/onboarding/store";
import { createAgent, getAgentRecord, listAgentRecords } from "@/lib/agents/registry";
import { defaultConfig } from "@/lib/agents/catalog";
import { getWorkspaceSettings } from "@/lib/settings";
import { addMember, makeUser } from "./helpers";
import { consultingAnswers } from "./onboarding-fixtures";

async function answerAll(workspaceId: string, userId: string) {
  const a = consultingAnswers();
  for (const s of STEPS) await saveStep({ workspaceId, userId, role: "owner", step: s, data: a[s] });
}

describe("onboarding → blueprint → approved workforce", () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => { owner = await makeUser("Onboarding Owner"); });

  it("saves answers step by step and refuses a proposal until every step is complete", async () => {
    const a = consultingAnswers();
    await saveStep({ workspaceId: owner.workspaceId, userId: owner.userId, role: "owner", step: "identity", data: a.identity });
    let s = await getOnboardingState(owner.workspaceId, "owner");
    expect(s.status).toBe("in_progress");
    expect(s.complete).toBe(false);
    await expect(createProposal({ workspaceId: owner.workspaceId, userId: owner.userId, role: "owner" })).rejects.toMatchObject({ code: "onboarding_incomplete" });
    await answerAll(owner.workspaceId, owner.userId);
    s = await getOnboardingState(owner.workspaceId, "owner");
    expect(s.complete).toBe(true);
    expect(s.profile!.facts.some((f) => f.key === "gaps")).toBe(true);
  });

  it("generates, edits (hash-checked), approves exactly what was reviewed, and builds the workforce", async () => {
    const ws = owner.workspaceId;
    // A custom agent the customer built themselves must survive onboarding untouched.
    const custom = await createAgent(ws, owner.userId, defaultConfig({ nameAr: "مخصص", nameEn: "Custom Helper", office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "operations" } }));

    const v1 = await createProposal({ workspaceId: ws, userId: owner.userId, role: "owner" });
    expect(v1.status).toBe("proposed");
    expect((await getOnboardingState(ws, "owner")).status).toBe("proposed");

    // Stale hash is refused.
    await expect(editBlueprint({ workspaceId: ws, userId: owner.userId, role: "owner", id: v1.id, edit: { op: "remove_agent", agent: "bd_specialist" }, baseHash: "0".repeat(64) }))
      .rejects.toMatchObject({ code: "blueprint_changed" });
    let bp = await editBlueprint({ workspaceId: ws, userId: owner.userId, role: "owner", id: v1.id, edit: { op: "add_agent", role: "project_manager", function: "delivery" }, baseHash: v1.hash });
    bp = await editBlueprint({ workspaceId: ws, userId: owner.userId, role: "owner", id: v1.id, edit: { op: "update_agent", agent: "executive_assistant", duties: "Prepare the weekly management briefing\nTrack board actions" }, baseHash: bp.hash });
    expect(bp.edits).toHaveLength(2);

    const impact = await previewImpact(ws, bp.blueprint);
    expect(impact.reconfigure.map((r) => r.slug).sort()).toEqual(["analytics", "business_development", "documents", "research"]);
    expect(impact.deactivate.map((d) => d.slug).sort()).toEqual(["marketing", "operations", "writing"]);
    expect(impact.deactivate.some((d) => d.slug === custom.slug)).toBe(false);
    expect(impact.newDepartments).toContain("delivery");

    // Approval is bound to the reviewed hash.
    await expect(approveAndGenerate({ workspaceId: ws, userId: owner.userId, role: "owner", id: v1.id, hash: v1.hash })).rejects.toMatchObject({ code: "blueprint_changed" });
    const applied = await approveAndGenerate({ workspaceId: ws, userId: owner.userId, role: "owner", id: v1.id, hash: bp.hash });
    expect(applied.status).toBe("applied");
    expect((await getOnboardingState(ws, "owner")).status).toBe("active");
    const r = applied.report!;
    expect(r.departmentsCreated).toContain("delivery");
    expect(r.agents.find((x) => x.key === "research_analyst")).toMatchObject({ slug: "research", action: "reconfigured" });
    expect(r.agents.filter((x) => x.action === "created").map((x) => x.key).sort()).toEqual(["executive_assistant", "project_manager", "quality_reviewer"]);
    expect(r.deactivated.map((d) => d.slug).sort()).toEqual(["marketing", "operations", "writing"]);
    expect(r.integrationsToConnect.map((i) => i.key)).toEqual(["microsoft"]);

    // Agents exist with the approved configuration, reporting lines, permissions and desks.
    const research = (await getAgentRecord(ws, "research"))!;
    expect(research.office.departmentKey).toBe("research");
    const analyst = (await getAgentRecord(ws, "analytics"))!;
    expect(analyst.relationships.supervisor).toBe("research");
    expect(analyst.office.departmentKey).toBe("research");
    const eaSlug = r.agents.find((x) => x.key === "executive_assistant")!.slug;
    const ea = (await getAgentRecord(ws, eaSlug))!;
    expect(ea.lifecycle).toBe("active");
    expect(ea.nameAr).toBe("لينا");
    expect(ea.responsibilities.deliverables).toEqual(["Prepare the weekly management briefing", "Track board actions"]);
    expect(ea.tools).toEqual(expect.arrayContaining(["email_search", "calendar_list_events"]));
    expect(ea.tools).not.toContain("send_email");
    expect(ea.permissions.maxRiskLevel).toBeLessThanOrEqual(2);
    expect(ea.ai.systemInstructions).toContain("Client documents are drafts");
    expect(ea.office.workstationId).toBeTruthy();
    const pmSlug = r.agents.find((x) => x.key === "project_manager")!.slug;
    expect((await getAgentRecord(ws, pmSlug))!.office.departmentKey).toBe("delivery");

    expect((await getAgentRecord(ws, "writing"))!.lifecycle).toBe("inactive");
    expect((await getAgentRecord(ws, custom.slug))!.lifecycle).toBe("active");
    expect((await getAgentRecord(ws, "orchestrator"))!.lifecycle).toBe("active");

    const settings = await getWorkspaceSettings(ws);
    expect(settings.autoApproveLevel3).toBe(false);
    expect(settings.autoApproveAgentMemories).toBe(false);

    const actions = (await query<{ action: string }>("SELECT action FROM audit_logs WHERE workspace_id=$1", [ws])).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["blueprint.proposed", "blueprint.edited", "blueprint.approved", "workforce.generated", "agent.created", "agent.updated", "agent.deactivated"]));

    // Approving again is refused; nothing is generated twice.
    await expect(approveAndGenerate({ workspaceId: ws, userId: owner.userId, role: "owner", id: v1.id, hash: applied.hash })).rejects.toMatchObject({ status: 409 });
    const active = await listAgentRecords(ws, { lifecycle: "active" });
    expect(active.filter((a) => a.nameAr === "لينا")).toHaveLength(1);
  });

  it("a second blueprint replaces agents from the first one, but never the customer's own", async () => {
    const ws = owner.workspaceId;
    const v2 = await createProposal({ workspaceId: ws, userId: owner.userId, role: "owner", revisionNote: "Drop the quality reviewer" });
    expect(v2.version).toBe(2);
    expect(v2.revisionNote).toBe("Drop the quality reviewer");
    const edited = await editBlueprint({ workspaceId: ws, userId: owner.userId, role: "owner", id: v2.id, edit: { op: "remove_agent", agent: "quality_reviewer" }, baseHash: v2.hash });
    const impact = await previewImpact(ws, edited.blueprint);
    const prior = await queryOne<{ report: { agents: Array<{ key: string; slug: string }> } }>("SELECT generation_report AS report FROM workforce_blueprints WHERE workspace_id=$1 AND version=1", [ws]);
    const qaSlug = prior!.report.agents.find((a) => a.key === "quality_reviewer")!.slug;
    const pmSlug = prior!.report.agents.find((a) => a.key === "project_manager")!.slug;
    expect(impact.deactivate.map((d) => d.slug)).toEqual(expect.arrayContaining([qaSlug, pmSlug]));
    const done = await approveAndGenerate({ workspaceId: ws, userId: owner.userId, role: "owner", id: v2.id, hash: edited.hash });
    expect(done.status).toBe("applied");
    expect((await getAgentRecord(ws, qaSlug))!.lifecycle).toBe("inactive");
    const v1 = await queryOne<{ status: string }>("SELECT status FROM workforce_blueprints WHERE workspace_id=$1 AND version=1", [ws]);
    expect(v1!.status).toBe("superseded");
    expect((await listAgentRecords(ws, { lifecycle: "active" })).some((a) => a.nameEn === "Custom Helper")).toBe(true);
  });

  it("a rejected proposal can be revised", async () => {
    const ws = owner.workspaceId;
    const v3 = await createProposal({ workspaceId: ws, userId: owner.userId, role: "owner" });
    const rej = await rejectBlueprint({ workspaceId: ws, userId: owner.userId, role: "owner", id: v3.id, note: "Too many agents" });
    expect(rej.status).toBe("rejected");
    await expect(approveAndGenerate({ workspaceId: ws, userId: owner.userId, role: "owner", id: v3.id, hash: v3.hash })).rejects.toMatchObject({ status: 409 });
  });
});

describe("onboarding governance", () => {
  it("only owners/admins can answer, propose, edit or approve; other tenants cannot touch a blueprint", async () => {
    const owner = await makeUser("Gov Owner");
    const member = await makeUser("Gov Member");
    await addMember(owner.workspaceId, member.userId, "member");
    await expect(saveStep({ workspaceId: owner.workspaceId, userId: member.userId, role: "member", step: "identity", data: consultingAnswers().identity })).rejects.toMatchObject({ status: 403 });
    await answerAll(owner.workspaceId, owner.userId);
    const bp = await createProposal({ workspaceId: owner.workspaceId, userId: owner.userId, role: "owner" });
    await expect(approveAndGenerate({ workspaceId: owner.workspaceId, userId: member.userId, role: "member", id: bp.id, hash: bp.hash })).rejects.toMatchObject({ status: 403 });
    expect((await getOnboardingState(owner.workspaceId, "member")).canManage).toBe(false);

    const other = await makeUser("Other Tenant");
    await expect(editBlueprint({ workspaceId: other.workspaceId, userId: other.userId, role: "owner", id: bp.id, edit: { op: "remove_agent", agent: "bd_specialist" }, baseHash: bp.hash })).rejects.toMatchObject({ status: 404 });
    await expect(approveAndGenerate({ workspaceId: other.workspaceId, userId: other.userId, role: "owner", id: bp.id, hash: bp.hash })).rejects.toMatchObject({ status: 404 });
    await expect(rejectBlueprint({ workspaceId: other.workspaceId, userId: other.userId, role: "owner", id: bp.id })).rejects.toMatchObject({ status: 409 });
    expect((await getOnboardingState(other.workspaceId, "owner")).blueprint).toBeNull();
    const still = await queryOne<{ status: string }>("SELECT status FROM workforce_blueprints WHERE id=$1", [bp.id]);
    expect(still!.status).toBe("proposed");
  });
});

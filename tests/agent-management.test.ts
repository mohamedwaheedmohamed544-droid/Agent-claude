import { beforeAll, describe, expect, it } from "vitest";
import { query, queryOne } from "@/lib/db";
import { ensureSystemAgents, assignableAgents, getAgent } from "@/lib/agents/store";
import { syncToolRegistry } from "@/lib/tools/registry";
import {
  createAgent, createDepartment, deleteAgent, deleteDepartment, duplicateAgent, getAgentRecord, listAgentRecords, saveSkill,
  setLifecycle, updateAgent, validateAgentConfig,
} from "@/lib/agents/registry";
import { defaultConfig } from "@/lib/agents/catalog";
import { getAgentRuntime } from "@/lib/agents/runtime";
import { draftAgent } from "@/lib/agents/draft";
import { handleChatMessage } from "@/lib/orchestrator/chat";
import { runTask } from "@/lib/orchestrator/engine";
import { buildOrchestratorPrompt } from "@/lib/agents/definitions";
import { executeTool } from "@/lib/tools/executor";
import { addMemory, searchMemory } from "@/lib/memory/store";
import { getOfficeState } from "@/lib/office/state";
import { makeUser } from "./helpers";

beforeAll(async () => {
  await ensureSystemAgents(true);
  await syncToolRegistry(true);
});

const mushtari = () => defaultConfig({
  nameAr: "مشتري", nameEn: "Mushtari", roleTitle: "Procurement Research Agent", roleTitleAr: "وكيل أبحاث المشتريات",
  description: "Researches government procurement opportunities and analyses tender requirements.",
  responsibilities: { main: "Find government procurement opportunities and report findings to راشد.", instructions: "Summarise each opportunity with deadline and requirements.", expertise: ["Procurement"], deliverables: ["Opportunity report"], methodology: "Search → analyse → report", successCriteria: ["Every opportunity cited"] },
  tools: ["web_search", "fetch_url", "knowledge_search", "list_files", "read_file", "create_document"],
  skills: [{ key: "web_research", mandatory: true }, { key: "document_analysis", mandatory: false }],
  office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "research", avatarPreset: "neutral_turtleneck" },
});

const specialist = (i: number, dept = "operations") => defaultConfig({
  nameAr: `وكيل ${i}`, nameEn: `Agent ${i}`, roleTitle: "Specialist", tools: ["knowledge_search", "create_document"],
  office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: dept },
});

describe("Agent Management — acceptance", () => {
  it("Test 1: creating مشتري saves it, initialises its runtime with skills, shows it in the office and lets the orchestrator delegate to it", async () => {
    const u = await makeUser();
    const before = (await listAgentRecords(u.workspaceId)).length;
    expect(before).toBe(8); // starter workforce seeded from data
    const agent = await createAgent(u.workspaceId, u.userId, mushtari());
    expect(agent.slug).toBe("mushtari");
    expect(agent.lifecycle).toBe("active");
    expect(await queryOne("SELECT 1 FROM agents WHERE workspace_id=$1 AND slug='mushtari'", [u.workspaceId])).toBeTruthy();

    const rt = (await getAgentRuntime(u.workspaceId, "mushtari"))!;
    expect(rt.skills.map((s) => s.key).sort()).toEqual(["document_analysis", "web_research"]);
    expect(rt.systemPrompt).toContain("مشتري");
    expect(rt.systemPrompt).toContain("Web research");
    expect(rt.allowedTools).toEqual(expect.arrayContaining(["web_search", "read_file"]));

    expect((await listAgentRecords(u.workspaceId)).map((a) => a.slug)).toContain("mushtari");
    const office = await getOfficeState(u.workspaceId);
    const prof = office.profiles.find((p) => p.slug === "mushtari")!;
    expect(prof.deskZone).toBe("research");
    expect(prof.workstationId).toBeTruthy();
    expect(office.layout.departments.find((d) => d.key === "research")!.workstations.some((w) => w.agentSlug === "mushtari")).toBe(true);

    // Registered with the orchestrator: part of the discovered roster and planning prompt.
    const roster = await assignableAgents(u.workspaceId);
    expect(roster.map((a) => a.slug)).toContain("mushtari");
    const prompt = buildOrchestratorPrompt(roster.map((a) => ({ slug: a.slug, nameAr: a.nameAr, roleTitle: a.roleTitle, description: a.description, main: a.config.responsibilities.main, skills: a.skills.map((s) => s.name), supervisor: a.config.relationships.supervisor, canJoinMeetings: a.config.relationships.canJoinMeetings })));
    expect(prompt).toContain("mushtari — مشتري");

    // Real delegated work.
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "ar", text: "Search the knowledge base for procurement opportunities", targetAgent: "mushtari" });
    expect(await runTask(r.taskId!)).toBe("completed");
    const msgs = await query<{ from_agent: string; to_agent: string; kind: string }>("SELECT from_agent, to_agent, kind FROM agent_messages WHERE task_id=$1", [r.taskId]);
    expect(msgs.map((m) => `${m.from_agent}->${m.to_agent}:${m.kind}`)).toEqual(expect.arrayContaining(["orchestrator->mushtari:delegation", "mushtari->orchestrator:result"]));
    const session = await queryOne<{ status: string; agent_version: number }>("SELECT status, agent_version FROM agent_runtime_sessions WHERE workspace_id=$1 AND agent_slug='mushtari'", [u.workspaceId]);
    expect(session).toBeTruthy();
  });

  it("Test 2 + 6: adding agents allocates workstations and expands the office (standard → large → multi-floor)", async () => {
    const u = await makeUser();
    expect((await getOfficeState(u.workspaceId)).layout.mode).toBe("standard");
    for (let i = 1; i <= 5; i++) await createAgent(u.workspaceId, u.userId, specialist(i));
    let office = await getOfficeState(u.workspaceId);
    expect(office.profiles).toHaveLength(13);
    expect(office.layout.mode).toBe("large");
    const ops = office.layout.departments.find((d) => d.key === "operations")!;
    expect(ops.workstations.filter((w) => w.agentSlug)).toHaveLength(6);
    expect(new Set(ops.workstations.map((w) => w.id)).size).toBe(ops.workstations.length);
    const rev = office.layout.revision;

    for (let i = 6; i <= 20; i++) await createAgent(u.workspaceId, u.userId, specialist(i, i % 2 ? "analytics" : "marketing"));
    office = await getOfficeState(u.workspaceId);
    expect(office.profiles).toHaveLength(28);
    expect(office.layout.mode).toBe("multi_floor");
    expect(office.layout.floors).toBe(2);
    expect(office.layout.revision).not.toBe(rev);
    expect(new Set(office.layout.departments.map((d) => d.floor))).toEqual(new Set([0, 1]));
    expect(office.layout.meetingRooms.length).toBeGreaterThanOrEqual(2);
    expect(office.layout.lounges).toHaveLength(2);
    // Every visible agent has exactly one desk.
    const desks = office.layout.departments.flatMap((d) => d.workstations).filter((w) => w.agentSlug);
    expect(desks).toHaveLength(28);
  });

  it("Test 3: editing name, role and skills creates a new version used by future tasks; history stays intact", async () => {
    const u = await makeUser();
    await createAgent(u.workspaceId, u.userId, mushtari());
    const r1 = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Search the knowledge base for supplier lists", targetAgent: "mushtari" });
    await runTask(r1.taskId!);
    const v1 = (await getAgentRuntime(u.workspaceId, "mushtari"))!;

    const updated = await updateAgent(u.workspaceId, u.userId, "mushtari", {
      nameAr: "مشتري الأول", roleTitle: "Senior Procurement Analyst", skills: [{ key: "web_research", mandatory: true }, { key: "tender_analysis", mandatory: false }],
    }, "Promotion");
    expect(updated.version).toBe(v1.version + 1);
    expect(updated.slug).toBe("mushtari");
    const v2 = (await getAgentRuntime(u.workspaceId, "mushtari"))!;
    expect(v2.versionId).not.toBe(v1.versionId);
    expect(v2.systemPrompt).toContain("مشتري الأول");
    expect(v2.systemPrompt).toContain("Tender & RFP analysis");

    const r2 = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Search the knowledge base for tenders", targetAgent: "mushtari" });
    await runTask(r2.taskId!);
    const sessions = await query<{ agent_version: number }>("SELECT agent_version FROM agent_runtime_sessions WHERE workspace_id=$1 AND agent_slug='mushtari' ORDER BY started_at", [u.workspaceId]);
    expect(sessions.map((s) => s.agent_version)).toEqual([v1.version, v2.version]);
    // Old task history still resolves to the same agent.
    expect((await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM task_steps WHERE task_id=$1 AND agent_slug='mushtari'", [r1.taskId]))!.n).toBe(1);
  });

  it("Test 4: a deactivated agent gets no new work, finishes already-assigned work, and leaves the active office", async () => {
    const u = await makeUser();
    await createAgent(u.workspaceId, u.userId, mushtari());
    const pending = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Search the knowledge base for bids", targetAgent: "mushtari" });
    const { affectedTasks } = await setLifecycle(u.workspaceId, u.userId, "mushtari", "deactivate");
    expect(affectedTasks.map((t) => t.id)).toContain(pending.taskId);
    expect((await assignableAgents(u.workspaceId)).map((a) => a.slug)).not.toContain("mushtari");
    await expect(handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "new work", targetAgent: "mushtari" })).rejects.toThrow(/not available/);
    expect(await runTask(pending.taskId!)).toBe("completed"); // safely finishes
    expect((await getOfficeState(u.workspaceId)).profiles.map((p) => p.slug)).not.toContain("mushtari");
    await setLifecycle(u.workspaceId, u.userId, "mushtari", "activate");
    expect((await getOfficeState(u.workspaceId)).profiles.map((p) => p.slug)).toContain("mushtari");
  });

  it("Test 5: archiving removes it from the office, keeps history, and restore brings the configuration back", async () => {
    const u = await makeUser();
    await createAgent(u.workspaceId, u.userId, mushtari());
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Search the knowledge base for RFQs", targetAgent: "mushtari" });
    await runTask(r.taskId!);
    const before = (await getAgentRecord(u.workspaceId, "mushtari"))!;

    const active = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Search again", targetAgent: "mushtari" });
    await expect(setLifecycle(u.workspaceId, u.userId, "mushtari", "archive")).rejects.toThrow(/active tasks/);
    await setLifecycle(u.workspaceId, u.userId, "mushtari", "archive", { force: true });
    expect((await queryOne<{ status: string }>("SELECT status FROM tasks WHERE id=$1", [active.taskId]))!.status).toBe("cancelled");

    const office = await getOfficeState(u.workspaceId);
    expect(office.profiles.map((p) => p.slug)).not.toContain("mushtari");
    expect(office.layout.departments.flatMap((d) => d.workstations).some((w) => w.agentSlug === "mushtari")).toBe(false);
    expect(office.directory.find((d) => d.slug === "mushtari")?.lifecycle).toBe("archived"); // history names still resolve
    expect((await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM agent_messages WHERE task_id=$1", [r.taskId]))!.n).toBeGreaterThan(0);

    await setLifecycle(u.workspaceId, u.userId, "mushtari", "restore");
    const restored = (await getAgentRecord(u.workspaceId, "mushtari"))!;
    expect(restored.lifecycle).toBe("inactive");
    expect(restored.version).toBe(before.version);
    expect(restored.skills).toEqual(before.skills);
    await setLifecycle(u.workspaceId, u.userId, "mushtari", "activate");
    expect((await getOfficeState(u.workspaceId)).profiles.map((p) => p.slug)).toContain("mushtari");
  });

  it("Test 7: natural-language creation proposes a config without saving; after confirmation it becomes available for real tasks", async () => {
    const u = await makeUser();
    const count = (await listAgentRecords(u.workspaceId)).length;
    const proposal = await draftAgent(u.workspaceId, u.userId,
      "Create a new Arabic-speaking procurement research agent called مشتري. It should research government procurement opportunities, analyze tender requirements, and report findings to راشد. Give it web research and document analysis Skills.");
    expect((await listAgentRecords(u.workspaceId)).length).toBe(count); // nothing saved yet
    expect(proposal.config.nameAr).toBe("مشتري");
    expect(proposal.config.skills.map((s) => s.key)).toEqual(expect.arrayContaining(["web_research", "document_analysis"]));
    expect(proposal.config.relationships.supervisor).toBe("orchestrator");
    expect(proposal.validation.errors).toHaveLength(0);
    expect(proposal.missingCapabilities[0].suggestedSkill.key).toBe("procurement_monitoring");

    // Offer accepted: create the missing skill, then confirm the agent.
    const skill = await saveSkill(u.workspaceId, u.userId, { ...proposal.missingCapabilities[0].suggestedSkill, nameAr: "رصد المشتريات", category: "research", instructions: "Track procurement portals and summarise new tenders.", dependsOn: [] });
    const agent = await createAgent(u.workspaceId, u.userId, { ...proposal.config, skills: [...proposal.config.skills, { key: skill.key, mandatory: false }] });
    expect((await getAgentRuntime(u.workspaceId, agent.slug))!.skills.map((s) => s.key)).toContain("procurement_monitoring");
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "ar", text: "Search the knowledge base for open tenders", targetAgent: agent.slug });
    expect(await runTask(r.taskId!)).toBe("completed");
  });
});

describe("Agent Management — governance", () => {
  it("rejects invalid and circular relationships", async () => {
    const u = await makeUser();
    const a = await createAgent(u.workspaceId, u.userId, specialist(1));
    const b = await createAgent(u.workspaceId, u.userId, { ...specialist(2), relationships: { ...specialist(2).relationships, supervisor: a.slug, delegatesTo: [a.slug] } });
    await expect(updateAgent(u.workspaceId, u.userId, a.slug, { relationships: { ...a.relationships, supervisor: b.slug } })).rejects.toThrow(/Circular reporting line/);
    await expect(updateAgent(u.workspaceId, u.userId, a.slug, { relationships: { ...a.relationships, delegatesTo: [b.slug] } })).rejects.toThrow(/Circular delegation/);
    const v = await validateAgentConfig(u.workspaceId, { ...specialist(3), relationships: { ...specialist(3).relationships, supervisor: "ghost" } });
    expect(v.validation.errors.some((e) => e.field === "relationships.supervisor")).toBe(true);
    const bad = await validateAgentConfig(u.workspaceId, { ...specialist(4), office: { ...specialist(4).office, departmentKey: "nope" } });
    expect(bad.validation.errors.some((e) => e.field === "office.departmentKey")).toBe(true);
  });

  it("skills cannot grant tools; the risk ceiling and restricted categories are enforced on every call", async () => {
    const u = await makeUser();
    const cfg = { ...specialist(1), tools: ["knowledge_search", "http_post_webhook", "web_search"], skills: [{ key: "competitor_analysis", mandatory: false }],
      permissions: { maxRiskLevel: 2 as const, alwaysApproveModify: true, restrictedCategories: ["web"], memoryAccess: "own" as const } };
    const { validation } = await validateAgentConfig(u.workspaceId, cfg);
    expect(validation.warnings.some((w) => /http_post_webhook.*blocked/.test(w.message))).toBe(true);
    expect(validation.missingTools).toContain("web_search"); // the skill needs it but the category is restricted
    const agent = await createAgent(u.workspaceId, u.userId, cfg);
    const rt = (await getAgentRuntime(u.workspaceId, agent.slug))!;
    expect(rt.allowedTools).toEqual(["knowledge_search"]);
    const ctx = { workspaceId: u.workspaceId, userId: u.userId, taskId: null, stepId: null, agentSlug: agent.slug, conversationId: null };
    // Even if a caller passes a broader allow-list, the agent policy blocks the call.
    const blocked = await executeTool("http_post_webhook", { url: "https://example.com/h", payload: {} }, ctx, ["http_post_webhook"], { maxRiskLevel: 2 });
    expect(blocked).toMatchObject({ status: "blocked" });
    const restricted = await executeTool("web_search", { query: "x" }, ctx, ["web_search"], { restrictedCategories: ["web"] });
    expect(restricted).toMatchObject({ status: "blocked" });
  });

  it("agents cannot read another agent's private memory unless granted shared access", async () => {
    const u = await makeUser();
    await addMemory({ workspaceId: u.workspaceId, scope: "agent", agentSlug: "research", content: "Private research note about vendor Alpha", source: "agent" });
    const own = await searchMemory(u.workspaceId, null, "vendor Alpha", { agentSlug: "research" });
    const other = await searchMemory(u.workspaceId, null, "vendor Alpha", { agentSlug: "writing" });
    const shared = await searchMemory(u.workspaceId, null, "vendor Alpha", { agentSlug: "orchestrator", includeOtherAgents: true });
    expect(own).toHaveLength(1);
    expect(other).toHaveLength(0);
    expect(shared).toHaveLength(1);
  });

  it("protects the orchestrator, active work and non-empty departments; deletion keeps history and never reuses the ID", async () => {
    const u = await makeUser();
    await expect(setLifecycle(u.workspaceId, u.userId, "orchestrator", "archive")).rejects.toThrow(/orchestrator/);
    await expect(deleteAgent(u.workspaceId, u.userId, "orchestrator", "orchestrator")).rejects.toThrow(/orchestrator/);
    await expect(deleteDepartment(u.workspaceId, u.userId, "research")).rejects.toThrow(/empty/);
    const dept = await createDepartment(u.workspaceId, u.userId, { name: "Procurement", nameAr: "المشتريات", color: "#0f766e" });
    const a = await createAgent(u.workspaceId, u.userId, { ...mushtari(), office: { ...mushtari().office, departmentKey: dept.key } });
    const busy = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "x work", targetAgent: a.slug });
    await expect(deleteAgent(u.workspaceId, u.userId, a.slug, a.slug)).rejects.toThrow(/active tasks/);
    await runTask(busy.taskId!);
    await expect(deleteAgent(u.workspaceId, u.userId, a.slug, "wrong")).rejects.toThrow(/Confirmation/);
    await deleteAgent(u.workspaceId, u.userId, a.slug, a.slug);
    expect(await getAgent(u.workspaceId, a.slug)).toBeNull();
    expect((await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM task_steps WHERE task_id=$1", [busy.taskId]))!.n).toBe(1);
    const again = await createAgent(u.workspaceId, u.userId, mushtari());
    expect(again.slug).not.toBe(a.slug);
    const audit = await query<{ action: string }>("SELECT action FROM audit_logs WHERE workspace_id=$1", [u.workspaceId]);
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["agent.created", "agent.deleted", "department.created"]));
  });

  it("duplicates as a draft that is not assignable until activated", async () => {
    const u = await makeUser();
    const copy = await duplicateAgent(u.workspaceId, u.userId, "research");
    expect(copy.lifecycle).toBe("draft");
    expect(copy.nameAr).toContain("نسخة");
    expect((await assignableAgents(u.workspaceId)).map((a) => a.slug)).not.toContain(copy.slug);
    expect((await getOfficeState(u.workspaceId)).profiles.map((p) => p.slug)).not.toContain(copy.slug);
  });
});

import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { signup, waitForTask } from "./helpers";

/**
 * Cross-tenant isolation release gate.
 *
 * Tenant A creates one of every workspace-scoped resource. Tenant B (a separate account with its
 * own workspace) then tries to read, modify and delete each one by its id/slug/key, to forge its
 * way into A's workspace with the x-nexus-workspace header, and to discover A's data through
 * list/search endpoints. Every attempt must fail and A's data must be unchanged afterwards.
 */

const MARKER = `tenant-a-secret-${Date.now()}`;

type Res = Record<string, string>;

async function seedTenantA(a: APIRequestContext): Promise<Res> {
  const ids: Res = {};
  const chat = await (await a.post("/api/chat", { data: { message: `Research and write a report on ${MARKER}` } })).json();
  ids.task = chat.taskId;
  ids.conversation = chat.conversationId;
  const detail = await waitForTask(a, chat.taskId, ["completed", "failed"]);
  ids.artifact = detail.artifacts[0].id;

  const webhook = await (await a.post("/api/chat", { data: { message: "Send a webhook to https://hooks.example.org/tenant-a" } })).json();
  const wd = await waitForTask(a, webhook.taskId, ["waiting_approval"]);
  ids.approval = wd.approvals[0].id;
  ids.approvalHash = wd.approvals[0].paramsHash;

  const mem = await a.post("/api/memory", { data: { content: `Workspace fact ${MARKER}`, scope: "workspace" } });
  expect(mem.status(), await mem.text()).toBe(200);
  ids.memory = (await mem.json()).memory.id;

  const kb = await a.post("/api/knowledge/bases", { data: { name: "Tenant A base" } });
  expect(kb.status()).toBe(201);
  ids.base = (await kb.json()).base.id;

  const up = await a.post("/api/files", { multipart: { file: { name: "a-notes.txt", mimeType: "text/plain", buffer: Buffer.from(`Confidential notes ${MARKER}\n`.repeat(20)) } } });
  expect([200, 201]).toContain(up.status());
  ids.file = (await up.json()).file.id;

  const dept = await a.post("/api/departments", { data: { name: "Tenant A Ops", nameAr: "عمليات", color: "#123456" } });
  expect(dept.status(), await dept.text()).toBe(201);
  ids.department = (await dept.json()).department.key;

  const skill = await a.post("/api/skills", { data: { key: "tenant_a_skill", name: "Tenant A skill", nameAr: "مهارة", description: "", category: "general", instructions: "Do tenant A things", requiredTools: [], dependsOn: [] } });
  expect(skill.status(), await skill.text()).toBe(201);
  ids.skill = "tenant_a_skill";

  const meeting = await a.post("/api/office/meetings", { data: { objective: "Plan the tenant A quarter", participants: ["research", "analytics"] } });
  expect(meeting.status(), await meeting.text()).toBeLessThan(300);
  const mt = await meeting.json();
  await waitForTask(a, mt.taskId, ["completed", "failed"], 60_000);
  ids.meeting = (await (await a.get("/api/office/meetings")).json()).meetings[0]?.id;

  const me = await (await a.get("/api/auth/me")).json();
  ids.workspace = me.currentWorkspace.workspaceId;
  return ids;
}

test.describe("Tenant isolation (release gate)", () => {
  test.describe.configure({ timeout: 240_000 });

  test("tenant B cannot read, change, delete or discover tenant A's resources", async ({ baseURL }) => {
    const a = await pwRequest.newContext({ baseURL });
    const b = await pwRequest.newContext({ baseURL });
    await signup(a, "Tenant A");
    await signup(b, "Tenant B");
    const id = await seedTenantA(a);
    expect(id.meeting, "meeting id").toBeTruthy();

    const deny = (s: number) => expect([403, 404]).toContain(s);

    // ── Direct object access by id ──
    deny((await b.get(`/api/tasks/${id.task}`)).status());
    deny((await b.post(`/api/tasks/${id.task}/control`, { data: { action: "cancel" } })).status());
    deny((await b.get(`/api/conversations/${id.conversation}`)).status());
    deny((await b.patch(`/api/conversations/${id.conversation}`, { data: { title: "pwned" } })).status());
    deny((await b.delete(`/api/conversations/${id.conversation}`)).status());
    deny((await b.get(`/api/artifacts/${id.artifact}`)).status());
    deny((await b.post(`/api/approvals/${id.approval}`, { data: { decision: "approve", paramsHash: id.approvalHash } })).status());
    deny((await b.patch(`/api/memory/${id.memory}`, { data: { content: "pwned memory" } })).status());
    deny((await b.delete(`/api/memory/${id.memory}`)).status());
    deny((await b.patch(`/api/knowledge/bases/${id.base}`, { data: { name: "pwned" } })).status());
    deny((await b.delete(`/api/knowledge/bases/${id.base}`)).status());
    deny((await b.get(`/api/files/${id.file}`)).status());
    deny((await b.patch(`/api/files/${id.file}`, { data: { knowledgeBaseId: null } })).status());
    deny((await b.post(`/api/files/${id.file}/reprocess`)).status());
    deny((await b.delete(`/api/files/${id.file}`)).status());
    deny((await b.get(`/api/office/meetings/${id.meeting}`)).status());
    // Slug/key resources are workspace-local names: B's call must resolve inside B's workspace only.
    deny((await b.patch(`/api/departments/${id.department}`, { data: { name: "pwned dept" } })).status());
    deny((await b.delete(`/api/departments/${id.department}`)).status());
    deny((await b.patch(`/api/skills/${id.skill}`, { data: { instructions: "pwned instructions" } })).status());
    deny((await b.delete(`/api/skills/${id.skill}`)).status());

    // ── Forged workspace selection ──
    const forged = { headers: { "x-nexus-workspace": id.workspace } };
    for (const path of ["/api/tasks", "/api/conversations", "/api/approvals", "/api/memory", "/api/files", "/api/knowledge/bases",
      "/api/agents", "/api/departments", "/api/skills", "/api/audit", "/api/analytics?days=7", "/api/office/state", "/api/settings", "/api/integrations", "/api/workspaces/members"]) {
      expect((await b.get(path, forged)).status(), path).toBe(403);
    }
    expect((await b.post("/api/chat", { ...forged, data: { message: "hello" } })).status()).toBe(403);
    expect((await b.post("/api/settings/emergency-stop", { ...forged, data: { active: true } })).status()).toBe(403);
    expect((await b.post("/api/workspaces/members", { ...forged, data: { email: "x@example.com", role: "admin" } })).status()).toBe(403);
    // The workspace cookie cannot be used to switch into a foreign workspace either.
    const ws = await b.put("/api/workspaces", { data: { workspaceId: id.workspace } });
    deny(ws.status());

    // ── Discovery through list/search endpoints ──
    const leaks: string[] = [];
    for (const path of ["/api/tasks", "/api/conversations", "/api/approvals", "/api/memory", "/api/files", "/api/knowledge/bases",
      "/api/audit", "/api/office/state", "/api/skills", "/api/departments", "/api/artifacts"]) {
      const r = await b.get(path);
      const text = await r.text();
      if (text.includes(MARKER) || text.includes(id.task) || text.includes(id.file) || text.includes(id.workspace) || text.includes("tenant_a_skill") || text.includes(id.department)) leaks.push(path);
    }
    const search = await b.post("/api/knowledge/search", { data: { query: MARKER } });
    if ((await search.text()).includes(MARKER)) leaks.push("POST /api/knowledge/search");
    for (const path of ["/api/office/meetings"]) if ((await (await b.get(path)).text()).includes(id.meeting)) leaks.push(path);
    expect(leaks, "list endpoints leaking tenant A data").toEqual([]);

    // ── Tenant A's data is intact ──
    expect((await a.get(`/api/tasks/${id.task}`)).status()).toBe(200);
    const conv = await (await a.get(`/api/conversations/${id.conversation}`)).json();
    expect(conv.conversation.title).not.toBe("pwned");
    expect((await a.get(`/api/files/${id.file}`)).status()).toBe(200);
    const mems = await (await a.get("/api/memory")).text();
    expect(mems).toContain(MARKER);
    expect(mems).not.toContain("pwned memory");
    const skills = await (await a.get("/api/skills")).text();
    expect(skills).toContain("tenant_a_skill");
    expect(skills).not.toContain("pwned instructions");
    const depts = await (await a.get("/api/departments")).text();
    expect(depts).toContain(id.department);
    expect(depts).not.toContain("pwned dept");
    const appr = await (await a.get("/api/approvals?status=pending")).text();
    expect(appr).toContain(id.approval);

    await a.dispose();
    await b.dispose();
  });
});

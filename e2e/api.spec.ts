import { test, expect, request as pwRequest } from "@playwright/test";
import { PASSWORD, signup, waitForTask } from "./helpers";

test.describe("API end-to-end (production build, real Postgres, mock LLM)", () => {
  test("health reports database, pgvector and migrations without leaking config", async ({ request }) => {
    const r = await request.get("/api/health");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.checks.database).toBe("ok");
    expect(body.checks.pgvector).toBe(true);
    expect(body.checks.migrationsApplied).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/postgres:\/\/|sk-/);
  });

  test("protected APIs require authentication; pages redirect to login", async ({ request }) => {
    expect((await request.get("/api/tasks")).status()).toBe(401);
    expect((await request.post("/api/chat", { data: { message: "hi" } })).status()).toBe(401);
    const page = await request.get("/tasks", { maxRedirects: 0 });
    expect(page.status()).toBe(307);
    expect(page.headers()["location"]).toContain("/login");
  });

  test("security headers are set", async ({ request }) => {
    const r = await request.get("/login");
    const h = r.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("signup, logout, login and wrong-password handling", async ({ request }) => {
    const u = await signup(request);
    const me = await (await request.get("/api/auth/me")).json();
    expect(me.user.email).toBe(u.email);
    expect(me.currentWorkspace.role).toBe("owner");
    await request.post("/api/auth/logout");
    expect((await request.get("/api/auth/me")).status()).toBe(401);
    expect((await request.post("/api/auth/login", { data: { email: u.email, password: "wrong-password-1" } })).status()).toBe(401);
    expect((await request.post("/api/auth/login", { data: { email: u.email, password: PASSWORD } })).status()).toBe(200);
    expect((await request.post("/api/auth/signup", { data: { name: "x", email: u.email, password: PASSWORD } })).status()).toBe(409);
    expect((await request.post("/api/auth/signup", { data: { name: "x", email: "weak@example.com", password: "short" } })).status()).toBe(400);
  });

  test("cross-origin mutations are rejected (CSRF)", async ({ request }) => {
    await signup(request);
    const r = await request.post("/api/chat", { data: { message: "hello" }, headers: { origin: "https://evil.example.com" } });
    expect(r.status()).toBe(403);
  });

  test("conversation persists; direct answers need no task", async ({ request }) => {
    await signup(request);
    const r = await request.post("/api/chat", { data: { message: "hello" } });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.mode).toBe("direct");
    expect(body.taskId).toBeNull();
    const conv = await (await request.get(`/api/conversations/${body.conversationId}`)).json();
    expect(conv.messages).toHaveLength(2);
    const list = await (await request.get("/api/conversations")).json();
    expect(list.conversations[0].id).toBe(body.conversationId);
  });

  test("multi-agent task runs in the background to completion with a deliverable", async ({ request }) => {
    await signup(request);
    const r = await request.post("/api/chat", { data: { message: "Research the GCC events market and write a report" } });
    const { taskId, conversationId, mode } = await r.json();
    expect(mode).toBe("multi");
    const detail = await waitForTask(request, taskId, ["completed", "failed"]);
    expect(detail.task.status).toBe("completed");
    expect(detail.steps.map((s: { agent: string }) => s.agent).sort()).toEqual(["marketing", "research", "writing"]);
    expect(detail.steps.find((s: { agent: string }) => s.agent === "writing").dependsOn.sort()).toEqual(["analysis", "research"]);
    expect(detail.artifacts).toHaveLength(1);
    expect(detail.usage.calls).toBeGreaterThan(0);
    const dl = await request.get(`/api/artifacts/${detail.artifacts[0].id}`);
    expect(dl.status()).toBe(200);
    expect(dl.headers()["content-type"]).toContain("wordprocessingml");
    const conv = await (await request.get(`/api/conversations/${conversationId}`)).json();
    expect(conv.messages.at(-1).metadata.kind).toBe("task_result");
  });

  test("Level 4 action blocks until approved; approval is bound to the exact parameters", async ({ request }) => {
    await signup(request);
    const r = await request.post("/api/chat", { data: { message: "Send a webhook to https://hooks.example.org/nexus-e2e" } });
    const { taskId } = await r.json();
    const waiting = await waitForTask(request, taskId, ["waiting_approval", "failed", "completed"]);
    expect(waiting.task.status).toBe("waiting_approval");
    const approval = waiting.approvals[0];
    expect(approval.riskLevel).toBe(4);
    expect(approval.status).toBe("pending");
    expect(approval.destination).toBe("https://hooks.example.org/nexus-e2e");
    const tampered = await request.post(`/api/approvals/${approval.id}`, { data: { decision: "approve", paramsHash: "0".repeat(64) } });
    expect(tampered.status()).toBe(409);
    const rej = await request.post(`/api/approvals/${approval.id}`, { data: { decision: "reject", paramsHash: approval.paramsHash, note: "not now" } });
    expect(rej.status()).toBe(200);
    const done = await waitForTask(request, taskId, ["completed", "failed"]);
    expect(done.task.status).toBe("completed");
    expect(done.toolExecutions.filter((e: { status: string; toolName: string }) => e.status === "succeeded" && e.toolName === "http_post_webhook")).toHaveLength(0);
    const again = await request.post(`/api/approvals/${approval.id}`, { data: { decision: "approve", paramsHash: approval.paramsHash } });
    expect(again.status()).toBe(409);
  });

  test("workspace isolation: another user cannot read tasks, conversations, approvals or deliverables", async ({ baseURL }) => {
    const a = await pwRequest.newContext({ baseURL });
    const b = await pwRequest.newContext({ baseURL });
    await signup(a, "Alice");
    await signup(b, "Bob");
    const { taskId, conversationId } = await (await a.post("/api/chat", { data: { message: "Research and write a report on logistics" } })).json();
    const detail = await waitForTask(a, taskId, ["completed", "failed"]);
    expect((await b.get(`/api/tasks/${taskId}`)).status()).toBe(404);
    expect((await b.get(`/api/conversations/${conversationId}`)).status()).toBe(404);
    expect((await b.get(`/api/artifacts/${detail.artifacts[0].id}`)).status()).toBe(404);
    expect((await (await b.get("/api/tasks")).json()).tasks).toHaveLength(0);
    // Forcing another workspace id via header is refused
    const meA = await (await a.get("/api/auth/me")).json();
    expect((await b.get("/api/tasks", { headers: { "x-nexus-workspace": meA.currentWorkspace.workspaceId } })).status()).toBe(403);
    await a.dispose();
    await b.dispose();
  });

  test("roles: viewers cannot chat or change settings; emergency stop pauses work", async ({ baseURL }) => {
    const owner = await pwRequest.newContext({ baseURL });
    const viewer = await pwRequest.newContext({ baseURL });
    await signup(owner, "Owner");
    const v = await signup(viewer, "Viewer");
    const me = await (await owner.get("/api/auth/me")).json();
    const wsId = me.currentWorkspace.workspaceId;
    expect((await owner.post("/api/workspaces/members", { data: { email: v.email, role: "viewer" } })).status()).toBe(200);
    const hdr = { "x-nexus-workspace": wsId };
    expect((await viewer.get("/api/tasks", { headers: hdr })).status()).toBe(200);
    expect((await viewer.post("/api/chat", { headers: hdr, data: { message: "hello" } })).status()).toBe(403);
    expect((await viewer.patch("/api/settings", { headers: hdr, data: { autoApproveLevel3: true } })).status()).toBe(403);
    expect((await viewer.get("/api/audit", { headers: hdr })).status()).toBe(403);

    expect((await owner.post("/api/settings/emergency-stop", { data: { active: true } })).status()).toBe(200);
    const blocked = await owner.post("/api/chat", { data: { message: "Analyse KPI data" } });
    expect(blocked.status()).toBe(423);
    expect((await owner.post("/api/settings/emergency-stop", { data: { active: false } })).status()).toBe(200);
    const audit = await (await owner.get("/api/audit?action=emergency_stop")).json();
    expect(audit.logs.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(["emergency_stop.engaged", "emergency_stop.released"]));
    await owner.dispose();
    await viewer.dispose();
  });

  test("cron endpoint requires the secret", async ({ request }) => {
    expect((await request.get("/api/cron/tick")).status()).toBe(401);
    const ok = await request.get("/api/cron/tick", { headers: { authorization: "Bearer e2e-cron-secret" } });
    expect(ok.status()).toBe(200);
  });

  test("analytics and admin health report usage and configuration presence only", async ({ request }) => {
    await signup(request);
    await request.post("/api/chat", { data: { message: "hello" } });
    const a = await (await request.get("/api/analytics?days=7")).json();
    expect(a.totals.calls).toBeGreaterThan(0);
    const h = await (await request.get("/api/admin/health")).json();
    expect(h.database.ok).toBe(true);
    expect(typeof h.configuration.OPENAI_API_KEY).toBe("boolean");
    expect(JSON.stringify(h)).not.toContain("e2e-only-key");
  });
});

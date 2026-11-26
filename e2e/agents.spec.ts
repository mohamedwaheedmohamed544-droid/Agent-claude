import { test, expect, request as pwRequest, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PASSWORD, signup, waitForTask } from "./helpers";

type Snapshot = { ready: boolean; characters: Record<string, { zone: string; floor?: number; animation: string; walking: boolean }> };
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __NEXUS_OFFICE__?: Snapshot }).__NEXUS_OFFICE__ ?? null);
async function until(page: Page, pred: (s: Snapshot) => boolean, timeout = 60_000, label = "condition") {
  const end = Date.now() + timeout;
  let last: Snapshot | null = null;
  while (Date.now() < end) {
    last = await snap(page);
    if (last?.ready && pred(last)) return last;
    await page.waitForTimeout(200);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(Object.keys(last?.characters ?? {}))}`);
}

const specialist = (i: number, dept: string) => ({
  nameAr: `موظف ${i}`, nameEn: `Staff ${i}`, roleTitle: "Specialist", roleTitleAr: "مختص", description: "", descriptionAr: "", personality: "", color: "#0ea5e9", capabilities: [],
  responsibilities: { main: "Support the team", instructions: "", expertise: [], deliverables: [], methodology: "", successCriteria: [] },
  ai: { provider: "anthropic", model: null, tier: "fast", temperature: null, systemInstructions: "", memory: { useWorkspaceMemory: true, useAgentMemory: true, useKnowledgeBase: true, maxContextTokens: 90000 } },
  tools: ["knowledge_search", "create_document"],
  permissions: { maxRiskLevel: 2, alwaysApproveModify: true, restrictedCategories: [], memoryAccess: "own" },
  relationships: { supervisor: "orchestrator", delegatesTo: [], collaboratesWith: [], canJoinMeetings: true, canInitiateCollaboration: true },
  office: { departmentKey: dept, workstationId: null, avatarPreset: "neutral_cardigan", appearance: { gender: "neutral", skin: "#c39278", outfit: "cardigan", outfitColor: "#6b5b4b", headwear: "none", headwearColor: "#000000", hairColor: "#2b201a", accessory: "glasses", height: 1.7 }, defaultAnimation: "idle", preferredMeetingRoom: null, visible: true },
  skills: [],
});

test.describe.configure({ mode: "serial" });

test.describe("Agent Management → live office (admin flow)", () => {
  let page: Page;
  let office: Page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("nexus-office-quality", "low"); } catch { /* ignore */ } });
    page = await ctx.newPage();
    const r = await page.request.post("/api/auth/signup", { data: { name: "Workforce Admin", email: `wf-${randomUUID().slice(0, 8)}@example.com`, password: PASSWORD } });
    expect(r.status()).toBe(200);
    office = await ctx.newPage();
    await office.goto("/office");
    await until(office, (s) => Object.keys(s.characters).length === 8, 60_000, "starter office");
  });

  test("Test 1 (UI): create مشتري in the Agent Builder — it registers and walks into the open office without a reload", async () => {
    await page.goto("/agents");
    await expect(page.getByRole("heading", { name: "Agent Management" })).toBeVisible();
    await expect(page.getByText("راشد").first()).toBeVisible();
    await page.getByRole("button", { name: /Create New Agent/ }).first().click();
    await page.waitForURL(/\/agents\/new/);
    await page.getByPlaceholder("مثال: مشتري").fill("مشتري");
    await page.getByPlaceholder("e.g. Mushtari").fill("Mushtari");
    await page.getByLabel("Role title (English)").fill("Procurement Research Agent");
    await page.getByRole("button", { name: "Save & activate" }).click();
    await page.waitForURL(/\/agents\/mushtari/, { timeout: 30_000 });

    const detail = await (await page.request.get("/api/agents/mushtari")).json();
    expect(detail.agent.lifecycle).toBe("active");
    expect(detail.runtime.systemPromptPreview).toContain("مشتري");
    expect(detail.workstation).toBeTruthy();

    // The office page (opened before the agent existed) picks it up over SSE.
    await until(office, (s) => Boolean(s.characters.mushtari), 45_000, "مشتري in the office");

    // The orchestrator can delegate real work to it.
    const assign = await page.request.post("/api/office/assign", { data: { agent: "mushtari", message: "Search the knowledge base for procurement notices" } });
    const done = await waitForTask(page.request, (await assign.json()).taskId, ["completed", "failed"], 60_000);
    expect(done.task.status).toBe("completed");
    expect(done.steps[0].agent).toBe("mushtari");
  });

  test("Tests 2 + 6: adding agents allocates desks and expands the office to multiple floors — no code, no reload", async () => {
    for (let i = 1; i <= 5; i++) {
      const r = await page.request.post("/api/agents", { data: { config: specialist(i, "operations") } });
      expect(r.status(), await r.text()).toBe(201);
    }
    let state = await (await page.request.get("/api/office/state")).json();
    expect(state.profiles).toHaveLength(14);
    expect(state.layout.mode).toBe("large");
    await until(office, (s) => Object.keys(s.characters).length === 14, 60_000, "14 characters");

    for (let i = 6; i <= 19; i++) await page.request.post("/api/agents", { data: { config: specialist(i, i % 2 ? "analytics" : "marketing") } });
    state = await (await page.request.get("/api/office/state")).json();
    expect(state.profiles).toHaveLength(28);
    expect(state.layout.mode).toBe("multi_floor");
    expect(state.layout.floors).toBe(2);
    const s = await until(office, (x) => Object.keys(x.characters).length === 28, 90_000, "28 characters");
    expect(new Set(Object.values(s.characters).map((c) => c.floor ?? 0))).toEqual(new Set([0, 1]));
    await expect(office.getByRole("combobox", { name: "Floor" })).toBeVisible();
    await office.screenshot({ path: "test-results/office-28-agents.png" });
  });

  test("Tests 4 + 5: deactivating and archiving remove agents from the active office; restore brings them back", async () => {
    let r = await page.request.post("/api/agents/staff_1/lifecycle", { data: { action: "deactivate" } });
    expect(r.status()).toBe(200);
    await until(office, (s) => !s.characters.staff_1, 60_000, "staff_1 left");
    r = await page.request.post("/api/agents/staff_2/lifecycle", { data: { action: "archive" } });
    expect(r.status()).toBe(200);
    await until(office, (s) => !s.characters.staff_2, 60_000, "staff_2 left");
    const list = await (await page.request.get("/api/agents?lifecycle=archived")).json();
    expect(list.agents.map((a: { slug: string }) => a.slug)).toContain("staff_2");
    await page.request.post("/api/agents/staff_2/lifecycle", { data: { action: "restore" } });
    await page.request.post("/api/agents/staff_2/lifecycle", { data: { action: "activate" } });
    await until(office, (s) => Boolean(s.characters.staff_2), 60_000, "staff_2 back");
    // The orchestrator can never be archived.
    expect((await page.request.post("/api/agents/orchestrator/lifecycle", { data: { action: "archive" } })).status()).toBe(403);
  });

  test("Test 7 (UI): Ask راشد proposes a configuration; nothing is created until confirmed", async () => {
    const before = (await (await page.request.get("/api/agents")).json()).agents.length;
    await page.goto("/agents?ask=1");
    await page.getByRole("dialog").getByRole("textbox").fill("Create a new Arabic-speaking procurement research agent called مشتري. It should research government procurement opportunities, analyze tender requirements, and report findings to راشد. Give it web research and document analysis Skills.");
    await page.getByRole("button", { name: "Design agent" }).click();
    await expect(page.getByRole("button", { name: "Create agent" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("dialog").getByText("Procurement Research Agent").first()).toBeVisible();
    expect((await (await page.request.get("/api/agents")).json()).agents.length).toBe(before);
    await page.getByRole("button", { name: "Create agent" }).click();
    await expect.poll(async () => (await (await page.request.get("/api/agents")).json()).agents.length, { timeout: 20_000 }).toBe(before + 1);
    const created = (await (await page.request.get("/api/agents")).json()).agents.find((a: { roleTitle: string; slug: string }) => a.roleTitle === "Procurement Research Agent" && a.slug !== "mushtari");
    expect(created.skills.map((s: { key: string }) => s.key)).toEqual(expect.arrayContaining(["web_research", "document_analysis"]));
  });

  test("Governance: only admins can manage agents (enforced on the server)", async ({ baseURL }) => {
    const me = await (await page.request.get("/api/auth/me")).json();
    const viewer = await pwRequest.newContext({ baseURL });
    const v = await signup(viewer, "Viewer");
    expect((await page.request.post("/api/workspaces/members", { data: { email: v.email, role: "member" } })).status()).toBe(200);
    const hdr = { "x-nexus-workspace": me.currentWorkspace.workspaceId };
    expect((await viewer.get("/api/agents", { headers: hdr })).status()).toBe(200);
    expect((await viewer.post("/api/agents", { headers: hdr, data: { config: specialist(99, "research") } })).status()).toBe(403);
    expect((await viewer.patch("/api/agents/research", { headers: hdr, data: { config: { nameAr: "x" } } })).status()).toBe(403);
    expect((await viewer.post("/api/agents/research/lifecycle", { headers: hdr, data: { action: "deactivate" } })).status()).toBe(403);
    expect((await viewer.delete("/api/agents/research?confirm=research", { headers: hdr })).status()).toBe(403);
    expect((await viewer.post("/api/skills", { headers: hdr, data: { name: "X skill", nameAr: "س", description: "", category: "x", instructions: "do things", requiredTools: [], dependsOn: [] } })).status()).toBe(403);
    await viewer.dispose();
  });
});

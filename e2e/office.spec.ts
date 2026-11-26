import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PASSWORD, waitForTask } from "./helpers";

type Snapshot = { ready: boolean; characters: Record<string, { zone: string; position: [number, number]; animation: string; walking: boolean; bubble: string | null }> };

async function office(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as { __NEXUS_OFFICE__: Snapshot }).__NEXUS_OFFICE__);
}

/** Polls the live 3D scene until `pred` is true; returns the first matching snapshot. */
async function until(page: Page, pred: (s: Snapshot) => boolean, timeout = 60_000, label = "condition"): Promise<Snapshot> {
  const deadline = Date.now() + timeout;
  let last: Snapshot | null = null;
  while (Date.now() < deadline) {
    last = await office(page);
    if (last?.ready && pred(last)) return last;
    await page.waitForTimeout(150);
  }
  throw new Error(`Timed out waiting for ${label}. Last: ${JSON.stringify(last?.characters ?? null).slice(0, 1500)}`);
}

async function presence(page: Page, agent: string) {
  const s = await (await page.request.get("/api/office/state")).json();
  return s.presence.find((p: { agent: string }) => p.agent === agent);
}

test.describe.configure({ mode: "serial" });

test.describe("Nexus Office acceptance (real backend → live 3D scene)", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // Software rendering in CI is slow; the low tier keeps frame time reasonable (behaviour is identical).
    await page.addInitScript(() => { try { localStorage.setItem("nexus-office-quality", "low"); } catch { /* ignore */ } });
    const email = `office-${randomUUID().slice(0, 8)}@example.com`;
    const r = await page.request.post("/api/auth/signup", { data: { name: "Office Owner", email, password: PASSWORD } });
    expect(r.status()).toBe(200);
    await page.goto("/office");
    await until(page, (s) => Object.keys(s.characters).length === 8, 60_000, "8 characters");
  });

  test.afterAll(async () => { await page.close(); });

  test("renders all eight Arabic-named agents at their desks, idle, with the dashboard", async () => {
    const s = await office(page);
    expect(Object.keys(s.characters).sort()).toEqual(["analytics", "business_development", "documents", "marketing", "operations", "orchestrator", "research", "writing"]);
    expect(s.characters.research.zone).toBe("research");
    expect(s.characters.orchestrator.zone).toBe("executive");
    for (const name of ["راشد", "باحث", "رائد", "بيان", "قلم", "بصيرة", "تميم", "أثر"]) {
      await expect(page.getByRole("button", { name: new RegExp(name) }).first()).toBeVisible();
    }
    await expect(page.getByTestId("office-dashboard")).toContainText("8");
    await page.screenshot({ path: "test-results/office-idle.png" });
  });

  test("A + B + C: assigning a task to باحث → راشد delegates at the research desk, باحث works, and the real result message appears", async () => {
    const assign = await page.request.post("/api/office/assign", { data: { agent: "research", message: "Search the knowledge base for supplier risks" } });
    expect(assign.status()).toBe(200);
    const { taskId } = await assign.json();

    // B: راشد walks to the research department to delegate
    await until(page, (s) => s.characters.orchestrator.zone === "research", 30_000, "راشد in research");
    // A: باحث's real status becomes working and the character plays a work animation
    await until(page, (s) => ["working", "typing", "reading", "thinking"].includes(s.characters.research.animation), 30_000, "باحث working");
    const p = await presence(page, "research");
    expect(["working", "idle"]).toContain(p.status);

    await waitForTask(page.request, taskId, ["completed"], 60_000);
    // C: the actual result message from باحث to راشد is shown in the live activity feed and stored
    const msgs = (await (await page.request.get("/api/office/agents/research")).json()).messages as Array<{ from: string; to: string; kind: string; content: string }>;
    const result = msgs.find((m) => m.from === "research" && m.to === "orchestrator" && m.kind === "result");
    expect(result?.content).toContain("[mock] Step complete");
    await expect(page.getByText(/sent a message to راشد/).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /باحث/ }).first().click();
    await expect(page.getByRole("complementary").getByText(result!.content.slice(0, 40)).first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
  });

  test("D + E + F: a real meeting — participants walk to the meeting room, messages and decisions are saved, then everyone returns to their desks", async () => {
    const r = await page.request.post("/api/chat", { data: { message: "Research three competitors and prepare a comparison report" } });
    const { taskId } = await r.json();

    // D: باحث and بيان (and chair راشد) are in the meeting room
    const inMeeting = await until(page, (s) => ["research", "documents", "orchestrator"].every((a) => s.characters[a].zone === "meeting_room"), 90_000, "meeting room");
    expect(inMeeting.characters.writing.zone).not.toBe("meeting_room");
    await page.screenshot({ path: "test-results/office-meeting.png" });

    const done = await waitForTask(page.request, taskId, ["completed"], 120_000);
    const meetingStep = done.steps.find((s: { key: string }) => s.key === "review");
    expect(meetingStep.status).toBe("completed");

    // E: meeting messages, decisions and action items are persisted
    const meetings = (await (await page.request.get("/api/office/meetings")).json()).meetings;
    const m = (await (await page.request.get(`/api/office/meetings/${meetings[0].id}`)).json()).meeting;
    expect(m.status).toBe("completed");
    expect(m.messages.filter((x: { kind: string }) => x.kind === "statement")).toHaveLength(4);
    expect(m.decisions.length).toBeGreaterThan(0);
    expect(m.actionItems.length).toBeGreaterThan(0);

    // F: characters leave the meeting room and return to their desks; statuses are idle again
    await until(page, (s) => s.characters.research.zone === "research" && s.characters.documents.zone === "documents" && s.characters.orchestrator.zone === "executive", 60_000, "back at desks");
    for (const a of ["research", "documents", "orchestrator", "writing"]) expect((await presence(page, a)).status).toBe("idle");
  });

  test("G: after a reload, task and meeting history is still available", async () => {
    await page.reload();
    await until(page, (s) => Object.keys(s.characters).length === 8, 60_000, "scene after reload");
    await page.getByRole("tab", { name: /Agent list/ }).click();
    const meetingButton = page.locator("[data-meeting]").first();
    await expect(meetingButton).toBeVisible();
    await meetingButton.click();
    await expect(page.getByRole("complementary").getByText("Decisions")).toBeVisible();
    await expect(page.getByRole("complementary").getByText(/contribution, round 2/).first()).toBeVisible();
    const tasks = (await (await page.request.get("/api/tasks")).json()).tasks;
    expect(tasks.filter((t: { status: string }) => t.status === "completed").length).toBeGreaterThanOrEqual(2);
  });
});

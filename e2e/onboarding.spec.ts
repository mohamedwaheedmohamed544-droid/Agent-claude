import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PASSWORD } from "./helpers";

/**
 * Phase 1 exit criterion: a new customer registers, describes the business, reviews a recommended
 * workforce, edits and approves it, and receives a configured workspace with a live office.
 */

type Snapshot = { ready: boolean; characters: Record<string, unknown> };
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __NEXUS_OFFICE__?: Snapshot }).__NEXUS_OFFICE__ ?? null);

async function next(page: Page) {
  await page.getByRole("button", { name: /Save & continue|Save & review answers/ }).click();
}

test.describe.configure({ mode: "serial" });

test("register → onboarding → proposal → edit → approve → configured workforce", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => { try { localStorage.setItem("nexus-office-quality", "low"); } catch { /* ignore */ } });

  // Register: new accounts land on guided onboarding.
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Sara Founder");
  await page.getByLabel("Email").fill(`onb-${randomUUID().slice(0, 8)}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((u) => u.pathname === "/onboarding");
  await expect(page.getByRole("heading", { name: "Set up your digital workforce" })).toBeVisible();

  // A — identity
  await page.getByLabel("Company name").fill("Masar Advisory");
  await page.getByLabel("Operating cities").fill("Riyadh");
  await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: "Consulting & professional services" }).click();
  await page.getByRole("radio", { name: "10–24 employees" }).click();
  await page.getByRole("radio", { name: "B2G — government" }).click();
  await page.getByRole("radio", { name: "Arabic and English" }).click();
  await next(page);

  // B — business model
  await expect(page.getByRole("heading", { name: "Business model" })).toBeVisible();
  await page.getByLabel("Main products and services").fill("Strategy consulting");
  await page.keyboard.press("Enter");
  await page.getByLabel("Describe your target customers").fill("Government entities and large companies in Saudi Arabia");
  await page.getByRole("button", { name: "Tenders & RFPs" }).click();
  await page.getByRole("button", { name: "Grow revenue and win more clients" }).click();
  await page.getByRole("button", { name: "Better reporting and decisions" }).click();
  await page.getByRole("button", { name: "Proposals and tenders take too long" }).click();
  await page.getByRole("button", { name: "Reports take too long to prepare" }).click();
  await next(page);

  // C — teams (conditional: proposals shown for B2G, recruitment not shown for consulting)
  await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();
  await expect(page.locator('[data-function="proposals"]')).toBeVisible();
  await expect(page.locator('[data-function="recruitment"]')).toHaveCount(0);
  const status: Record<string, string> = {
    sales: "We have a team", marketing: "Not relevant", delivery: "We have a team", operations: "We have a team",
    finance: "Outsourced", hr: "Not relevant", research: "We need it but don't have it", proposals: "We have a team",
  };
  for (const [fn, label] of Object.entries(status)) await page.locator(`[data-function="${fn}"]`).getByRole("radio", { name: label }).click();
  await next(page);

  // D — work & processes
  await expect(page.getByRole("heading", { name: "Work & processes" })).toBeVisible();
  for (const name of ["Writing proposals", "Reviewing tenders & RFPs", "Weekly / monthly reports", "Meeting notes & action items"]) {
    await page.getByRole("group", { name: /Which tasks are repetitive/ }).getByRole("button", { name }).click();
  }
  await page.getByRole("group", { name: /What do you research regularly/ }).getByRole("button", { name: "Competitors" }).click();
  await page.getByRole("group", { name: /What do you research regularly/ }).getByRole("button", { name: "Tender opportunities" }).click();
  await page.getByRole("button", { name: "Internal KPI reports" }).click();
  await page.getByRole("button", { name: "Sending emails to people outside the company" }).click();
  await page.getByRole("button", { name: "Pricing and quotations" }).click();
  await page.getByRole("button", { name: "Final pricing decisions" }).click();
  await page.getByLabel(/Any other rule for the digital workforce/).fill("Never contact a government client directly");
  await next(page);

  // E — systems
  await expect(page.getByRole("heading", { name: "Systems" })).toBeVisible();
  await page.locator('[data-system="email"]').getByRole("button", { name: /Microsoft 365/ }).click();
  await page.locator('[data-system="calendar"]').getByRole("button", { name: /Outlook Calendar/ }).click();
  await page.locator('[data-system="project_management"]').getByRole("button", { name: "Asana" }).click();
  await next(page);

  // F — priorities
  await page.getByRole("button", { name: "Increase revenue" }).click();
  await page.getByRole("button", { name: "Better reporting & decision support" }).click();
  await next(page);

  // Summary → proposal
  await expect(page.getByText("Your company profile")).toBeVisible();
  await page.getByRole("button", { name: "Generate workforce proposal" }).click();
  await expect(page.getByRole("heading", { name: "Workforce proposal v1" })).toBeVisible({ timeout: 20_000 });

  // Every recommendation explains itself; unsupported systems are labelled honestly.
  const proposal = page.locator('[data-agent="proposal_specialist"]');
  await expect(proposal).toContainText("Proposal & Tender Specialist");
  await expect(proposal).toContainText("Repetitive task: Writing proposals");
  await expect(page.locator('[data-department="research"]')).toContainText("New capability");
  await expect(page.locator('[data-integration="microsoft"]')).toContainText("Connector available");
  await expect(page.locator('[data-integration="asana"]')).toContainText("No connector yet");
  await expect(page.locator('[data-approval="external_send"]').getByRole("switch")).toBeDisabled();
  await expect(page.locator('[data-approval="customer_rule"]')).toContainText("Never contact a government client directly");
  await expect(page.getByText(/Your answers point to a Marketing Strategist/)).toBeVisible(); // open question, not an agent
  await expect(page.locator('[data-agent="marketing_strategist"]')).toHaveCount(0);
  await page.screenshot({ path: "docs/screenshots/onboarding-proposal.png", fullPage: true });

  // Customer edits: remove an agent, add one, edit responsibilities.
  await page.locator('[data-agent="bd_specialist"]').getByRole("button", { name: /Remove/ }).click();
  await expect(page.locator('[data-agent="bd_specialist"]')).toHaveCount(0);
  await page.getByLabel("Role", { exact: true }).selectOption({ label: "Delivery Project Manager" });
  await page.getByLabel("Department", { exact: true }).selectOption({ label: "Client delivery & projects" });
  await page.getByRole("button", { name: "Add an agent" }).click();
  const pm = page.locator('[data-agent="project_manager"]');
  await expect(pm).toContainText("Your edit");
  await page.locator('[data-agent="executive_assistant"]').getByRole("button", { name: "Edit responsibilities" }).click();
  await page.locator('[data-agent="executive_assistant"]').getByLabel("Edit responsibilities").fill("Prepare the weekly management briefing\nTrack board actions");
  await page.locator('[data-agent="executive_assistant"]').getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-agent="executive_assistant"]')).toContainText("Prepare the weekly management briefing");
  await expect(page.getByText("3 edits")).toBeVisible();

  // Approve: the dialog shows exactly what will change.
  await page.getByRole("button", { name: "Approve & create workforce" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Create this workforce?");
  await expect(dialog.locator('[data-impact="onb.bp.willCreate"]')).toContainText("لينا");
  await expect(dialog.locator('[data-impact="onb.bp.willCreate"]')).toContainText("خالد");
  await expect(dialog.locator('[data-impact="onb.bp.willDeactivate"]')).toContainText("قلم");
  await dialog.getByRole("button", { name: "Approve & create workforce" }).click();

  await expect(page.getByRole("heading", { name: "Your digital workforce is ready" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Microsoft 365" })).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/onboarding-done.png", fullPage: true });

  // The workforce is real: agents, departments and approval policy via the API.
  const agents = await (await page.request.get("/api/agents")).json();
  const active = (agents.agents as Array<{ nameAr: string; lifecycle: string; office: { departmentKey: string } }>).filter((a) => a.lifecycle === "active");
  const names = active.map((a) => a.nameAr);
  expect(names).toEqual(expect.arrayContaining(["راشد", "بيان", "باحث", "بصيرة", "لينا", "خالد"]));
  expect(names).not.toContain("هدى"); // quality reviewer is only recommended when client documents need approval
  expect(names).not.toContain("رائد");
  expect(names).not.toContain("قلم");
  expect(active.find((a) => a.nameAr === "خالد")!.office.departmentKey).toBe("delivery");
  const settings = await (await page.request.get("/api/settings")).json();
  expect(settings.settings.autoApproveLevel3).toBe(false);
  const state = await (await page.request.get("/api/onboarding")).json();
  expect(state.status).toBe("active");
  expect(state.blueprint.status).toBe("applied");

  // The office reflects the approved workforce (orchestrator + 5 agents), driven by backend data.
  await page.goto("/office");
  const deadline = Date.now() + 60_000;
  let count = 0;
  while (Date.now() < deadline) {
    const s = await snap(page);
    count = s?.ready ? Object.keys(s.characters).length : 0;
    if (count === 6) break;
    await page.waitForTimeout(250);
  }
  expect(count).toBe(6);

  // The dashboard no longer nags once the workforce is active.
  await page.goto("/");
  await expect(page.getByTestId("onboarding-card")).toHaveCount(0);
});

test("Arabic interface renders the questionnaire right-to-left", async ({ page, context }) => {
  await context.addCookies([{ name: "nexus_locale", value: "ar", url: "http://localhost:3100" }]);
  const r = await page.request.post("/api/auth/signup", { data: { name: "Arabic User", email: `onb-ar-${randomUUID().slice(0, 8)}@example.com`, password: PASSWORD, locale: "ar" } });
  expect(r.status()).toBe(200);
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "أعدّ القوى العاملة الرقمية" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "الاستشارات والخدمات المهنية" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  // The dashboard invites the admin to finish setup.
  await page.goto("/");
  await expect(page.getByTestId("onboarding-card")).toBeVisible();
});

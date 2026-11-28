import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PASSWORD, waitForTask } from "./helpers";

const SECTIONS = ["/", "/chat", "/tasks", "/approvals", "/agents", "/agents/research", "/knowledge", "/files", "/memory", "/integrations", "/analytics", "/activity", "/settings"];

async function signupViaUi(page: Page) {
  const email = `ui-${randomUUID().slice(0, 8)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Mona Analyst");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  // New accounts land on guided onboarding; these tests exercise the rest of the app.
  await page.waitForURL((u) => u.pathname === "/onboarding");
  await page.goto("/");
  return email;
}

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return errors;
}

test.describe("UI end-to-end (desktop)", () => {
  test("sign up, run a multi-agent task from chat and see the deliverable", async ({ page }) => {
    const errors = trackErrors(page);
    await signupViaUi(page);
    await page.goto("/chat");
    const box = page.getByPlaceholder("Ask anything, or describe a task for your agents…");
    await box.fill("Research the Saudi events market and write a report");
    await box.press("Enter");
    await page.waitForURL(/\/chat\/[0-9a-f-]{36}/);
    await expect(page.getByText("Task run").first()).toBeVisible();
    // The final consolidated result arrives as a new assistant message with the deliverable
    await expect(page.getByText("Mock Report").first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Completed").first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("approval center: approve a Level 3 action and it executes exactly once", async ({ page }) => {
    await signupViaUi(page);
    const wi = await (await page.request.post("/api/work-items", { data: { title: "Submit tender documents" } })).json();
    const chat = await (await page.request.post("/api/chat", { data: { message: `Mark work item ${wi.item.id} as complete` } })).json();
    await waitForTask(page.request, chat.taskId, ["waiting_approval"]);
    await page.goto("/approvals");
    await expect(page.getByText("update_work_item").first()).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).first().click();
    const done = await waitForTask(page.request, chat.taskId, ["completed", "failed"]);
    expect(done.task.status).toBe("completed");
    const items = await (await page.request.get("/api/work-items")).json();
    expect(items.items.find((i: { id: string }) => i.id === wi.item.id).status).toBe("done");
    expect(done.toolExecutions.filter((e: { toolName: string; status: string }) => e.toolName === "update_work_item" && e.status === "succeeded")).toHaveLength(1);
  });

  test("every section renders without errors in English and Arabic (RTL), light and dark", async ({ page }) => {
    await signupViaUi(page);
    for (const locale of ["en", "ar"] as const) {
      await page.context().addCookies([{ name: "nexus_locale", value: locale, url: page.url() }]);
      for (const theme of ["light", "dark"]) {
        await page.evaluate((t) => localStorage.setItem("nexus-theme", t), theme);
        for (const path of SECTIONS) {
          const errors = trackErrors(page);
          const res = await page.goto(path);
          expect(res?.status(), path).toBeLessThan(400);
          await expect(page.locator("main")).toBeVisible();
          await page.waitForLoadState("networkidle");
          expect(await page.locator("html").getAttribute("dir")).toBe(locale === "ar" ? "rtl" : "ltr");
          expect(await page.locator("html").getAttribute("data-theme")).toBe(theme);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow, `${path} horizontal overflow (${locale}/${theme})`).toBeLessThanOrEqual(1);
          expect(errors, `${path} (${locale}/${theme})`).toEqual([]);
          page.removeAllListeners("console");
          page.removeAllListeners("pageerror");
        }
      }
    }
  });
});

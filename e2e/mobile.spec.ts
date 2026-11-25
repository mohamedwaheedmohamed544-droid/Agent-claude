import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PASSWORD } from "./helpers";

const SECTIONS = ["/", "/chat", "/tasks", "/approvals", "/agents", "/knowledge", "/files", "/memory", "/integrations", "/analytics", "/activity", "/settings"];

test("mobile: navigation drawer works and no section scrolls horizontally (EN + AR)", async ({ page }) => {
  const email = `m-${randomUUID().slice(0, 8)}@example.com`;
  const r = await page.request.post("/api/auth/signup", { data: { name: "Mobile User", email, password: PASSWORD } });
  expect(r.status()).toBe(200);
  for (const locale of ["en", "ar"]) {
    await page.context().addCookies([{ name: "nexus_locale", value: locale, url: "http://localhost" }]);
    for (const path of SECTIONS) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} (${locale})`).toBeLessThanOrEqual(1);
    }
  }
  await page.goto("/");
  await page.getByRole("button", { name: /menu|القائمة/i }).click();
  await page.getByRole("link", { name: /Task Center|مركز المهام/ }).click();
  await expect(page).toHaveURL(/\/tasks$/);
});

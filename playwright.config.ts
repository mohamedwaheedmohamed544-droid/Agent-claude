import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build (`next start`) backed by a dedicated
 * Postgres database and the deterministic mock LLM. Build first: `npm run build`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const DB = process.env.E2E_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/nexus_e2e";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "api", testMatch: /api\.spec\.ts/ },
    { name: "tenancy", testMatch: /tenancy\.spec\.ts/ },
    { name: "onboarding", testMatch: /onboarding\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "desktop", testMatch: /ui\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    { name: "agents", testMatch: /agents\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "office", testMatch: /office\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx tsx e2e/prepare-db.ts && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: DB,
      E2E_DATABASE_URL: DB,
      NEXUS_LLM_PROVIDER: "mock",
      NEXUS_ALLOW_MOCK: "1",
      ANTHROPIC_MODEL: "mock-model",
      NEXUS_ENCRYPTION_KEY: "e2e-only-key-not-for-production",
      CRON_SECRET: "e2e-cron-secret",
      NEXUS_TASK_BUDGET_MS: "60000",
      NEXUS_RATE_LIMIT_SCALE: "50",
      NEXUS_MOCK_DELAY_MS: "900",
    },
  },
});

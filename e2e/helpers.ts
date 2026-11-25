import { expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

export const PASSWORD = "Nexus-e2e-pass-2026";

export async function signup(request: APIRequestContext, name = "E2E User") {
  const email = `e2e-${randomUUID().slice(0, 8)}@example.com`;
  const res = await request.post("/api/auth/signup", { data: { name, email, password: PASSWORD } });
  expect(res.status(), await res.text()).toBe(200);
  return { email, ...(await res.json()) as { user: { id: string }; workspaceId: string } };
}

export async function waitForTask(request: APIRequestContext, taskId: string, until: string[], timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last: { task: { status: string } } | null = null;
  while (Date.now() < deadline) {
    const r = await request.get(`/api/tasks/${taskId}`);
    expect(r.status()).toBe(200);
    last = await r.json();
    if (until.includes(last!.task.status)) return last as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    await new Promise((res) => setTimeout(res, 700));
  }
  throw new Error(`Task ${taskId} did not reach ${until.join("/")} (last: ${last?.task.status})`);
}

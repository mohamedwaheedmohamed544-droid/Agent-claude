import { randomUUID } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createWorkspace } from "@/lib/auth/session";

export async function makeUser(name = "Test User") {
  const email = `${randomUUID()}@test.local`;
  const u = await queryOne<{ id: string }>(
    "INSERT INTO users(email, name, password_hash) VALUES ($1,$2,$3) RETURNING id",
    [email, name, await hashPassword("password12345")],
  );
  const workspaceId = await createWorkspace(u!.id, `${name}'s workspace`);
  return { userId: u!.id, email, workspaceId };
}

export async function addMember(workspaceId: string, userId: string, role: string) {
  await query("INSERT INTO workspace_members(workspace_id, user_id, role) VALUES ($1,$2,$3)", [workspaceId, userId, role]);
}

export async function taskState(taskId: string) {
  const task = await queryOne<{ status: string; result: string | null; summary: string | null; error: unknown }>(
    "SELECT status, result, summary, error FROM tasks WHERE id=$1", [taskId],
  );
  const steps = await query<{ step_key: string; agent_slug: string; status: string; output: string | null; attempts: number }>(
    "SELECT step_key, agent_slug, status, output, attempts FROM task_steps WHERE task_id=$1 ORDER BY position", [taskId],
  );
  return { task: task!, steps };
}

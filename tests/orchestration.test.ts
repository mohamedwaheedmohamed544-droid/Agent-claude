import { describe, expect, it, beforeAll } from "vitest";
import { query, queryOne } from "@/lib/db";
import { ensureSystemAgents } from "@/lib/agents/store";
import { syncToolRegistry } from "@/lib/tools/registry";
import { handleChatMessage, listMessages } from "@/lib/orchestrator/chat";
import { controlTask, runTask } from "@/lib/orchestrator/engine";
import { decideApproval, listApprovals } from "@/lib/approvals";
import { validatePlan, PlanValidationError } from "@/lib/orchestrator/planner";
import { makeUser, taskState } from "./helpers";

beforeAll(async () => {
  await ensureSystemAgents(true);
  await syncToolRegistry(true);
});

describe("planner validation", () => {
  const step = (key: string, deps: string[] = []) => ({ key, agent: "research", title: key, instruction: "x", expected_output: "y", depends_on: deps, condition: null });
  it("rejects cycles", () => {
    expect(() => validatePlan({ mode: "multi", title: "t", reply: null, steps: [step("a", ["b"]), step("b", ["a"])] })).toThrow(PlanValidationError);
  });
  it("rejects unknown agents and dangling deps", () => {
    expect(() => validatePlan({ mode: "single", title: "t", reply: null, steps: [{ ...step("a"), agent: "hacker" }] })).toThrow(/agent/);
    expect(() => validatePlan({ mode: "single", title: "t", reply: null, steps: [step("a", ["zzz"])] })).toThrow(/unknown step/);
  });
  it("requires a reply for direct mode and normalises mode", () => {
    expect(() => validatePlan({ mode: "direct", title: "t", reply: null, steps: [] })).toThrow();
    expect(validatePlan({ mode: "single", title: "t", reply: null, steps: [step("a"), step("b", ["a"])] }).mode).toBe("multi");
  });
});

describe("chat + orchestration", () => {
  it("answers simple messages directly and persists history", async () => {
    const u = await makeUser();
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "hello" });
    expect(r.taskId).toBeNull();
    expect(r.reply.content).toContain("Hello");
    const msgs = await listMessages(u.workspaceId, u.userId, r.conversationId);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("routes a single-agent task to the right specialist and completes it", async () => {
    const u = await makeUser();
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Analyse our KPI data trends" });
    expect(r.plan.steps[0].agent).toBe("analytics");
    expect(await runTask(r.taskId!)).toBe("completed");
    const s = await taskState(r.taskId!);
    expect(s.task.status).toBe("completed");
    expect(s.steps[0].status).toBe("completed");
    const msgs = await listMessages(u.workspaceId, u.userId, r.conversationId);
    expect(msgs.at(-1)?.metadata.kind).toBe("task_result");
  });

  it("runs a multi-agent plan with parallel steps, dependencies, artifacts and consolidation", async () => {
    const u = await makeUser();
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Research the Saudi events market and write a report" });
    expect(r.plan.mode).toBe("multi");
    expect(await runTask(r.taskId!)).toBe("completed");
    const s = await taskState(r.taskId!);
    expect(s.steps.map((x) => x.status)).toEqual(["completed", "completed", "completed"]);
    expect(new Set(s.steps.map((x) => x.agent_slug))).toEqual(new Set(["research", "marketing", "writing"]));
    const arts = await query("SELECT id, format FROM generated_artifacts WHERE task_id=$1", [r.taskId]);
    expect(arts.length).toBe(1);
    const deps = await query("SELECT * FROM task_dependencies d JOIN task_steps s ON s.id=d.step_id WHERE s.task_id=$1", [r.taskId]);
    expect(deps.length).toBe(2);
    const msgs = await listMessages(u.workspaceId, u.userId, r.conversationId);
    const last = msgs.at(-1)!;
    expect((last.metadata.artifacts as unknown[]).length).toBe(1);
    expect(last.metadata.agents).toEqual(expect.arrayContaining(["research", "marketing", "writing"]));
  });

  it("retries recoverable failures, then fails the task and allows a manual retry", async () => {
    const u = await makeUser();
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "research this [fail]" });
    await query("UPDATE task_steps SET max_attempts=2 WHERE task_id=$1", [r.taskId]);
    expect(await runTask(r.taskId!, { budgetMs: 30_000 })).toBe("failed");
    const s = await taskState(r.taskId!);
    expect(s.steps[0].attempts).toBe(2);
    expect(s.task.status).toBe("failed");
    expect(await controlTask(u.workspaceId, r.taskId!, "retry", u.userId)).toBe("running");
  });
});

describe("approval enforcement", () => {
  it("Level 4 external action waits for approval; rejection is honoured without execution", async () => {
    const u = await makeUser();
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Send a webhook to https://hooks.example.com/abc" });
    expect(await runTask(r.taskId!)).toBe("waiting_approval");
    const [a] = await listApprovals(u.workspaceId, "pending");
    expect(a.toolName).toBe("http_post_webhook");
    expect(a.riskLevel).toBe(4);
    expect(a.destination).toBe("https://hooks.example.com/abc");
    // Wrong hash (user reviewed something else) is refused
    await expect(decideApproval({ workspaceId: u.workspaceId, approvalId: a.id, userId: u.userId, role: "owner", decision: "approve", paramsHash: "deadbeef" })).rejects.toThrow(/changed/);
    await decideApproval({ workspaceId: u.workspaceId, approvalId: a.id, userId: u.userId, role: "owner", decision: "reject", paramsHash: a.paramsHash });
    expect(await runTask(r.taskId!)).toBe("completed");
    const execs = await query<{ status: string }>("SELECT status FROM tool_executions WHERE task_id=$1 AND tool_name='http_post_webhook'", [r.taskId]);
    expect(execs.every((e) => e.status !== "succeeded")).toBe(true);
  });

  it("Level 3 modify action executes exactly once after approval", async () => {
    const u = await makeUser();
    const wi = await queryOne<{ id: string }>("INSERT INTO work_items(workspace_id, title) VALUES ($1,'Prepare tender') RETURNING id", [u.workspaceId]);
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: `Mark work item ${wi!.id} as complete` });
    expect(await runTask(r.taskId!)).toBe("waiting_approval");
    expect((await queryOne<{ status: string }>("SELECT status FROM work_items WHERE id=$1", [wi!.id]))!.status).toBe("todo");
    const [a] = await listApprovals(u.workspaceId, "pending");
    expect(a.riskLevel).toBe(3);
    await decideApproval({ workspaceId: u.workspaceId, approvalId: a.id, userId: u.userId, role: "owner", decision: "approve", paramsHash: a.paramsHash });
    expect(await runTask(r.taskId!)).toBe("completed");
    expect((await queryOne<{ status: string }>("SELECT status FROM work_items WHERE id=$1", [wi!.id]))!.status).toBe("done");
    const ok = await query("SELECT 1 FROM tool_executions WHERE task_id=$1 AND tool_name='update_work_item' AND status='succeeded'", [r.taskId]);
    expect(ok.length).toBe(1);
    const [after] = await listApprovals(u.workspaceId, undefined, r.taskId!);
    expect(after.status).toBe("executed");
    const audit = await query<{ action: string }>("SELECT action FROM audit_logs WHERE workspace_id=$1", [u.workspaceId]);
    expect(audit.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(["approval.requested", "approval.approved", "tool.executed"]));
  });

  it("auto-approves Level 3 only when the workspace allows it; Level 4 never auto-approves", async () => {
    const { requiresApproval } = await import("@/lib/tools/executor");
    expect(requiresApproval(3, false)).toBe(true);
    expect(requiresApproval(3, true)).toBe(false);
    expect(requiresApproval(4, true)).toBe(true);
    expect(requiresApproval(2, false)).toBe(false);
  });

  it("only the task owner or an admin may decide; other workspaces cannot see it", async () => {
    const owner = await makeUser();
    const other = await makeUser("Other");
    const r = await handleChatMessage({ workspaceId: owner.workspaceId, userId: owner.userId, locale: "en", text: "Send a webhook to https://hooks.example.com/x" });
    await runTask(r.taskId!);
    const [a] = await listApprovals(owner.workspaceId, "pending");
    await expect(decideApproval({ workspaceId: other.workspaceId, approvalId: a.id, userId: other.userId, role: "owner", decision: "approve", paramsHash: a.paramsHash })).rejects.toThrow(/not found/i);
    await expect(decideApproval({ workspaceId: owner.workspaceId, approvalId: a.id, userId: other.userId, role: "member", decision: "approve", paramsHash: a.paramsHash })).rejects.toThrow(/owner or a workspace admin/);
    expect(await listApprovals(other.workspaceId)).toHaveLength(0);
  });

  it("emergency stop pauses execution", async () => {
    const u = await makeUser();
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Analyse spreadsheet data" });
    await query(`UPDATE workspaces SET settings = settings || '{"emergencyStop": true}' WHERE id=$1`, [u.workspaceId]);
    expect(await runTask(r.taskId!)).toBe("paused");
    await expect(controlTask(u.workspaceId, r.taskId!, "resume", u.userId)).rejects.toThrow(/Emergency/);
    await query(`UPDATE workspaces SET settings = settings || '{"emergencyStop": false}' WHERE id=$1`, [u.workspaceId]);
    expect(await controlTask(u.workspaceId, r.taskId!, "resume", u.userId)).toBe("running");
    expect(await runTask(r.taskId!)).toBe("completed");
  });

  it("cancel stops a task and expires its pending approvals", async () => {
    const u = await makeUser();
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Send a webhook to https://hooks.example.com/y" });
    await runTask(r.taskId!);
    expect(await controlTask(u.workspaceId, r.taskId!, "cancel", u.userId)).toBe("cancelled");
    const [a] = await listApprovals(u.workspaceId, undefined, r.taskId!);
    expect(a.status).toBe("expired");
  });
});

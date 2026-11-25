import { workspaceRoute } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { kickTask } from "@/lib/orchestrator/engine";
import { listApprovals } from "@/lib/approvals";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Full, user-visible execution trace of a task (no hidden reasoning — only plan, steps, tools, results). */
export const GET = workspaceRoute(async ({ workspaceId, params }) => {
  const task = await queryOne<{ status: string; locked_until: string | null; updated_at: string }>(
    `SELECT t.id, t.title, t.objective, t.status, t.mode, t.plan, t.result, t.summary, t.error, t.conversation_id AS "conversationId",
            t.parent_task_id AS "parentTaskId", t.created_at AS "createdAt", t.updated_at AS "updatedAt", t.started_at AS "startedAt",
            t.completed_at AS "completedAt", t.run_count AS "runCount", t.locked_until, t.updated_at, u.name AS "createdByName"
       FROM tasks t LEFT JOIN users u ON u.id=t.created_by WHERE t.id=$1 AND t.workspace_id=$2`,
    [params.id, workspaceId],
  );
  if (!task) throw notFound("Task not found");
  // Self-healing resume when no runner holds the lease.
  if (["planned", "running"].includes(task.status) && (!task.locked_until || new Date(task.locked_until) < new Date()) &&
      Date.now() - new Date(task.updated_at).getTime() > 3000) {
    kickTask(params.id);
  }
  const steps = await query(
    `SELECT s.id, s.step_key AS key, s.position, s.agent_slug AS agent, s.title, s.input, s.expected_output AS "expectedOutput",
            s.condition, s.status, s.output, s.output_meta AS meta, s.error, s.attempts, s.max_attempts AS "maxAttempts",
            s.started_at AS "startedAt", s.completed_at AS "completedAt",
            COALESCE((SELECT array_agg(d2.step_key) FROM task_dependencies d JOIN task_steps d2 ON d2.id=d.depends_on_step_id WHERE d.step_id=s.id), '{}') AS "dependsOn"
       FROM task_steps s WHERE s.task_id=$1 ORDER BY s.position`,
    [params.id],
  );
  const toolExecutions = await query(
    `SELECT id, step_id AS "stepId", tool_name AS "toolName", agent_slug AS agent, risk_level AS "riskLevel", status, error,
            duration_ms AS "durationMs", approval_id AS "approvalId", created_at AS "createdAt"
       FROM tool_executions WHERE task_id=$1 ORDER BY created_at`,
    [params.id],
  );
  const artifacts = await query(
    `SELECT id, kind, title, format, size_bytes AS "sizeBytes", agent_slug AS agent, created_at AS "createdAt" FROM generated_artifacts WHERE task_id=$1 ORDER BY created_at`,
    [params.id],
  );
  const usage = await queryOne(
    `SELECT COALESCE(sum(prompt_tokens),0)::int AS "promptTokens", COALESCE(sum(completion_tokens),0)::int AS "completionTokens",
            COALESCE(sum(cost_usd),0)::float AS "costUsd", count(*)::int AS calls FROM usage_records WHERE task_id=$1`,
    [params.id],
  );
  const approvals = await listApprovals(workspaceId, undefined, params.id);
  const publicTask: Record<string, unknown> = { ...task };
  delete publicTask.locked_until;
  delete publicTask.updated_at;
  return { task: publicTask, steps, toolExecutions, artifacts, approvals, usage };
});

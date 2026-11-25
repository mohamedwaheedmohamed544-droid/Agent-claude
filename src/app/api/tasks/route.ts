import { workspaceRoute } from "@/lib/api";
import { query } from "@/lib/db";
import { resumeStaleTasks } from "@/lib/orchestrator/engine";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export const GET = workspaceRoute(async ({ req, workspaceId }) => {
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  const limit = Math.min(Number(sp.get("limit") ?? 50) || 50, 200);
  // Self-healing: resume tasks whose runner died (covers environments without frequent cron).
  await resumeStaleTasks(2, workspaceId).catch(() => {});
  const tasks = await query(
    `SELECT t.id, t.title, t.status, t.mode, t.summary, t.conversation_id AS "conversationId", t.created_at AS "createdAt",
            t.updated_at AS "updatedAt", t.started_at AS "startedAt", t.completed_at AS "completedAt", u.name AS "createdByName",
            (SELECT count(*)::int FROM task_steps s WHERE s.task_id=t.id) AS "stepCount",
            (SELECT count(*)::int FROM task_steps s WHERE s.task_id=t.id AND s.status IN ('completed','skipped')) AS "stepsDone",
            (SELECT array_agg(DISTINCT s.agent_slug) FROM task_steps s WHERE s.task_id=t.id) AS agents,
            (SELECT count(*)::int FROM approvals a WHERE a.task_id=t.id AND a.status='pending') AS "pendingApprovals"
       FROM tasks t LEFT JOIN users u ON u.id=t.created_by
      WHERE t.workspace_id=$1 AND ($2::text IS NULL OR t.status=$2)
      ORDER BY t.updated_at DESC LIMIT $3`,
    [workspaceId, status, limit],
  );
  const counts = await query<{ status: string; n: number }>(
    "SELECT status, count(*)::int AS n FROM tasks WHERE workspace_id=$1 GROUP BY status", [workspaceId],
  );
  return { tasks, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
});

import { workspaceRoute } from "@/lib/api";
import { query } from "@/lib/db";

export const GET = workspaceRoute(async ({ req, workspaceId }) => {
  const sp = new URL(req.url).searchParams;
  const taskId = sp.get("taskId");
  return {
    artifacts: await query(
      `SELECT a.id, a.kind, a.title, a.format, a.mime_type AS "mimeType", a.size_bytes AS "sizeBytes", a.agent_slug AS agent,
              a.task_id AS "taskId", a.conversation_id AS "conversationId", a.created_at AS "createdAt", t.title AS "taskTitle"
         FROM generated_artifacts a LEFT JOIN tasks t ON t.id=a.task_id
        WHERE a.workspace_id=$1 AND ($2::uuid IS NULL OR a.task_id=$2) ORDER BY a.created_at DESC LIMIT 200`,
      [workspaceId, taskId && /^[0-9a-f-]{36}$/i.test(taskId) ? taskId : null],
    ),
  };
});

import { workspaceRoute } from "@/lib/api";
import { query } from "@/lib/db";

export const GET = workspaceRoute(async ({ req, workspaceId, user }) => {
  const archived = new URL(req.url).searchParams.get("archived") === "1";
  return {
    conversations: await query(
      `SELECT c.id, c.title, c.archived, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
              (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id) AS "messageCount"
         FROM conversations c WHERE c.workspace_id=$1 AND c.user_id=$2 AND c.archived=$3
        ORDER BY c.updated_at DESC LIMIT 100`,
      [workspaceId, user.id, archived],
    ),
  };
});

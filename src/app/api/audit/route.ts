import { workspaceRoute } from "@/lib/api";
import { query } from "@/lib/db";

export const GET = workspaceRoute(async ({ req, workspaceId }) => {
  const sp = new URL(req.url).searchParams;
  const action = sp.get("action");
  const actorType = sp.get("actorType");
  const before = sp.get("before");
  const limit = Math.min(Number(sp.get("limit") ?? 100) || 100, 500);
  const rows = await query(
    `SELECT l.id::text, l.actor_type AS "actorType", l.actor, l.action, l.target_type AS "targetType", l.target_id AS "targetId",
            l.metadata, l.created_at AS "createdAt", u.name AS "userName", u.email AS "userEmail"
       FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id
      WHERE l.workspace_id=$1 AND ($2::text IS NULL OR l.action LIKE $2 || '%') AND ($3::text IS NULL OR l.actor_type=$3)
        AND ($4::bigint IS NULL OR l.id < $4)
      ORDER BY l.id DESC LIMIT $5`,
    [workspaceId, action, actorType, before && /^\d+$/.test(before) ? before : null, limit],
  );
  return { logs: rows, nextBefore: rows.length === limit ? (rows.at(-1) as { id: string }).id : null };
}, { minRole: "admin" });

import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { listMessages } from "@/lib/orchestrator/chat";

export const GET = workspaceRoute(async ({ workspaceId, user, params }) => {
  const conv = await queryOne(
    `SELECT id, title, archived, created_at AS "createdAt", updated_at AS "updatedAt" FROM conversations WHERE id=$1 AND workspace_id=$2 AND user_id=$3`,
    [params.id, workspaceId, user.id],
  );
  if (!conv) throw notFound("Conversation not found");
  const messages = await listMessages(workspaceId, user.id, params.id);
  const tasks = await query(
    `SELECT id, title, status, mode, summary, created_at AS "createdAt", updated_at AS "updatedAt" FROM tasks WHERE conversation_id=$1 AND workspace_id=$2 ORDER BY created_at`,
    [params.id, workspaceId],
  );
  return { conversation: conv, messages, tasks };
});

const Patch = z.object({ title: z.string().trim().min(1).max(200).optional(), archived: z.boolean().optional() });

export const PATCH = workspaceRoute(async ({ req, workspaceId, user, params }) => {
  const p = Patch.parse(await readJson(req));
  const r = await queryOne(
    "UPDATE conversations SET title=COALESCE($4,title), archived=COALESCE($5,archived), updated_at=now() WHERE id=$1 AND workspace_id=$2 AND user_id=$3 RETURNING id",
    [params.id, workspaceId, user.id, p.title ?? null, p.archived ?? null],
  );
  if (!r) throw notFound("Conversation not found");
  return { ok: true };
});

export const DELETE = workspaceRoute(async ({ workspaceId, user, params }) => {
  const r = await queryOne("DELETE FROM conversations WHERE id=$1 AND workspace_id=$2 AND user_id=$3 RETURNING id", [params.id, workspaceId, user.id]);
  if (!r) throw notFound("Conversation not found");
  return { ok: true };
});

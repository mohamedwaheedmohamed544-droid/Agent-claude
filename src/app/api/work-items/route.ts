import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { notFound } from "@/lib/errors";

export const GET = workspaceRoute(async ({ workspaceId }) => ({
  items: await query(
    `SELECT id, title, description, status, priority, due_date AS "dueDate", assignee, task_id AS "taskId", created_by_agent AS "createdByAgent",
            created_at AS "createdAt", updated_at AS "updatedAt" FROM work_items WHERE workspace_id=$1 ORDER BY
            CASE status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END, due_date NULLS LAST, created_at DESC LIMIT 500`,
    [workspaceId],
  ),
}));

const Create = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  assignee: z.string().max(200).optional(),
});

export const POST = workspaceRoute(async ({ req, workspaceId }) => {
  const b = Create.parse(await readJson(req));
  return {
    item: await queryOne(
      "INSERT INTO work_items(workspace_id, title, description, priority, due_date, assignee) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, title, status, priority",
      [workspaceId, b.title, b.description ?? null, b.priority ?? "medium", b.dueDate ?? null, b.assignee ?? null],
    ),
  };
});

const Patch = Create.partial().extend({ id: z.string().uuid(), status: z.enum(["todo", "in_progress", "done", "blocked"]).optional(), remove: z.boolean().optional() });

/** Direct user edits (not agent actions) — no approval needed; agent edits go through update_work_item. */
export const PATCH = workspaceRoute(async ({ req, workspaceId }) => {
  const b = Patch.parse(await readJson(req));
  if (b.remove) {
    const r = await queryOne("DELETE FROM work_items WHERE id=$1 AND workspace_id=$2 RETURNING id", [b.id, workspaceId]);
    if (!r) throw notFound();
    return { ok: true };
  }
  const r = await queryOne(
    `UPDATE work_items SET title=COALESCE($3,title), description=COALESCE($4,description), priority=COALESCE($5,priority),
            due_date=COALESCE($6::date,due_date), assignee=COALESCE($7,assignee), status=COALESCE($8,status), updated_at=now()
      WHERE id=$1 AND workspace_id=$2 RETURNING id, title, status, priority`,
    [b.id, workspaceId, b.title ?? null, b.description ?? null, b.priority ?? null, b.dueDate ?? null, b.assignee ?? null, b.status ?? null],
  );
  if (!r) throw notFound();
  return { item: r };
});

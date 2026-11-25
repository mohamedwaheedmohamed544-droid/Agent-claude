import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { deleteMemory, updateMemory } from "@/lib/memory/store";

const Patch = z.object({
  content: z.string().trim().min(2).max(4000).optional(),
  /** 'active' approves an agent-proposed memory; 'archived' retires it. */
  status: z.enum(["active", "archived"]).optional(),
  importance: z.number().min(0).max(1).optional(),
  kind: z.enum(["preference", "fact", "decision", "context", "workflow", "note"]).optional(),
});

export const PATCH = workspaceRoute(async ({ req, workspaceId, user, params }) => {
  const p = Patch.parse(await readJson(req));
  const m = await updateMemory(workspaceId, user.id, params.id, p);
  if (!m) throw notFound("Memory not found");
  const action = p.status === "active" ? "memory.approved" : p.status === "archived" ? "memory.archived" : "memory.updated";
  await audit({ workspaceId, userId: user.id, actorType: "user", action, targetType: "memory", targetId: params.id });
  return { memory: m };
});

export const DELETE = workspaceRoute(async ({ workspaceId, user, params }) => {
  if (!(await deleteMemory(workspaceId, user.id, params.id))) throw notFound("Memory not found");
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "memory.deleted", targetType: "memory", targetId: params.id });
  return { ok: true };
});

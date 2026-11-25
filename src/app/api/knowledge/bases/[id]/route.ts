import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteBase, updateBase } from "@/lib/knowledge/bases";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
}).refine((p) => p.name !== undefined || p.description !== undefined, { message: "Nothing to update" });

export const PATCH = workspaceRoute(async ({ req, workspaceId, user, params, ip }) => {
  const body = Patch.parse(await readJson(req));
  const base = await updateBase(workspaceId, params.id, body);
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "knowledge_base.updated", targetType: "knowledge_base", targetId: base.id, ip, metadata: { name: base.name } });
  return { base };
}, { minRole: "member" });

/** Admin only. Files in the base are kept and become unassigned. */
export const DELETE = workspaceRoute(async ({ workspaceId, user, params, ip }) => {
  const r = await deleteBase(workspaceId, params.id);
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "knowledge_base.deleted", targetType: "knowledge_base", targetId: params.id, ip, metadata: r });
  return { ok: true, detachedFiles: r.detachedFiles };
}, { minRole: "admin" });

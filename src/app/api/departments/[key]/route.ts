import { readJson, workspaceRoute } from "@/lib/api";
import { deleteDepartment, updateDepartment } from "@/lib/agents/registry";

export const PATCH = workspaceRoute(async ({ req, user, workspaceId, params }) => ({
  department: await updateDepartment(workspaceId, user.id, params.key, await readJson(req)),
}), { minRole: "admin" });

export const DELETE = workspaceRoute(async ({ user, workspaceId, params }) => {
  await deleteDepartment(workspaceId, user.id, params.key);
  return { ok: true };
}, { minRole: "admin" });

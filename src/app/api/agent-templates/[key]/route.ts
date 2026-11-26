import { workspaceRoute } from "@/lib/api";
import { deleteTemplate } from "@/lib/agents/registry";

export const DELETE = workspaceRoute(async ({ user, workspaceId, params }) => {
  await deleteTemplate(workspaceId, user.id, params.key);
  return { ok: true };
}, { minRole: "admin" });

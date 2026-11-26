import { readJson, workspaceRoute } from "@/lib/api";
import { createDepartment, listDepartments } from "@/lib/agents/registry";

export const GET = workspaceRoute(async ({ workspaceId }) => ({ departments: await listDepartments(workspaceId) }));

export const POST = workspaceRoute(async ({ req, user, workspaceId }) => {
  const department = await createDepartment(workspaceId, user.id, await readJson(req));
  return new Response(JSON.stringify({ department }), { status: 201, headers: { "content-type": "application/json" } });
}, { minRole: "admin" });

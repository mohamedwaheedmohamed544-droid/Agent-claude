import { readJson, workspaceRoute } from "@/lib/api";
import { listSkills, saveSkill } from "@/lib/agents/registry";

export const GET = workspaceRoute(async ({ workspaceId }) => ({ skills: await listSkills(workspaceId) }));

/** Create a custom skill (admins). Skills add instructions and declare tool dependencies; they never grant permissions. */
export const POST = workspaceRoute(async ({ req, user, workspaceId }) => {
  const skill = await saveSkill(workspaceId, user.id, await readJson(req, 64_000));
  return new Response(JSON.stringify({ skill }), { status: 201, headers: { "content-type": "application/json" } });
}, { minRole: "admin" });

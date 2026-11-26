import { readJson, workspaceRoute } from "@/lib/api";
import { deleteSkill, listSkills, saveSkill } from "@/lib/agents/registry";
import { notFound } from "@/lib/errors";

export const PATCH = workspaceRoute(async ({ req, user, workspaceId, params }) => {
  const current = (await listSkills(workspaceId)).find((s) => s.key === params.key);
  if (!current) throw notFound("Skill not found");
  const patch = (await readJson<Record<string, unknown>>(req, 64_000)) ?? {};
  return { skill: await saveSkill(workspaceId, user.id, { ...current, ...patch, key: undefined }, params.key) };
}, { minRole: "admin" });

export const DELETE = workspaceRoute(async ({ user, workspaceId, params }) => {
  await deleteSkill(workspaceId, user.id, params.key);
  return { ok: true };
}, { minRole: "admin" });

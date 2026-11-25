import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { audit } from "@/lib/audit";
import { WorkspaceSettingsSchema, getWorkspaceSettings } from "@/lib/settings";
import { resolveModels } from "@/lib/ai/models";

export const GET = workspaceRoute(async ({ workspaceId }) => {
  const settings = await getWorkspaceSettings(workspaceId);
  const ws = await queryOne<{ name: string }>("SELECT name FROM workspaces WHERE id=$1", [workspaceId]);
  return { workspaceName: ws?.name, settings, effectiveModels: resolveModels(settings) };
});

const Patch = WorkspaceSettingsSchema.partial().extend({
  workspaceName: z.string().trim().min(1).max(120).optional(),
}).strict();

export const PATCH = workspaceRoute(async ({ req, workspaceId, user, ip }) => {
  const patch = Patch.parse(await readJson(req));
  const { workspaceName, ...rest } = patch;
  const current = await getWorkspaceSettings(workspaceId);
  const next = WorkspaceSettingsSchema.parse({ ...current, ...rest, models: { ...current.models, ...(rest.models ?? {}) } });
  await query("UPDATE workspaces SET settings=$2, name=COALESCE($3,name), updated_at=now() WHERE id=$1", [workspaceId, next, workspaceName ?? null]);
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "settings.updated", metadata: { changed: Object.keys(patch) }, ip });
  return { settings: next };
}, { minRole: "admin" });

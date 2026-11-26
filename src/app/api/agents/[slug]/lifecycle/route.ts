import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { setLifecycle } from "@/lib/agents/registry";

export const maxDuration = 60;
const Body = z.object({ action: z.enum(["activate", "deactivate", "archive", "restore"]), force: z.boolean().optional() });

/** Activate / deactivate / archive / restore (admins). Archiving an agent with active work requires force (cancels it). */
export const POST = workspaceRoute(async ({ req, user, workspaceId, params, ip }) => {
  const b = Body.parse(await readJson(req));
  return setLifecycle(workspaceId, user.id, params.slug, b.action, { force: b.force, ip });
}, { minRole: "admin", rate: { limit: 60, windowSec: 60, bucket: "agent-admin" } });

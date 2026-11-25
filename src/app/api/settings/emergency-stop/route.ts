import { z } from "zod";
import { readJson, workspaceRoute, hasRole } from "@/lib/api";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { forbidden } from "@/lib/errors";
import { getWorkspaceSettings } from "@/lib/settings";

const Body = z.object({ active: z.boolean() });

/**
 * Any member can ENGAGE the emergency stop (safety first). Only admins can RELEASE it.
 * Engaging pauses every running task in the workspace and blocks all tool calls and model calls.
 */
export const POST = workspaceRoute(async ({ req, workspaceId, user, role, ip }) => {
  const { active } = Body.parse(await readJson(req));
  if (!active && !hasRole(role, "admin")) throw forbidden("Only an admin can release the emergency stop");
  const s = await getWorkspaceSettings(workspaceId);
  await query("UPDATE workspaces SET settings=$2, updated_at=now() WHERE id=$1", [workspaceId, { ...s, emergencyStop: active }]);
  let paused = 0;
  if (active) {
    const rows = await query("UPDATE tasks SET pause_requested=true, updated_at=now() WHERE workspace_id=$1 AND status IN ('planned','running','waiting_approval') RETURNING id", [workspaceId]);
    await query("UPDATE tasks SET status='paused' WHERE workspace_id=$1 AND status='waiting_approval'", [workspaceId]);
    paused = rows.length;
  }
  await audit({ workspaceId, userId: user.id, actorType: "user", action: active ? "emergency_stop.engaged" : "emergency_stop.released", metadata: { tasksPaused: paused }, ip });
  return { emergencyStop: active, tasksPaused: paused };
});

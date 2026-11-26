import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { query } from "@/lib/db";
import { getOfficeSettings } from "@/lib/office/state";

export const GET = workspaceRoute(async ({ workspaceId }) => ({ settings: await getOfficeSettings(workspaceId) }));

const Patch = z.object({
  quality: z.enum(["auto", "high", "low"]).optional(),
  voice: z.object({ enabled: z.boolean() }).optional(),
}).strict();

/** Workspace office preferences (render quality; voice is reserved for a future TTS release). */
export const PATCH = workspaceRoute(async ({ req, workspaceId }) => {
  const p = Patch.parse(await readJson(req));
  const next = { ...(await getOfficeSettings(workspaceId)), ...p };
  await query(
    `INSERT INTO office_settings(workspace_id, settings) VALUES ($1,$2)
     ON CONFLICT (workspace_id) DO UPDATE SET settings=EXCLUDED.settings, updated_at=now()`,
    [workspaceId, next],
  );
  return { settings: next };
}, { minRole: "admin" });

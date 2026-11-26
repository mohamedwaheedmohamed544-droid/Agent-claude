import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitEvent } from "@/lib/office/events";
import { computeLayoutSpec, getOfficeSettings } from "@/lib/office/directory";
import { ensureWorkspaceSeeded } from "@/lib/agents/registry";

export const GET = workspaceRoute(async ({ workspaceId }) => {
  await ensureWorkspaceSeeded(workspaceId);
  return { settings: await getOfficeSettings(workspaceId), layout: await computeLayoutSpec(workspaceId) };
});

const Patch = z.object({
  layoutMode: z.enum(["auto", "compact", "standard", "expanded", "large", "multi_floor", "custom"]).optional(),
  floors: z.number().int().min(1).max(10).nullable().optional(),
  meetingRooms: z.number().int().min(1).max(12).nullable().optional(),
  characterScale: z.number().min(0.8).max(1.25).optional(),
  showLabels: z.boolean().optional(),
  ambientLounge: z.boolean().optional(),
  camera: z.object({ defaultView: z.enum(["overview", "executive"]), autoRotate: z.boolean() }).partial().optional(),
  quality: z.enum(["auto", "high", "low"]).optional(),
  voice: z.object({ enabled: z.boolean() }).optional(),
}).strict();

/** Office layout settings (admins): automatic or manual sizing, floors, meeting rooms, character size, camera. */
export const PATCH = workspaceRoute(async ({ req, user, workspaceId, ip }) => {
  const p = Patch.parse(await readJson(req));
  const current = await getOfficeSettings(workspaceId);
  const next = { ...current, ...p, camera: { ...current.camera, ...(p.camera ?? {}) }, voice: { ...current.voice, ...(p.voice ?? {}) } };
  await query(
    `INSERT INTO office_settings(workspace_id, settings) VALUES ($1,$2)
     ON CONFLICT (workspace_id) DO UPDATE SET settings=EXCLUDED.settings, updated_at=now()`,
    [workspaceId, next],
  );
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "office.settings_updated", metadata: { fields: Object.keys(p) }, ip });
  await emitEvent({ workspaceId, agent: "orchestrator", type: "office_layout_changed", summary: "Office settings updated", payload: { fields: Object.keys(p) } });
  return { settings: next, layout: await computeLayoutSpec(workspaceId) };
}, { minRole: "admin" });

import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { listTemplates, saveTemplate } from "@/lib/agents/registry";

export const GET = workspaceRoute(async ({ workspaceId }) => ({ templates: await listTemplates(workspaceId) }));

const Body = z.object({
  fromAgent: z.string().max(80).optional(), config: z.unknown().optional(),
  name: z.string().trim().min(2).max(80), nameAr: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(), category: z.string().max(40).optional(),
}).refine((b) => b.fromAgent || b.config, "Provide fromAgent or config");

/** Save an agent (or a configuration) as a reusable template (admins). */
export const POST = workspaceRoute(async ({ req, user, workspaceId }) => {
  const b = Body.parse(await readJson(req, 200_000));
  const template = await saveTemplate(workspaceId, user.id, b);
  return new Response(JSON.stringify({ template }), { status: 201, headers: { "content-type": "application/json" } });
}, { minRole: "admin" });

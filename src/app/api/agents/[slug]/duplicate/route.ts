import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { duplicateAgent } from "@/lib/agents/registry";

const Body = z.object({ nameAr: z.string().trim().min(1).max(60).optional(), nameEn: z.string().trim().min(1).max(60).optional() });

/** Duplicates an agent as a draft (admins). */
export const POST = workspaceRoute(async ({ req, user, workspaceId, params, ip }) => {
  const b = Body.parse(await readJson(req));
  const agent = await duplicateAgent(workspaceId, user.id, params.slug, b, ip);
  return new Response(JSON.stringify({ agent }), { status: 201, headers: { "content-type": "application/json" } });
}, { minRole: "admin", rate: { limit: 30, windowSec: 60, bucket: "agent-admin" } });

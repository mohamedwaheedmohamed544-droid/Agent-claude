import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { createAgent } from "@/lib/agents/registry";

const Body = z.object({
  data: z.object({ format: z.literal("nexus-agent"), version: z.literal(1), config: z.record(z.string(), z.unknown()) }).passthrough(),
  lifecycle: z.enum(["draft", "active"]).optional(),
});

/** Imports an exported agent configuration (validated exactly like a new agent; never carries permissions it doesn't declare). */
export const POST = workspaceRoute(async ({ req, user, workspaceId, ip }) => {
  const parsed = Body.safeParse(await readJson(req, 200_000));
  if (!parsed.success) throw badRequest("Not a Nexus agent export (expected format \"nexus-agent\", version 1)");
  const config = { ...parsed.data.data.config, office: { ...(parsed.data.data.config.office as object), workstationId: null } };
  const agent = await createAgent(workspaceId, user.id, config, { lifecycle: parsed.data.lifecycle ?? "draft", ip });
  return new Response(JSON.stringify({ agent }), { status: 201, headers: { "content-type": "application/json" } });
}, { minRole: "admin", rate: { limit: 20, windowSec: 60, bucket: "agent-admin" } });

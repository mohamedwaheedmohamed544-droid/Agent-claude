import { workspaceRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { getAgentRecord, stripRecord } from "@/lib/agents/registry";

/** Portable agent configuration (no IDs, no workstation, no history). */
export const GET = workspaceRoute(async ({ workspaceId, params, user }) => {
  const a = await getAgentRecord(workspaceId, params.slug);
  if (!a) throw notFound("Agent not found");
  const config = stripRecord(a);
  const body = { format: "nexus-agent", version: 1, exportedAt: new Date().toISOString(), config: { ...config, office: { ...config.office, workstationId: null } } };
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "agent.exported", targetType: "agent", targetId: a.slug });
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="nexus-agent-${a.slug}.json"`,
      "cache-control": "private, no-store",
    },
  });
}, { minRole: "admin" });

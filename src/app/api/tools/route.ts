import { workspaceRoute } from "@/lib/api";
import { query } from "@/lib/db";
import { allTools, globallyEnabledTools, toolJsonSchema } from "@/lib/tools/registry";
import { getWorkspaceSettings } from "@/lib/settings";
import { listAgents } from "@/lib/agents/store";

export const GET = workspaceRoute(async ({ workspaceId }) => {
  const [enabled, settings, agents, stats, connected] = await Promise.all([
    globallyEnabledTools(),
    getWorkspaceSettings(workspaceId),
    listAgents(workspaceId),
    query<{ tool: string; calls: number; failed: number }>(
      `SELECT tool_name AS tool, count(*)::int AS calls, count(*) FILTER (WHERE status='failed')::int AS failed
         FROM tool_executions WHERE workspace_id=$1 GROUP BY tool_name`, [workspaceId]),
    query<{ provider: string }>("SELECT provider FROM integrations WHERE workspace_id=$1 AND status='connected'", [workspaceId]),
  ]);
  const st = new Map(stats.map((s) => [s.tool, s]));
  const conn = new Set(connected.map((c) => c.provider));
  return {
    tools: allTools().map((t) => ({
      name: t.name, description: t.description, category: t.category, riskLevel: t.riskLevel,
      requiredPermissions: t.requiredPermissions, integration: t.integration ?? null,
      integrationConnected: t.integration ? t.integration.split("|").some((p) => conn.has(p)) : null,
      inputSchema: toolJsonSchema(t), outputSchema: t.output,
      enabled: enabled.has(t.name) && !settings.disabledTools.includes(t.name),
      requiresApproval: t.riskLevel === 4 || (t.riskLevel === 3 && !settings.autoApproveLevel3),
      agents: agents.filter((a) => a.allowedTools.includes(t.name)).map((a) => a.slug),
      calls: st.get(t.name)?.calls ?? 0, failed: st.get(t.name)?.failed ?? 0,
    })),
  };
});

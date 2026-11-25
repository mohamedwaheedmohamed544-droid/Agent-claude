import { workspaceRoute } from "@/lib/api";
import { query } from "@/lib/db";
import { listAgents } from "@/lib/agents/store";

export const GET = workspaceRoute(async ({ workspaceId }) => {
  const agents = await listAgents(workspaceId);
  const stats = await query<{ agent: string; runs: number; completed: number; failed: number; avg_ms: number | null; last_run: string | null }>(
    `SELECT agent_slug AS agent, count(*)::int AS runs, count(*) FILTER (WHERE status='completed')::int AS completed,
            count(*) FILTER (WHERE status='failed')::int AS failed,
            avg(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL)::float AS avg_ms,
            max(started_at) AS last_run
       FROM task_steps WHERE workspace_id=$1 GROUP BY agent_slug`,
    [workspaceId],
  );
  const by = new Map(stats.map((s) => [s.agent, s]));
  return {
    agents: agents.map((a) => {
      const s = by.get(a.slug);
      return {
        slug: a.slug, name: a.name, nameAr: a.nameAr, description: a.description, descriptionAr: a.descriptionAr, icon: a.icon, color: a.color,
        capabilities: a.capabilities, active: a.active, customized: a.workspaceScoped, version: a.version, tier: a.tier, tools: a.allowedTools,
        stats: { runs: s?.runs ?? 0, completed: s?.completed ?? 0, failed: s?.failed ?? 0, avgMs: s?.avg_ms ? Math.round(s.avg_ms) : null, lastRun: s?.last_run ?? null },
      };
    }),
  };
});

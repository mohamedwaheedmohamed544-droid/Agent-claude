import { workspaceRoute } from "@/lib/api";
import { query, queryOne } from "@/lib/db";

/** Workspace analytics & observability: usage, cost, model mix, task/agent/tool outcomes, approvals, API errors. */
export const GET = workspaceRoute(async ({ req, workspaceId }) => {
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days") ?? 30) || 30, 1), 365);
  const p = [workspaceId, days];
  const since = `created_at > now() - make_interval(days => $2)`;
  const [totals, daily, models, tasks, agents, tools, approvals, api, durations] = await Promise.all([
    queryOne(
      `SELECT COALESCE(sum(prompt_tokens),0)::int AS "promptTokens", COALESCE(sum(completion_tokens),0)::int AS "completionTokens",
              COALESCE(sum(cost_usd),0)::float AS "costUsd", count(*)::int AS calls, count(*) FILTER (WHERE NOT success)::int AS "failedCalls",
              COALESCE(avg(latency_ms),0)::int AS "avgLatencyMs"
         FROM usage_records WHERE workspace_id=$1 AND ${since}`, p),
    query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, sum(prompt_tokens + completion_tokens)::int AS tokens,
              sum(cost_usd)::float AS "costUsd", count(*)::int AS calls
         FROM usage_records WHERE workspace_id=$1 AND ${since} GROUP BY 1 ORDER BY 1`, p),
    query(
      `SELECT model, count(*)::int AS calls, sum(prompt_tokens + completion_tokens)::int AS tokens, sum(cost_usd)::float AS "costUsd",
              count(*) FILTER (WHERE NOT success)::int AS failures
         FROM usage_records WHERE workspace_id=$1 AND ${since} GROUP BY model ORDER BY calls DESC`, p),
    query(`SELECT status, count(*)::int AS n FROM tasks WHERE workspace_id=$1 AND ${since} GROUP BY status`, p),
    query(
      `SELECT agent_slug AS agent, count(*)::int AS steps, count(*) FILTER (WHERE status='completed')::int AS completed,
              count(*) FILTER (WHERE status='failed')::int AS failed
         FROM task_steps WHERE workspace_id=$1 AND ${since} GROUP BY agent_slug ORDER BY steps DESC`, p),
    query(
      `SELECT tool_name AS tool, count(*)::int AS calls, count(*) FILTER (WHERE status='succeeded')::int AS succeeded,
              count(*) FILTER (WHERE status='failed')::int AS failed, count(*) FILTER (WHERE status IN ('blocked','awaiting_approval'))::int AS gated,
              COALESCE(avg(duration_ms),0)::int AS "avgMs"
         FROM tool_executions WHERE workspace_id=$1 AND ${since} GROUP BY tool_name ORDER BY calls DESC`, p),
    query(`SELECT status, count(*)::int AS n FROM approvals WHERE workspace_id=$1 AND ${since} GROUP BY status`, p),
    queryOne(
      `SELECT count(*)::int AS requests, count(*) FILTER (WHERE status >= 500)::int AS "serverErrors",
              count(*) FILTER (WHERE status >= 400 AND status < 500)::int AS "clientErrors", COALESCE(avg(duration_ms),0)::int AS "avgMs"
         FROM api_request_logs WHERE workspace_id=$1 AND ${since}`, p),
    queryOne(
      `SELECT COALESCE(avg(EXTRACT(EPOCH FROM (completed_at - created_at))),0)::float AS "avgTaskSeconds",
              COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at))),0)::float AS "p90TaskSeconds"
         FROM tasks WHERE workspace_id=$1 AND ${since} AND status='completed'`, p),
  ]);
  return { days, totals, daily, models, tasks, agents, tools, approvals, api, durations, costNote: "Costs are estimates based on published per-token prices." };
});

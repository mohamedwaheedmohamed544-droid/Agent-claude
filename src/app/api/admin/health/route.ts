import { workspaceRoute } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { isMockMode, verifyModelAccess } from "@/lib/ai/llm";
import { hasEncryptionKey } from "@/lib/security/crypto";
import { resolveModels } from "@/lib/ai/models";
import { getWorkspaceSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** System health for admins. Shows which settings are present — never their values. */
export const GET = workspaceRoute(async ({ req, workspaceId }) => {
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  const started = Date.now();
  const db = await queryOne<{ version: string; vector: string | null; migrations: number; size: string }>(
    `SELECT split_part(version(), ' ', 2) AS version, (SELECT extversion FROM pg_extension WHERE extname='vector') AS vector,
            (SELECT count(*)::int FROM schema_migrations) AS migrations, pg_size_pretty(pg_database_size(current_database())) AS size`,
  );
  const dbLatency = Date.now() - started;
  const models = await verifyModelAccess(force, resolveModels(await getWorkspaceSettings(workspaceId)));
  const queue = await queryOne(
    `SELECT count(*) FILTER (WHERE status='running')::int AS running, count(*) FILTER (WHERE status='planned')::int AS planned,
            count(*) FILTER (WHERE status='waiting_approval')::int AS "waitingApproval", count(*) FILTER (WHERE status='paused')::int AS paused,
            count(*) FILTER (WHERE status IN ('planned','running') AND (locked_until IS NULL OR locked_until < now()) AND updated_at < now() - interval '2 minutes')::int AS stalled
       FROM tasks WHERE workspace_id=$1`, [workspaceId],
  );
  const errors = await query(
    `SELECT route, status, count(*)::int AS n FROM api_request_logs WHERE created_at > now() - interval '24 hours' AND status >= 500
      AND workspace_id=$1 GROUP BY route, status ORDER BY n DESC LIMIT 10`, [workspaceId],
  );
  const env = (k: string) => Boolean(process.env[k]);
  return {
    database: { ok: true, latencyMs: dbLatency, ...db },
    ai: { mode: isMockMode() ? "mock" : "anthropic", ...models },
    queue,
    recentServerErrors: errors,
    configuration: {
      ANTHROPIC_API_KEY: env("ANTHROPIC_API_KEY"), ANTHROPIC_MODEL: env("ANTHROPIC_MODEL"), ANTHROPIC_FALLBACK_MODEL: env("ANTHROPIC_FALLBACK_MODEL"), VOYAGE_API_KEY: env("VOYAGE_API_KEY"),
      DATABASE_URL: env("DATABASE_URL"), NEXUS_ENCRYPTION_KEY: hasEncryptionKey(), CRON_SECRET: env("CRON_SECRET"),
      GOOGLE_CLIENT_ID: env("GOOGLE_CLIENT_ID"), MICROSOFT_CLIENT_ID: env("MICROSOFT_CLIENT_ID"),
    },
    runtime: { node: process.version, region: process.env.VERCEL_REGION ?? null, env: process.env.VERCEL_ENV ?? process.env.NODE_ENV },
  };
}, { minRole: "admin" });

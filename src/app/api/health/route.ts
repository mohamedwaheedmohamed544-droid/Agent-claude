import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { isAiConfigured, isMockMode } from "@/lib/ai/llm";

export const dynamic = "force-dynamic";

/** Public liveness/readiness probe. Reports configuration presence only — never values. */
export async function GET() {
  const started = Date.now();
  let database: "ok" | "error" = "error";
  let migrations: number | null = null;
  let pgvector = false;
  try {
    const r = await queryOne<{ n: number; v: boolean }>(
      "SELECT (SELECT count(*)::int FROM schema_migrations) AS n, EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS v",
    );
    database = "ok";
    migrations = r?.n ?? 0;
    pgvector = Boolean(r?.v);
  } catch {
    database = "error";
  }
  const ai = isAiConfigured();
  const status = database === "ok" && ai ? "ok" : "degraded";
  return NextResponse.json(
    {
      status,
      service: "nexus-ai",
      checks: { database, migrationsApplied: migrations, pgvector, aiConfigured: ai, aiMode: isMockMode() ? "mock" : "anthropic" },
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    },
    { status: database === "ok" ? 200 : 503 },
  );
}

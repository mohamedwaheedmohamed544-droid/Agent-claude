import { queryOne } from "../db";
import { isAiConfigured, isMockMode, verifyModelAccess } from "../ai/llm";
import { hasEncryptionKey } from "../security/crypto";
import { getTool } from "../tools/registry";
import { listIntegrationRows } from "./store";
import { OAUTH_PROVIDERS, isProviderConfigured, missingEnv, providerConfig, redirectUri, type OAuthProviderId } from "./providers";

/**
 * Integration catalogue for GET /api/integrations. Contains configuration PRESENCE and connection state only —
 * never secrets, tokens or env var values.
 */

export interface ToolRef { name: string; riskLevel: number }

export interface ServiceInfo {
  key: string;
  group: "communication" | "calendar" | "storage";
  capabilities: string[];
  tools: ToolRef[];
}

export interface IntegrationInfo {
  provider: string;
  kind: "oauth" | "builtin";
  name: string;
  description: string;
  configured: boolean;
  status: "connected" | "disconnected" | "error" | "pending" | "available" | "not_configured";
  accountLabel: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastError: string | null;
  capabilities: string[];
  tools: ToolRef[];
  services?: ServiceInfo[];
  setup?: { envVars: string[]; missingEnv: string[]; optionalEnv: string[]; redirectUri?: string };
  details?: Record<string, unknown>;
}

function toolRefs(names: string[]): ToolRef[] {
  return names.map((n) => ({ name: n, riskLevel: getTool(n)?.riskLevel ?? 0 })).filter((t) => t.riskLevel > 0);
}

const SERVICES: Record<OAuthProviderId, ServiceInfo[]> = {
  google: [
    { key: "gmail", group: "communication", capabilities: ["email.search", "email.send"], tools: toolRefs(["email_search", "send_email"]) },
    { key: "google_calendar", group: "calendar", capabilities: ["calendar.read", "calendar.create", "calendar.invite"], tools: toolRefs(["calendar_list_events", "calendar_create_event", "calendar_invite_attendees"]) },
    { key: "google_drive", group: "storage", capabilities: ["drive.search", "drive.upload"], tools: toolRefs(["drive_search", "drive_upload_file"]) },
  ],
  microsoft: [
    { key: "outlook", group: "communication", capabilities: ["email.search", "email.send"], tools: toolRefs(["email_search", "send_email"]) },
    { key: "outlook_calendar", group: "calendar", capabilities: ["calendar.read", "calendar.create", "calendar.invite"], tools: toolRefs(["calendar_list_events", "calendar_create_event", "calendar_invite_attendees"]) },
  ],
};

const DESCRIPTIONS: Record<OAuthProviderId, string> = {
  google: "Gmail, Google Calendar and Google Drive through one Google account (OAuth 2.0 with PKCE).",
  microsoft: "Outlook mail and calendar through Microsoft Graph (OAuth 2.0 with PKCE).",
};

async function oauthEntries(workspaceId: string, origin?: string): Promise<IntegrationInfo[]> {
  const rows = new Map((await listIntegrationRows(workspaceId)).map((r) => [r.provider, r]));
  return OAUTH_PROVIDERS.map((p) => {
    const cfg = providerConfig(p);
    const row = rows.get(p);
    const configured = isProviderConfigured(p);
    const services = SERVICES[p];
    return {
      provider: p,
      kind: "oauth" as const,
      name: cfg.name,
      description: DESCRIPTIONS[p],
      configured,
      status: row ? row.status : configured ? "disconnected" : "not_configured",
      accountLabel: row?.account_label ?? null,
      scopes: row?.scopes?.length ? row.scopes : [],
      connectedAt: row?.status === "connected" || row?.status === "error" ? row.created_at.toISOString() : null,
      lastError: row?.last_error ?? null,
      capabilities: services.flatMap((s) => s.capabilities),
      tools: Array.from(new Map(services.flatMap((s) => s.tools).map((t) => [t.name, t])).values()),
      services,
      setup: {
        envVars: cfg.requiredEnv,
        missingEnv: missingEnv(p),
        optionalEnv: cfg.optionalEnv,
        redirectUri: redirectUri(p, origin),
      },
      details: { requestedScopes: cfg.scopes, encryptionReady: hasEncryptionKey(), revocable: Boolean(cfg.revokeUrl) },
    };
  });
}

async function aiEntries(): Promise<IntegrationInfo[]> {
  const configured = isAiConfigured();
  let status: IntegrationInfo["status"] = configured ? "available" : "not_configured";
  let lastError: string | null = null;
  let models: Array<{ role: string; model: string | null; available: boolean | null }> = [];
  if (configured) {
    const report = await verifyModelAccess().catch((e: unknown) => ({ checked: false, error: e instanceof Error ? e.message : String(e), models: [] }));
    models = report.models;
    const primary = report.models.find((m) => m.role === "primary");
    if (!report.checked) { status = "error"; lastError = report.error ?? "Could not verify model access"; }
    else if (primary && primary.available === false) { status = "error"; lastError = `Configured primary model "${primary.model}" is not available to this API key`; }
    else status = "connected";
  }
  const mode = configured ? (isMockMode() ? "mock" : "anthropic") : null;
  return [
    {
      provider: "anthropic", kind: "builtin", name: "Anthropic Claude", description: "Claude models power the orchestrator and every agent; optional Voyage AI embeddings power semantic search.",
      configured, status, accountLabel: null, scopes: [], connectedAt: null, lastError,
      capabilities: ["llm.chat", "llm.tools", ...(process.env.VOYAGE_API_KEY ? ["embeddings"] : [])], tools: [],
      setup: { envVars: ["ANTHROPIC_API_KEY"], missingEnv: ["ANTHROPIC_API_KEY"].filter((k) => !process.env[k]?.trim()), optionalEnv: ["ANTHROPIC_MODEL", "ANTHROPIC_FALLBACK_MODEL", "VOYAGE_API_KEY"] },
      details: { mode, models },
    },
    {
      provider: "web_search", kind: "builtin", name: "Web search", description: "Live web search with cited sources, served by Claude's web search tool.",
      configured, status: configured ? (status === "error" ? "error" : "available") : "not_configured", accountLabel: null, scopes: [], connectedAt: null,
      lastError: status === "error" ? lastError : null,
      capabilities: ["web.search", "web.fetch"], tools: toolRefs(["web_search", "fetch_url"]),
      setup: { envVars: ["ANTHROPIC_API_KEY"], missingEnv: ["ANTHROPIC_API_KEY"].filter((k) => !process.env[k]?.trim()), optionalEnv: [] },
    },
  ];
}

async function databaseEntry(): Promise<IntegrationInfo> {
  const started = Date.now();
  let ok = false;
  let migrations = 0;
  let pgvector = false;
  try {
    const r = await queryOne<{ n: number; v: boolean }>(
      "SELECT (SELECT count(*)::int FROM schema_migrations) AS n, EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS v",
    );
    ok = true;
    migrations = r?.n ?? 0;
    pgvector = Boolean(r?.v);
  } catch { ok = false; }
  let host = "";
  try { host = new URL(process.env.DATABASE_URL ?? "").hostname; } catch { /* ignore */ }
  return {
    provider: "neon", kind: "builtin", name: host.endsWith("neon.tech") ? "Neon PostgreSQL" : "PostgreSQL",
    description: "Primary database: workspaces, tasks, approvals, audit log and vector knowledge index.",
    configured: Boolean(process.env.DATABASE_URL), status: ok ? "connected" : "error", accountLabel: null, scopes: [], connectedAt: null,
    lastError: ok ? null : "Database is unreachable",
    capabilities: ["storage", "vector_search"], tools: [],
    setup: { envVars: ["DATABASE_URL"], missingEnv: process.env.DATABASE_URL ? [] : ["DATABASE_URL"], optionalEnv: [] },
    details: { latencyMs: Date.now() - started, migrationsApplied: migrations, pgvector, managed: host.endsWith("neon.tech") },
  };
}

function webhookEntry(): IntegrationInfo {
  return {
    provider: "webhook", kind: "builtin", name: "Webhooks", description: "Send JSON to Zapier, Make, Slack, CRMs or any HTTPS endpoint — every call requires explicit approval.",
    configured: true, status: "available", accountLabel: null, scopes: [], connectedAt: null, lastError: null,
    capabilities: ["webhook.post"], tools: toolRefs(["http_post_webhook"]),
  };
}

export async function listIntegrationCatalog(workspaceId: string, origin?: string): Promise<IntegrationInfo[]> {
  const [oauth, ai, db] = await Promise.all([oauthEntries(workspaceId, origin), aiEntries(), databaseEntry()]);
  return [...oauth, ...ai, db, webhookEntry()];
}

/** Client-side mirror of GET /api/integrations (see src/lib/integrations/catalog.ts). */

export interface ToolRef { name: string; riskLevel: number }

export interface ServiceInfo {
  key: string;
  group: "communication" | "calendar" | "storage";
  capabilities: string[];
  tools: ToolRef[];
}

export type IntegrationStatus = "connected" | "disconnected" | "error" | "pending" | "available" | "not_configured";

export interface IntegrationInfo {
  provider: string;
  kind: "oauth" | "builtin";
  name: string;
  description: string;
  configured: boolean;
  status: IntegrationStatus;
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

export interface TestResult { ok: boolean; latencyMs: number; account: string | null; error?: string }

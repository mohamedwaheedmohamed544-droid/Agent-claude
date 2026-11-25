import { z } from "zod";
import { query } from "../db";
import type { ToolSpec } from "../ai/llm";
import { BUILTIN_TOOLS } from "./builtin";
import { INTEGRATION_TOOLS } from "./integration-tools";
import type { ToolDefinition } from "./types";

const ALL: ToolDefinition[] = [...BUILTIN_TOOLS, ...INTEGRATION_TOOLS];
const BY_NAME = new Map(ALL.map((t) => [t.name, t]));

export function allTools(): ToolDefinition[] {
  return ALL;
}

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

export function toolJsonSchema(t: ToolDefinition): Record<string, unknown> {
  const schema = z.toJSONSchema(t.input, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export function toolSpecs(names: string[]): ToolSpec[] {
  return names
    .map((n) => BY_NAME.get(n))
    .filter((t): t is ToolDefinition => Boolean(t))
    .map((t) => ({
      name: t.name,
      description: `${t.description} [risk level ${t.riskLevel}]`,
      input_schema: toolJsonSchema(t) as ToolSpec["input_schema"],
    }));
}

let synced = false;
/** Mirrors code-defined tools into tool_registry (the DB copy holds the enabled flag + metadata for the UI). */
export async function syncToolRegistry(force = false): Promise<void> {
  if (synced && !force) return;
  for (const t of ALL) {
    await query(
      `INSERT INTO tool_registry(name, description, risk_level, category, input_schema, output_schema, required_permissions, integration_provider)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (name) DO UPDATE SET description=EXCLUDED.description, risk_level=EXCLUDED.risk_level, category=EXCLUDED.category,
         input_schema=EXCLUDED.input_schema, output_schema=EXCLUDED.output_schema, required_permissions=EXCLUDED.required_permissions,
         integration_provider=EXCLUDED.integration_provider, updated_at=now()`,
      [t.name, t.description, t.riskLevel, t.category, toolJsonSchema(t), t.output, t.requiredPermissions, t.integration ?? null],
    );
  }
  synced = true;
}

export async function globallyEnabledTools(): Promise<Set<string>> {
  await syncToolRegistry();
  const rows = await query<{ name: string }>("SELECT name FROM tool_registry WHERE enabled");
  return new Set(rows.map((r) => r.name));
}

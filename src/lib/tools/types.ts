import type { z } from "zod";

/**
 * Risk levels (autonomy policy):
 * 1 Read      – automatic
 * 2 Prepare   – automatic (drafts, internal deliverables; no external effect)
 * 3 Modify    – approval unless workspace enables autoApproveLevel3
 * 4 External  – ALWAYS explicit approval, bound to exact parameters
 */
export type RiskLevel = 1 | 2 | 3 | 4;

export interface ToolContext {
  workspaceId: string;
  userId: string | null;
  taskId: string | null;
  stepId: string | null;
  agentSlug: string | null;
  conversationId: string | null;
  /** Stable key for external side effects (forwarded as Idempotency-Key where supported). */
  idempotencyKey?: string;
  /** Whether the calling agent may read other agents' private memory. */
  memoryAccess?: "own" | "shared";
}

export interface ApprovalPreview {
  /** One-line human readable description of exactly what will happen. */
  summary: string;
  /** Where the effect lands (email recipient, URL, calendar, record id…). */
  destination?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous tool registry
export interface ToolDefinition<I = any> {
  name: string;
  description: string;
  category: "knowledge" | "memory" | "web" | "documents" | "data" | "operations" | "communication" | "integration";
  riskLevel: RiskLevel;
  input: z.ZodType<I>;
  /** Human-readable description of the output shape (stored in tool_registry.output_schema). */
  output: Record<string, unknown>;
  requiredPermissions: string[];
  /** Integration provider that must be connected (e.g. 'google', 'microsoft'). */
  integration?: string;
  timeoutMs?: number;
  preview?: (input: I) => ApprovalPreview;
  handler: (input: I, ctx: ToolContext) => Promise<unknown>;
}

export function defineTool<I>(t: ToolDefinition<I>): ToolDefinition<I> {
  return t;
}

/** Errors a tool can raise to give the model actionable feedback without failing the step. */
export class ToolUserError extends Error {}

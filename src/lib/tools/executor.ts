import { ZodError } from "zod";
import { query, queryOne, transaction } from "../db";
import { audit } from "../audit";
import { getWorkspaceSettings } from "../settings";
import { canonicalJson, redactSecrets, sha256 } from "../security/crypto";
import { getTool, globallyEnabledTools } from "./registry";
import { ToolUserError, type ToolContext } from "./types";

export class ApprovalRequiredError extends Error {
  constructor(public approvalId: string, public toolName: string) {
    super(`Approval required for ${toolName}`);
  }
}
export class EmergencyStopError extends Error {
  constructor() { super("Emergency stop is active"); }
}

export type ToolOutcome =
  | { status: "ok"; output: unknown; executionId: string }
  | { status: "error"; error: string; executionId?: string }
  | { status: "blocked"; error: string }
  | { status: "rejected"; error: string };

export function approvalHash(toolName: string, input: unknown): string {
  return sha256(canonicalJson({ tool: toolName, params: input }));
}

/** Policy decision for a tool given workspace settings. Exported for tests. */
export function requiresApproval(riskLevel: number, autoApproveLevel3: boolean): boolean {
  if (riskLevel >= 4) return true;
  if (riskLevel === 3) return !autoApproveLevel3;
  return false;
}

function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`Tool ${name} timed out after ${ms}ms`)), ms); }),
  ]);
}

async function integrationConnected(workspaceId: string, providers: string): Promise<boolean> {
  const list = providers.split("|");
  const row = await queryOne("SELECT 1 FROM integrations WHERE workspace_id=$1 AND provider = ANY($2) AND status='connected'", [workspaceId, list]);
  return Boolean(row);
}

/**
 * The single choke point for every tool call by every agent. Enforces, in order:
 * tool exists → agent allow-list → emergency stop → global/workspace enablement →
 * input validation → integration connected → approval policy (bound to exact params) →
 * idempotency → execution with timeout → logging & audit.
 */
export interface AgentToolPolicy {
  /** Require approval for level-3 actions even if the workspace auto-approves them. */
  alwaysApproveModify?: boolean;
  /** Re-checked on every call (defence in depth; the runtime factory already filters tools). */
  maxRiskLevel?: number;
  restrictedCategories?: string[];
  memoryAccess?: "own" | "shared";
}

export async function executeTool(
  name: string, rawArgs: unknown, ctx: ToolContext, allowedTools: string[], policy: AgentToolPolicy = {},
): Promise<ToolOutcome> {
  const tool = getTool(name);
  if (!tool) return { status: "blocked", error: `Unknown tool "${name}"` };
  const denial = !allowedTools.includes(name) ? "not_allowed_for_agent"
    : policy.maxRiskLevel !== undefined && tool.riskLevel > policy.maxRiskLevel ? "above_agent_risk_ceiling"
    : policy.restrictedCategories?.includes(tool.category) ? "restricted_category" : null;
  if (denial) {
    await audit({ workspaceId: ctx.workspaceId, actorType: "agent", actor: ctx.agentSlug, action: "tool.blocked", targetType: "tool", targetId: name, metadata: { reason: denial, taskId: ctx.taskId } });
    return { status: "blocked", error: `Tool "${name}" is not permitted for this agent (${denial.replace(/_/g, " ")})` };
  }
  const settings = await getWorkspaceSettings(ctx.workspaceId);
  if (settings.emergencyStop) throw new EmergencyStopError();
  if (settings.disabledTools.includes(name) || !(await globallyEnabledTools()).has(name)) {
    return { status: "blocked", error: `Tool "${name}" is disabled in this workspace` };
  }

  let input: unknown;
  try {
    input = tool.input.parse(rawArgs);
  } catch (e) {
    const msg = e instanceof ZodError ? e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") : "invalid input";
    return { status: "error", error: `Invalid arguments: ${msg}` };
  }

  if (tool.integration && !(await integrationConnected(ctx.workspaceId, tool.integration))) {
    return { status: "blocked", error: `The ${tool.integration.replace("|", " or ")} integration is not connected. Ask the user to connect it under Integrations; do not attempt the action another way.` };
  }

  const hash = approvalHash(name, input);
  const idempotencyKey = tool.riskLevel >= 3 ? sha256(`${ctx.workspaceId}|${ctx.taskId}|${ctx.stepId}|${hash}`) : undefined;
  let approvalId: string | null = null;

  if (requiresApproval(tool.riskLevel, settings.autoApproveLevel3 && !policy.alwaysApproveModify)) {
    if (!ctx.stepId || !ctx.taskId) return { status: "blocked", error: "Actions requiring approval can only run inside a task" };
    const decision = await transaction(async (c) => {
      const existing = await queryOne<{ id: string; status: string }>(
        `SELECT id, status FROM approvals WHERE step_id=$1 AND params_hash=$2 AND status IN ('pending','approved','rejected','executed')
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [ctx.stepId, hash], c,
      );
      if (existing?.status === "approved") {
        // Atomically claim the approval so it can be used exactly once.
        await query("UPDATE approvals SET status='executed', executed_at=now() WHERE id=$1", [existing.id], c);
        return { kind: "execute" as const, id: existing.id };
      }
      if (existing?.status === "executed") return { kind: "already" as const, id: existing.id };
      if (existing?.status === "rejected") return { kind: "rejected" as const, id: existing.id };
      if (existing?.status === "pending") return { kind: "pending" as const, id: existing.id };
      // Parameters differ from any earlier request → earlier pending approvals for this step are superseded.
      await query("UPDATE approvals SET status='superseded', decided_at=now() WHERE step_id=$1 AND status='pending'", [ctx.stepId], c);
      const pv = tool.preview?.(input) ?? { summary: `${tool.name} with ${canonicalJson(input).slice(0, 300)}` };
      const created = await queryOne<{ id: string }>(
        `INSERT INTO approvals(workspace_id, task_id, step_id, tool_name, risk_level, agent_slug, summary, destination, params, params_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [ctx.workspaceId, ctx.taskId, ctx.stepId, name, tool.riskLevel, ctx.agentSlug, redactSecrets(pv.summary).slice(0, 1000), pv.destination ?? null, input, hash], c,
      );
      return { kind: "created" as const, id: created!.id };
    });
    if (decision.kind === "rejected") {
      return { status: "rejected", error: "The user REJECTED this exact action. Do not retry it or achieve the same effect another way. Report that it was not performed." };
    }
    if (decision.kind === "pending" || decision.kind === "created") {
      if (decision.kind === "created") {
        await query(
          `INSERT INTO tool_executions(workspace_id, task_id, step_id, tool_name, agent_slug, risk_level, input, status, approval_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'awaiting_approval',$8)`,
          [ctx.workspaceId, ctx.taskId, ctx.stepId, name, ctx.agentSlug, tool.riskLevel, input, decision.id],
        );
        await audit({ workspaceId: ctx.workspaceId, actorType: "agent", actor: ctx.agentSlug, action: "approval.requested", targetType: "approval", targetId: decision.id, metadata: { tool: name, riskLevel: tool.riskLevel, taskId: ctx.taskId } });
      }
      throw new ApprovalRequiredError(decision.id, name);
    }
    approvalId = decision.id;
    if (decision.kind === "already") {
      const prior = await queryOne<{ id: string; output: unknown }>(
        "SELECT id, output FROM tool_executions WHERE idempotency_key=$1 AND status='succeeded' LIMIT 1", [idempotencyKey],
      );
      if (prior) return { status: "ok", output: prior.output, executionId: prior.id };
      return { status: "error", error: "This approved action was already attempted. Request a new approval if it must be retried." };
    }
  }

  // Idempotency: never repeat a succeeded side effect.
  if (idempotencyKey) {
    const prior = await queryOne<{ id: string; output: unknown }>(
      "SELECT id, output FROM tool_executions WHERE idempotency_key=$1 AND status='succeeded' LIMIT 1", [idempotencyKey],
    );
    if (prior) return { status: "ok", output: prior.output, executionId: prior.id };
  }

  const exec = await queryOne<{ id: string }>(
    `INSERT INTO tool_executions(workspace_id, task_id, step_id, tool_name, agent_slug, risk_level, input, status, approval_id, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'running',$8,$9) RETURNING id`,
    [ctx.workspaceId, ctx.taskId, ctx.stepId, name, ctx.agentSlug, tool.riskLevel, input, approvalId, idempotencyKey ?? null],
  );
  const started = Date.now();
  try {
    const output = await withTimeout(tool.handler(input, { ...ctx, idempotencyKey, memoryAccess: policy.memoryAccess ?? "own" }), tool.timeoutMs ?? 45_000, name);
    const safeOutput = JSON.parse(redactSecrets(JSON.stringify(output ?? null)));
    await query("UPDATE tool_executions SET status='succeeded', output=$2, duration_ms=$3 WHERE id=$1", [exec!.id, safeOutput, Date.now() - started]);
    if (tool.riskLevel >= 3) {
      await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, actorType: "agent", actor: ctx.agentSlug, action: "tool.executed", targetType: "tool", targetId: name, metadata: { riskLevel: tool.riskLevel, approvalId, taskId: ctx.taskId, executionId: exec!.id } });
    }
    return { status: "ok", output: safeOutput, executionId: exec!.id };
  } catch (e) {
    const msg = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 1000);
    await query("UPDATE tool_executions SET status='failed', error=$2, duration_ms=$3 WHERE id=$1", [exec!.id, msg, Date.now() - started]);
    if (approvalId) {
      // Release the approval so the same exact action can be retried without re-prompting.
      await query("UPDATE approvals SET status='approved', executed_at=NULL WHERE id=$1 AND status='executed'", [approvalId]);
    }
    if (tool.riskLevel >= 3) {
      await audit({ workspaceId: ctx.workspaceId, actorType: "agent", actor: ctx.agentSlug, action: "tool.failed", targetType: "tool", targetId: name, metadata: { error: msg, taskId: ctx.taskId } });
    }
    return { status: "error", error: e instanceof ToolUserError ? msg : `Tool failed: ${msg}`, executionId: exec!.id };
  }
}

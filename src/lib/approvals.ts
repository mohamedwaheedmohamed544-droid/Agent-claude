import { query, queryOne } from "./db";
import { audit } from "./audit";
import { AppError, conflict, forbidden, notFound } from "./errors";
import { hasRole } from "./api";
import type { Role } from "./auth/session";
import { approvalHash } from "./tools/executor";
import { onApprovalDecided } from "./orchestrator/engine";

export interface ApprovalRow {
  id: string;
  taskId: string | null;
  stepId: string | null;
  toolName: string;
  riskLevel: number;
  agentSlug: string | null;
  summary: string;
  destination: string | null;
  params: Record<string, unknown>;
  paramsHash: string;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string;
  createdAt: string;
  taskTitle: string | null;
  taskCreatedBy: string | null;
}

const COLS = `a.id, a.task_id AS "taskId", a.step_id AS "stepId", a.tool_name AS "toolName", a.risk_level AS "riskLevel",
  a.agent_slug AS "agentSlug", a.summary, a.destination, a.params, a.params_hash AS "paramsHash", a.status,
  a.decided_by AS "decidedBy", a.decided_at AS "decidedAt", a.decision_note AS "decisionNote", a.expires_at AS "expiresAt",
  a.created_at AS "createdAt", t.title AS "taskTitle", t.created_by AS "taskCreatedBy"`;

export async function listApprovals(workspaceId: string, status?: string, taskId?: string): Promise<ApprovalRow[]> {
  await query("UPDATE approvals SET status='expired' WHERE workspace_id=$1 AND status='pending' AND expires_at < now()", [workspaceId]);
  return query<ApprovalRow>(
    `SELECT ${COLS} FROM approvals a LEFT JOIN tasks t ON t.id = a.task_id
      WHERE a.workspace_id=$1 AND ($2::text IS NULL OR a.status=$2) AND ($3::uuid IS NULL OR a.task_id=$3)
      ORDER BY a.created_at DESC LIMIT 200`,
    [workspaceId, status ?? null, taskId ?? null],
  );
}

/**
 * Approve or reject a pending action. The caller must echo the params_hash they reviewed:
 * if the stored parameters differ in any way from what was displayed, the decision is refused.
 * Level 4 approvals require the task owner or a workspace admin.
 */
export async function decideApproval(p: {
  workspaceId: string; approvalId: string; userId: string; role: Role; decision: "approve" | "reject"; paramsHash: string; note?: string; ip?: string;
}): Promise<ApprovalRow> {
  const a = await queryOne<ApprovalRow>(`SELECT ${COLS} FROM approvals a LEFT JOIN tasks t ON t.id=a.task_id WHERE a.id=$1 AND a.workspace_id=$2`, [p.approvalId, p.workspaceId]);
  if (!a) throw notFound("Approval not found");
  if (a.status !== "pending") throw conflict(`This approval is already ${a.status}`);
  if (new Date(a.expiresAt).getTime() < Date.now()) {
    await query("UPDATE approvals SET status='expired' WHERE id=$1", [a.id]);
    throw conflict("This approval has expired");
  }
  if (!hasRole(p.role, "member")) throw forbidden("Viewers cannot decide approvals");
  const isOwner = a.taskCreatedBy === p.userId;
  if (!isOwner && !hasRole(p.role, "admin")) throw forbidden("Only the task owner or a workspace admin can decide this approval");
  // Integrity: the stored hash must match the stored params, and the reviewer must have seen this exact hash.
  if (approvalHash(a.toolName, a.params) !== a.paramsHash) throw new AppError(409, "integrity_error", "Approval parameters failed integrity check");
  if (p.paramsHash !== a.paramsHash) throw new AppError(409, "params_changed", "The action changed since you reviewed it. Please review it again.");

  const status = p.decision === "approve" ? "approved" : "rejected";
  const updated = await queryOne<{ id: string }>(
    `UPDATE approvals SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1 AND status='pending' RETURNING id`,
    [a.id, status, p.userId, p.note?.slice(0, 1000) ?? null],
  );
  if (!updated) throw conflict("This approval was decided concurrently");
  await audit({
    workspaceId: p.workspaceId, userId: p.userId, actorType: "user", action: `approval.${status}`, targetType: "approval", targetId: a.id,
    metadata: { tool: a.toolName, riskLevel: a.riskLevel, destination: a.destination, taskId: a.taskId, paramsHash: a.paramsHash }, ip: p.ip,
  });
  await onApprovalDecided(p.workspaceId, a.id);
  return (await queryOne<ApprovalRow>(`SELECT ${COLS} FROM approvals a LEFT JOIN tasks t ON t.id=a.task_id WHERE a.id=$1`, [a.id]))!;
}

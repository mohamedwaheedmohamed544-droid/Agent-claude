import { query, type Queryable } from "./db";
import { redactSecrets } from "./security/crypto";

export interface AuditEntry {
  workspaceId?: string | null;
  userId?: string | null;
  actorType: "user" | "agent" | "system";
  actor?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(e: AuditEntry, client?: Queryable): Promise<void> {
  const meta = e.metadata ? JSON.parse(redactSecrets(JSON.stringify(e.metadata))) : {};
  await query(
    `INSERT INTO audit_logs(workspace_id, user_id, actor_type, actor, action, target_type, target_id, metadata, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [e.workspaceId ?? null, e.userId ?? null, e.actorType, e.actor ?? null, e.action, e.targetType ?? null, e.targetId ?? null, meta, e.ip ?? null],
    client,
  ).catch((err) => console.error("[audit] failed to write", e.action, err.message));
}

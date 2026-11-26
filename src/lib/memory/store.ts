import { query, queryOne, toVector } from "../db";
import { embed } from "../ai/llm";
import { badRequest } from "../errors";
import { containsSecret } from "../security/crypto";

export type MemoryScope = "user" | "workspace" | "task" | "agent";
export type MemoryKind = "preference" | "fact" | "decision" | "context" | "workflow" | "note";

export interface MemoryItem {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  source: "user" | "agent" | "system";
  status: "active" | "proposed" | "archived";
  importance: number;
  userId: string | null;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
  score?: number;
}

const COLS = `id, scope, kind, content, source, status, importance, user_id AS "userId", task_id AS "taskId",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export interface NewMemory {
  workspaceId: string;
  scope: MemoryScope;
  kind?: MemoryKind;
  content: string;
  source: "user" | "agent" | "system";
  status?: "active" | "proposed";
  importance?: number;
  userId?: string | null;
  taskId?: string | null;
  agentSlug?: string | null;
  createdBy?: string | null;
}

/** Memory never stores secrets: content that looks like a credential is rejected. */
export async function addMemory(m: NewMemory): Promise<MemoryItem> {
  const content = m.content.trim();
  if (!content) throw badRequest("Memory content is empty");
  if (content.length > 4000) throw badRequest("Memory content is too long (max 4000 characters)");
  if (containsSecret(content)) throw badRequest("Memory content appears to contain a secret or credential and was not stored");
  if (m.scope === "user" && !m.userId) throw badRequest("User-scoped memory requires a user");
  if (m.scope === "task" && !m.taskId) throw badRequest("Task-scoped memory requires a task");
  if (m.scope === "agent" && !m.agentSlug) throw badRequest("Agent-scoped memory requires an agent");

  let vector: string | null = null;
  let model: string | null = null;
  try {
    const r = await embed([content], { workspaceId: m.workspaceId, userId: m.userId, taskId: m.taskId, purpose: "memory_embedding" });
    vector = toVector(r.vectors[0]);
    model = r.model;
  } catch (e) {
    console.warn("[memory] embedding unavailable, storing without vector:", (e as Error).message);
  }
  const row = await queryOne<MemoryItem>(
    `INSERT INTO memory_items(workspace_id, user_id, task_id, scope, kind, content, source, status, importance, embedding, embedding_model, created_by, agent_slug)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector,$11,$12,$13) RETURNING ${COLS}`,
    [m.workspaceId, m.scope === "user" ? m.userId : null, m.taskId ?? null, m.scope, m.kind ?? "fact", content, m.source,
      m.status ?? "active", m.importance ?? 0.5, vector, model, m.createdBy ?? null, m.scope === "agent" ? m.agentSlug : null],
  );
  return row!;
}

/**
 * Retrieves relevant ACTIVE memories visible to a user: their own user-scoped memories plus
 * workspace memories (and task memories when a taskId is provided).
 */
export interface MemorySearchOptions {
  limit?: number;
  taskId?: string | null;
  /** Calling agent (enables its private memory). */
  agentSlug?: string | null;
  includeWorkspace?: boolean;
  includeOwnAgent?: boolean;
  /** Only for agents granted memoryAccess "shared". */
  includeOtherAgents?: boolean;
}

/**
 * Retrieves relevant ACTIVE memories visible to a user/agent: the user's own memories, workspace
 * memories, task memories for the current task, the agent's own private memories and — only when
 * the agent has shared memory access — other agents' private memories.
 */
export async function searchMemory(workspaceId: string, userId: string | null, q: string, opts: MemorySearchOptions = {}): Promise<MemoryItem[]> {
  const limit = Math.min(opts.limit ?? 6, 20);
  const visibility = `workspace_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at > now())
    AND ((scope='workspace' AND $5) OR (scope='user' AND user_id=$2) OR (scope='task' AND task_id=$3)
         OR (scope='agent' AND ((agent_slug=$4 AND $6) OR ($7 AND $4::text IS NOT NULL))))`;
  const base = [workspaceId, userId, opts.taskId ?? null, opts.agentSlug ?? null, opts.includeWorkspace !== false, opts.includeOwnAgent !== false, Boolean(opts.includeOtherAgents)];
  const n = base.length;
  try {
    const any = await queryOne("SELECT 1 FROM memory_items WHERE workspace_id=$1 AND embedding IS NOT NULL LIMIT 1", [workspaceId]);
    if (any && q.trim()) {
      const { vectors } = await embed([q], { workspaceId, userId, purpose: "memory_retrieval" }, "query");
      return await query<MemoryItem>(
        `SELECT ${COLS}, (1 - (embedding <=> $${n + 1}::vector)) * 0.8 + importance * 0.2 AS score
           FROM memory_items WHERE ${visibility} AND embedding IS NOT NULL
          ORDER BY score DESC LIMIT ${limit}`,
        [...base, toVector(vectors[0])],
      );
    }
  } catch (e) {
    console.warn("[memory] vector retrieval unavailable:", (e as Error).message);
  }
  const terms = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2).slice(0, 8);
  return query<MemoryItem>(
    `SELECT ${COLS}, importance AS score FROM memory_items WHERE ${visibility}
       ${terms.length ? `AND (${terms.map((_, i) => `content ILIKE $${i + n + 1}`).join(" OR ")})` : ""}
      ORDER BY importance DESC, updated_at DESC LIMIT ${limit}`,
    [...base, ...terms.map((t) => `%${t}%`)],
  );
}

export async function listMemory(
  workspaceId: string, userId: string, filter: { scope?: MemoryScope; status?: string } = {},
): Promise<MemoryItem[]> {
  const params: unknown[] = [workspaceId, userId];
  let where = "workspace_id=$1 AND (scope<>'user' OR user_id=$2)";
  if (filter.scope) { params.push(filter.scope); where += ` AND scope=$${params.length}`; }
  if (filter.status) { params.push(filter.status); where += ` AND status=$${params.length}`; }
  return query<MemoryItem>(`SELECT ${COLS} FROM memory_items WHERE ${where} ORDER BY updated_at DESC LIMIT 500`, params);
}

export async function updateMemory(
  workspaceId: string, userId: string, id: string,
  patch: { content?: string; status?: "active" | "archived"; importance?: number; kind?: MemoryKind },
): Promise<MemoryItem | null> {
  if (patch.content !== undefined && containsSecret(patch.content)) throw badRequest("Memory content appears to contain a secret");
  let vector: string | null = null;
  if (patch.content) {
    try { vector = toVector((await embed([patch.content], { workspaceId, userId, purpose: "memory_embedding" })).vectors[0]); } catch { /* keep old */ }
  }
  return queryOne<MemoryItem>(
    `UPDATE memory_items SET content=COALESCE($4,content), status=COALESCE($5,status), importance=COALESCE($6,importance),
            kind=COALESCE($7,kind), embedding=COALESCE($8::vector, embedding), updated_at=now()
      WHERE id=$3 AND workspace_id=$1 AND (scope<>'user' OR user_id=$2) RETURNING ${COLS}`,
    [workspaceId, userId, id, patch.content ?? null, patch.status ?? null, patch.importance ?? null, patch.kind ?? null, vector],
  );
}

export async function deleteMemory(workspaceId: string, userId: string, id: string): Promise<boolean> {
  const rows = await query("DELETE FROM memory_items WHERE id=$3 AND workspace_id=$1 AND (scope<>'user' OR user_id=$2) RETURNING id", [workspaceId, userId, id]);
  return rows.length > 0;
}

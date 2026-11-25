import { query, queryOne, transaction } from "../db";
import { conflict, notFound } from "../errors";
import { isUuid } from "./store";

/** Knowledge bases: named collections of files within a workspace. */

export interface KnowledgeBaseDTO {
  id: string;
  name: string;
  description: string | null;
  fileCount: number;
  readyCount: number;
  chunkCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
}

interface BaseRow {
  id: string;
  name: string;
  description: string | null;
  file_count: string | number;
  ready_count: string | number;
  chunk_count: string | number;
  total_bytes: string | number;
  created_at: Date;
  updated_at: Date;
}

const BASE_SELECT = `
  SELECT b.id, b.name, b.description, b.created_at, b.updated_at,
         count(f.id) AS file_count,
         count(f.id) FILTER (WHERE f.status = 'ready') AS ready_count,
         COALESCE(sum(f.chunk_count), 0) AS chunk_count,
         COALESCE(sum(f.size_bytes), 0) AS total_bytes
    FROM knowledge_bases b
    LEFT JOIN knowledge_files f ON f.knowledge_base_id = b.id AND f.workspace_id = b.workspace_id`;

function toDTO(r: BaseRow): KnowledgeBaseDTO {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    fileCount: Number(r.file_count),
    readyCount: Number(r.ready_count),
    chunkCount: Number(r.chunk_count),
    totalBytes: Number(r.total_bytes),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export interface UnassignedSummary { fileCount: number; chunkCount: number }

export async function listBases(workspaceId: string): Promise<{ bases: KnowledgeBaseDTO[]; unassigned: UnassignedSummary }> {
  const [rows, un] = await Promise.all([
    query<BaseRow>(`${BASE_SELECT} WHERE b.workspace_id = $1 GROUP BY b.id ORDER BY b.created_at, b.name`, [workspaceId]),
    queryOne<{ n: string; c: string }>(
      "SELECT count(*) AS n, COALESCE(sum(chunk_count),0) AS c FROM knowledge_files WHERE workspace_id=$1 AND knowledge_base_id IS NULL", [workspaceId],
    ),
  ]);
  return { bases: rows.map(toDTO), unassigned: { fileCount: Number(un?.n ?? 0), chunkCount: Number(un?.c ?? 0) } };
}

export async function getBase(workspaceId: string, id: string): Promise<KnowledgeBaseDTO | null> {
  if (!isUuid(id)) return null;
  const r = await queryOne<BaseRow>(`${BASE_SELECT} WHERE b.workspace_id = $1 AND b.id = $2 GROUP BY b.id`, [workspaceId, id]);
  return r ? toDTO(r) : null;
}

async function assertUniqueName(workspaceId: string, name: string, exceptId?: string) {
  const dup = await queryOne(
    "SELECT 1 FROM knowledge_bases WHERE workspace_id=$1 AND lower(name)=lower($2) AND ($3::uuid IS NULL OR id <> $3)",
    [workspaceId, name, exceptId ?? null],
  );
  if (dup) throw conflict("A knowledge base with this name already exists");
}

export async function createBase(workspaceId: string, userId: string, input: { name: string; description?: string | null }): Promise<KnowledgeBaseDTO> {
  await assertUniqueName(workspaceId, input.name);
  const r = await queryOne<{ id: string }>(
    "INSERT INTO knowledge_bases(workspace_id, name, description, created_by) VALUES ($1,$2,$3,$4) RETURNING id",
    [workspaceId, input.name, input.description || null, userId],
  );
  return (await getBase(workspaceId, r!.id))!;
}

export async function updateBase(workspaceId: string, id: string, patch: { name?: string; description?: string | null }): Promise<KnowledgeBaseDTO> {
  if (!(await getBase(workspaceId, id))) throw notFound("Knowledge base not found");
  if (patch.name !== undefined) await assertUniqueName(workspaceId, patch.name, id);
  await query(
    `UPDATE knowledge_bases SET
        name = COALESCE($3, name),
        description = CASE WHEN $4::boolean THEN $5 ELSE description END,
        updated_at = now()
      WHERE workspace_id=$1 AND id=$2`,
    [workspaceId, id, patch.name ?? null, patch.description !== undefined, patch.description || null],
  );
  return (await getBase(workspaceId, id))!;
}

/** Deletes a base but keeps its files: they become unassigned. Returns the number of files detached. */
export async function deleteBase(workspaceId: string, id: string): Promise<{ name: string; detachedFiles: number }> {
  if (!isUuid(id)) throw notFound("Knowledge base not found");
  return transaction(async (c) => {
    const base = await queryOne<{ name: string }>("SELECT name FROM knowledge_bases WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, id], c);
    if (!base) throw notFound("Knowledge base not found");
    const detached = await c.query(
      "UPDATE knowledge_files SET knowledge_base_id=NULL, updated_at=now() WHERE workspace_id=$1 AND knowledge_base_id=$2", [workspaceId, id],
    );
    await c.query("DELETE FROM knowledge_bases WHERE workspace_id=$1 AND id=$2", [workspaceId, id]);
    return { name: base.name, detachedFiles: detached.rowCount ?? 0 };
  });
}

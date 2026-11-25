import { query, queryOne, type Queryable } from "../db";
import { notFound } from "../errors";

/** Data access for knowledge files. Every statement is scoped by workspace_id. */

export type FileStatus = "pending" | "processing" | "ready" | "failed";
export const FILE_STATUSES: FileStatus[] = ["pending", "processing", "ready", "failed"];

export interface FileDTO {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: FileStatus;
  chunkCount: number;
  /** Failure reason, or a non-fatal note prefixed with "warning:". */
  error: string | null;
  knowledgeBaseId: string | null;
  knowledgeBaseName: string | null;
  conversationId: string | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FileRow {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: FileStatus;
  chunk_count: number;
  error: string | null;
  knowledge_base_id: string | null;
  knowledge_base_name: string | null;
  conversation_id: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

const FILE_SELECT = `
  SELECT f.id, f.filename, f.mime_type, f.size_bytes, f.status, f.chunk_count, f.error, f.knowledge_base_id,
         b.name AS knowledge_base_name, f.conversation_id, f.uploaded_by, u.name AS uploaded_by_name, f.created_at, f.updated_at
    FROM knowledge_files f
    LEFT JOIN knowledge_bases b ON b.id = f.knowledge_base_id AND b.workspace_id = f.workspace_id
    LEFT JOIN users u ON u.id = f.uploaded_by`;

function toDTO(r: FileRow): FileDTO {
  return {
    id: r.id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    status: r.status,
    chunkCount: Number(r.chunk_count),
    error: r.error,
    knowledgeBaseId: r.knowledge_base_id,
    knowledgeBaseName: r.knowledge_base_name,
    conversationId: r.conversation_id,
    uploadedBy: r.uploaded_by,
    uploadedByName: r.uploaded_by_name,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export async function getFile(workspaceId: string, fileId: string, client?: Queryable): Promise<FileDTO | null> {
  if (!isUuid(fileId)) return null;
  const r = await queryOne<FileRow>(`${FILE_SELECT} WHERE f.workspace_id = $1 AND f.id = $2`, [workspaceId, fileId], client);
  return r ? toDTO(r) : null;
}

export async function requireFile(workspaceId: string, fileId: string): Promise<FileDTO> {
  const f = await getFile(workspaceId, fileId);
  if (!f) throw notFound("File not found");
  return f;
}

export interface ListFilesFilter {
  /** A base id, or "none" for files not in any base. */
  knowledgeBaseId?: string | null;
  q?: string | null;
  status?: string | null;
  conversationId?: string | null;
  limit?: number;
}

export async function listFiles(workspaceId: string, filter: ListFilesFilter = {}): Promise<FileDTO[]> {
  const where = ["f.workspace_id = $1"];
  const params: unknown[] = [workspaceId];
  if (filter.knowledgeBaseId === "none") where.push("f.knowledge_base_id IS NULL");
  else if (filter.knowledgeBaseId) {
    if (!isUuid(filter.knowledgeBaseId)) return [];
    params.push(filter.knowledgeBaseId);
    where.push(`f.knowledge_base_id = $${params.length}`);
  }
  if (filter.conversationId) {
    if (!isUuid(filter.conversationId)) return [];
    params.push(filter.conversationId);
    where.push(`f.conversation_id = $${params.length}`);
  }
  if (filter.status && (FILE_STATUSES as string[]).includes(filter.status)) {
    params.push(filter.status);
    where.push(`f.status = $${params.length}`);
  }
  const q = filter.q?.trim().slice(0, 200);
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where.push(`f.filename ILIKE $${params.length}`);
  }
  const limit = Math.min(Math.max(filter.limit ?? 500, 1), 1000);
  const rows = await query<FileRow>(`${FILE_SELECT} WHERE ${where.join(" AND ")} ORDER BY f.created_at DESC LIMIT ${limit}`, params);
  return rows.map(toDTO);
}

export interface ChunkPreview {
  index: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
  content: string;
}

export interface FileDetail {
  file: FileDTO;
  preview: string;
  previewTruncated: boolean;
  textLength: number;
  chunks: ChunkPreview[];
}

export async function getFileDetail(workspaceId: string, fileId: string, opts: { previewChars?: number; maxChunks?: number } = {}): Promise<FileDetail> {
  const file = await requireFile(workspaceId, fileId);
  const previewChars = opts.previewChars ?? 5000;
  const [text] = await query<{ preview: string | null; len: number | null }>(
    "SELECT left(extracted_text, $3) AS preview, char_length(extracted_text) AS len FROM knowledge_files WHERE workspace_id=$1 AND id=$2",
    [workspaceId, fileId, previewChars],
  );
  const chunks = await query<{ chunk_index: number; token_count: number; metadata: Record<string, unknown>; content: string }>(
    `SELECT chunk_index, token_count, metadata, left(content, 300) AS content
       FROM document_chunks WHERE workspace_id=$1 AND file_id=$2 ORDER BY chunk_index LIMIT $3`,
    [workspaceId, fileId, opts.maxChunks ?? 500],
  );
  const len = Number(text?.len ?? 0);
  return {
    file,
    preview: text?.preview ?? "",
    previewTruncated: len > previewChars,
    textLength: len,
    chunks: chunks.map((c) => ({ index: c.chunk_index, tokenCount: c.token_count, metadata: c.metadata ?? {}, content: c.content })),
  };
}

export async function getFileContent(workspaceId: string, fileId: string): Promise<{ filename: string; mimeType: string; content: Buffer } | null> {
  if (!isUuid(fileId)) return null;
  const r = await queryOne<{ filename: string; mime_type: string; content: Buffer }>(
    "SELECT filename, mime_type, content FROM knowledge_files WHERE workspace_id=$1 AND id=$2", [workspaceId, fileId],
  );
  return r ? { filename: r.filename, mimeType: r.mime_type, content: r.content } : null;
}

/** Deletes a file; its chunks and embeddings cascade. Returns the deleted filename, or null if absent. */
export async function deleteFile(workspaceId: string, fileId: string): Promise<{ filename: string } | null> {
  if (!isUuid(fileId)) return null;
  return queryOne<{ filename: string }>(
    "DELETE FROM knowledge_files WHERE workspace_id=$1 AND id=$2 RETURNING filename", [workspaceId, fileId],
  );
}

export async function assertKnowledgeBase(workspaceId: string, baseId: string, client?: Queryable): Promise<void> {
  const ok = isUuid(baseId) && (await queryOne("SELECT 1 FROM knowledge_bases WHERE workspace_id=$1 AND id=$2", [workspaceId, baseId], client));
  if (!ok) throw notFound("Knowledge base not found");
}

export async function moveFile(workspaceId: string, fileId: string, knowledgeBaseId: string | null): Promise<FileDTO> {
  if (knowledgeBaseId) await assertKnowledgeBase(workspaceId, knowledgeBaseId);
  const r = isUuid(fileId)
    ? await queryOne(
      "UPDATE knowledge_files SET knowledge_base_id=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING id",
      [workspaceId, fileId, knowledgeBaseId],
    )
    : null;
  if (!r) throw notFound("File not found");
  return requireFile(workspaceId, fileId);
}

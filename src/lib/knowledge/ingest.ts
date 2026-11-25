import { query, queryOne, toVector, transaction } from "../db";
import { AppError, conflict, notFound } from "../errors";
import { embed, isMockMode } from "../ai/llm";
import { redactSecrets, sha256 } from "../security/crypto";
import { chunkSections, type Chunk } from "./chunker";
import { MAX_EXTRACTED_CHARS, ParseError, parseDocument } from "./parsers";
import { assertKnowledgeBase, getFile, isUuid, type FileDTO } from "./store";
import { kindOf, validateUpload } from "./validation";

/**
 * Ingestion pipeline: validate → store (processing) → extract → chunk → embed → ready.
 * Runs synchronously within the request so it works on serverless hosts without a queue.
 */

const EMBED_BATCH = 64;
/** A "processing" row older than this is assumed to belong to a crashed invocation. */
const STALE_PROCESSING_MINUTES = 10;

export interface UploadInput {
  workspaceId: string;
  userId: string;
  filename: string;
  bytes: Buffer;
  knowledgeBaseId?: string | null;
  conversationId?: string | null;
}

export interface UploadResult {
  file: FileDTO;
  duplicate: boolean;
}

export async function ingestUpload(input: UploadInput): Promise<UploadResult> {
  const v = await validateUpload(input.filename, input.bytes);
  const hash = sha256(input.bytes);
  const kbId = input.knowledgeBaseId || null;
  const convId = input.conversationId || null;
  if (kbId) await assertKnowledgeBase(input.workspaceId, kbId);
  if (convId) {
    const ok = isUuid(convId) && await queryOne(
      "SELECT 1 FROM conversations WHERE id=$1 AND workspace_id=$2 AND user_id=$3", [convId, input.workspaceId, input.userId],
    );
    if (!ok) throw notFound("Conversation not found");
  }

  // Serialise identical uploads within a workspace so concurrent requests cannot create duplicates.
  const outcome = await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`kf:${input.workspaceId}:${hash}`]);
    const existing = await queryOne<{ id: string; status: string; knowledge_base_id: string | null; updated_at: Date }>(
      "SELECT id, status, knowledge_base_id, updated_at FROM knowledge_files WHERE workspace_id=$1 AND sha256=$2 ORDER BY created_at LIMIT 1",
      [input.workspaceId, hash], c,
    );
    if (existing) {
      // Uploading a known file into a base files the existing copy there if it is not filed yet.
      if (kbId && !existing.knowledge_base_id) {
        await c.query("UPDATE knowledge_files SET knowledge_base_id=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2", [input.workspaceId, existing.id, kbId]);
      }
      return { id: existing.id, duplicate: true, retry: existing.status === "failed" };
    }
    const row = await queryOne<{ id: string }>(
      `INSERT INTO knowledge_files(workspace_id, knowledge_base_id, conversation_id, filename, mime_type, size_bytes, sha256, content, status, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'processing',$9) RETURNING id`,
      [input.workspaceId, kbId, convId, v.filename, v.mimeType, input.bytes.length, hash, input.bytes, input.userId], c,
    );
    return { id: row!.id, duplicate: false, retry: false };
  });

  if (!outcome.duplicate) {
    await processFile(input.workspaceId, outcome.id, { userId: input.userId });
  } else if (outcome.retry) {
    // A previous attempt failed (e.g. transient error); give the identical upload another chance.
    await reprocessFile(input.workspaceId, outcome.id, { userId: input.userId }).catch(() => {});
  }
  const file = await getFile(input.workspaceId, outcome.id);
  if (!file) throw notFound("File not found");
  return { file, duplicate: outcome.duplicate };
}

/** Converts any pipeline error into a message that is safe to show users and store. */
function safeErrorMessage(e: unknown): string {
  if (e instanceof ParseError || e instanceof AppError) return e.message.slice(0, 300);
  return "The document could not be processed. It may be corrupted, encrypted or in an unsupported format.";
}

interface ProcessContext { userId?: string | null }

/**
 * Extracts, chunks and indexes a stored file. Never throws for document problems: the outcome is
 * recorded on the file row (ready / failed, with `error`). Returns the final status.
 */
export async function processFile(workspaceId: string, fileId: string, ctx: ProcessContext = {}): Promise<"ready" | "failed"> {
  const row = await queryOne<{ filename: string; mime_type: string; content: Buffer }>(
    "SELECT filename, mime_type, content FROM knowledge_files WHERE workspace_id=$1 AND id=$2", [workspaceId, fileId],
  );
  if (!row) throw notFound("File not found");

  let chunks: Array<Chunk & { id?: string }>;
  const warnings: string[] = [];
  try {
    const kind = kindOf(row.filename, row.mime_type);
    if (!kind) throw new ParseError("Unsupported file type.");
    const doc = await parseDocument(kind, row.content);
    if (!doc.text.trim()) {
      throw new ParseError(kind === "pdf"
        ? "No text could be extracted. Scanned PDFs (images of text) need OCR, which is not supported."
        : "No text could be extracted from this file.");
    }
    if (doc.truncated) warnings.push(`only the first ${MAX_EXTRACTED_CHARS.toLocaleString("en-US")} characters were indexed`);
    chunks = chunkSections(doc.sections);
    await transaction(async (c) => {
      await c.query("DELETE FROM document_chunks WHERE workspace_id=$1 AND file_id=$2", [workspaceId, fileId]);
      await c.query(
        "UPDATE knowledge_files SET extracted_text=$3, chunk_count=0, updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [workspaceId, fileId, doc.text],
      );
      const inserted = await c.query<{ id: string; chunk_index: number }>(
        `INSERT INTO document_chunks(workspace_id, file_id, chunk_index, content, token_count, metadata)
         SELECT $1, $2, t.i, t.c, t.n, t.m
           FROM unnest($3::int[], $4::text[], $5::int[], $6::jsonb[]) AS t(i, c, n, m)
         RETURNING id, chunk_index`,
        [workspaceId, fileId, chunks.map((x) => x.index), chunks.map((x) => x.content), chunks.map((x) => x.tokenCount), chunks.map((x) => JSON.stringify(x.metadata))],
      );
      const ids = new Map(inserted.rows.map((r) => [r.chunk_index, r.id]));
      chunks = chunks.map((x) => ({ ...x, id: ids.get(x.index) }));
    });
  } catch (e) {
    if (!(e instanceof ParseError)) console.error("[ingest] extraction failed", fileId, redactSecrets(e instanceof Error ? e.message : String(e)));
    await query(
      "UPDATE knowledge_files SET status='failed', error=$3, chunk_count=0, updated_at=now() WHERE workspace_id=$1 AND id=$2",
      [workspaceId, fileId, safeErrorMessage(e)],
    );
    await query("DELETE FROM document_chunks WHERE workspace_id=$1 AND file_id=$2", [workspaceId, fileId]).catch(() => {});
    return "failed";
  }

  // Embeddings are best-effort: without them the chunks remain searchable via full-text search.
  const embedWarning = await embedChunks(workspaceId, fileId, row.filename, chunks, ctx);
  if (embedWarning) warnings.push(embedWarning);

  await query(
    "UPDATE knowledge_files SET status='ready', chunk_count=$3, error=$4, updated_at=now() WHERE workspace_id=$1 AND id=$2",
    [workspaceId, fileId, chunks.length, warnings.length ? `warning: ${warnings.join("; ")}`.slice(0, 500) : null],
  );
  return "ready";
}

async function embedChunks(
  workspaceId: string, fileId: string, filename: string, chunks: Array<Chunk & { id?: string }>, ctx: ProcessContext,
): Promise<string | null> {
  if (!isMockMode() && !process.env.VOYAGE_API_KEY) {
    return "semantic search is unavailable because embeddings are not configured (VOYAGE_API_KEY); keyword search still works";
  }
  try {
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH).filter((c) => c.id);
      if (!batch.length) continue;
      // The filename gives each vector document-level context without altering the stored chunk.
      const { vectors, model } = await embed(batch.map((c) => `${filename}\n\n${c.content}`), {
        workspaceId, userId: ctx.userId ?? null, purpose: "embedding",
      });
      await query(
        `INSERT INTO embeddings(workspace_id, chunk_id, model, embedding)
         SELECT $1, t.c, $2, t.v::vector FROM unnest($3::uuid[], $4::text[]) AS t(c, v)
         ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model`,
        [workspaceId, model, batch.map((c) => c.id), vectors.map(toVector)],
      );
    }
    return null;
  } catch (e) {
    console.warn("[ingest] embedding failed", fileId, redactSecrets(e instanceof Error ? e.message : String(e)));
    return "semantic indexing failed, so only keyword search is available for this file; try reprocessing later";
  }
}

/** Re-runs extraction and indexing. Refuses while another run is in progress (unless it is stale). */
export async function reprocessFile(workspaceId: string, fileId: string, ctx: ProcessContext = {}): Promise<FileDTO> {
  if (!isUuid(fileId)) throw notFound("File not found");
  const claimed = await queryOne(
    `UPDATE knowledge_files SET status='processing', error=NULL, updated_at=now()
      WHERE workspace_id=$1 AND id=$2
        AND (status <> 'processing' OR updated_at < now() - make_interval(mins => $3))
      RETURNING id`,
    [workspaceId, fileId, STALE_PROCESSING_MINUTES],
  );
  if (!claimed) {
    if (!(await getFile(workspaceId, fileId))) throw notFound("File not found");
    throw conflict("This file is already being processed");
  }
  await processFile(workspaceId, fileId, ctx);
  const f = await getFile(workspaceId, fileId);
  if (!f) throw notFound("File not found");
  return f;
}

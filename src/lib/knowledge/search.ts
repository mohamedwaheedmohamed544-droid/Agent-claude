import { query, toVector } from "../db";
import { embed, type CallContext } from "../ai/llm";

export interface ChunkHit {
  chunkId: string;
  fileId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface SearchOptions {
  limit?: number;
  knowledgeBaseId?: string | null;
  fileIds?: string[] | null;
  /** Minimum fused relevance score (0..1) for a hit to be returned. */
  minScore?: number;
}

/**
 * Hybrid retrieval: pgvector cosine similarity + Postgres full-text search,
 * merged with reciprocal-rank fusion. Strictly scoped to one workspace.
 */
export async function searchKnowledge(
  workspaceId: string, q: string, ctx: Omit<CallContext, "workspaceId" | "purpose">, opts: SearchOptions = {},
): Promise<ChunkHit[]> {
  const limit = Math.min(Math.max(opts.limit ?? 6, 1), 20);
  const filters: string[] = ["c.workspace_id = $1", "f.status = 'ready'"];
  const params: unknown[] = [workspaceId];
  if (opts.knowledgeBaseId) { params.push(opts.knowledgeBaseId); filters.push(`f.knowledge_base_id = $${params.length}`); }
  if (opts.fileIds?.length) { params.push(opts.fileIds); filters.push(`f.id = ANY($${params.length}::uuid[])`); }
  const where = filters.join(" AND ");

  type Row = { id: string; file_id: string; filename: string; chunk_index: number; content: string; metadata: Record<string, unknown>; s: number };
  const ranked = new Map<string, { row: Row; rrf: number; vec?: number; fts?: number }>();
  const K = 60;

  // Vector search (skipped silently if no embeddings exist or embedding fails)
  try {
    const hasEmb = await query<{ n: number }>("SELECT 1 AS n FROM embeddings WHERE workspace_id=$1 LIMIT 1", [workspaceId]);
    if (hasEmb.length) {
      const { vectors } = await embed([q], { ...ctx, workspaceId, purpose: "retrieval" }, "query");
      const vp = [...params, toVector(vectors[0])];
      const rows = await query<Row>(
        `SELECT c.id, c.file_id, f.filename, c.chunk_index, c.content, c.metadata, 1 - (e.embedding <=> $${vp.length}::vector) AS s
           FROM embeddings e JOIN document_chunks c ON c.id = e.chunk_id JOIN knowledge_files f ON f.id = c.file_id
          WHERE ${where} AND e.workspace_id = $1
          ORDER BY e.embedding <=> $${vp.length}::vector LIMIT ${limit * 3}`,
        vp,
      );
      rows.forEach((r, i) => ranked.set(r.id, { row: r, rrf: 1 / (K + i + 1), vec: Number(r.s) }));
    }
  } catch (e) {
    console.warn("[search] vector search unavailable:", (e as Error).message);
  }

  // Full-text search ('simple' config works for Arabic and English tokens)
  const tp = [...params, q];
  const fts = await query<Row>(
    `SELECT c.id, c.file_id, f.filename, c.chunk_index, c.content, c.metadata,
            ts_rank_cd(c.tsv, websearch_to_tsquery('simple', $${tp.length})) AS s
       FROM document_chunks c JOIN knowledge_files f ON f.id = c.file_id
      WHERE ${where} AND c.tsv @@ websearch_to_tsquery('simple', $${tp.length})
      ORDER BY s DESC LIMIT ${limit * 3}`,
    tp,
  );
  // Fallback to OR-query when the AND query is too strict
  const ftsRows = fts.length ? fts : await query<Row>(
    `SELECT c.id, c.file_id, f.filename, c.chunk_index, c.content, c.metadata,
            ts_rank_cd(c.tsv, to_tsquery('simple', $${tp.length})) AS s
       FROM document_chunks c JOIN knowledge_files f ON f.id = c.file_id
      WHERE ${where} AND c.tsv @@ to_tsquery('simple', $${tp.length})
      ORDER BY s DESC LIMIT ${limit * 3}`,
    [...params, orQuery(q)],
  ).catch(() => [] as Row[]);

  ftsRows.forEach((r, i) => {
    const cur = ranked.get(r.id);
    if (cur) { cur.rrf += 1 / (K + i + 1); cur.fts = Number(r.s); }
    else ranked.set(r.id, { row: r, rrf: 1 / (K + i + 1), fts: Number(r.s) });
  });

  const maxRrf = 2 / (K + 1);
  return [...ranked.values()]
    .map((x) => ({
      chunkId: x.row.id, fileId: x.row.file_id, filename: x.row.filename, chunkIndex: x.row.chunk_index,
      content: x.row.content, metadata: x.row.metadata,
      // Relevance: blend of normalised RRF and raw vector similarity when available.
      score: Number((0.5 * (x.rrf / maxRrf) + 0.5 * (x.vec ?? Math.min(1, (x.fts ?? 0) * 5))).toFixed(4)),
    }))
    .filter((h) => h.score >= (opts.minScore ?? 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function orQuery(q: string): string {
  const terms = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2).slice(0, 12);
  return terms.length ? terms.map((t) => `${t}:*`).join(" | ") : "''";
}

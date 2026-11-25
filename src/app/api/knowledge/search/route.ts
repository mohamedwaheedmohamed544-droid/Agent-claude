import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { searchKnowledge } from "@/lib/knowledge/search";
import { assertKnowledgeBase } from "@/lib/knowledge/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  query: z.string().trim().min(1).max(1000),
  knowledgeBaseId: z.string().uuid().nullable().optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

/** Search playground: hybrid (vector + full-text) retrieval over this workspace's ready files. */
export const POST = workspaceRoute(async ({ req, workspaceId, user }) => {
  const body = Body.parse(await readJson(req));
  if (body.knowledgeBaseId) await assertKnowledgeBase(workspaceId, body.knowledgeBaseId);
  const hits = await searchKnowledge(workspaceId, body.query, { userId: user.id }, { limit: body.limit ?? 10, knowledgeBaseId: body.knowledgeBaseId ?? null });
  return {
    hits: hits.map((h) => ({ fileId: h.fileId, filename: h.filename, chunkIndex: h.chunkIndex, content: h.content, score: h.score, metadata: h.metadata })),
  };
}, { minRole: "viewer", rate: { limit: 60, windowSec: 60, bucket: "knowledge-search" } });

import { workspaceRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { reprocessFile } from "@/lib/knowledge/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = workspaceRoute(async ({ workspaceId, user, params, ip }) => {
  const file = await reprocessFile(workspaceId, params.id, { userId: user.id });
  await audit({
    workspaceId, userId: user.id, actorType: "user", action: "file.reprocessed", targetType: "file", targetId: file.id, ip,
    metadata: { status: file.status, chunks: file.chunkCount },
  });
  return { file };
}, { minRole: "member", rate: { limit: 20, windowSec: 60, bucket: "files-reprocess" } });

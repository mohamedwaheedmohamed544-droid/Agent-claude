import { workspaceRoute } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { EXTENSION, type ArtifactFormat } from "@/lib/artifacts";

/** Downloads a deliverable. ?preview=1 returns the text content as JSON for in-app viewing. */
export const GET = workspaceRoute(async ({ req, workspaceId, params }) => {
  const a = await queryOne<{ title: string; format: ArtifactFormat; mime_type: string; content_text: string | null; content_bytes: Buffer | null; kind: string; created_at: string }>(
    "SELECT title, format, mime_type, content_text, content_bytes, kind, created_at FROM generated_artifacts WHERE id=$1 AND workspace_id=$2",
    [params.id, workspaceId],
  );
  if (!a) throw notFound("Deliverable not found");
  if (new URL(req.url).searchParams.get("preview") === "1") {
    return { id: params.id, title: a.title, format: a.format, kind: a.kind, text: a.content_text ?? "", createdAt: a.created_at };
  }
  const body = a.content_bytes ?? Buffer.from(a.content_text ?? "", "utf8");
  const filename = `${a.title.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 100) || "deliverable"}.${EXTENSION[a.format]}`;
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": a.mime_type,
      "content-disposition": `attachment; filename="deliverable.${EXTENSION[a.format]}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});

import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { deleteFile, getFileContent, getFileDetail, moveFile } from "@/lib/knowledge/store";
import { KIND_MIME, extensionOf } from "@/lib/knowledge/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOWNLOAD_MIME = new Set(Object.values(KIND_MIME));

function contentDisposition(filename: string): string {
  const ext = extensionOf(filename);
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\;]/g, "_").trim() || `file${ext ? `.${ext}` : ""}`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** File details with text preview and chunk list; `?download=1` streams the original bytes. */
export const GET = workspaceRoute(async ({ req, workspaceId, params }) => {
  if (new URL(req.url).searchParams.get("download") === "1") {
    const f = await getFileContent(workspaceId, params.id);
    if (!f) throw notFound("File not found");
    const base = DOWNLOAD_MIME.has(f.mimeType) ? f.mimeType : "application/octet-stream";
    const type = base.startsWith("text/") || base === "application/json" ? `${base}; charset=utf-8` : base;
    return new Response(new Uint8Array(f.content), {
      headers: {
        "content-type": type,
        "content-length": String(f.content.length),
        "content-disposition": contentDisposition(f.filename),
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, no-store",
      },
    });
  }
  return getFileDetail(workspaceId, params.id);
});

const Patch = z.object({ knowledgeBaseId: z.string().uuid().nullable() });

export const PATCH = workspaceRoute(async ({ req, workspaceId, user, params, ip }) => {
  const body = Patch.parse(await readJson(req));
  const file = await moveFile(workspaceId, params.id, body.knowledgeBaseId);
  await audit({
    workspaceId, userId: user.id, actorType: "user", action: "file.moved", targetType: "file", targetId: file.id, ip,
    metadata: { knowledgeBaseId: body.knowledgeBaseId },
  });
  return { file };
}, { minRole: "member" });

export const DELETE = workspaceRoute(async ({ workspaceId, user, params, ip }) => {
  const deleted = await deleteFile(workspaceId, params.id);
  if (!deleted) throw notFound("File not found");
  await audit({
    workspaceId, userId: user.id, actorType: "user", action: "file.deleted", targetType: "file", targetId: params.id, ip,
    metadata: { filename: deleted.filename },
  });
  return { ok: true };
}, { minRole: "member" });

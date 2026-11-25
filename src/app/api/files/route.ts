import { workspaceRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AppError, badRequest } from "@/lib/errors";
import { ingestUpload } from "@/lib/knowledge/ingest";
import { listFiles } from "@/lib/knowledge/store";
import { ALLOWED_EXTENSIONS, maxUploadBytes } from "@/lib/knowledge/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Extraction + embedding run inside the upload request (no queue), so allow long documents.
export const maxDuration = 300;

/** Allowance for multipart boundaries and the small text fields alongside the file. */
const MULTIPART_OVERHEAD = 64 * 1024;

export const GET = workspaceRoute(async ({ req, workspaceId }) => {
  const sp = new URL(req.url).searchParams;
  const files = await listFiles(workspaceId, {
    knowledgeBaseId: sp.get("knowledgeBaseId"),
    q: sp.get("q"),
    status: sp.get("status"),
    conversationId: sp.get("conversationId"),
  });
  return { files, limits: { maxUploadBytes: maxUploadBytes(), allowedExtensions: ALLOWED_EXTENSIONS } };
});

function optionalField(form: FormData, name: string): string | null {
  const v = form.get(name);
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw badRequest(`Field "${name}" must be a string`);
  return v.trim() || null;
}

export const POST = workspaceRoute(async ({ req, workspaceId, user, ip }) => {
  const max = maxUploadBytes();
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max + MULTIPART_OVERHEAD) {
    throw new AppError(413, "payload_too_large", `The file exceeds the ${Math.round((max / 1024 / 1024) * 10) / 10} MB upload limit.`);
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    throw badRequest("Expected a multipart/form-data upload");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Malformed upload body");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw badRequest('Missing "file" field');
  if (file.size > max) {
    throw new AppError(413, "payload_too_large", `The file exceeds the ${Math.round((max / 1024 / 1024) * 10) / 10} MB upload limit.`);
  }

  const result = await ingestUpload({
    workspaceId,
    userId: user.id,
    filename: file.name,
    bytes: Buffer.from(await file.arrayBuffer()),
    knowledgeBaseId: optionalField(form, "knowledgeBaseId"),
    conversationId: optionalField(form, "conversationId"),
  });
  if (!result.duplicate) {
    await audit({
      workspaceId, userId: user.id, actorType: "user", action: "file.uploaded", targetType: "file", targetId: result.file.id, ip,
      metadata: { filename: result.file.filename, sizeBytes: result.file.sizeBytes, status: result.file.status, chunks: result.file.chunkCount },
    });
  }
  return Response.json(result, { status: result.duplicate ? 200 : 201 });
}, { minRole: "member", rate: { limit: 30, windowSec: 60, bucket: "files-upload" } });

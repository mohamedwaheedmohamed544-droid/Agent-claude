"use client";

import { ApiError } from "@/lib/client/api";

/** Client-side helpers for uploading documents to POST /api/files. */

export type UploadedFileStatus = "pending" | "processing" | "ready" | "failed";

export interface UploadedFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: UploadedFileStatus;
  chunkCount: number;
  /** Failure reason, or a non-fatal note prefixed with "warning:". */
  error: string | null;
  knowledgeBaseId: string | null;
  createdAt: string;
}

export interface UploadOptions {
  conversationId?: string;
  knowledgeBaseId?: string;
}

/** Extensions the server accepts (kept in sync with src/lib/knowledge/validation.ts). */
export const ACCEPTED_EXTENSIONS = ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "md", "markdown", "json"];
/** Value for an <input type="file" accept> attribute. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");

export function isAcceptedFile(file: File): boolean {
  const ext = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? "";
  return ACCEPTED_EXTENSIONS.includes(ext);
}

function buildForm(file: File, opts?: UploadOptions): FormData {
  const form = new FormData();
  form.append("file", file, file.name);
  if (opts?.knowledgeBaseId) form.append("knowledgeBaseId", opts.knowledgeBaseId);
  if (opts?.conversationId) form.append("conversationId", opts.conversationId);
  return form;
}

function toError(status: number, text: string): ApiError {
  let body: { error?: { code?: string; message?: string; details?: unknown } } | null = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (body?.error?.message) return new ApiError(status, body.error.code ?? "http_error", body.error.message, body.error.details);
  // Hosting platforms (e.g. Vercel) reject oversized bodies with a non-JSON 413 before our handler runs.
  if (status === 413) return new ApiError(413, "payload_too_large", "The file is too large to upload.");
  if (status === 0) return new ApiError(0, "network_error", "Network error: the upload could not be completed.");
  return new ApiError(status, "http_error", `Upload failed (${status})`);
}

function redirectIfUnauthenticated(status: number) {
  if (status === 401 && typeof window !== "undefined") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
}

/**
 * Uploads one file and resolves once the server has finished extracting and indexing it.
 * Duplicate uploads resolve to the existing file. Throws ApiError with the server's safe message.
 */
export async function uploadFile(file: File, opts?: UploadOptions): Promise<UploadedFile> {
  const res = await fetch("/api/files", { method: "POST", body: buildForm(file, opts), credentials: "same-origin", cache: "no-store" });
  const text = await res.text();
  redirectIfUnauthenticated(res.status);
  if (!res.ok) throw toError(res.status, text);
  return (JSON.parse(text) as { file: UploadedFile }).file;
}

export interface UploadProgress {
  /** 0..1 fraction of bytes sent; the server then processes the file. */
  sent: number;
  phase: "uploading" | "processing";
}

/**
 * Same as uploadFile, but reports byte-level progress (XMLHttpRequest, since fetch has no
 * upload progress events) and can be aborted. Also reports whether the file was a duplicate.
 */
export function uploadFileWithProgress(
  file: File,
  opts: UploadOptions & { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<{ file: UploadedFile; duplicate: boolean }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.({ sent: e.loaded / e.total, phase: e.loaded >= e.total ? "processing" : "uploading" });
    };
    xhr.upload.onload = () => opts.onProgress?.({ sent: 1, phase: "processing" });
    xhr.onload = () => {
      redirectIfUnauthenticated(xhr.status);
      if (xhr.status < 200 || xhr.status >= 300) return reject(toError(xhr.status, xhr.responseText));
      try {
        resolve(JSON.parse(xhr.responseText) as { file: UploadedFile; duplicate: boolean });
      } catch {
        reject(new ApiError(xhr.status, "bad_response", "Unexpected response from the server."));
      }
    };
    xhr.onerror = () => reject(toError(0, ""));
    xhr.onabort = () => reject(new ApiError(0, "aborted", "Upload cancelled."));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(buildForm(file, opts));
  });
}

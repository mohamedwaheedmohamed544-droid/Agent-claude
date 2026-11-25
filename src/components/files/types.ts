import type { UploadedFile } from "./upload";

/** File row as returned by GET /api/files. */
export interface FileItem extends UploadedFile {
  knowledgeBaseName: string | null;
  conversationId: string | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  updatedAt: string;
}

export interface FilesResponse {
  files: FileItem[];
  limits: { maxUploadBytes: number; allowedExtensions: string[] };
}

export interface ChunkPreview {
  index: number;
  tokenCount: number;
  metadata: { page?: number; sheet?: string; slide?: number; heading?: string };
  content: string;
}

export interface FileDetailResponse {
  file: FileItem;
  preview: string;
  previewTruncated: boolean;
  textLength: number;
  chunks: ChunkPreview[];
}

export interface KnowledgeBase {
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

export interface BasesResponse {
  bases: KnowledgeBase[];
  unassigned: { fileCount: number; chunkCount: number };
}

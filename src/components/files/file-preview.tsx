"use client";

import { useState } from "react";
import { Download, Hash, RefreshCw } from "lucide-react";
import { formatBytes, timeAgo, useApi } from "@/lib/client/hooks";
import { useApp } from "../providers";
import { Alert, Badge, Button, Dialog, EmptyState, ErrorState, LoadingBlock, StatusBadge, Tabs } from "../ui";
import { FileTypeIcon, fileExtLabel } from "./file-icon";
import type { ChunkPreview, FileDetailResponse } from "./types";

export function chunkLocation(m: ChunkPreview["metadata"], t: (k: string, v?: Record<string, string | number>) => string): string[] {
  const out: string[] = [];
  if (m.page !== undefined) out.push(t("files.meta.page", { n: m.page }));
  if (m.slide !== undefined) out.push(t("files.meta.slide", { n: m.slide }));
  if (m.sheet !== undefined) out.push(t("files.meta.sheet", { name: m.sheet }));
  return out;
}

/** Dialog showing a file's metadata, extracted-text preview and chunk list. */
export function FilePreviewDialog({ fileId, onClose, onReprocess, reprocessing }: {
  fileId: string | null;
  onClose: () => void;
  onReprocess?: (id: string) => Promise<unknown>;
  reprocessing?: boolean;
}) {
  const { t, can } = useApp();
  const [tab, setTab] = useState<"text" | "chunks">("text");
  const { data, error, loading, reload } = useApi<FileDetailResponse>(fileId ? `/api/files/${fileId}` : null, {
    intervalMs: (d) => (d?.file.status === "processing" || d?.file.status === "pending" ? 3000 : null),
  });
  const f = data?.file;
  const warning = f?.error?.startsWith("warning:") ? f.error.slice("warning:".length).trim() : null;

  return (
    <Dialog
      open={Boolean(fileId)}
      onClose={() => { setTab("text"); onClose(); }}
      size="xl"
      title={f ? <span className="flex min-w-0 items-center gap-2.5"><FileTypeIcon filename={f.filename} size="sm" /><span className="truncate" dir="auto">{f.filename}</span></span> : t("files.preview.title")}
      description={f ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{fileExtLabel(f.filename)}</span><span aria-hidden>·</span>
          <span>{formatBytes(f.sizeBytes)}</span><span aria-hidden>·</span>
          <span>{t("files.chunksCount", { n: f.chunkCount })}</span>
          {f.uploadedByName && <><span aria-hidden>·</span><span>{t("files.uploadedByAgo", { name: f.uploadedByName, time: timeAgo(f.createdAt, t) })}</span></>}
        </span>
      ) : undefined}
      footer={f && (
        <>
          {can("member") && onReprocess && (
            <Button variant="outline" icon={<RefreshCw className="size-4" />} loading={reprocessing}
              onClick={() => { const p = onReprocess(f.id); setTimeout(() => void reload(), 400); void p.finally(() => void reload()); }}>
              {t("files.action.reprocess")}
            </Button>
          )}
          <a href={`/api/files/${f.id}?download=1`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-card hover:bg-accent-hover">
            <Download className="size-4" />{t("action.download")}
          </a>
        </>
      )}
    >
      {loading && !data ? <LoadingBlock rows={4} /> : error ? <ErrorState error={error} onRetry={reload} /> : data && f ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={f.status} />
            {f.knowledgeBaseName && <Badge tone="accent">{f.knowledgeBaseName}</Badge>}
            {data.textLength > 0 && <Badge>{t("files.preview.characters", { n: data.textLength.toLocaleString() })}</Badge>}
          </div>
          {f.status === "failed" && f.error && <Alert tone="danger" title={t("files.preview.failedTitle")}>{f.error}</Alert>}
          {warning && <Alert tone="warning" title={t("files.preview.warningTitle")}>{warning}</Alert>}

          <Tabs value={tab} onChange={setTab} items={[
            { value: "text", label: t("files.preview.text") },
            { value: "chunks", label: t("files.preview.chunks"), count: data.chunks.length },
          ]} />

          {tab === "text" ? (
            data.preview ? (
              <div className="rounded-xl border border-border bg-surface-2/60">
                <pre dir="auto" className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-start font-sans text-[13px] leading-relaxed text-fg-2">
                  {data.preview}
                </pre>
                {data.previewTruncated && (
                  <p className="border-t border-border px-4 py-2 text-[12px] text-fg-3">{t("files.preview.truncated", { n: data.preview.length.toLocaleString() })}</p>
                )}
              </div>
            ) : <EmptyState title={t("files.preview.noText")} description={f.status === "processing" ? t("files.preview.processing") : undefined} />
          ) : data.chunks.length ? (
            <ol className="space-y-2">
              {data.chunks.map((c) => (
                <li key={c.index} className="rounded-xl border border-border bg-surface px-4 py-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-0.5 font-mono text-[11.5px] font-medium text-fg-3"><Hash className="size-3" />{c.index + 1}</span>
                    <Badge>{t("files.preview.tokens", { n: c.tokenCount })}</Badge>
                    {chunkLocation(c.metadata, t).map((l) => <Badge key={l} tone="info">{l}</Badge>)}
                    {c.metadata.heading && <span className="truncate text-[12px] text-fg-3" dir="auto">{c.metadata.heading}</span>}
                  </div>
                  <p dir="auto" className="line-clamp-4 whitespace-pre-wrap break-words text-start text-[13px] leading-relaxed text-fg-2">{c.content}</p>
                </li>
              ))}
            </ol>
          ) : <EmptyState title={t("files.preview.noChunks")} />}
        </div>
      ) : null}
    </Dialog>
  );
}

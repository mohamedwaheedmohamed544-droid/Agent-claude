"use client";

import { useState } from "react";
import { Download, Eye, FileSpreadsheet, FileText, FileJson, Globe, FileType2 } from "lucide-react";
import { useApp } from "@/components/providers";
import { Badge, Button, Dialog, ErrorState, LoadingBlock, cx } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { useApi, formatBytes } from "@/lib/client/hooks";
import type { ArtifactRef, Source } from "./types";

function FormatIcon({ format, className }: { format?: string; className?: string }) {
  const c = cx("size-4 shrink-0", className);
  if (format === "xlsx") return <FileSpreadsheet className={c} />;
  if (format === "json") return <FileJson className={c} />;
  if (format === "docx") return <FileType2 className={c} />;
  return <FileText className={c} />;
}

const FORMAT_LABEL: Record<string, string> = { markdown: "MD", text: "TXT", json: "JSON", docx: "DOCX", xlsx: "XLSX" };

/** A deliverable chip with Preview (in-app, text only) and Download actions. */
export function DeliverableChip({ artifact, sizeBytes }: { artifact: ArtifactRef; sizeBytes?: number }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-1.5 shadow-card">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text"><FormatIcon format={artifact.format} /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-fg" dir="auto" title={artifact.title}>{artifact.title}</p>
        <p className="text-[11px] text-fg-3">
          {FORMAT_LABEL[artifact.format ?? ""] ?? artifact.format ?? ""}{sizeBytes ? ` · ${formatBytes(sizeBytes)}` : ""}
        </p>
      </div>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label={`${t("tasks.preview")}: ${artifact.title}`} title={t("tasks.preview")}>
        <Eye className="size-4" />
      </button>
      <a href={`/api/artifacts/${artifact.id}`} download className="rounded-md p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label={`${t("action.download")}: ${artifact.title}`} title={t("action.download")}>
        <Download className="size-4" />
      </a>
      {open && <ArtifactPreviewDialog id={artifact.id} title={artifact.title} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function DeliverableList({ artifacts, sizes }: { artifacts: ArtifactRef[]; sizes?: Record<string, number> }) {
  if (!artifacts.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {artifacts.map((a) => <DeliverableChip key={a.id} artifact={a} sizeBytes={sizes?.[a.id]} />)}
    </div>
  );
}

function ArtifactPreviewDialog({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const { t } = useApp();
  const { data, error, loading, reload } = useApi<{ title: string; format: string; text: string }>(`/api/artifacts/${id}?preview=1`);
  return (
    <Dialog open onClose={onClose} size="xl" title={<span dir="auto">{data?.title ?? title}</span>}
      description={data?.format ? <Badge className="font-mono">{FORMAT_LABEL[data.format] ?? data.format}</Badge> : undefined}
      footer={<>
        <Button variant="outline" onClick={onClose}>{t("action.close")}</Button>
        <a href={`/api/artifacts/${id}`} download className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-card hover:bg-accent-hover">
          <Download className="size-4" />{t("action.download")}
        </a>
      </>}>
      {loading ? <LoadingBlock rows={4} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data?.text ? (
        <p className="text-sm text-fg-3">{t("tasks.previewUnavailable")}</p>
      ) : data.format === "json" ? (
        <pre className="overflow-x-auto rounded-xl border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-fg" dir="ltr">{prettyJson(data.text)}</pre>
      ) : (
        <Markdown text={data.text} />
      )}
    </Dialog>
  );
}

function prettyJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

/** Sources cited by agents: web links open in a new tab; documents link to the Files area. */
export function SourceList({ sources, compact }: { sources: Source[]; compact?: boolean }) {
  if (!sources.length) return null;
  return (
    <ol className={cx("grid gap-1.5", !compact && "sm:grid-cols-2")}>
      {sources.map((s, i) => {
        const inner = (
          <>
            <span className="grid size-5 shrink-0 place-items-center rounded-md bg-surface-3 text-[10.5px] font-semibold text-fg-2 tabular-nums">{i + 1}</span>
            {s.kind === "web" ? <Globe className="size-3.5 shrink-0 text-info" /> : <FileText className="size-3.5 shrink-0 text-accent" />}
            <span className="min-w-0 flex-1 truncate" dir="auto">{s.title}</span>
            {s.url && <span className="hidden shrink-0 text-[11px] text-fg-3 sm:inline" dir="ltr">{hostOf(s.url)}</span>}
          </>
        );
        const cls = "flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-fg-2";
        return (
          <li key={`${s.url ?? s.fileId ?? s.title}-${i}`} className="min-w-0">
            {s.url && /^https?:\/\//i.test(s.url) ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className={cx(cls, "hover:border-border-strong hover:text-fg")}>{inner}</a>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

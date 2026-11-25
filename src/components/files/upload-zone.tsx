"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, CloudUpload, Copy, X } from "lucide-react";
import { formatBytes } from "@/lib/client/hooks";
import { useApp } from "../providers";
import { Button, cx } from "../ui";
import { FileTypeIcon } from "./file-icon";
import { ACCEPT_ATTRIBUTE, isAcceptedFile, uploadFileWithProgress, type UploadedFile } from "./upload";

type ItemState = "queued" | "uploading" | "processing" | "done" | "duplicate" | "warning" | "error";

interface QueueItem {
  key: string;
  file: File;
  state: ItemState;
  progress: number;
  message?: string;
}

const CONCURRENCY = 2;

/**
 * Drag-and-drop / picker upload area with a per-file progress queue.
 * Files are validated client-side (type, size) for fast feedback; the server re-validates everything.
 */
export function UploadZone({ knowledgeBaseId, maxUploadBytes, onUploaded, compact }: {
  knowledgeBaseId?: string | null;
  maxUploadBytes?: number;
  onUploaded?: (file: UploadedFile) => void;
  compact?: boolean;
}) {
  const { t } = useApp();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = useRef(0);
  const started = useRef(new Set<string>());
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;
  const kbRef = useRef(knowledgeBaseId);
  kbRef.current = knowledgeBaseId;

  const patch = useCallback((key: string, p: Partial<QueueItem>) => {
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));
  }, []);

  const run = useCallback(async (item: QueueItem) => {
    if (started.current.has(item.key)) return;
    started.current.add(item.key);
    active.current++;
    patch(item.key, { state: "uploading", progress: 0 });
    try {
      const { file, duplicate } = await uploadFileWithProgress(item.file, {
        knowledgeBaseId: kbRef.current ?? undefined,
        onProgress: (p) => patch(item.key, { progress: p.sent, state: p.phase }),
      });
      if (file.status === "failed") {
        patch(item.key, { state: "error", progress: 1, message: file.error ?? t("files.upload.failed") });
      } else if (duplicate) {
        patch(item.key, { state: "duplicate", progress: 1, message: t("files.upload.duplicate") });
      } else if (file.error?.startsWith("warning:")) {
        patch(item.key, { state: "warning", progress: 1, message: t("files.upload.readyWithWarning", { n: file.chunkCount }) });
      } else {
        patch(item.key, { state: "done", progress: 1, message: t("files.upload.indexed", { n: file.chunkCount }) });
      }
      onUploadedRef.current?.(file);
    } catch (e) {
      patch(item.key, { state: "error", message: (e as Error).message });
    } finally {
      active.current--;
      setItems((list) => [...list]); // nudge the scheduler effect
    }
  }, [patch, t]);

  // Simple scheduler: keep up to CONCURRENCY uploads in flight.
  useEffect(() => {
    const queued = items.filter((i) => i.state === "queued" && !started.current.has(i.key));
    const slots = CONCURRENCY - active.current;
    queued.slice(0, Math.max(0, slots)).forEach((it) => void run(it));
  }, [items, run]);

  const addFiles = (list: FileList | File[]) => {
    const next: QueueItem[] = [];
    for (const file of Array.from(list)) {
      const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;
      if (!isAcceptedFile(file)) next.push({ key, file, state: "error", progress: 0, message: t("files.upload.unsupported") });
      else if (file.size === 0) next.push({ key, file, state: "error", progress: 0, message: t("files.upload.empty") });
      else if (maxUploadBytes && file.size > maxUploadBytes) next.push({ key, file, state: "error", progress: 0, message: t("files.upload.tooLarge", { max: formatBytes(maxUploadBytes) }) });
      else next.push({ key, file, state: "queued", progress: 0 });
    }
    setItems((cur) => [...next, ...cur].slice(0, 50));
  };

  const busy = items.some((i) => i.state === "queued" || i.state === "uploading" || i.state === "processing");
  const finished = items.filter((i) => !["queued", "uploading", "processing"].includes(i.state));

  return (
    <div className="space-y-3">
      <div
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
        className={cx(
          "relative flex flex-col items-center justify-center rounded-2xl border border-dashed text-center transition-colors",
          compact ? "px-4 py-5" : "px-6 py-9",
          dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface hover:bg-surface-2/60",
        )}
      >
        <div className={cx("mb-3 grid place-items-center rounded-2xl bg-accent-soft text-accent-text", compact ? "size-10" : "size-12")}>
          <CloudUpload className="size-5" />
        </div>
        <p className="text-sm font-medium text-fg">{dragging ? t("files.upload.dropNow") : t("files.upload.title")}</p>
        <p className="mt-1 max-w-md text-[12.5px] text-fg-3">
          {t("files.upload.hint", { max: maxUploadBytes ? formatBytes(maxUploadBytes) : "4 MB" })}
        </p>
        <Button size="sm" variant="outline" className="mt-4" onClick={() => inputRef.current?.click()}>
          {t("files.upload.choose")}
        </Button>
        <input
          ref={inputRef} type="file" multiple accept={ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1}
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {items.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <p className="text-[13px] font-medium text-fg-2">
              {busy ? t("files.upload.inProgress", { n: items.length - finished.length }) : t("files.upload.completed", { n: items.length })}
            </p>
            {finished.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setItems((l) => l.filter((i) => !finished.includes(i)))}>
                {t("files.upload.clear")}
              </Button>
            )}
          </div>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {items.map((it) => <QueueRow key={it.key} item={it} onDismiss={() => setItems((l) => l.filter((x) => x.key !== it.key))} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

function QueueRow({ item, onDismiss }: { item: QueueItem; onDismiss: () => void }) {
  const { t } = useApp();
  const running = item.state === "uploading" || item.state === "processing";
  const label: Record<ItemState, string> = {
    queued: t("files.upload.queued"),
    uploading: t("files.upload.uploading", { pct: Math.round(item.progress * 100) }),
    processing: t("files.upload.processing"),
    done: item.message ?? "",
    duplicate: item.message ?? "",
    warning: item.message ?? "",
    error: item.message ?? t("files.upload.failed"),
  };
  const tone = item.state === "error" ? "text-danger" : item.state === "warning" ? "text-warning" : item.state === "done" ? "text-success" : "text-fg-3";
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <FileTypeIcon filename={item.file.name} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-[13px] font-medium text-fg" dir="auto">{item.file.name}</p>
          <span className="shrink-0 text-[11.5px] tabular-nums text-fg-3">{formatBytes(item.file.size)}</span>
        </div>
        {running || item.state === "queued" ? (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className={cx("h-full rounded-full bg-accent transition-[width] duration-300", item.state === "processing" && "animate-soft-pulse")}
                style={{ width: `${Math.max(item.state === "processing" ? 100 : 4, item.progress * 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-[11.5px] text-fg-3">{label[item.state]}</span>
          </div>
        ) : (
          <p className={cx("mt-0.5 flex items-center gap-1 text-[12px]", tone)}>
            {item.state === "error" ? <CircleAlert className="size-3.5 shrink-0" />
              : item.state === "duplicate" ? <Copy className="size-3.5 shrink-0" />
                : <CircleCheck className="size-3.5 shrink-0" />}
            <span className="truncate">{label[item.state]}</span>
          </p>
        )}
      </div>
      {!running && item.state !== "queued" && (
        <button onClick={onDismiss} className="rounded-md p-1 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label={t("action.close")}>
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}

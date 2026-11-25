"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Ellipsis, Eye, FolderInput, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { formatBytes, timeAgo } from "@/lib/client/hooks";
import { useApp } from "../providers";
import { Alert, Button, Dialog, Field, Select, StatusBadge, Table, Td, Th, cx } from "../ui";
import { FileTypeIcon, fileExtLabel } from "./file-icon";
import { FilePreviewDialog } from "./file-preview";
import type { FileItem, KnowledgeBase } from "./types";

/**
 * Files list with row actions (preview, download, move, reprocess, delete).
 * Renders a table on wide screens and stacked cards on phones.
 */
export function FilesTable({ files, bases, onChanged, showBase = true }: {
  files: FileItem[];
  bases: KnowledgeBase[];
  onChanged: () => void;
  showBase?: boolean;
}) {
  const { t } = useApp();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [moving, setMoving] = useState<FileItem | null>(null);
  const [deleting, setDeleting] = useState<FileItem | null>(null);
  const [reprocessing, setReprocessing] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const reprocess = async (id: string) => {
    setReprocessing((s) => new Set(s).add(id));
    setActionError(null);
    try {
      await api(`/api/files/${id}/reprocess`, { method: "POST" });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setReprocessing((s) => { const n = new Set(s); n.delete(id); return n; });
      onChanged();
    }
  };

  const actions = (f: FileItem) => (
    <RowMenu
      file={f}
      onPreview={() => setPreviewId(f.id)}
      onMove={() => setMoving(f)}
      onReprocess={() => void reprocess(f.id)}
      onDelete={() => setDeleting(f)}
      busy={reprocessing.has(f.id)}
    />
  );

  return (
    <>
      {actionError && <div className="px-4 pb-3"><Alert tone="danger">{actionError}</Alert></div>}

      {/* Wide screens */}
      <Table className="hidden md:block">
        <thead>
          <tr>
            <Th>{t("files.col.name")}</Th>
            <Th>{t("files.col.status")}</Th>
            <Th className="text-end">{t("files.col.chunks")}</Th>
            {showBase && <Th>{t("files.col.base")}</Th>}
            <Th>{t("files.col.uploaded")}</Th>
            <Th className="w-12"><span className="sr-only">{t("files.col.actions")}</span></Th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.id} className="group transition-colors hover:bg-surface-2/50">
              <Td className="max-w-[340px]">
                <button onClick={() => setPreviewId(f.id)} className="flex min-w-0 items-center gap-3 text-start">
                  <FileTypeIcon filename={f.filename} mimeType={f.mimeType} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg group-hover:text-accent-text" dir="auto">{f.filename}</span>
                    <span className="block text-[12px] text-fg-3">{fileExtLabel(f.filename)} · {formatBytes(f.sizeBytes)}</span>
                  </span>
                </button>
              </Td>
              <Td><FileStatus file={f} busy={reprocessing.has(f.id)} /></Td>
              <Td className="text-end tabular-nums">{f.status === "ready" ? f.chunkCount : "—"}</Td>
              {showBase && <Td className="max-w-[180px]"><span className="block truncate" dir="auto">{f.knowledgeBaseName ?? <span className="text-fg-3">{t("files.noBase")}</span>}</span></Td>}
              <Td className="whitespace-nowrap">
                <span className="block text-fg-2" dir="auto">{f.uploadedByName ?? "—"}</span>
                <span className="block text-[12px] text-fg-3" title={new Date(f.createdAt).toLocaleString()}>{timeAgo(f.createdAt, t)}</span>
              </Td>
              <Td className="text-end">{actions(f)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {/* Phones */}
      <ul className="divide-y divide-border md:hidden">
        {files.map((f) => (
          <li key={f.id} className="flex items-start gap-3 px-4 py-3">
            <button onClick={() => setPreviewId(f.id)} className="flex min-w-0 flex-1 items-start gap-3 text-start">
              <FileTypeIcon filename={f.filename} mimeType={f.mimeType} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg" dir="auto">{f.filename}</span>
                <span className="mt-0.5 block text-[12px] text-fg-3">
                  {formatBytes(f.sizeBytes)}
                  {f.status === "ready" && <> · {t("files.chunksCount", { n: f.chunkCount })}</>}
                  {" · "}{timeAgo(f.createdAt, t)}
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <FileStatus file={f} busy={reprocessing.has(f.id)} />
                  {showBase && f.knowledgeBaseName && <span className="truncate text-[12px] text-fg-3" dir="auto">{f.knowledgeBaseName}</span>}
                </span>
              </span>
            </button>
            {actions(f)}
          </li>
        ))}
      </ul>

      <FilePreviewDialog
        fileId={previewId}
        onClose={() => setPreviewId(null)}
        onReprocess={reprocess}
        reprocessing={previewId ? reprocessing.has(previewId) : false}
      />
      <MoveDialog file={moving} bases={bases} onClose={() => setMoving(null)} onDone={() => { setMoving(null); onChanged(); }} />
      <DeleteDialog file={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); onChanged(); }} />
    </>
  );
}

function FileStatus({ file, busy }: { file: FileItem; busy?: boolean }) {
  const { t } = useApp();
  const warning = file.status === "ready" && file.error?.startsWith("warning:");
  return (
    <span className="inline-flex items-center gap-1.5" title={file.error ?? undefined}>
      <StatusBadge status={busy ? "processing" : file.status} />
      {warning && !busy && <span className="text-[11.5px] font-medium text-warning">{t("files.status.keywordOnly")}</span>}
    </span>
  );
}

function RowMenu({ file, onPreview, onMove, onReprocess, onDelete, busy }: {
  file: FileItem; onPreview: () => void; onMove: () => void; onReprocess: () => void; onDelete: () => void; busy: boolean;
}) {
  const { t, can } = useApp();
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const open = pos !== null;
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  // The menu is position:fixed so it is not clipped by the table's scroll container.
  const toggle = () => {
    if (open || !btn.current) { setPos(null); return; }
    const r = btn.current.getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    const width = 208;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rtl ? r.left : r.right - width));
    const below = r.bottom + 280 < window.innerHeight;
    setPos(below ? { left, top: r.bottom + 4, width } : { left, bottom: window.innerHeight - r.top + 4, width });
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : e.type !== "mousedown" || !ref.current?.contains(e.target as Node)) setPos(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-50";
  const member = can("member");
  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={btn} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={t("files.col.actions")}
        className={cx("grid size-8 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg", open && "bg-surface-2 text-fg")}
      >
        <Ellipsis className="size-4" />
      </button>
      {open && (
        <div role="menu" style={pos} className="fixed z-40 rounded-xl border border-border bg-surface p-1 shadow-modal" onClick={() => setPos(null)}>
          <button role="menuitem" className={item} onClick={onPreview}><Eye className="size-4" />{t("files.action.preview")}</button>
          <a role="menuitem" className={item} href={`/api/files/${file.id}?download=1`}><Download className="size-4" />{t("action.download")}</a>
          {member && (
            <>
              <button role="menuitem" className={item} onClick={onMove}><FolderInput className="size-4" />{t("files.action.move")}</button>
              <button role="menuitem" className={item} onClick={onReprocess} disabled={busy || file.status === "processing"}>
                <RefreshCw className="size-4" />{t("files.action.reprocess")}
              </button>
              <div className="my-1 h-px bg-border" />
              <button role="menuitem" className={cx(item, "text-danger hover:bg-danger-soft hover:text-danger")} onClick={onDelete}>
                <Trash2 className="size-4" />{t("action.delete")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MoveDialog({ file, bases, onClose, onDone }: { file: FileItem | null; bases: KnowledgeBase[]; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setTarget(file?.knowledgeBaseId ?? ""); setError(null); }, [file]);

  const save = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/files/${file.id}`, { method: "PATCH", body: { knowledgeBaseId: target || null } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(file)} onClose={onClose} size="sm" title={t("files.move.title")} description={file ? <span dir="auto">{file.filename}</span> : undefined}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("action.cancel")}</Button>
        <Button onClick={save} loading={busy} disabled={(file?.knowledgeBaseId ?? "") === target}>{t("files.move.confirm")}</Button>
      </>}>
      <Field label={t("files.move.label")} error={error ?? undefined}>
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t("files.noBase")}</option>
          {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      </Field>
    </Dialog>
  );
}

function DeleteDialog({ file, onClose, onDone }: { file: FileItem | null; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [file]);

  const remove = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await api(`/api/files/${file.id}`, { method: "DELETE" });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(file)} onClose={onClose} size="sm" title={t("files.delete.title")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("action.cancel")}</Button>
        <Button variant="danger" onClick={remove} loading={busy} icon={<Trash2 className="size-4" />}>{t("action.delete")}</Button>
      </>}>
      <p className="text-sm text-fg-2">{t("files.delete.body", { name: file?.filename ?? "" })}</p>
      {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}
    </Dialog>
  );
}

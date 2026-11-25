"use client";

import { useEffect, useState } from "react";
import { BookOpen, FileSearch, FolderOpen, Layers, Library, Pencil, Plus, ScanText, Trash2, Upload } from "lucide-react";
import { Page } from "@/components/page";
import { useApp } from "@/components/providers";
import { Alert, Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, LoadingBlock, PageHeader, Textarea, cx } from "@/components/ui";
import { FilesTable } from "@/components/files/files-table";
import { UploadZone } from "@/components/files/upload-zone";
import type { BasesResponse, FilesResponse, KnowledgeBase } from "@/components/files/types";
import { api } from "@/lib/client/api";
import { formatBytes, useApi } from "@/lib/client/hooks";
import { SearchPlayground } from "./search-playground";

/** "none" selects files that are not filed in any base. */
type Selection = string | null;

export default function KnowledgePage() {
  const { t, can } = useApp();
  const { data, error, loading, reload } = useApi<BasesResponse>("/api/knowledge/bases");
  const [selected, setSelected] = useState<Selection>(null);
  const [editing, setEditing] = useState<KnowledgeBase | "new" | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeBase | null>(null);
  const bases = data?.bases ?? [];

  // Select the first base once loaded, and recover if the selected base disappears.
  useEffect(() => {
    if (!data) return;
    if (selected === "none") return;
    if (!selected || !data.bases.some((b) => b.id === selected)) setSelected(data.bases[0]?.id ?? null);
  }, [data, selected]);

  const totalFiles = bases.reduce((n, b) => n + b.fileCount, 0) + (data?.unassigned.fileCount ?? 0);
  const totalChunks = bases.reduce((n, b) => n + b.chunkCount, 0) + (data?.unassigned.chunkCount ?? 0);
  const selectedBase = bases.find((b) => b.id === selected) ?? null;

  return (
    <Page wide>
      <PageHeader
        icon={<BookOpen className="size-5" />}
        title={t("knowledge.title")}
        description={t("knowledge.subtitle")}
        actions={can("member") && <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>{t("knowledge.base.new")}</Button>}
      />

      {loading && !data ? <LoadingBlock rows={3} /> : error ? <ErrorState error={error} onRetry={reload} /> : data && (
        <>
          {totalFiles === 0 && <HowItWorks />}

          <section aria-label={t("knowledge.bases")} className="mb-6">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-fg-3">{t("knowledge.bases")}</h2>
              <p className="text-[12.5px] text-fg-3">{t("knowledge.totals", { files: totalFiles, chunks: totalChunks.toLocaleString() })}</p>
            </div>
            {bases.length === 0 ? (
              <Card>
                <EmptyState icon={<Library className="size-5" />} title={t("knowledge.empty.title")} description={t("knowledge.empty.body")}
                  action={can("member") && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>{t("knowledge.base.new")}</Button>} />
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {bases.map((b) => (
                  <BaseCard key={b.id} base={b} active={selected === b.id} onSelect={() => setSelected(b.id)}
                    onEdit={() => setEditing(b)} onDelete={() => setDeleting(b)} />
                ))}
                {data.unassigned.fileCount > 0 && (
                  <button onClick={() => setSelected("none")}
                    className={cx("flex flex-col justify-between rounded-2xl border border-dashed p-4 text-start transition-colors",
                      selected === "none" ? "border-accent bg-accent-soft/50" : "border-border-strong hover:bg-surface-2/60")}>
                    <span className="flex items-center gap-2 text-sm font-medium text-fg"><FolderOpen className="size-4 text-fg-3" />{t("knowledge.unassigned")}</span>
                    <span className="mt-3 text-[12.5px] text-fg-3">
                      {t("knowledge.base.files", { n: data.unassigned.fileCount })} · {t("knowledge.base.chunks", { n: data.unassigned.chunkCount.toLocaleString() })}
                    </span>
                  </button>
                )}
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-5">
            <div className="min-w-0 lg:col-span-3">
              {selected ? <BaseFiles selection={selected} base={selectedBase} bases={bases} onChanged={reload} /> : (
                <Card><EmptyState icon={<Layers className="size-5" />} title={t("knowledge.selectBase")} /></Card>
              )}
            </div>
            <div className="min-w-0 lg:col-span-2">
              <SearchPlayground bases={bases} defaultBaseId={selected && selected !== "none" ? selected : null} />
            </div>
          </div>
        </>
      )}

      <BaseDialog target={editing} onClose={() => setEditing(null)} onSaved={(b) => { setEditing(null); setSelected(b.id); void reload(); }} />
      <DeleteBaseDialog base={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); setSelected(null); void reload(); }} />
    </Page>
  );
}

function HowItWorks() {
  const { t } = useApp();
  const steps = [
    { icon: Upload, title: t("knowledge.how.step1"), body: t("knowledge.how.step1Body") },
    { icon: ScanText, title: t("knowledge.how.step2"), body: t("knowledge.how.step2Body") },
    { icon: FileSearch, title: t("knowledge.how.step3"), body: t("knowledge.how.step3Body") },
  ];
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="border-b border-border bg-surface-2/50 px-5 py-4">
        <p className="text-[15px] font-semibold text-fg">{t("knowledge.how.title")}</p>
        <p className="mt-0.5 text-[13px] text-fg-3">{t("knowledge.how.body")}</p>
      </div>
      <ol className="grid gap-px bg-border sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 bg-surface px-5 py-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text"><s.icon className="size-4" /></span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-fg">{i + 1}. {s.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-3">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function BaseCard({ base, active, onSelect, onEdit, onDelete }: {
  base: KnowledgeBase; active: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const { t, can } = useApp();
  return (
    <div className={cx("group relative flex flex-col rounded-2xl border bg-surface p-4 shadow-card transition-colors",
      active ? "border-accent ring-3 ring-[var(--ring)]" : "border-border hover:border-border-strong")}>
      <button onClick={onSelect} className="absolute inset-0 rounded-2xl" aria-label={base.name} aria-pressed={active} />
      <div className="flex items-start gap-3">
        <span className={cx("grid size-9 shrink-0 place-items-center rounded-xl", active ? "bg-accent text-white" : "bg-accent-soft text-accent-text")}>
          <Library className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg" dir="auto">{base.name}</p>
          <p className="mt-0.5 line-clamp-2 min-h-[2.4em] text-[12.5px] leading-snug text-fg-3" dir="auto">{base.description || t("knowledge.base.noDescription")}</p>
        </div>
        {can("member") && (
          <div className="relative z-10 -me-1 -mt-1 flex opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button onClick={onEdit} className="rounded-md p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label={t("action.edit")}><Pencil className="size-3.5" /></button>
            {can("admin") && (
              <button onClick={onDelete} className="rounded-md p-1.5 text-fg-3 hover:bg-danger-soft hover:text-danger" aria-label={t("action.delete")}><Trash2 className="size-3.5" /></button>
            )}
          </div>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
        <div><dt className="text-[11px] text-fg-3">{t("knowledge.base.filesLabel")}</dt><dd className="text-sm font-semibold tabular-nums text-fg">{base.fileCount}</dd></div>
        <div><dt className="text-[11px] text-fg-3">{t("knowledge.base.chunksLabel")}</dt><dd className="text-sm font-semibold tabular-nums text-fg">{base.chunkCount.toLocaleString()}</dd></div>
        <div><dt className="text-[11px] text-fg-3">{t("knowledge.base.sizeLabel")}</dt><dd className="text-sm font-semibold tabular-nums text-fg">{formatBytes(base.totalBytes)}</dd></div>
      </dl>
    </div>
  );
}

function BaseFiles({ selection, base, bases, onChanged }: { selection: string; base: KnowledgeBase | null; bases: KnowledgeBase[]; onChanged: () => void }) {
  const { t, can } = useApp();
  const [showUpload, setShowUpload] = useState(false);
  const { data, error, loading, reload } = useApi<FilesResponse>(`/api/files?knowledgeBaseId=${encodeURIComponent(selection)}`, {
    intervalMs: (d) => (d?.files.some((f) => f.status === "processing" || f.status === "pending") ? 4000 : null),
  });
  const refresh = () => { void reload(); onChanged(); };
  const canUpload = can("member") && selection !== "none";
  const files = data?.files ?? [];

  return (
    <Card>
      <CardHeader
        title={<span dir="auto">{selection === "none" ? t("knowledge.unassigned") : base?.name ?? ""}</span>}
        description={selection === "none" ? t("knowledge.unassignedBody") : t("knowledge.filesInBase", { n: files.length })}
        actions={canUpload && (
          <Button size="sm" variant={showUpload ? "secondary" : "outline"} icon={<Upload className="size-4" />} onClick={() => setShowUpload((v) => !v)}>
            {showUpload ? t("files.upload.hide") : t("knowledge.addFiles")}
          </Button>
        )}
      />
      {canUpload && (showUpload || (!loading && files.length === 0)) && (
        <div className="px-5 pb-4">
          <UploadZone compact knowledgeBaseId={selection} maxUploadBytes={data?.limits.maxUploadBytes} onUploaded={refresh} />
        </div>
      )}
      <div className="border-t border-border">
        {loading && !data ? <div className="p-4"><LoadingBlock rows={3} /></div>
          : error ? <div className="p-4"><ErrorState error={error} onRetry={reload} /></div>
            : files.length === 0 ? (
              <EmptyState icon={<FolderOpen className="size-5" />} title={t("knowledge.noFiles")} description={canUpload ? t("knowledge.noFilesBody") : undefined} />
            ) : <FilesTable files={files} bases={bases} onChanged={refresh} showBase={false} />}
      </div>
    </Card>
  );
}

function BaseDialog({ target, onClose, onSaved }: { target: KnowledgeBase | "new" | null; onClose: () => void; onSaved: (b: KnowledgeBase) => void }) {
  const { t } = useApp();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = target === "new";

  useEffect(() => {
    if (!target) return;
    setName(target === "new" ? "" : target.name);
    setDescription(target === "new" ? "" : target.description ?? "");
    setError(null);
  }, [target]);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!target || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), description: description.trim() || null };
      const r = isNew
        ? await api<{ base: KnowledgeBase }>("/api/knowledge/bases", { method: "POST", body })
        : await api<{ base: KnowledgeBase }>(`/api/knowledge/bases/${target.id}`, { method: "PATCH", body });
      onSaved(r.base);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onClose={onClose} title={isNew ? t("knowledge.base.createTitle") : t("knowledge.base.editTitle")}
      description={isNew ? t("knowledge.base.createBody") : undefined}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("action.cancel")}</Button>
        <Button onClick={() => void save()} loading={busy} disabled={!name.trim()}>{isNew ? t("action.create") : t("action.save")}</Button>
      </>}>
      <form onSubmit={save} className="space-y-4">
        <Field label={t("knowledge.base.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus dir="auto" placeholder={t("knowledge.base.namePlaceholder")} />
        </Field>
        <Field label={t("knowledge.base.description")} hint={t("knowledge.base.descriptionHint")}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} dir="auto" />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

function DeleteBaseDialog({ base, onClose, onDone }: { base: KnowledgeBase | null; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [base]);

  const remove = async () => {
    if (!base) return;
    setBusy(true);
    try {
      await api(`/api/knowledge/bases/${base.id}`, { method: "DELETE" });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(base)} onClose={onClose} size="sm" title={t("knowledge.base.deleteTitle")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("action.cancel")}</Button>
        <Button variant="danger" onClick={remove} loading={busy} icon={<Trash2 className="size-4" />}>{t("action.delete")}</Button>
      </>}>
      <p className="text-sm text-fg-2">{t("knowledge.base.deleteBody", { name: base?.name ?? "", n: base?.fileCount ?? 0 })}</p>
      {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}
    </Dialog>
  );
}

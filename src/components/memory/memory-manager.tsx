"use client";

import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Brain, Check, Info, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  Alert, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, LoadingBlock, PageHeader, Select, Tabs, Textarea, cx,
} from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { timeAgo, useApi } from "@/lib/client/hooks";
import { useFormat } from "@/components/analytics/format";

type Status = "active" | "proposed" | "archived";
type Scope = "user" | "workspace" | "task";
const KINDS = ["fact", "preference", "decision", "context", "workflow", "note"] as const;
type Kind = (typeof KINDS)[number];

interface Memory {
  id: string; scope: Scope; kind: Kind; content: string; source: "user" | "agent" | "system"; status: Status;
  importance: number; userId: string | null; taskId: string | null; createdAt: string; updatedAt: string;
}

const MAX = 4000;

export function MemoryManager() {
  const { t, can } = useApp();
  const [tab, setTab] = useState<Status>("active");
  const [scope, setScope] = useState<"" | Scope>("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const { data, error, loading, reload, setData } = useApi<{ memories: Memory[] }>(`/api/memory${scope ? `?scope=${scope}` : ""}`);
  const canWrite = can("member");

  const all = useMemo(() => data?.memories ?? [], [data]);
  const counts = useMemo(() => ({
    active: all.filter((m) => m.status === "active").length,
    proposed: all.filter((m) => m.status === "proposed").length,
    archived: all.filter((m) => m.status === "archived").length,
  }), [all]);
  const shown = all.filter((m) => m.status === tab && (!q.trim() || m.content.toLowerCase().includes(q.trim().toLowerCase())));

  const replace = (m: Memory) => setData((d) => (d ? { memories: d.memories.map((x) => (x.id === m.id ? m : x)) } : d));
  const remove = (id: string) => setData((d) => (d ? { memories: d.memories.filter((x) => x.id !== id) } : d));

  return (
    <>
      <PageHeader
        icon={<Brain className="size-5" />}
        title={t("nav.memory")}
        description={t("memory.subtitle")}
        actions={canWrite ? <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>{t("memory.add")}</Button> : undefined}
      />

      <div className="mb-5 flex items-start gap-3 rounded-xl border border-info-soft bg-info-soft/60 px-4 py-3 text-[13px] text-fg-2">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="space-y-1">
          <p>{t("memory.explain.retrieval")}</p>
          <p>{t("memory.explain.secrets")}</p>
          <p>{t("memory.explain.proposals")}</p>
        </div>
      </div>

      {notice && <div className="mb-4" role="status" aria-live="polite"><Alert tone={notice.tone} action={<button onClick={() => setNotice(null)} aria-label={t("action.close")}><X className="size-4" /></button>}>{notice.text}</Alert></div>}

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs<Status> value={tab} onChange={setTab} items={[
          { value: "active", label: t("memory.tab.active"), count: counts.active },
          { value: "proposed", label: t("memory.tab.proposed"), count: counts.proposed },
          { value: "archived", label: t("memory.tab.archived"), count: counts.archived },
        ]} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("memory.search")} aria-label={t("memory.search")} className="ps-9" />
          </div>
          <Select value={scope} onChange={(e) => setScope(e.target.value as "" | Scope)} aria-label={t("memory.scope")} className="sm:w-44">
            <option value="">{t("memory.scope.all")}</option>
            <option value="user">{t("memory.scope.user")}</option>
            <option value="workspace">{t("memory.scope.workspace")}</option>
            <option value="task">{t("memory.scope.task")}</option>
          </Select>
        </div>
      </div>

      {tab === "proposed" && counts.proposed > 0 && (
        <p className="mb-3 text-[13px] text-fg-3">{t("memory.proposedHint")}</p>
      )}

      {error && !data ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <LoadingBlock rows={4} /> : shown.length === 0 ? (
        <Card>
          <EmptyState icon={<Brain className="size-5" />}
            title={q ? t("memory.noMatch") : t(`memory.empty.${tab}`)}
            description={q ? undefined : t(`memory.empty.${tab}.desc`)}
            action={tab === "active" && canWrite && !q ? <Button variant="outline" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>{t("memory.add")}</Button> : undefined} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {shown.map((m) => (
            <MemoryRow key={m.id} m={m} canWrite={canWrite} onChanged={replace} onRemoved={remove} onNotice={setNotice} />
          ))}
        </ul>
      )}

      <AddMemoryDialog open={adding} onClose={() => setAdding(false)}
        onAdded={(m) => {
          setAdding(false);
          setData((d) => (d ? { memories: [m, ...d.memories] } : d));
          setTab(m.status);
          setNotice({ tone: "success", text: t("memory.added") });
        }} />
    </>
  );
}

function ImportanceInput({ value, onChange, id }: { value: number; onChange: (v: number) => void; id: string }) {
  const { t } = useApp();
  return (
    <div className="flex items-center gap-3">
      <input id={id} type="range" min={0} max={1} step={0.1} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 flex-1 accent-[var(--accent)]" aria-valuetext={`${Math.round(value * 100)}%`} />
      <span className="w-20 text-end text-[12.5px] tabular-nums text-fg-2">{importanceLabel(t, value)}</span>
    </div>
  );
}

function importanceLabel(t: (k: string, v?: Record<string, string | number>) => string, v: number) {
  const level = v >= 0.75 ? "high" : v >= 0.4 ? "medium" : "low";
  return `${t(`memory.importance.${level}`)} · ${Math.round(v * 100)}%`;
}

function MemoryRow({ m, canWrite, onChanged, onRemoved, onNotice }: {
  m: Memory; canWrite: boolean; onChanged: (m: Memory) => void; onRemoved: (id: string) => void;
  onNotice: (n: { tone: "success" | "danger"; text: string } | null) => void;
}) {
  const { t } = useApp();
  const f = useFormat();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(m.content);
  const [kind, setKind] = useState<Kind>(m.kind);
  const [importance, setImportance] = useState(m.importance);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patch = async (body: Record<string, unknown>, action: string, successText: string) => {
    setBusy(action); setErr(null);
    try {
      const r = await api<{ memory: Memory }>(`/api/memory/${m.id}`, { method: "PATCH", body });
      onChanged(r.memory);
      onNotice({ tone: "success", text: successText });
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally { setBusy(null); }
  };

  const saveEdit = async () => {
    const body: Record<string, unknown> = {};
    if (content.trim() !== m.content) body.content = content.trim();
    if (kind !== m.kind) body.kind = kind;
    if (importance !== m.importance) body.importance = importance;
    if (!Object.keys(body).length) { setEditing(false); return; }
    if (await patch(body, "edit", t("memory.updated"))) setEditing(false);
  };

  const del = async () => {
    setBusy("delete"); setErr(null);
    try {
      await api(`/api/memory/${m.id}`, { method: "DELETE" });
      setConfirmDelete(false);
      onRemoved(m.id);
      onNotice({ tone: "success", text: t("memory.deleted") });
    } catch (e) {
      setConfirmDelete(false);
      setErr((e as Error).message);
    } finally { setBusy(null); }
  };

  const sourceTone = m.source === "agent" ? "accent" : m.source === "system" ? "info" : "neutral";
  const editId = `mem-imp-${m.id}`;

  return (
    <li>
      <Card className={cx("p-4", m.status === "proposed" && "border-warning/40")}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={m.scope === "workspace" ? "info" : m.scope === "task" ? "accent" : "neutral"}>{t(`memory.scope.${m.scope}`)}</Badge>
          <Badge>{t(`memory.kind.${m.kind}`)}</Badge>
          <Badge tone={sourceTone}>{t(`memory.source.${m.source}`)}</Badge>
          {m.status === "proposed" && <Badge tone="warning" dot>{t("status.proposed")}</Badge>}
          <span className="ms-auto text-[12px] text-fg-3" title={f.date(m.updatedAt)}>{t("memory.updatedAgo", { time: timeAgo(m.updatedAt, t) })}</span>
        </div>

        {editing ? (
          <div className="mt-3 space-y-3">
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} maxLength={MAX} dir="auto" aria-label={t("memory.content")} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("memory.kind")}>
                <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                  {KINDS.map((k) => <option key={k} value={k}>{t(`memory.kind.${k}`)}</option>)}
                </Select>
              </Field>
              <div>
                <label htmlFor={editId} className="mb-1.5 block text-[13px] font-medium text-fg-2">{t("memory.importance")}</label>
                <ImportanceInput id={editId} value={importance} onChange={setImportance} />
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-3 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-fg" dir="auto">{m.content}</p>
        )}

        {!editing && (
          <div className="mt-3 flex items-center gap-2 text-[12px] text-fg-3">
            <span>{t("memory.importance")}</span>
            <span aria-hidden className="inline-block h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${m.importance * 100}%` }} />
            </span>
            <span className="tabular-nums">{importanceLabel(t, m.importance)}</span>
          </div>
        )}

        {err && <div className="mt-3"><Alert tone="danger">{err}</Alert></div>}

        {canWrite && (
          <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
            {editing ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setContent(m.content); setKind(m.kind); setImportance(m.importance); setErr(null); }}>{t("action.cancel")}</Button>
                <Button size="sm" loading={busy === "edit"} disabled={content.trim().length < 2} onClick={saveEdit}>{t("action.save")}</Button>
              </>
            ) : (
              <>
                {m.status === "proposed" && (
                  <>
                    <Button size="sm" variant="success" icon={<Check className="size-3.5" />} loading={busy === "approve"}
                      onClick={() => patch({ status: "active" }, "approve", t("memory.approved"))}>{t("action.approve")}</Button>
                    <Button size="sm" variant="outline" icon={<X className="size-3.5" />} loading={busy === "reject"}
                      onClick={() => patch({ status: "archived" }, "reject", t("memory.rejected"))}>{t("memory.rejectArchive")}</Button>
                  </>
                )}
                {m.status === "archived" && (
                  <Button size="sm" variant="outline" icon={<ArchiveRestore className="size-3.5" />} loading={busy === "restore"}
                    onClick={() => patch({ status: "active" }, "restore", t("memory.restored"))}>{t("memory.restore")}</Button>
                )}
                <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>{t("action.edit")}</Button>
                {m.status === "active" && (
                  <Button size="sm" variant="ghost" icon={<Archive className="size-3.5" />} loading={busy === "archive"}
                    onClick={() => patch({ status: "archived" }, "archive", t("memory.archivedMsg"))}>{t("memory.archive")}</Button>
                )}
                <Button size="sm" variant="ghost" className="text-danger hover:text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>{t("action.delete")}</Button>
              </>
            )}
          </div>
        )}
      </Card>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} size="sm" title={t("memory.deleteTitle")}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={busy === "delete"} onClick={del}>{t("action.delete")}</Button>
        </>}>
        <p className="text-sm text-fg-2">{t("memory.deleteBody")}</p>
        <blockquote className="mt-3 line-clamp-4 border-s-2 border-border-strong ps-3 text-[13px] text-fg-3" dir="auto">{m.content}</blockquote>
      </Dialog>
    </li>
  );
}

function AddMemoryDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (m: Memory) => void }) {
  const { t } = useApp();
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<"user" | "workspace">("user");
  const [kind, setKind] = useState<Kind>("fact");
  const [importance, setImportance] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const close = () => { setErr(null); onClose(); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api<{ memory: Memory }>("/api/memory", { method: "POST", body: { content: content.trim(), scope, kind, importance } });
      setContent(""); setKind("fact"); setImportance(0.5);
      onAdded(r.memory);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={close} title={t("memory.addTitle")} description={t("memory.addDesc")}
      footer={<>
        <Button variant="ghost" onClick={close}>{t("action.cancel")}</Button>
        <Button type="submit" form="add-memory" loading={busy} disabled={content.trim().length < 2}>{t("memory.save")}</Button>
      </>}>
      <form id="add-memory" onSubmit={submit} className="space-y-4">
        {err && <Alert tone="danger" title={t("memory.rejectedByServer")}>{err}</Alert>}
        <Field label={t("memory.content")} hint={t("memory.contentHint", { n: content.length, max: MAX })}>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} maxLength={MAX} dir="auto" required
            placeholder={t("memory.contentPlaceholder")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("memory.scope")} hint={t(`memory.scope.${scope}.hint`)}>
            <Select value={scope} onChange={(e) => setScope(e.target.value as "user" | "workspace")}>
              <option value="user">{t("memory.scope.user")}</option>
              <option value="workspace">{t("memory.scope.workspace")}</option>
            </Select>
          </Field>
          <Field label={t("memory.kind")}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => <option key={k} value={k}>{t(`memory.kind.${k}`)}</option>)}
            </Select>
          </Field>
        </div>
        <div>
          <label htmlFor="new-mem-importance" className="mb-1.5 block text-[13px] font-medium text-fg-2">{t("memory.importance")}</label>
          <ImportanceInput id="new-mem-importance" value={importance} onChange={setImportance} />
          <p className="mt-1 text-xs text-fg-3">{t("memory.importanceHint")}</p>
        </div>
        <p className="flex items-start gap-2 text-[12.5px] text-fg-3"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t("memory.explain.secrets")}</p>
      </form>
    </Dialog>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive, ArchiveRestore, Copy, Download, Eye, LayoutTemplate, Pencil, Power, PowerOff, Trash2,
} from "lucide-react";
import { Alert, Button, Dialog, Field, Input, Textarea } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api, ApiError } from "@/lib/client/api";
import { FeedbackMessage, useFeedback } from "@/components/settings/shared";
import type { MenuItem } from "./shared";
import { activeTasksOf, downloadJson, localName, type AgentRecord } from "./types";

export type AgentAction = "view" | "edit" | "duplicate" | "activate" | "deactivate" | "archive" | "restore" | "export" | "template" | "delete";

type Pending =
  | { kind: "deactivate" | "archive" | "delete" | "duplicate" | "template"; agent: AgentRecord }
  | null;

/**
 * Lifecycle and maintenance actions for one agent, with every confirmation the spec asks for:
 * deactivate explains the effect, archive handles 409 active_tasks (offer force), delete needs the typed
 * agent ID. Returns menu items, an imperative `run`, the dialogs element and a feedback line.
 */
export function useAgentActions({ onChanged }: { onChanged?: (action: AgentAction, agent: AgentRecord) => void } = {}) {
  const { t, can, locale } = useApp();
  const router = useRouter();
  const admin = can("admin");
  const [fb, setFb] = useFeedback();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<Array<{ id: string; title: string; status: string | null }>>([]);
  const [typed, setTyped] = useState("");
  const [dup, setDup] = useState({ nameAr: "", nameEn: "" });
  const [tpl, setTpl] = useState({ name: "", nameAr: "", description: "", category: "custom" });

  const close = useCallback(() => { setPending(null); setError(null); setBlocking([]); setTyped(""); setBusy(false); }, []);
  const changed = useCallback((a: AgentAction, agent: AgentRecord) => onChanged?.(a, agent), [onChanged]);

  const lifecycle = useCallback(async (agent: AgentRecord, action: "activate" | "deactivate" | "archive" | "restore", force = false) => {
    setBusy(true); setError(null);
    try {
      const res = await api<{ agent: AgentRecord; affectedTasks?: unknown[] }>(`/api/agents/${encodeURIComponent(agent.slug)}/lifecycle`, { body: { action, force: force || undefined } });
      const n = Array.isArray(res.affectedTasks) ? res.affectedTasks.length : 0;
      setFb({ tone: "success", text: t(`agents.actions.done.${action}`, { name: localName(agent, locale), n }) });
      close();
      changed(action, res.agent ?? agent);
    } catch (err) {
      if (err instanceof ApiError && err.code === "active_tasks") {
        setBlocking(activeTasksOf(err.details));
        setError(err.message);
        if (!pending) setPending({ kind: action === "archive" ? "archive" : "deactivate", agent });
      } else if (pending) {
        setError((err as Error).message);
      } else {
        setFb({ tone: "danger", text: (err as Error).message });
      }
      setBusy(false);
    }
  }, [t, locale, setFb, close, changed, pending]);

  const exportAgent = useCallback(async (agent: AgentRecord) => {
    try {
      const data = await api<unknown>(`/api/agents/${encodeURIComponent(agent.slug)}/export`);
      downloadJson(`${agent.slug}.nexus-agent.json`, data);
    } catch (err) { setFb({ tone: "danger", text: (err as Error).message }); }
  }, [setFb]);

  const run = useCallback((action: AgentAction, agent: AgentRecord) => {
    setError(null); setBlocking([]); setTyped("");
    switch (action) {
      case "view": router.push(`/agents/${agent.slug}`); break;
      case "edit": router.push(`/agents/${agent.slug}/edit`); break;
      case "export": void exportAgent(agent); break;
      case "activate": case "restore": void lifecycle(agent, action); break;
      case "duplicate":
        setDup({ nameAr: agent.nameAr ? `${agent.nameAr} (نسخة)` : "", nameEn: agent.nameEn ? `${agent.nameEn} (copy)` : "" });
        setPending({ kind: "duplicate", agent }); break;
      case "template":
        setTpl({ name: agent.nameEn || agent.roleTitle, nameAr: agent.nameAr || agent.roleTitleAr, description: agent.description, category: "custom" });
        setPending({ kind: "template", agent }); break;
      default: setPending({ kind: action, agent });
    }
  }, [router, exportAgent, lifecycle]);

  const items = useCallback((agent: AgentRecord, opts: { exclude?: AgentAction[] } = {}): MenuItem[] => {
    const ex = new Set(opts.exclude ?? []);
    const orch = agent.isOrchestrator;
    const lc = agent.lifecycle;
    const all: Array<MenuItem & { action: AgentAction }> = [
      { action: "view", key: "view", label: t("agents.actions.view"), icon: <Eye className="size-4" />, onSelect: () => run("view", agent) },
      { action: "edit", key: "edit", label: t("agents.actions.edit"), icon: <Pencil className="size-4" />, onSelect: () => run("edit", agent), hidden: !admin || lc === "archived" },
      { action: "duplicate", key: "duplicate", label: t("agents.actions.duplicate"), icon: <Copy className="size-4" />, onSelect: () => run("duplicate", agent), hidden: !admin || orch },
      { action: "activate", key: "activate", label: t("agents.actions.activate"), icon: <Power className="size-4" />, onSelect: () => run("activate", agent), hidden: !admin || (lc !== "inactive" && lc !== "draft") },
      { action: "deactivate", key: "deactivate", label: t("agents.actions.deactivate"), icon: <PowerOff className="size-4" />, onSelect: () => run("deactivate", agent), hidden: !admin || orch || lc !== "active" },
      { action: "archive", key: "archive", label: t("agents.actions.archive"), icon: <Archive className="size-4" />, onSelect: () => run("archive", agent), hidden: !admin || orch || lc === "archived" },
      { action: "restore", key: "restore", label: t("agents.actions.restore"), icon: <ArchiveRestore className="size-4" />, onSelect: () => run("restore", agent), hidden: !admin || lc !== "archived" },
      { action: "export", key: "export", label: t("agents.actions.export"), icon: <Download className="size-4" />, onSelect: () => run("export", agent) },
      { action: "template", key: "template", label: t("agents.actions.saveTemplate"), icon: <LayoutTemplate className="size-4" />, onSelect: () => run("template", agent), hidden: !admin || orch },
      { action: "delete", key: "delete", label: t("agents.actions.delete"), icon: <Trash2 className="size-4" />, onSelect: () => run("delete", agent), danger: true, hidden: !admin || orch },
    ];
    return all.filter((i) => !ex.has(i.action));
  }, [t, admin, run]);

  const submitDuplicate = async () => {
    if (!pending) return;
    setBusy(true); setError(null);
    try {
      const res = await api<{ agent: AgentRecord }>(`/api/agents/${encodeURIComponent(pending.agent.slug)}/duplicate`, {
        body: { nameAr: dup.nameAr.trim() || undefined, nameEn: dup.nameEn.trim() || undefined },
      });
      close();
      changed("duplicate", res.agent);
      router.push(`/agents/${res.agent.slug}/edit?from=duplicate`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  };

  const submitTemplate = async () => {
    if (!pending) return;
    if (!tpl.name.trim() || !tpl.nameAr.trim()) { setError(t("agents.templates.nameRequired")); return; }
    setBusy(true); setError(null);
    try {
      await api("/api/agent-templates", { body: { fromAgent: pending.agent.slug, name: tpl.name.trim(), nameAr: tpl.nameAr.trim(), description: tpl.description, category: tpl.category || undefined } });
      setFb({ tone: "success", text: t("agents.templates.saved", { name: tpl.name.trim() }) });
      const a = pending.agent;
      close();
      changed("template", a);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  };

  const submitDelete = async () => {
    if (!pending) return;
    setBusy(true); setError(null); setBlocking([]);
    try {
      await api(`/api/agents/${encodeURIComponent(pending.agent.slug)}?confirm=${encodeURIComponent(typed.trim())}`, { method: "DELETE" });
      const a = pending.agent;
      setFb({ tone: "success", text: t("agents.actions.done.delete", { name: localName(a, locale) }) });
      close();
      changed("delete", a);
    } catch (err) {
      if (err instanceof ApiError && err.code === "active_tasks") setBlocking(activeTasksOf(err.details));
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const a = pending?.agent;
  const name = a ? localName(a, locale) : "";
  const taskList = blocking.length > 0 && (
    <div className="mt-3 rounded-xl border border-border bg-surface-2/60 p-3">
      <p className="text-[13px] font-medium text-fg">{t("agents.actions.activeTasks", { n: blocking.length })}</p>
      <ul className="mt-2 space-y-1 text-[13px] text-fg-2">
        {blocking.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2">
            <Link href={`/tasks/${x.id}`} className="truncate text-accent-text hover:underline">{x.title}</Link>
            {x.status && <span className="shrink-0 text-xs text-fg-3">{t(`status.${x.status}`)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );

  const element = (
    <>
      <Dialog open={pending?.kind === "deactivate"} onClose={close} size="sm" title={t("agents.actions.deactivateTitle", { name })}
        footer={<>
          <Button variant="ghost" onClick={close}>{t("action.cancel")}</Button>
          <Button variant="secondary" loading={busy} onClick={() => a && void lifecycle(a, "deactivate")}>{t("agents.actions.deactivate")}</Button>
        </>}>
        <p className="text-sm leading-relaxed text-fg-2">{t("agents.actions.deactivateBody")}</p>
        {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}
        {taskList}
      </Dialog>

      <Dialog open={pending?.kind === "archive"} onClose={close} size="md" title={t("agents.actions.archiveTitle", { name })}
        footer={<>
          <Button variant="ghost" onClick={close}>{t("action.cancel")}</Button>
          {blocking.length > 0
            ? <Button variant="danger" loading={busy} onClick={() => a && void lifecycle(a, "archive", true)}>{t("agents.actions.archiveForce")}</Button>
            : <Button variant="danger" loading={busy} onClick={() => a && void lifecycle(a, "archive")}>{t("agents.actions.archive")}</Button>}
        </>}>
        <p className="text-sm leading-relaxed text-fg-2">{t("agents.actions.archiveBody")}</p>
        {error && <div className="mt-3"><Alert tone={blocking.length ? "warning" : "danger"}>{error}</Alert></div>}
        {taskList}
        {blocking.length > 0 && <p className="mt-3 text-[13px] text-fg-3">{t("agents.actions.archiveForceHint")}</p>}
      </Dialog>

      <Dialog open={pending?.kind === "delete"} onClose={close} size="md" title={t("agents.actions.deleteTitle", { name })}
        footer={<>
          <Button variant="ghost" onClick={close}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={busy} disabled={!a || typed.trim() !== a.slug} onClick={() => void submitDelete()}>{t("agents.actions.deleteConfirm")}</Button>
        </>}>
        <div className="space-y-3">
          <Alert tone="danger" title={t("agents.actions.deleteWarnTitle")}>{t("agents.actions.deleteBody")}</Alert>
          <Field label={t("agents.actions.deleteType", { id: a?.slug ?? "" })}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} dir="ltr" className="font-mono" autoComplete="off" spellCheck={false} />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          {taskList}
        </div>
      </Dialog>

      <Dialog open={pending?.kind === "duplicate"} onClose={close} size="sm" title={t("agents.actions.duplicateTitle", { name })} description={t("agents.actions.duplicateBody")}
        footer={<>
          <Button variant="ghost" onClick={close}>{t("action.cancel")}</Button>
          <Button loading={busy} onClick={() => void submitDuplicate()}>{t("agents.actions.duplicate")}</Button>
        </>}>
        <div className="space-y-3">
          <Field label={t("agents.builder.nameAr")}><Input dir="rtl" value={dup.nameAr} onChange={(e) => setDup((d) => ({ ...d, nameAr: e.target.value }))} /></Field>
          <Field label={t("agents.builder.nameEn")}><Input dir="ltr" value={dup.nameEn} onChange={(e) => setDup((d) => ({ ...d, nameEn: e.target.value }))} /></Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </Dialog>

      <Dialog open={pending?.kind === "template"} onClose={close} size="md" title={t("agents.templates.saveTitle")} description={t("agents.templates.saveBody")}
        footer={<>
          <Button variant="ghost" onClick={close}>{t("action.cancel")}</Button>
          <Button loading={busy} onClick={() => void submitTemplate()}>{t("agents.templates.save")}</Button>
        </>}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("agents.templates.nameEn")}><Input dir="ltr" value={tpl.name} onChange={(e) => setTpl((d) => ({ ...d, name: e.target.value }))} /></Field>
            <Field label={t("agents.templates.nameAr")}><Input dir="rtl" value={tpl.nameAr} onChange={(e) => setTpl((d) => ({ ...d, nameAr: e.target.value }))} /></Field>
          </div>
          <Field label={t("agents.templates.description")}><Textarea rows={3} value={tpl.description} onChange={(e) => setTpl((d) => ({ ...d, description: e.target.value }))} /></Field>
          <Field label={t("agents.templates.category")}><Input value={tpl.category} onChange={(e) => setTpl((d) => ({ ...d, category: e.target.value }))} /></Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </Dialog>
    </>
  );

  const feedback = <FeedbackMessage fb={fb} onDismiss={() => setFb(null)} />;
  return { items, run, element, feedback, setFeedback: setFb };
}

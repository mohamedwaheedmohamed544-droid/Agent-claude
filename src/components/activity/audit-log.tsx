"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Activity, ChevronDown, Cog, Lock, RefreshCw, ScrollText } from "lucide-react";
import { AgentAvatar, Alert, Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Select, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/hooks";
import { tOr, useFormat } from "@/components/analytics/format";

interface AuditLog {
  id: string; actorType: "user" | "agent" | "system"; actor: string | null; action: string;
  targetType: string | null; targetId: string | null; metadata: Record<string, unknown> | null; createdAt: string;
  userName: string | null; userEmail: string | null;
}

export const ACTION_PREFIXES = [
  "auth", "task", "step", "approval", "tool", "memory", "agent", "settings", "member", "emergency_stop", "integration", "file",
] as const;
const PAGE = 50;

export function AuditLogView() {
  const { t, can } = useApp();
  if (!can("admin")) {
    return (
      <>
        <PageHeader icon={<Activity className="size-5" />} title={t("nav.activity")} description={t("activity.subtitle")} />
        <Card><EmptyState icon={<Lock className="size-5" />} title={t("activity.adminOnly")} description={t("activity.adminOnlyDesc")} /></Card>
      </>
    );
  }
  return <AuditStream />;
}

function AuditStream() {
  const { t } = useApp();
  const f = useFormat();
  const [action, setAction] = useState("");
  const [actorType, setActorType] = useState("");
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const reqId = useRef(0);

  const build = useCallback((before?: string) => {
    const sp = new URLSearchParams({ limit: String(PAGE) });
    if (action) sp.set("action", action);
    if (actorType) sp.set("actorType", actorType);
    if (before) sp.set("before", before);
    return `/api/audit?${sp}`;
  }, [action, actorType]);

  const loadFirst = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true); setError(null); setMoreError(null);
    try {
      const r = await api<{ logs: AuditLog[]; nextBefore: string | null }>(build());
      if (id !== reqId.current) return;
      setLogs(r.logs); setNext(r.nextBefore);
    } catch (e) {
      if (id === reqId.current) setError(e as Error);
    } finally { if (id === reqId.current) setLoading(false); }
  }, [build]);

  useEffect(() => { void loadFirst(); }, [loadFirst]);

  const loadMore = async () => {
    if (!next) return;
    const id = reqId.current;
    setLoading(true); setMoreError(null);
    try {
      const r = await api<{ logs: AuditLog[]; nextBefore: string | null }>(build(next));
      if (id !== reqId.current) return;
      setLogs((cur) => [...(cur ?? []), ...r.logs]); setNext(r.nextBefore);
    } catch (e) {
      setMoreError((e as Error).message);
    } finally { if (id === reqId.current) setLoading(false); }
  };

  // Group rows by local calendar day for scannability.
  const groups: Array<{ day: string; label: string; rows: AuditLog[] }> = [];
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  for (const l of logs ?? []) {
    const d = new Date(l.createdAt);
    const key = d.toDateString();
    const label = key === today ? t("activity.today") : key === yesterday ? t("activity.yesterday") : f.fullDay(d);
    const g = groups.at(-1);
    if (g && g.day === key) g.rows.push(l); else groups.push({ day: key, label, rows: [l] });
  }
  const filtered = Boolean(action || actorType);

  return (
    <>
      <PageHeader
        icon={<Activity className="size-5" />}
        title={t("nav.activity")}
        description={t("activity.subtitle")}
        actions={<Button variant="outline" icon={<RefreshCw className={cx("size-4", loading && "animate-spin")} />} onClick={loadFirst} disabled={loading}>{t("action.refresh")}</Button>}
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="audit-action">{t("activity.filter.action")}</label>
          <Select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} className="sm:w-56">
            <option value="">{t("activity.filter.allActions")}</option>
            {ACTION_PREFIXES.map((p) => <option key={p} value={p}>{t(`activity.prefix.${p}`)}</option>)}
          </Select>
          <label className="sr-only" htmlFor="audit-actor">{t("activity.filter.actor")}</label>
          <Select id="audit-actor" value={actorType} onChange={(e) => setActorType(e.target.value)} className="sm:w-48">
            <option value="">{t("activity.filter.allActors")}</option>
            <option value="user">{t("activity.actor.user")}</option>
            <option value="agent">{t("activity.actor.agent")}</option>
            <option value="system">{t("activity.actor.system")}</option>
          </Select>
          {filtered && <Button variant="ghost" size="sm" onClick={() => { setAction(""); setActorType(""); }}>{t("activity.filter.clear")}</Button>}
          {logs && <p className="text-[12px] text-fg-3 sm:ms-auto" aria-live="polite">{t("activity.showing", { n: logs.length })}</p>}
        </div>
      </Card>

      {error && !logs ? <ErrorState error={error} onRetry={loadFirst} /> : !logs ? <LoadingBlock rows={6} /> : logs.length === 0 ? (
        <Card><EmptyState icon={<ScrollText className="size-5" />} title={filtered ? t("activity.emptyFiltered") : t("activity.empty")} /></Card>
      ) : (
        <Card>
          {error && <div className="p-3"><ErrorState error={error} onRetry={loadFirst} /></div>}
          <ol aria-label={t("activity.logLabel")}>
            {groups.map((g) => (
              <Fragment key={g.day}>
                <li className="sticky top-14 z-[1] border-b first:rounded-t-2xl border-border bg-surface-2/95 px-4 py-1.5 text-[12px] font-semibold text-fg-3 backdrop-blur">
                  {g.label}
                </li>
                {g.rows.map((l) => <LogRow key={l.id} log={l} />)}
              </Fragment>
            ))}
          </ol>
          <div className="flex flex-col items-center gap-2 border-t border-border p-4">
            {moreError && <Alert tone="danger">{moreError}</Alert>}
            {next ? (
              <Button variant="outline" onClick={loadMore} loading={loading}>{t("activity.loadMore")}</Button>
            ) : (
              <p className="text-[12.5px] text-fg-3">{t("activity.end", { n: logs.length })}</p>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

function actionTone(action: string): string {
  if (/(failed|blocked|rejected|removed|deleted|login_failed|engaged)$/.test(action)) return "bg-danger";
  if (/^approval\.|requested$|reset$|role_changed$/.test(action)) return "bg-warning";
  if (/(completed|executed|approved|released|created|added|signup|login)$/.test(action)) return "bg-success";
  return "bg-accent";
}

function LogRow({ log: l }: { log: AuditLog }) {
  const { t } = useApp();
  const f = useFormat();
  const [open, setOpen] = useState(false);
  const meta = l.metadata && Object.keys(l.metadata).length ? l.metadata : null;
  const label = tOr(t, `activity.action.${l.action}`, l.action);
  const taskId = typeof meta?.taskId === "string" ? meta.taskId : l.targetType === "task" ? l.targetId : null;
  const detailId = `audit-meta-${l.id}`;

  return (
    <li className="border-b border-border last:border-0">
      <div className="flex gap-3 px-4 py-3">
        <span aria-hidden className={cx("mt-2 size-2 shrink-0 rounded-full", actionTone(l.action))} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Actor log={l} />
              <span className="text-[13.5px] text-fg">{label}</span>
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-3" dir="ltr">{l.action}</code>
            </div>
            <time dateTime={l.createdAt} title={f.date(l.createdAt)} className="shrink-0 text-[12px] tabular-nums text-fg-3">
              {f.time(l.createdAt)} · {timeAgo(l.createdAt, t)}
            </time>
          </div>
          {(l.targetType || taskId) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-3">
              {l.targetType && (
                <span>
                  {tOr(t, `activity.target.${l.targetType}`, l.targetType)}
                  {l.targetId && <>: <span className="break-all font-mono text-fg-2" dir="ltr">{l.targetId.length > 40 ? `${l.targetId.slice(0, 8)}…` : l.targetId}</span></>}
                </span>
              )}
              {taskId && <Link href={`/tasks/${taskId}`} className="font-medium text-accent hover:underline">{t("activity.openTask")}</Link>}
            </p>
          )}
          {meta && (
            <div className="mt-1.5">
              <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={detailId}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-fg-3 hover:text-fg">
                <ChevronDown className={cx("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
                {open ? t("activity.hideDetails") : t("activity.showDetails")}
              </button>
              {open && (
                <pre id={detailId} dir="ltr" className="mt-1.5 max-h-80 overflow-auto rounded-lg border border-border bg-surface-2 p-3 text-start font-mono text-[12px] leading-relaxed text-fg-2">
                  {JSON.stringify(meta, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function Actor({ log: l }: { log: AuditLog }) {
  const { t } = useApp();
  if (l.actorType === "agent") {
    const slug = l.actor ?? "orchestrator";
    return (
      <span className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-fg">
        <AgentAvatar slug={slug} size="sm" />{tOr(t, `agent.${slug}`, slug)}
      </span>
    );
  }
  if (l.actorType === "system" || (!l.userName && !l.userEmail)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-fg">
        <span className="grid size-6 place-items-center rounded-md bg-surface-3 text-fg-3"><Cog className="size-3.5" aria-hidden /></span>
        {l.actorType === "system" ? t("activity.actor.system") : (l.actor ?? t("activity.actor.unknown"))}
      </span>
    );
  }
  const name = l.userName || l.userEmail || "?";
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium text-fg" title={l.userEmail ?? undefined}>
      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent-text">{initials}</span>
      <span className="truncate">{name}</span>
    </span>
  );
}

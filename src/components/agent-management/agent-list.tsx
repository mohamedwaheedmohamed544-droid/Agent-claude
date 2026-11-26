"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Archive, Bot, CircleDot, Coffee, Power, PowerOff, Search, Users, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Select, Skeleton, Stat, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { timeAgo, useApi } from "@/lib/client/hooks";
import { useAgentActions } from "./agent-actions";
import { ActionMenu, AgentFace, ChipRow, Checkbox, LifecycleBadge, PresenceBadge } from "./shared";
import { LIFECYCLES, PRESENCE_STATUSES, localDept, localName, localRole, type AgentListItem, type AgentListResponse, type DepartmentRecord } from "./types";

type Sort = "name" | "department" | "lastActive" | "created";
type LifecycleFilter = "" | "active" | "inactive" | "draft" | "archived" | "all";

/** Agents tab of Agent Management: counts, filters, cards with actions, bulk activate/deactivate. */
export function AgentList() {
  const { t, locale, can } = useApp();
  const admin = can("admin");
  const router = useRouter();
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<"activate" | "deactivate" | null>(null);

  const params = new URLSearchParams();
  if (lifecycle) params.set("lifecycle", lifecycle);
  if (department) params.set("department", department);
  const qs = params.toString();
  const list = useApi<AgentListResponse>(`/api/agents${qs ? `?${qs}` : ""}`, { intervalMs: 15_000 });
  const depts = useApi<{ departments: DepartmentRecord[] }>("/api/departments");
  const actions = useAgentActions({ onChanged: () => { void list.reload(); } });

  const agents = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (list.data?.agents ?? []).filter((a) => {
      if (status && (a.lifecycle !== "active" || (a.presence?.status ?? "idle") !== status)) return false;
      if (!needle) return true;
      return [a.nameAr, a.nameEn, a.slug, a.roleTitle, a.roleTitleAr, a.departmentName ?? "", a.departmentNameAr ?? "", ...a.skillNames]
        .join(" ").toLowerCase().includes(needle);
    });
    const cmp: Record<Sort, (a: AgentListItem, b: AgentListItem) => number> = {
      name: (a, b) => localName(a, locale).localeCompare(localName(b, locale), locale),
      department: (a, b) => (localDept({ name: a.departmentName ?? "", nameAr: a.departmentNameAr ?? "" }, locale))
        .localeCompare(localDept({ name: b.departmentName ?? "", nameAr: b.departmentNameAr ?? "" }, locale), locale) || localName(a, locale).localeCompare(localName(b, locale), locale),
      lastActive: (a, b) => (b.stats.lastRun ?? "").localeCompare(a.stats.lastRun ?? ""),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    };
    // The orchestrator always leads the list.
    return rows.sort((a, b) => Number(b.isOrchestrator) - Number(a.isOrchestrator) || cmp[sort](a, b));
  }, [list.data, q, status, sort, locale]);

  const deptColor = useMemo(() => new Map((depts.data?.departments ?? []).map((d) => [d.key, d.color])), [depts.data]);
  const selectable = agents.filter((a) => !a.isOrchestrator && a.lifecycle !== "archived");
  const toggle = (slug: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(slug); else n.delete(slug); return n; });
  const visibleSelected = [...selected].filter((s) => selectable.some((a) => a.slug === s));

  const bulk = async (action: "activate" | "deactivate") => {
    setBulkBusy(action);
    try {
      const res = await api<{ results: Array<{ slug: string; ok: boolean; error?: string }> }>("/api/agents/bulk", { body: { slugs: visibleSelected, action } });
      const failed = res.results.filter((r) => !r.ok);
      const ok = res.results.length - failed.length;
      actions.setFeedback(failed.length
        ? { tone: "danger", text: t("agents.bulk.partial", { ok, failed: failed.length, details: failed.map((f) => `${f.slug}: ${f.error ?? "—"}`).join(" · ") }) }
        : { tone: "success", text: t(`agents.bulk.done.${action}`, { n: ok }) });
      setSelected(new Set());
      await list.reload();
    } catch (err) {
      actions.setFeedback({ tone: "danger", text: (err as Error).message });
    } finally { setBulkBusy(null); }
  };

  const c = list.data?.counts;
  return (
    <div className="space-y-5">
      {c ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label={t("agents.counts.total")} value={c.total} icon={<Users className="size-4" />} />
            <Stat label={t("agents.counts.active")} value={c.active} icon={<Power className="size-4" />} tone="success" />
            <Stat label={t("agents.counts.working")} value={c.working} icon={<Activity className="size-4" />} tone="accent" />
            <Stat label={t("agents.counts.idle")} value={c.idle} icon={<Coffee className="size-4" />} tone="neutral" />
            <Stat label={t("agents.counts.inMeetings")} value={c.inMeetings} icon={<CircleDot className="size-4" />} tone="info" />
            <Stat label={t("agents.counts.archived")} value={c.archived} icon={<Archive className="size-4" />} tone="neutral" />
          </div>
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            <button type="button" onClick={() => setLifecycle("draft")} className="rounded-full focus-visible:outline-offset-2"><Badge tone="neutral">{t("agents.counts.draft", { n: c.draft })}</Badge></button>
            <button type="button" onClick={() => setLifecycle("inactive")} className="rounded-full focus-visible:outline-offset-2"><Badge tone="warning">{t("agents.counts.inactive", { n: c.inactive })}</Badge></button>
          </div>
        </>
      ) : list.loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : null}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("agents.filter.search")} aria-label={t("agents.filter.search")} className="ps-9" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex">
          <Select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label={t("agents.filter.department")} className="lg:w-44">
            <option value="">{t("agents.filter.allDepartments")}</option>
            {(depts.data?.departments ?? []).map((d) => <option key={d.key} value={d.key}>{localDept(d, locale)}</option>)}
          </Select>
          <Select value={lifecycle} onChange={(e) => setLifecycle(e.target.value as LifecycleFilter)} aria-label={t("agents.filter.lifecycle")} className="lg:w-40">
            <option value="">{t("agents.filter.notArchived")}</option>
            {LIFECYCLES.map((l) => <option key={l} value={l}>{t(`agents.lifecycle.${l}`)}</option>)}
            <option value="all">{t("agents.filter.all")}</option>
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("agents.filter.status")} className="lg:w-40">
            <option value="">{t("agents.filter.anyStatus")}</option>
            {PRESENCE_STATUSES.filter((s) => s !== "paused").map((s) => <option key={s} value={s}>{t(`agents.presence.${s}`)}</option>)}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("agents.filter.sort")} className="lg:w-44">
            {(["name", "department", "lastActive", "created"] as Sort[]).map((s) => <option key={s} value={s}>{t(`agents.sort.${s}`)}</option>)}
          </Select>
        </div>
      </div>

      {actions.feedback}

      {admin && visibleSelected.length > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent-text shadow-card" role="region" aria-label={t("agents.bulk.label")}>
          <span className="font-medium">{t("agents.bulk.selected", { n: visibleSelected.length })}</span>
          <div className="ms-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" icon={<Power className="size-4" />} loading={bulkBusy === "activate"} onClick={() => void bulk("activate")}>{t("agents.actions.activate")}</Button>
            <Button size="sm" variant="outline" icon={<PowerOff className="size-4" />} loading={bulkBusy === "deactivate"} onClick={() => void bulk("deactivate")}>{t("agents.actions.deactivate")}</Button>
            <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => setSelected(new Set())}>{t("agents.bulk.clear")}</Button>
          </div>
        </div>
      )}

      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}

      {list.loading && !list.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}</div>
      ) : list.data && agents.length === 0 ? (
        <Card>
          <EmptyState icon={<Bot className="size-5" />}
            title={q || status || department || lifecycle ? t("agents.empty.noMatch") : t("agents.empty.title")}
            description={q || status || department || lifecycle ? undefined : t("agents.empty.body")}
            action={admin && !(q || status || department || lifecycle) ? <Button onClick={() => router.push("/agents/new")}>{t("agents.create")}</Button> : undefined} />
        </Card>
      ) : (
        <>
          {admin && selectable.length > 0 && (
            <Checkbox checked={visibleSelected.length === selectable.length && selectable.length > 0}
              onChange={(on) => setSelected(on ? new Set(selectable.map((a) => a.slug)) : new Set())} label={t("agents.bulk.selectAll", { n: selectable.length })} />
          )}
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((a) => (
              <li key={a.slug}>
                <AgentCard agent={a} deptColor={deptColor.get(a.office?.departmentKey ?? "")} selectable={admin && !a.isOrchestrator && a.lifecycle !== "archived"} selected={selected.has(a.slug)}
                  onSelect={(on) => toggle(a.slug, on)} menu={<ActionMenu label={t("agents.actions.menu", { name: localName(a, locale) })} items={actions.items(a)} />} />
              </li>
            ))}
          </ul>
        </>
      )}
      {actions.element}
    </div>
  );
}

function AgentCard({ agent: a, deptColor, selectable, selected, onSelect, menu }: {
  agent: AgentListItem; deptColor?: string; selectable: boolean; selected: boolean; onSelect: (on: boolean) => void; menu: React.ReactNode;
}) {
  const { t, locale } = useApp();
  const dept = localDept({ name: a.departmentName ?? "", nameAr: a.departmentNameAr ?? "" }, locale);
  const muted = a.lifecycle === "archived" || a.lifecycle === "inactive";
  return (
    <article className={cx("relative flex h-full flex-col rounded-2xl border bg-surface p-4 shadow-card transition-colors",
      selected ? "border-accent ring-3 ring-[var(--ring)]" : "border-border hover:border-border-strong")}>
      <div className="flex items-start gap-3">
        {selectable && (
          <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={t("agents.bulk.selectOne", { name: localName(a, locale) })}
            className="mt-1 size-4 shrink-0 rounded border-border accent-[var(--accent)]" />
        )}
        <AgentFace color={a.color} appearance={a.office?.appearance} name={a.nameEn} size="md" className={cx(muted && "opacity-60 grayscale")} />
        <div className="min-w-0 flex-1">
          <Link href={`/agents/${a.slug}`} className="block rounded focus-visible:outline-offset-2">
            <h2 className="truncate text-[17px] font-semibold leading-snug text-fg" dir="rtl" lang="ar">{a.nameAr || a.nameEn}</h2>
            <p className="truncate text-[12.5px] text-fg-3" dir="ltr">{a.nameEn}</p>
          </Link>
        </div>
        {menu}
      </div>
      <p className="mt-2 truncate text-[13px] font-medium text-fg-2">{localRole(a, locale) || "—"}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {a.isOrchestrator && <Badge tone="accent">{t("agents.orchestrator")}</Badge>}
        <LifecycleBadge lifecycle={a.lifecycle} hideActive />
        <PresenceBadge presence={a.presence} lifecycle={a.lifecycle} />
        {dept && <Badge tone="neutral"><span className="size-2 rounded-full" style={{ background: deptColor ?? a.color }} aria-hidden />{dept}</Badge>}
      </div>
      <div className="mt-3 flex-1">
        {a.skillNames.length ? <ChipRow items={a.skillNames} max={3} tone="accent" /> : <p className="text-[12.5px] text-fg-3">{t("agents.builder.skills.none")}</p>}
      </div>
      <div className="mt-3 border-t border-border pt-2.5 text-[12.5px] text-fg-3">
        {a.currentTask ? (
          <Link href={`/tasks/${a.currentTask.id}`} className="flex items-center gap-1.5 text-accent-text hover:underline">
            <Activity className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{a.currentTask.title}</span>
          </Link>
        ) : a.presence?.activity ? (
          <p className="truncate">{a.presence.activity}</p>
        ) : (
          <p>{a.stats.lastRun ? t("agents.lastActive", { time: timeAgo(a.stats.lastRun, t) }) : t("agents.neverRun")}</p>
        )}
      </div>
    </article>
  );
}

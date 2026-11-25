"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Bot, CheckCircle2, Clock, ExternalLink, History, ListChecks, Settings2, Wrench, XCircle } from "lucide-react";
import {
  AgentAvatar, Badge, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, RiskBadge, Skeleton, Stat, StatusBadge, Table, Tabs, Td, Th,
} from "@/components/ui";
import { useApp } from "@/components/providers";
import { timeAgo, useApi } from "@/lib/client/hooks";
import { Meter } from "@/components/analytics/charts";
import { successRate, useFormat } from "@/components/analytics/format";
import { AgentConfigPanel, VersionHistory } from "./agent-config";
import { localizedAgent, type AgentDetailResponse, type AgentListItem, type ToolInfo } from "./types";

type TabKey = "overview" | "tools" | "activity" | "configuration" | "versions";

export function AgentDetail({ slug }: { slug: string }) {
  const { t, locale, can } = useApp();
  const detail = useApi<AgentDetailResponse>(`/api/agents/${encodeURIComponent(slug)}`);
  const list = useApi<{ agents: AgentListItem[] }>("/api/agents");
  const tools = useApi<{ tools: ToolInfo[] }>("/api/tools");
  const [tab, setTab] = useState<TabKey>("overview");

  const reloadAll = async () => { await Promise.all([detail.reload(), list.reload(), tools.reload()]); };

  const back = (
    <Link href="/agents" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-3 hover:text-fg">
      <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />{t("agents.backToDirectory")}
    </Link>
  );

  if (detail.error && !detail.data) {
    const notFound = (detail.error as { status?: number }).status === 404;
    return (
      <>
        {back}
        {notFound
          ? <Card><EmptyState icon={<Bot className="size-5" />} title={t("agents.notFound")} /></Card>
          : <ErrorState error={detail.error} onRetry={detail.reload} />}
      </>
    );
  }
  if (!detail.data) {
    return (
      <>
        {back}
        <div className="flex items-center gap-3"><Skeleton className="size-11 rounded-xl" /><Skeleton className="h-7 w-48" /></div>
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        <div className="mt-6"><LoadingBlock rows={4} /></div>
      </>
    );
  }

  const { agent, versions, recentSteps, toolUsage } = detail.data;
  const l = localizedAgent(agent, locale);
  const stats = list.data?.agents.find((a) => a.slug === agent.slug)?.stats;
  const admin = can("admin");

  return (
    <>
      {back}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <AgentAvatar slug={agent.slug} size="lg" />
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-fg">{l.name}</h1>
            <p className="mt-1 max-w-2xl text-sm text-fg-3">{l.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {agent.active ? <Badge tone="success" dot>{t("status.active")}</Badge> : <Badge tone="neutral" dot>{t("agents.inactive")}</Badge>}
              {agent.workspaceScoped ? <Badge tone="accent">{t("agents.customized", { v: agent.version })}</Badge> : <Badge>{t("agents.builtIn", { v: agent.version })}</Badge>}
              <Badge>{t(`agents.tier.${agent.tier}`)}</Badge>
              {agent.modelOverride && <Badge tone="info" className="font-mono">{agent.modelOverride}</Badge>}
            </div>
          </div>
        </div>
      </div>

      <Tabs<TabKey>
        value={tab} onChange={setTab} className="mb-5"
        items={[
          { value: "overview", label: t("agents.tab.overview") },
          { value: "tools", label: t("agents.tab.tools"), count: agent.allowedTools.length },
          { value: "activity", label: t("agents.tab.activity") },
          { value: "configuration", label: <><Settings2 className="size-3.5" aria-hidden />{t("agents.tab.configuration")}</> },
          { value: "versions", label: t("agents.tab.versions"), count: versions.length },
        ]}
      />

      {tab === "overview" && <Overview data={detail.data} stats={stats} statsLoading={list.loading} />}
      {tab === "tools" && <ToolsTab allowed={agent.allowedTools} tools={tools.data?.tools} error={tools.error} reload={tools.reload} usage={toolUsage} />}
      {tab === "activity" && <ActivityTab steps={recentSteps} usage={toolUsage} />}
      {tab === "configuration" && (
        <AgentConfigPanel data={detail.data} tools={tools.data?.tools} editable={admin} onSaved={reloadAll} />
      )}
      {tab === "versions" && <VersionHistory agent={agent} versions={versions} editable={admin} onRestored={reloadAll} />}
    </>
  );
}

function Overview({ data, stats, statsLoading }: { data: AgentDetailResponse; stats?: AgentListItem["stats"]; statsLoading: boolean }) {
  const { t } = useApp();
  const f = useFormat();
  const { agent, toolUsage } = data;
  const rate = stats ? successRate(stats.completed, stats.failed) : null;
  const toolCalls = toolUsage.reduce((a, u) => a + u.calls, 0);
  return (
    <div className="space-y-6">
      <section aria-label={t("agents.performance")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statsLoading && !stats ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />) : (
          <>
            <Stat label={t("agents.stat.runs")} value={f.num(stats?.runs ?? 0)} icon={<ListChecks className="size-4" />}
              hint={stats ? t("agents.stat.runsHint", { c: f.num(stats.completed), f: f.num(stats.failed) }) : undefined} />
            <Stat label={t("agents.stat.success")} value={f.pct(rate)} icon={<CheckCircle2 className="size-4" />} tone="success" />
            <Stat label={t("agents.stat.avgDuration")} value={f.ms(stats?.avgMs)} icon={<Clock className="size-4" />} tone="info" />
            <Stat label={t("agents.stat.lastRun")} value={stats?.lastRun ? timeAgo(stats.lastRun, t) : "—"} icon={<History className="size-4" />} tone="neutral"
              hint={stats?.lastRun ? f.date(stats.lastRun) : t("agents.neverRun")} />
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("agents.capabilities")} />
          <ul className="flex flex-wrap gap-2 px-5 pb-5">
            {agent.capabilities.map((c) => <li key={c} className="rounded-lg bg-surface-2 px-2.5 py-1 text-[13px] text-fg-2" dir="auto">{c}</li>)}
          </ul>
        </Card>
        <Card>
          <CardHeader title={t("agents.model")} description={t("agents.modelDesc")} />
          <dl className="grid grid-cols-2 gap-4 px-5 pb-5 text-sm">
            <div><dt className="text-[12px] text-fg-3">{t("agents.config.tier")}</dt><dd className="mt-0.5 font-medium text-fg">{t(`agents.tier.${agent.tier}`)}</dd></div>
            <div><dt className="text-[12px] text-fg-3">{t("agents.config.modelOverride")}</dt><dd className="mt-0.5 break-all font-mono text-[13px] text-fg">{agent.modelOverride ?? t("agents.config.noOverride")}</dd></div>
            <div><dt className="text-[12px] text-fg-3">{t("agents.stat.tools")}</dt><dd className="mt-0.5 font-medium text-fg tabular-nums">{f.num(agent.allowedTools.length)}</dd></div>
            <div><dt className="text-[12px] text-fg-3">{t("agents.toolCalls")}</dt><dd className="mt-0.5 font-medium text-fg tabular-nums">{f.num(toolCalls)}</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function approvalLabel(t: (k: string) => string, tool: { riskLevel: number; requiresApproval: boolean }) {
  if (tool.riskLevel >= 4) return <Badge tone="danger">{t("agents.approval.always")}</Badge>;
  if (tool.requiresApproval) return <Badge tone="warning">{t("agents.approval.required")}</Badge>;
  if (tool.riskLevel === 3) return <Badge tone="warning">{t("agents.approval.autoL3")}</Badge>;
  return <Badge tone="success">{t("agents.approval.none")}</Badge>;
}

function integrationCell(t: (k: string) => string, tool: { integration: string | null; integrationConnected: boolean | null }) {
  if (!tool.integration) return <span className="text-fg-3">—</span>;
  return (
    <span className="inline-flex flex-col gap-1">
      <span className="font-mono text-[12px] text-fg-2">{tool.integration.replace("|", " / ")}</span>
      <StatusBadge status={tool.integrationConnected ? "connected" : "disconnected"} />
    </span>
  );
}

function ToolsTab({ allowed, tools, error, reload, usage }: {
  allowed: string[]; tools?: ToolInfo[]; error: Error | null; reload: () => void; usage: AgentDetailResponse["toolUsage"];
}) {
  const { t } = useApp();
  const f = useFormat();
  const rows = useMemo(() => {
    const by = new Map((tools ?? []).map((x) => [x.name, x]));
    return allowed.map((n) => ({ name: n, info: by.get(n) })).sort((a, b) => (a.info?.riskLevel ?? 0) - (b.info?.riskLevel ?? 0));
  }, [allowed, tools]);
  const calls = new Map(usage.map((u) => [u.tool, u.calls]));
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!tools) return <LoadingBlock rows={4} />;
  return (
    <Card>
      <CardHeader title={t("agents.tools.title")} description={t("agents.tools.desc")} />
      {rows.length === 0 ? <EmptyState icon={<Wrench className="size-5" />} title={t("agents.tools.none")} /> : (
        <Table>
          <thead><tr>
            <Th>{t("agents.tools.name")}</Th><Th>{t("agents.tools.risk")}</Th><Th>{t("agents.tools.approval")}</Th>
            <Th>{t("agents.tools.integration")}</Th><Th>{t("agents.tools.state")}</Th><Th className="text-end">{t("agents.tools.calls")}</Th>
          </tr></thead>
          <tbody>
            {rows.map(({ name, info }) => (
              <tr key={name}>
                <Td className="min-w-[220px]">
                  <p className="font-mono text-[13px] font-medium text-fg">{name}</p>
                  {info && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-fg-3">{info.description}</p>}
                </Td>
                <Td>{info ? <RiskBadge level={info.riskLevel} /> : "—"}</Td>
                <Td>{info ? approvalLabel(t, info) : "—"}</Td>
                <Td>{info ? integrationCell(t, info) : "—"}</Td>
                <Td>{info?.enabled ? <Badge tone="success">{t("agents.tools.enabled")}</Badge> : <Badge tone="danger">{t("agents.tools.disabled")}</Badge>}</Td>
                <Td className="text-end tabular-nums">{f.num(calls.get(name) ?? 0)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function ActivityTab({ steps, usage }: { steps: AgentDetailResponse["recentSteps"]; usage: AgentDetailResponse["toolUsage"] }) {
  const { t } = useApp();
  const f = useFormat();
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader title={t("agents.recentSteps")} description={t("agents.recentStepsDesc")} />
        {steps.length === 0 ? <EmptyState icon={<ListChecks className="size-5" />} title={t("agents.noSteps")} /> : (
          <ul className="divide-y divide-border border-t border-border">
            {steps.map((s) => {
              const dur = s.startedAt && s.completedAt ? new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime() : null;
              return (
                <li key={s.id}>
                  <Link href={`/tasks/${s.taskId}`} className="flex flex-col gap-1.5 px-5 py-3 hover:bg-surface-2/60 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-fg" dir="auto">{s.title}</p>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[12.5px] text-fg-3">
                        <ExternalLink className="size-3 shrink-0" aria-hidden /><span className="truncate" dir="auto">{s.taskTitle}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-[12px] text-fg-3">
                      <StatusBadge status={s.status} />
                      {dur != null && <span className="tabular-nums">{f.ms(dur)}</span>}
                      <span title={f.date(s.startedAt)}>{timeAgo(s.startedAt, t)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={t("agents.toolUsage")} description={t("agents.toolUsageDesc")} />
        {usage.length === 0 ? <EmptyState icon={<Wrench className="size-5" />} title={t("agents.noToolUsage")} /> : (
          <Table>
            <thead><tr><Th>{t("agents.tools.name")}</Th><Th className="text-end">{t("agents.tools.calls")}</Th><Th>{t("agents.stat.success")}</Th></tr></thead>
            <tbody>
              {usage.map((u) => {
                const r = u.calls ? u.succeeded / u.calls : null;
                return (
                  <tr key={u.tool}>
                    <Td className="font-mono text-[13px] text-fg">{u.tool}</Td>
                    <Td className="text-end tabular-nums">{f.num(u.calls)}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <Meter value={r} tone={r != null && r < 0.7 ? "danger" : "success"} label={`${u.tool}: ${f.pct(r)}`} />
                        <span className="tabular-nums text-[12.5px]">{f.pct(r)}</span>
                        {u.calls - u.succeeded > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[12px] text-danger" title={t("agents.notSucceeded")}><XCircle className="size-3" aria-hidden />{f.num(u.calls - u.succeeded)}</span>
                        )}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

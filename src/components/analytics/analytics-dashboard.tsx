"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Clock, Coins, Cpu, Gauge, Hash, Zap } from "lucide-react";
import { AgentAvatar, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Stat, Table, Tabs, Td, Th, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { useApi } from "@/lib/client/hooks";
import { BarChart, BreakdownBar, Meter, OutcomeBar, STATUS_COLOR, type BarDatum } from "./charts";
import { successRate, tOr, useFormat } from "./format";
import { SystemHealth } from "./system-health";

interface AnalyticsData {
  days: number;
  totals: { promptTokens: number; completionTokens: number; costUsd: number; calls: number; failedCalls: number; avgLatencyMs: number };
  daily: Array<{ day: string; tokens: number; costUsd: number; calls: number }>;
  models: Array<{ model: string; calls: number; tokens: number; costUsd: number; failures: number }>;
  tasks: Array<{ status: string; n: number }>;
  agents: Array<{ agent: string; steps: number; completed: number; failed: number }>;
  tools: Array<{ tool: string; calls: number; succeeded: number; failed: number; gated: number; avgMs: number }>;
  approvals: Array<{ status: string; n: number }>;
  api: { requests: number; serverErrors: number; clientErrors: number; avgMs: number };
  durations: { avgTaskSeconds: number; p90TaskSeconds: number };
  costNote: string;
}

type Period = "7" | "30" | "90";
type Metric = "tokens" | "costUsd" | "calls";

const TASK_STATUSES = ["completed", "running", "planned", "waiting_approval", "paused", "failed", "cancelled", "draft"];
const APPROVAL_STATUSES = ["approved", "executed", "pending", "rejected", "expired", "superseded"];

/** Builds the full list of UTC days in the period so missing days render as zero, not gaps. */
function fillDays(days: number, rows: AnalyticsData["daily"]) {
  const by = new Map(rows.map((r) => [r.day, r]));
  const out: AnalyticsData["daily"] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push(by.get(key) ?? { day: key, tokens: 0, costUsd: 0, calls: 0 });
  }
  return out;
}

export function AnalyticsDashboard() {
  const { t, can } = useApp();
  const f = useFormat();
  const [period, setPeriod] = useState<Period>("30");
  const [metric, setMetric] = useState<Metric>("tokens");
  const { data, error, loading, reload } = useApi<AnalyticsData>(`/api/analytics?days=${period}`);

  const daily = useMemo(() => (data ? fillDays(data.days, data.daily) : []), [data]);
  const fmtMetric = (m: Metric, v: number) => (m === "costUsd" ? f.usd(v) : m === "tokens" ? f.compact(v) : f.num(v));
  const bars: BarDatum[] = daily.map((d) => ({ key: d.day, label: f.day(d.day), value: d[metric] ?? 0, display: fmtMetric(metric, d[metric] ?? 0) }));
  const maxVal = Math.max(0, ...bars.map((b) => b.value));

  const tot = data?.totals;
  const failRate = tot && tot.calls ? tot.failedCalls / tot.calls : null;
  const tokens = tot ? tot.promptTokens + tot.completionTokens : 0;

  return (
    <>
      <PageHeader
        icon={<BarChart3 className="size-5" />}
        title={t("nav.analytics")}
        description={t("analytics.subtitle")}
        actions={
          <Tabs<Period> value={period} onChange={setPeriod} items={[
            { value: "7", label: t("analytics.period.days", { n: 7 }) },
            { value: "30", label: t("analytics.period.days", { n: 30 }) },
            { value: "90", label: t("analytics.period.days", { n: 90 }) },
          ]} />
        }
      />

      {error && <div className="mb-4"><ErrorState error={error} onRetry={reload} /></div>}

      <section aria-label={t("analytics.overview")} className={cx("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6", loading && data && "opacity-70 transition-opacity")}>
        {!data ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />) : (
          <>
            <Stat label={t("analytics.stat.calls")} value={f.num(tot!.calls)} icon={<Zap className="size-4" />} />
            <Stat label={t("analytics.stat.tokens")} value={f.compact(tokens)} icon={<Hash className="size-4" />} tone="info"
              hint={t("analytics.stat.tokensHint", { p: f.compact(tot!.promptTokens), c: f.compact(tot!.completionTokens) })} />
            <Stat label={t("analytics.stat.cost")} value={f.usd(tot!.costUsd)} icon={<Coins className="size-4" />} tone="warning" hint={t("analytics.stat.costHint")} />
            <Stat label={t("analytics.stat.failRate")} value={f.pct(failRate)} icon={<AlertTriangle className="size-4" />}
              tone={failRate && failRate > 0.05 ? "danger" : "success"} hint={t("analytics.stat.failHint", { n: f.num(tot!.failedCalls) })} />
            <Stat label={t("analytics.stat.latency")} value={f.ms(tot!.calls ? tot!.avgLatencyMs : null)} icon={<Gauge className="size-4" />} tone="neutral" />
            <Stat label={t("analytics.stat.taskDuration")} value={f.ms(data.durations.avgTaskSeconds ? data.durations.avgTaskSeconds * 1000 : null)}
              icon={<Clock className="size-4" />} tone="neutral"
              hint={data.durations.p90TaskSeconds ? t("analytics.stat.p90", { v: f.ms(data.durations.p90TaskSeconds * 1000) }) : undefined} />
          </>
        )}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={t(`analytics.daily.${metric}`)}
            description={t("analytics.daily.desc", { n: period })}
            actions={
              <Tabs<Metric> value={metric} onChange={setMetric} items={[
                { value: "tokens", label: t("analytics.metric.tokens") },
                { value: "costUsd", label: t("analytics.metric.cost") },
                { value: "calls", label: t("analytics.metric.calls") },
              ]} />
            }
            className="flex-col sm:flex-row"
          />
          <div className="px-5 pb-5 pt-2">
            {!data ? <Skeleton className="h-[200px]" /> : (
              <BarChart data={bars} title={`${t(`analytics.daily.${metric}`)} — ${t("analytics.period.days", { n: period })}`}
                maxLabel={fmtMetric(metric, maxVal)} />
            )}
            {data && <p className="mt-3 text-[12px] text-fg-3">{t("analytics.costNote")}</p>}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t("analytics.tasks.title")} description={t("analytics.tasks.desc")} />
            <div className="px-5 pb-5">
              {!data ? <Skeleton className="h-24" /> : (
                <BreakdownBar title={t("analytics.tasks.title")} emptyLabel={t("analytics.tasks.empty")}
                  segments={orderedSegments(TASK_STATUSES, data.tasks, (s) => t(`status.${s}`))} />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title={t("analytics.approvals.title")} description={t("analytics.approvals.desc")} />
            <div className="px-5 pb-5">
              {!data ? <Skeleton className="h-24" /> : (
                <BreakdownBar title={t("analytics.approvals.title")} emptyLabel={t("analytics.approvals.empty")}
                  segments={orderedSegments(APPROVAL_STATUSES, data.approvals, (s) => t(`status.${s}`))} />
              )}
            </div>
          </Card>
        </div>
      </div>

      {data && (
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <ModelsCard data={data} />
          <AgentsCard data={data} />
          <ToolsCard data={data} />
          <ApiCard data={data} />
        </div>
      )}

      {can("admin") && <SystemHealth />}
    </>
  );
}

function orderedSegments(order: string[], rows: Array<{ status: string; n: number }>, label: (s: string) => string) {
  const by = new Map(rows.map((r) => [r.status, r.n]));
  const keys = [...order.filter((s) => by.has(s)), ...rows.map((r) => r.status).filter((s) => !order.includes(s))];
  return keys.map((s) => ({ key: s, label: label(s), value: by.get(s) ?? 0, color: STATUS_COLOR[s] ?? "var(--text-3)" }));
}

function ModelsCard({ data }: { data: AnalyticsData }) {
  const { t } = useApp();
  const f = useFormat();
  return (
    <Card>
      <CardHeader title={t("analytics.models.title")} description={t("analytics.models.desc")} />
      {data.models.length === 0 ? <EmptyState icon={<Cpu className="size-5" />} title={t("analytics.models.empty")} /> : (
        <Table>
          <caption className="sr-only">{t("analytics.models.title")}</caption>
          <thead><tr>
            <Th>{t("analytics.col.model")}</Th><Th className="text-end">{t("analytics.col.calls")}</Th><Th className="text-end">{t("analytics.col.tokens")}</Th>
            <Th className="text-end">{t("analytics.col.cost")}</Th><Th className="text-end">{t("analytics.col.failures")}</Th>
          </tr></thead>
          <tbody>
            {data.models.map((m) => (
              <tr key={m.model}>
                <Td className="font-mono text-[13px] text-fg" ><span dir="ltr">{m.model}</span></Td>
                <Td className="text-end tabular-nums">{f.num(m.calls)}</Td>
                <Td className="text-end tabular-nums">{f.compact(m.tokens)}</Td>
                <Td className="text-end tabular-nums">{f.usd(m.costUsd)}</Td>
                <Td className={cx("text-end tabular-nums", m.failures > 0 && "text-danger")}>{f.num(m.failures)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function AgentsCard({ data }: { data: AnalyticsData }) {
  const { t } = useApp();
  const f = useFormat();
  return (
    <Card>
      <CardHeader title={t("analytics.agents.title")} description={t("analytics.agents.desc")} />
      {data.agents.length === 0 ? <EmptyState title={t("analytics.agents.empty")} /> : (
        <Table>
          <caption className="sr-only">{t("analytics.agents.title")}</caption>
          <thead><tr>
            <Th>{t("analytics.col.agent")}</Th><Th className="text-end">{t("analytics.col.steps")}</Th>
            <Th className="text-end">{t("analytics.col.completed")}</Th><Th className="text-end">{t("analytics.col.failed")}</Th><Th>{t("analytics.col.successRate")}</Th>
          </tr></thead>
          <tbody>
            {data.agents.map((a) => {
              const r = successRate(a.completed, a.failed);
              const name = tOr(t, `agent.${a.agent}`, a.agent);
              return (
                <tr key={a.agent}>
                  <Td><span className="inline-flex items-center gap-2 whitespace-nowrap text-fg"><AgentAvatar slug={a.agent} size="sm" />{name}</span></Td>
                  <Td className="text-end tabular-nums">{f.num(a.steps)}</Td>
                  <Td className="text-end tabular-nums">{f.num(a.completed)}</Td>
                  <Td className={cx("text-end tabular-nums", a.failed > 0 && "text-danger")}>{f.num(a.failed)}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <Meter value={r} tone={r == null ? "accent" : r >= 0.9 ? "success" : r < 0.7 ? "danger" : "warning"} label={`${name}: ${f.pct(r)}`} />
                      <span className="text-[12.5px] tabular-nums">{f.pct(r)}</span>
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function ToolsCard({ data }: { data: AnalyticsData }) {
  const { t } = useApp();
  const f = useFormat();
  return (
    <Card>
      <CardHeader title={t("analytics.tools.title")} description={t("analytics.tools.desc")} />
      {data.tools.length === 0 ? <EmptyState title={t("analytics.tools.empty")} /> : (
        <>
          <Table>
            <caption className="sr-only">{t("analytics.tools.title")}</caption>
            <thead><tr>
              <Th>{t("analytics.col.tool")}</Th><Th className="text-end">{t("analytics.col.calls")}</Th><Th className="text-end">{t("analytics.col.succeeded")}</Th>
              <Th className="text-end">{t("analytics.col.failed")}</Th><Th className="text-end">{t("analytics.col.gated")}</Th><Th className="text-end">{t("analytics.col.avgMs")}</Th><Th><span className="sr-only">{t("analytics.col.mix")}</span></Th>
            </tr></thead>
            <tbody>
              {data.tools.map((x) => (
                <tr key={x.tool}>
                  <Td className="font-mono text-[13px] text-fg">{x.tool}</Td>
                  <Td className="text-end tabular-nums">{f.num(x.calls)}</Td>
                  <Td className="text-end tabular-nums text-success">{f.num(x.succeeded)}</Td>
                  <Td className={cx("text-end tabular-nums", x.failed > 0 && "text-danger")}>{f.num(x.failed)}</Td>
                  <Td className={cx("text-end tabular-nums", x.gated > 0 && "text-warning")}>{f.num(x.gated)}</Td>
                  <Td className="text-end tabular-nums whitespace-nowrap">{f.ms(x.avgMs)}</Td>
                  <Td><OutcomeBar parts={[
                    { value: x.succeeded, className: "bg-success" }, { value: x.failed, className: "bg-danger" },
                    { value: x.gated, className: "bg-warning" }, { value: Math.max(0, x.calls - x.succeeded - x.failed - x.gated), className: "bg-border-strong" },
                  ]} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="px-5 py-3 text-[12px] text-fg-3">{t("analytics.tools.gatedNote")}</p>
        </>
      )}
    </Card>
  );
}

function ApiCard({ data }: { data: AnalyticsData }) {
  const { t } = useApp();
  const f = useFormat();
  const a = data.api;
  const srv = a.requests ? a.serverErrors / a.requests : null;
  const cli = a.requests ? a.clientErrors / a.requests : null;
  const ok = a.requests - a.serverErrors - a.clientErrors;
  return (
    <Card>
      <CardHeader title={t("analytics.api.title")} description={t("analytics.api.desc")} />
      <div className="space-y-5 px-5 pb-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label={t("analytics.api.requests")} value={f.num(a.requests)} />
          <Metric label={t("analytics.api.serverErrors")} value={f.pct(srv)} sub={f.num(a.serverErrors)} tone={a.serverErrors > 0 ? "text-danger" : undefined} />
          <Metric label={t("analytics.api.clientErrors")} value={f.pct(cli)} sub={f.num(a.clientErrors)} tone={cli && cli > 0.1 ? "text-warning" : undefined} />
          <Metric label={t("analytics.api.avg")} value={f.ms(a.requests ? a.avgMs : null)} />
        </dl>
        <BreakdownBar title={t("analytics.api.title")} emptyLabel={t("analytics.api.empty")} segments={[
          { key: "ok", label: t("analytics.api.ok"), value: Math.max(0, ok), color: "var(--success)" },
          { key: "4xx", label: t("analytics.api.clientErrors"), value: a.clientErrors, color: "var(--warning)" },
          { key: "5xx", label: t("analytics.api.serverErrors"), value: a.serverErrors, color: "var(--danger)" },
        ]} />
      </div>
    </Card>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-fg-3">{label}</dt>
      <dd className={cx("mt-0.5 text-lg font-semibold tabular-nums text-fg", tone)}>{value}{sub && <span className="ms-1.5 text-[12px] font-normal text-fg-3">({sub})</span>}</dd>
    </div>
  );
}

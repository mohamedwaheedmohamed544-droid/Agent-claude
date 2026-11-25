"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Bot, ChevronDown, GitBranch, GitFork, ListOrdered, MessageCircle, Route, Search, Wrench } from "lucide-react";
import { AgentAvatar, Badge, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { timeAgo, useApi } from "@/lib/client/hooks";
import { successRate, useFormat } from "@/components/analytics/format";
import { ApprovalLevels } from "./approval-levels";
import { localizedAgent, type AgentListItem } from "./types";

export function AgentDirectory() {
  const { t, locale } = useApp();
  const { data, error, loading, reload } = useApi<{ agents: AgentListItem[] }>("/api/agents");
  const [q, setQ] = useState("");

  const agents = (data?.agents ?? []).filter((a) => {
    if (!q.trim()) return true;
    const l = localizedAgent(a, locale);
    const hay = `${l.name} ${l.description} ${a.name} ${a.capabilities.join(" ")}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <>
      <PageHeader
        icon={<Bot className="size-5" />}
        title={t("nav.agents")}
        description={t("agents.subtitle")}
        actions={data && data.agents.length > 4 ? (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("agents.search")} aria-label={t("agents.search")} className="ps-9" />
          </div>
        ) : undefined}
      />

      <OrchestratorCard />

      {error && <div className="mt-6"><ErrorState error={error} onRetry={reload} /></div>}

      {loading && !data ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
        </div>
      ) : data && agents.length === 0 ? (
        <Card className="mt-6"><EmptyState icon={<Bot className="size-5" />} title={q ? t("agents.noMatch") : t("agents.empty")} /></Card>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => <li key={a.slug}><AgentCard agent={a} /></li>)}
        </ul>
      )}
    </>
  );
}

function AgentCard({ agent: a }: { agent: AgentListItem }) {
  const { t, locale } = useApp();
  const f = useFormat();
  const l = localizedAgent(a, locale);
  const rate = successRate(a.stats.completed, a.stats.failed);
  const caps = a.capabilities.slice(0, 5);
  return (
    <Link href={`/agents/${a.slug}`}
      className="group flex h-full flex-col rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-border-strong hover:shadow-pop focus-visible:outline-offset-2">
      <div className="flex items-start gap-3">
        <AgentAvatar slug={a.slug} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="truncate text-[15px] font-semibold text-fg">{l.name}</h2>
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden />
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {a.active ? <Badge tone="success" dot>{t("status.active")}</Badge> : <Badge tone="neutral" dot>{t("agents.inactive")}</Badge>}
            {a.customized && <Badge tone="accent">{t("agents.customized", { v: a.version })}</Badge>}
            <Badge tone="neutral">{t(`agents.tier.${a.tier}`)}</Badge>
          </div>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-fg-2">{l.description}</p>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("agents.capabilities")}>
        {caps.map((c) => <li key={c} className="rounded-md bg-surface-2 px-2 py-0.5 text-[11.5px] text-fg-2" dir="auto">{c}</li>)}
        {a.capabilities.length > caps.length && (
          <li className="rounded-md px-1.5 py-0.5 text-[11.5px] text-fg-3">{t("agents.more", { n: a.capabilities.length - caps.length })}</li>
        )}
      </ul>
      <div className="mt-auto pt-4">
        <dl className="grid grid-cols-4 gap-2 border-t border-border pt-3 text-center">
          <MiniStat label={t("agents.stat.runs")} value={f.num(a.stats.runs)} />
          <MiniStat label={t("agents.stat.success")} value={f.pct(rate)} tone={rate == null ? undefined : rate >= 0.9 ? "text-success" : rate < 0.7 ? "text-danger" : "text-warning"} />
          <MiniStat label={t("agents.stat.avg")} value={f.ms(a.stats.avgMs)} />
          <MiniStat label={t("agents.stat.tools")} value={f.num(a.tools.length)} />
        </dl>
        <p className="mt-2 text-[12px] text-fg-3">
          {a.stats.lastRun ? t("agents.lastRun", { time: timeAgo(a.stats.lastRun, t) }) : t("agents.neverRun")}
        </p>
      </div>
    </Link>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-fg-3">{label}</dt>
      <dd className={cx("mt-0.5 truncate text-[13.5px] font-semibold tabular-nums text-fg", tone)}>{value}</dd>
    </div>
  );
}

/** Explains how the orchestrator plans and routes requests, and the approval policy. */
function OrchestratorCard() {
  const { t } = useApp();
  const [open, setOpen] = useState(true);
  const modes = [
    { icon: MessageCircle, key: "direct" },
    { icon: Route, key: "single" },
    { icon: GitFork, key: "multi" },
  ];
  const patterns = [
    { icon: ListOrdered, key: "sequential" },
    { icon: GitFork, key: "parallel" },
    { icon: GitBranch, key: "conditional" },
  ];
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-start hover:bg-surface-2/50">
        <AgentAvatar slug="orchestrator" size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-fg">{t("agents.orch.title")}</h2>
          <p className="mt-0.5 text-[13px] text-fg-3">{t("agents.orch.subtitle")}</p>
        </div>
        <ChevronDown className={cx("size-4 shrink-0 text-fg-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="grid gap-6 border-t border-border px-5 py-5 lg:grid-cols-2">
          <div className="space-y-5">
            <section>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-fg-3">{t("agents.orch.modes")}</h3>
              <ol className="mt-2 space-y-2">
                {modes.map(({ icon: Icon, key }) => (
                  <li key={key} className="flex gap-3">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text"><Icon className="size-3.5" aria-hidden /></span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-fg">{t(`agents.orch.mode.${key}`)}</p>
                      <p className="text-[13px] text-fg-2">{t(`agents.orch.mode.${key}.desc`)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-fg-3">{t("agents.orch.patterns")}</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-3">
                {patterns.map(({ icon: Icon, key }) => (
                  <li key={key} className="rounded-xl border border-border p-3">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg"><Icon className="size-3.5 text-accent" aria-hidden />{t(`agents.orch.pattern.${key}`)}</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{t(`agents.orch.pattern.${key}.desc`)}</p>
                  </li>
                ))}
              </ul>
            </section>
            <p className="flex items-start gap-2 text-[12.5px] text-fg-3">
              <Wrench className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t("agents.orch.toolsNote")}
            </p>
          </div>
          <section>
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-fg-3">{t("agents.levels.title")}</h3>
            <div className="mt-2"><ApprovalLevels compact /></div>
            <p className="mt-3 text-[12.5px] text-fg-3">
              {t("agents.levels.settingsHint")}{" "}
              <Link href="/settings#autonomy" className="font-medium text-accent hover:underline">{t("agents.levels.settingsLink")}</Link>
            </p>
          </section>
        </div>
      )}
    </Card>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Coins, Cpu, FileText, Hash, ListTree, MessageSquare, MousePointerClick, ShieldCheck, Target, Trophy } from "lucide-react";
import { ApiError } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import { Markdown } from "@/components/markdown";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/ui";
import { ApprovalCard } from "@/components/approvals/approval-card";
import { DeliverableList, SourceList } from "./deliverables";
import { LinkButton } from "./link-button";
import {
  Handoffs, ProgressBar, StepDetail, StepGraph, TaskControls, TaskErrorAlert, WaitingHint, aggregateSources, stepsDone,
} from "./execution";
import { formatCost, formatDateTime, formatDuration, formatNumber, useTaskDetail } from "./utils";

export function TaskDetailView({ taskId }: { taskId: string }) {
  const { t, locale } = useApp();
  const { data, error, loading, reload, kick } = useTaskDetail(taskId);
  const [selected, setSelected] = useState<string | null>(null);

  const steps = useMemo(() => data?.steps ?? [], [data]);
  const sizes = useMemo(() => Object.fromEntries((data?.artifacts ?? []).map((a) => [a.id, a.sizeBytes])), [data]);
  const sources = useMemo(() => aggregateSources(steps), [steps]);
  const autoKey = steps.find((s) => s.status === "waiting_approval")?.key ?? steps.find((s) => s.status === "running")?.key ?? steps[0]?.key ?? null;
  const selectedKey = selected ?? autoKey;
  const selectedStep = steps.find((s) => s.key === selectedKey);
  const afterChange = () => kick();

  const back = (
    <Link href="/tasks" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-3 hover:text-fg">
      <ArrowLeft className="size-4 rtl:rotate-180" />{t("nav.tasks")}
    </Link>
  );

  if (loading && !data) {
    return (
      <div>
        {back}
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/3" />
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <Skeleton className="h-96" /><Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  if (!data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div>
        {back}
        {notFound ? (
          <Card><EmptyState icon={<ListTree className="size-5" />} title={t("tasks.notFound")} description={t("tasks.notFoundBody")}
            action={<LinkButton href="/tasks">{t("tasks.backToTasks")}</LinkButton>} /></Card>
        ) : error ? <ErrorState error={error} onRetry={reload} /> : null}
      </div>
    );
  }

  const { task, approvals, usage, toolExecutions } = data;
  const done = stepsDone(steps);
  const sortedApprovals = [...approvals].sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1));
  const elapsed = task.startedAt ? (task.completedAt ? new Date(task.completedAt).getTime() : Date.now()) - new Date(task.startedAt).getTime() : null;

  return (
    <div>
      {back}
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <Badge>{task.mode === "multi" ? t("tasks.modeMulti") : t("tasks.modeSingle")}</Badge>
            {approvals.some((a) => a.status === "pending") && <Badge tone="warning"><ShieldCheck className="size-3" />{t("tasks.pendingApprovals", { n: approvals.filter((a) => a.status === "pending").length })}</Badge>}
          </div>
          <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-fg" dir="auto">{task.title}</h1>
          <p className="mt-1 text-[13px] text-fg-3">
            {t("tasks.createdByOn", { name: task.createdByName ?? t("tasks.system"), time: formatDateTime(task.createdAt, locale) })}
            {" · "}{t("tasks.updated")} {timeAgo(task.updatedAt, t)}
            {elapsed !== null && <> · {t("tasks.elapsed")} <span dir="ltr">{formatDuration(elapsed)}</span></>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          {task.conversationId && (
            <LinkButton href={`/chat/${task.conversationId}`} size="sm" icon={<MessageSquare className="size-3.5" />}>{t("tasks.openConversation")}</LinkButton>
          )}
          <TaskControls taskId={task.id} status={task.status} onChanged={afterChange} />
        </div>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <ProgressBar done={done} total={steps.length} status={task.status} />
        <span className="shrink-0 text-[12.5px] text-fg-3 tabular-nums">{t("tasks.stepsProgress", { done, total: steps.length })}</span>
      </div>

      <div className="mb-5 space-y-3">
        <TaskErrorAlert data={data} />
        <WaitingHint status={task.status} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Target className="size-4 text-fg-3" />{t("tasks.objective")}</span>} />
            <p className="whitespace-pre-wrap px-5 pb-5 text-[14px] leading-relaxed text-fg-2" dir="auto">{task.objective}</p>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><ListTree className="size-4 text-fg-3" />{t("tasks.executionGraph")}</span>}
              description={t("tasks.executionGraphHint")} />
            <div className="space-y-3 px-5 pb-5">
              <Handoffs steps={steps} />
              {steps.length ? (
                <StepGraph steps={steps} execs={toolExecutions} selectedKey={selectedKey} onSelect={setSelected} />
              ) : <p className="text-sm text-fg-3">{t("tasks.noSteps")}</p>}
            </div>
          </Card>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <Card className="lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto">
            <CardHeader title={t("tasks.stepDetails")} />
            <div className="px-5 pb-5">
              {selectedStep ? (
                <StepDetail step={selectedStep} execs={toolExecutions} artifactSizes={sizes} full />
              ) : (
                <EmptyState icon={<MousePointerClick className="size-5" />} title={t("tasks.selectStep")} />
              )}
            </div>
          </Card>
        </aside>
      </div>

      {approvals.length > 0 && (
        <section className="mt-6 space-y-3">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-fg"><ShieldCheck className="size-4 text-fg-3" />{t("tasks.approvals")}</h2>
          <div className="grid gap-3 xl:grid-cols-2">
            {sortedApprovals.map((a) => <ApprovalCard key={a.id} approval={a} showTask={false} compact={a.status !== "pending"} onChanged={afterChange} />)}
          </div>
        </section>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Card className="min-w-0">
          <CardHeader title={<span className="flex items-center gap-2"><Trophy className="size-4 text-fg-3" />{t("tasks.finalResult")}</span>}
            description={task.summary ?? undefined} />
          <div className="space-y-5 px-5 pb-5">
            {task.result ? <Markdown text={task.result} /> : (
              <p className="text-sm text-fg-3">{task.status === "completed" ? t("tasks.noOutput") : t("tasks.resultPending")}</p>
            )}
            {sources.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[12px] font-semibold uppercase tracking-wide text-fg-3">{t("tasks.sources")}</h4>
                <SourceList sources={sources} />
              </div>
            )}
            {data.artifacts.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-3"><FileText className="size-3.5" />{t("tasks.deliverables")}</h4>
                <DeliverableList artifacts={data.artifacts} sizes={sizes} />
              </div>
            )}
          </div>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHeader title={t("tasks.usage")} description={t("tasks.costNote")} />
          <dl className="grid grid-cols-2 gap-3 px-5 pb-5">
            {[
              { icon: <Hash className="size-4" />, label: t("tasks.promptTokens"), value: formatNumber(usage?.promptTokens) },
              { icon: <Hash className="size-4" />, label: t("tasks.completionTokens"), value: formatNumber(usage?.completionTokens) },
              { icon: <Coins className="size-4" />, label: t("tasks.estCost"), value: formatCost(usage?.costUsd) },
              { icon: <Cpu className="size-4" />, label: t("tasks.modelCalls"), value: formatNumber(usage?.calls) },
            ].map((i) => (
              <div key={i.label} className="rounded-xl bg-surface-2 px-3 py-2.5">
                <dt className="flex items-center gap-1.5 text-[12px] text-fg-3">{i.icon}{i.label}</dt>
                <dd className="mt-1 text-lg font-semibold text-fg tabular-nums">{i.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}

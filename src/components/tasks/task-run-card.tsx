"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ShieldCheck, Workflow } from "lucide-react";
import { useApp } from "@/components/providers";
import { Card, ErrorState, Skeleton, StatusBadge, cx } from "@/components/ui";
import { ApprovalCard } from "@/components/approvals/approval-card";
import { DeliverableList, SourceList } from "./deliverables";
import {
  Handoffs, ProgressBar, StepDetail, StepGraph, TaskControls, TaskErrorAlert, UsageSummary, aggregateSources, stepsDone,
} from "./execution";
import type { TaskStep } from "./types";
import { isTerminal, useTaskDetail } from "./utils";

export interface PlanPreview {
  mode?: string;
  steps: Array<{ key: string; agent: string; title: string; depends_on: string[] }>;
}

function planToSteps(plan: PlanPreview | undefined): TaskStep[] {
  return (plan?.steps ?? []).map((s, i) => ({
    id: s.key, key: s.key, position: i, agent: s.agent, title: s.title, input: "", expectedOutput: null, condition: null, status: "pending",
    output: null, meta: null, error: null, attempts: 0, maxAttempts: 3, startedAt: null, completedAt: null, dependsOn: s.depends_on ?? [],
  }));
}

/**
 * Live view of a task started from chat. Polls fast while executing, slowly while waiting on a human,
 * and stops at a terminal state (then asks the conversation to refresh so the result message appears).
 */
export function TaskRunCard({ taskId, plan, onFinished }: { taskId: string; plan?: PlanPreview; onFinished?: (status: string, observed: boolean) => void }) {
  const { t } = useApp();
  const { data, error, loading, reload, kick } = useTaskDetail(taskId, { onTerminal: onFinished });
  const [open, setOpen] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const steps = useMemo(() => data?.steps ?? planToSteps(plan), [data, plan]);
  const status = data?.task.status ?? "planned";
  const terminal = isTerminal(status);
  // Default: expanded while work is in progress, collapsed once finished (the result message follows).
  const expanded = open ?? !terminal;
  const pendingApprovals = (data?.approvals ?? []).filter((a) => a.status === "pending");
  const done = stepsDone(steps);
  const sizes = useMemo(() => Object.fromEntries((data?.artifacts ?? []).map((a) => [a.id, a.sizeBytes])), [data]);
  const sources = useMemo(() => aggregateSources(data?.steps ?? []), [data]);

  // Auto-focus the step that needs attention (or the one running) until the user picks one.
  const autoKey = steps.find((s) => s.status === "waiting_approval")?.key ?? steps.find((s) => s.status === "running")?.key ?? null;
  const selectedKey = selected ?? autoKey;
  const selectedStep = data ? data.steps.find((s) => s.key === selectedKey) : undefined;

  useEffect(() => { if (selected && !steps.some((s) => s.key === selected)) setSelected(null); }, [steps, selected]);

  const afterControl = () => kick();

  return (
    <Card className="mt-2 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3.5 pb-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text"><Workflow className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">{t("chat.taskRun")}</p>
          {data ? (
            <Link href={`/tasks/${taskId}`} className="group flex min-w-0 items-center gap-1 text-[14px] font-semibold text-fg hover:text-accent">
              <span className="truncate" dir="auto">{data.task.title}</span>
              <ArrowUpRight className="size-3.5 shrink-0 opacity-60 group-hover:opacity-100 rtl:-scale-x-100" />
            </Link>
          ) : loading ? <Skeleton className="mt-1 h-4 w-48" /> : null}
        </div>
        <div className="flex items-center gap-2">
          {pendingApprovals.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-warning"><ShieldCheck className="size-3.5" />{pendingApprovals.length}</span>
          )}
          <StatusBadge status={status} />
          <button type="button" onClick={() => setOpen(!expanded)} aria-expanded={expanded} aria-label={expanded ? t("chat.collapseRun") : t("chat.expandRun")}
            className="rounded-lg p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg">
            <ChevronDown className={cx("size-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </div>

      <div className="space-y-2 px-4 pb-3">
        <div className="flex items-center gap-3">
          <ProgressBar done={done} total={steps.length} status={status} />
          <span className="shrink-0 text-[12px] text-fg-3 tabular-nums">{t("tasks.stepsProgress", { done, total: steps.length })}</span>
        </div>
        <Handoffs steps={steps} />
      </div>

      {error && !data && <div className="px-4 pb-4"><ErrorState error={error} onRetry={reload} /></div>}

      {expanded && (
        <div className="space-y-4 border-t border-border bg-bg/40 px-4 py-4">
          {data && <TaskErrorAlert data={data} />}

          {pendingApprovals.length > 0 && (
            <section className="space-y-2" aria-label={t("chat.approvalsNeeded")}>
              <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-warning"><ShieldCheck className="size-4" />{t("chat.approvalsNeeded")}</h4>
              {pendingApprovals.map((a) => (
                <ApprovalCard key={a.id} approval={a} compact showTask={false} onChanged={afterControl} />
              ))}
            </section>
          )}

          <StepGraph steps={steps} execs={data?.toolExecutions ?? []} selectedKey={selectedKey} onSelect={(k) => setSelected(k === selectedKey ? "" : k)} dense />

          {selectedStep && (
            <div className="rounded-xl border border-border bg-surface p-3.5">
              <StepDetail step={selectedStep} execs={data?.toolExecutions ?? []} artifactSizes={sizes} />
            </div>
          )}

          {sources.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-[12px] font-semibold uppercase tracking-wide text-fg-3">{t("tasks.sources")}</h4>
              <SourceList sources={sources} />
            </section>
          )}
          {data && data.artifacts.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-[12px] font-semibold uppercase tracking-wide text-fg-3">{t("tasks.deliverables")}</h4>
              <DeliverableList artifacts={data.artifacts} sizes={sizes} />
            </section>
          )}

          {data && (
            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
              <UsageSummary usage={data.usage} />
              <TaskControls taskId={taskId} status={status} onChanged={afterControl} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

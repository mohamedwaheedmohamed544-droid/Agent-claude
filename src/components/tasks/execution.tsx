"use client";

import { Fragment, useMemo, useState } from "react";
import {
  ArrowDown, ArrowRight, Ban, Clock, Coins, Cpu, GitBranch, Hash, Pause, Play, RotateCcw, Wrench, Zap,
} from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { useApp } from "@/components/providers";
import { Markdown } from "@/components/markdown";
import {
  Alert, AgentAvatar, AgentName, Badge, Button, Dialog, RiskBadge, StatusBadge, cx,
} from "@/components/ui";
import { DeliverableList, SourceList } from "./deliverables";
import type { ArtifactRef, Source, TaskDetail, TaskStep, TaskUsage, ToolExecution } from "./types";
import { computeHandoffs, computeLayers, formatCost, formatDateTime, formatDuration, formatNumber, isTerminal, stepDurationMs } from "./utils";

// ───────────── Progress ─────────────

export function ProgressBar({ done, total, status, className }: { done: number; total: number; status?: string; className?: string }) {
  const { t } = useApp();
  const pct = total ? Math.round((done / total) * 100) : status === "completed" ? 100 : 0;
  const color = status === "failed" ? "bg-danger" : status === "completed" ? "bg-success" : status === "waiting_approval" ? "bg-warning" : status === "cancelled" || status === "paused" ? "bg-fg-3" : "bg-accent";
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done}
      aria-label={t("tasks.progressLabel", { done, total })}>
      <div className={cx("h-full rounded-full transition-[width] duration-500", color, status === "running" && "animate-soft-pulse")} style={{ width: `${Math.max(pct, status === "running" ? 4 : 0)}%` }} />
    </div>
  );
}

export function stepsDone(steps: Array<{ status: string }>): number {
  return steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
}

// ───────────── Handoffs ─────────────

export function Handoffs({ steps, className }: { steps: Array<{ key: string; agent: string; dependsOn?: string[]; depends_on?: string[] }>; className?: string }) {
  const { t } = useApp();
  const handoffs = useMemo(() => computeHandoffs(steps), [steps]);
  if (!handoffs.length) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-1.5", className)} aria-label={t("tasks.handoffs")}>
      <span className="text-[11.5px] font-medium text-fg-3">{t("tasks.handoffs")}:</span>
      {handoffs.map(([from, to]) => (
        <span key={`${from}-${to}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 ps-0.5 pe-2 text-[11.5px] font-medium text-fg-2">
          <AgentAvatar slug={from} size="sm" className="size-5!" />
          <AgentName slug={from} />
          <ArrowRight className="size-3 text-fg-3 rtl:rotate-180" />
          <AgentName slug={to} />
        </span>
      ))}
    </div>
  );
}

// ───────────── Execution graph ─────────────

export interface ToolRow { id: string; name: string; status: string; riskLevel?: number; durationMs?: number | null; error?: string | null }

export function toolsForStep(step: TaskStep, execs: ToolExecution[]): ToolRow[] {
  const fromExec = execs.filter((e) => e.stepId === step.id);
  if (fromExec.length) return fromExec.map((e) => ({ id: e.id, name: e.toolName, status: e.status, riskLevel: e.riskLevel, durationMs: e.durationMs, error: e.error }));
  return (step.meta?.toolCalls ?? []).map((c, i) => ({ id: `${step.id}-${i}`, name: c.name, status: c.status }));
}

function StepNode({ step, steps, execs, selected, onSelect }: { step: TaskStep; steps: TaskStep[]; execs: ToolExecution[]; selected: boolean; onSelect: () => void }) {
  const { t } = useApp();
  const tools = toolsForStep(step, execs);
  const maxRisk = Math.max(0, ...tools.map((x) => x.riskLevel ?? 0));
  const deps = step.dependsOn.map((k) => steps.find((s) => s.key === k)).filter(Boolean) as TaskStep[];
  const dur = stepDurationMs(step);
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      className={cx(
        "group flex w-full min-w-0 flex-col gap-2 rounded-xl border bg-surface p-3 text-start transition-colors",
        selected ? "border-accent ring-3 ring-[var(--ring)]" : "border-border hover:border-border-strong",
        step.status === "running" && !selected && "border-accent/50",
        step.status === "waiting_approval" && !selected && "border-warning/60",
        step.status === "failed" && !selected && "border-danger/50",
      )}>
      <div className="flex w-full items-start gap-2">
        <AgentAvatar slug={step.agent} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-fg" dir="auto">{step.title}</p>
          <p className="mt-0.5 text-[11.5px] text-fg-3"><AgentName slug={step.agent} /></p>
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center gap-1.5">
        <StatusBadge status={step.status} />
        {(step.attempts > 1 || step.status === "failed") && (
          <Badge tone={step.status === "failed" ? "danger" : "neutral"} className="tabular-nums"><RotateCcw className="size-3" />{step.attempts}/{step.maxAttempts}</Badge>
        )}
        {dur !== null && <span className="inline-flex items-center gap-1 text-[11px] text-fg-3 tabular-nums"><Clock className="size-3" />{formatDuration(dur)}</span>}
        {tools.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-fg-3 tabular-nums" title={tools.map((x) => x.name).join(", ")}><Wrench className="size-3" />{tools.length}</span>
        )}
        {maxRisk >= 3 && <RiskBadge level={maxRisk} />}
        {step.condition && <Badge tone="info"><GitBranch className="size-3" />{t("tasks.conditional")}</Badge>}
      </div>
      {deps.length > 0 && (
        <p className="w-full truncate text-[11px] text-fg-3" dir="auto">
          {t("tasks.after")} {deps.map((d) => d.title).join(" · ")}
        </p>
      )}
    </button>
  );
}

/** Layered execution graph: each row is a dependency depth; steps in the same row run in parallel. */
export function StepGraph({ steps, execs, selectedKey, onSelect, dense }: {
  steps: TaskStep[]; execs: ToolExecution[]; selectedKey: string | null; onSelect: (key: string) => void; dense?: boolean;
}) {
  const { t } = useApp();
  const layers = useMemo(() => computeLayers(steps), [steps]);
  return (
    <ol className="space-y-1" aria-label={t("tasks.executionGraph")}>
      {layers.map((layer, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <li aria-hidden className="flex justify-center py-0.5 text-fg-3"><ArrowDown className="size-4" /></li>
          )}
          <li>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">{t("tasks.stage", { n: i + 1 })}</span>
              {layer.length > 1 && <Badge tone="accent"><Zap className="size-3" />{t("tasks.parallel", { n: layer.length })}</Badge>}
            </div>
            <div className={cx("grid gap-2", layer.length > 1 && (dense ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3"))}>
              {layer.map((s) => (
                <StepNode key={s.id} step={s} steps={steps} execs={execs} selected={selectedKey === s.key} onSelect={() => onSelect(s.key)} />
              ))}
            </div>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

// ───────────── Step detail ─────────────

function Section({ title, children, icon }: { title: React.ReactNode; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-3">{icon}{title}</h4>
      {children}
    </section>
  );
}

export function ToolActivity({ tools }: { tools: ToolRow[] }) {
  const { t } = useApp();
  if (!tools.length) return <p className="text-[13px] text-fg-3">{t("tasks.noTools")}</p>;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {tools.map((x) => (
        <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
          <code className="min-w-0 truncate font-mono text-[12.5px] text-fg">{x.name}</code>
          {x.riskLevel !== undefined && x.riskLevel > 0 && <RiskBadge level={x.riskLevel} />}
          <span className="ms-auto flex items-center gap-2">
            {x.durationMs !== undefined && x.durationMs !== null && <span className="text-[11.5px] text-fg-3 tabular-nums">{formatDuration(x.durationMs)}</span>}
            <StatusBadge status={x.status} />
          </span>
          {x.error && <p className="w-full text-[12px] text-danger" dir="auto">{x.error}</p>}
        </li>
      ))}
    </ul>
  );
}

export function StepDetail({ step, execs, artifactSizes, full }: { step: TaskStep; execs: ToolExecution[]; artifactSizes?: Record<string, number>; full?: boolean }) {
  const { t, locale } = useApp();
  const tools = toolsForStep(step, execs);
  const dur = stepDurationMs(step);
  const sources: Source[] = step.meta?.sources ?? [];
  const artifacts: ArtifactRef[] = step.meta?.artifacts ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentAvatar slug={step.agent} />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-fg" dir="auto">{step.title}</p>
            <p className="text-[12px] text-fg-3"><AgentName slug={step.agent} /> · <code className="font-mono" dir="ltr">{step.key}</code></p>
          </div>
        </div>
        <StatusBadge status={step.status} />
      </div>

      <dl className="grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
        {[
          [t("tasks.attempts"), `${step.attempts}/${step.maxAttempts}`],
          [t("tasks.duration"), formatDuration(dur)],
          [t("tasks.started"), formatDateTime(step.startedAt, locale)],
          [t("tasks.model"), step.meta?.model ?? "—"],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-lg bg-surface-2 px-2.5 py-1.5">
            <dt className="text-[11px] text-fg-3">{k}</dt>
            <dd className="truncate font-medium text-fg tabular-nums" title={v}>{v}</dd>
          </div>
        ))}
      </dl>

      {step.error?.message && (
        <Alert tone={step.status === "failed" ? "danger" : "warning"} title={step.error.recoverable && step.status !== "failed" ? t("tasks.retrying") : t("tasks.stepError")}>
          <span dir="auto">{step.error.message}</span>
        </Alert>
      )}

      {full && (
        <>
          <Section title={t("tasks.instruction")}>
            <p className="whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-fg-2" dir="auto">{step.input}</p>
          </Section>
          {step.expectedOutput && (
            <Section title={t("tasks.expectedOutput")}>
              <p className="text-[13px] leading-relaxed text-fg-2" dir="auto">{step.expectedOutput}</p>
            </Section>
          )}
          {step.condition && (
            <Section title={t("tasks.condition")} icon={<GitBranch className="size-3.5" />}>
              <p className="text-[13px] text-fg-2" dir="auto">{step.condition}</p>
            </Section>
          )}
        </>
      )}

      <Section title={t("tasks.toolActivity")} icon={<Wrench className="size-3.5" />}>
        <ToolActivity tools={tools} />
      </Section>

      <Section title={t("tasks.output")}>
        {step.output ? (
          <div className="rounded-xl border border-border bg-surface px-3.5 py-3"><Markdown text={step.output} /></div>
        ) : (
          <p className="text-[13px] text-fg-3">{step.status === "running" ? t("tasks.outputRunning") : t("tasks.noOutput")}</p>
        )}
      </Section>

      {sources.length > 0 && <Section title={t("tasks.sources")}><SourceList sources={sources} compact={!full} /></Section>}
      {artifacts.length > 0 && <Section title={t("tasks.deliverables")}><DeliverableList artifacts={artifacts} sizes={artifactSizes} /></Section>}
    </div>
  );
}

// ───────────── Usage ─────────────

export function UsageSummary({ usage, className }: { usage: TaskUsage | null; className?: string }) {
  const { t } = useApp();
  if (!usage) return null;
  const items = [
    { icon: <Hash className="size-3.5" />, label: t("tasks.tokens"), value: formatNumber(usage.promptTokens + usage.completionTokens), title: t("tasks.tokensDetail", { p: formatNumber(usage.promptTokens), c: formatNumber(usage.completionTokens) }) },
    { icon: <Coins className="size-3.5" />, label: t("tasks.estCost"), value: formatCost(usage.costUsd), title: t("tasks.costNote") },
    { icon: <Cpu className="size-3.5" />, label: t("tasks.modelCalls"), value: formatNumber(usage.calls), title: undefined },
  ];
  return (
    <div className={cx("flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-3", className)}>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5" title={i.title}>
          {i.icon}{i.label}: <span className="font-medium text-fg-2 tabular-nums" dir="ltr">{i.value}</span>
        </span>
      ))}
    </div>
  );
}

// ───────────── Controls ─────────────

export function TaskControls({ taskId, status, onChanged, size = "sm" }: { taskId: string; status: string; onChanged: () => void; size?: "sm" | "md" }) {
  const { t, can } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!can("member")) return null;

  async function act(action: "pause" | "resume" | "cancel" | "retry") {
    setBusy(action);
    setError(null);
    try {
      await api(`/api/tasks/${taskId}/control`, { method: "POST", body: { action } });
      setConfirmCancel(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "emergency_stop" ? t("tasks.emergencyStop") : (e as Error).message);
      setConfirmCancel(false);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  const canPause = ["planned", "running", "waiting_approval"].includes(status);
  const canResume = status === "paused";
  const canCancel = !isTerminal(status);
  const canRetry = status === "failed";
  if (!canPause && !canResume && !canCancel && !canRetry) return null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {canPause && <Button variant="outline" size={size} icon={<Pause className="size-3.5" />} loading={busy === "pause"} disabled={busy !== null} onClick={() => act("pause")}>{t("action.pause")}</Button>}
        {canResume && <Button variant="primary" size={size} icon={<Play className="size-3.5" />} loading={busy === "resume"} disabled={busy !== null} onClick={() => act("resume")}>{t("action.resume")}</Button>}
        {canRetry && <Button variant="primary" size={size} icon={<RotateCcw className="size-3.5" />} loading={busy === "retry"} disabled={busy !== null} onClick={() => act("retry")}>{t("action.retry")}</Button>}
        {canCancel && <Button variant="ghost" size={size} icon={<Ban className="size-3.5" />} disabled={busy !== null} onClick={() => setConfirmCancel(true)}>{t("tasks.cancelTask")}</Button>}
      </div>
      {error && <p className="max-w-xs text-end text-[12px] text-danger" role="alert">{error}</p>}
      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)} size="sm" title={t("tasks.cancelConfirmTitle")} description={t("tasks.cancelConfirmBody")}
        footer={<>
          <Button variant="outline" onClick={() => setConfirmCancel(false)}>{t("tasks.keepRunning")}</Button>
          <Button variant="danger" loading={busy === "cancel"} onClick={() => act("cancel")}>{t("tasks.cancelTask")}</Button>
        </>} />
    </div>
  );
}

// ───────────── Aggregates ─────────────

export function aggregateSources(steps: TaskStep[]): Source[] {
  const all = steps.flatMap((s) => s.meta?.sources ?? []);
  return all.filter((s, i) => all.findIndex((x) => (x.url ?? x.fileId ?? x.title) === (s.url ?? s.fileId ?? s.title)) === i);
}

export function TaskErrorAlert({ data }: { data: TaskDetail }) {
  const { t } = useApp();
  if (data.task.status !== "failed" || !data.task.error?.message) return null;
  return <Alert tone="danger" title={t("tasks.failedTitle")}><span dir="auto">{data.task.error.message}</span></Alert>;
}

export function WaitingHint({ status }: { status: string }) {
  const { t } = useApp();
  if (status === "waiting_approval") return <Alert tone="warning" title={t("tasks.waitingTitle")}>{t("tasks.waitingBody")}</Alert>;
  if (status === "paused") return <Alert tone="neutral" title={t("tasks.pausedTitle")}>{t("tasks.pausedBody")}</Alert>;
  return null;
}


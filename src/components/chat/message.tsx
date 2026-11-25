"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, BookOpen, FileText, Package } from "lucide-react";
import { timeAgo } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import { Markdown } from "@/components/markdown";
import { AgentAvatar, AgentName, Spinner, cx } from "@/components/ui";
import { DeliverableList, SourceList } from "@/components/tasks/deliverables";
import { TaskRunCard } from "@/components/tasks/task-run-card";
import { AgentStack } from "@/components/tasks/task-list";
import { formatDateTime } from "@/components/tasks/utils";
import type { ChatMessage } from "./types";

function UserMessage({ m }: { m: ChatMessage }) {
  const { t, locale } = useApp();
  const attachments = m.metadata?.attachments ?? [];
  return (
    <div className="flex justify-end">
      <div className={cx("flex max-w-[88%] flex-col items-end gap-1.5 sm:max-w-[75%]", m.pending && "opacity-70")}>
        {attachments.length > 0 && (
          <ul className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-fg-2">
                <FileText className="size-3.5 text-accent" /><span className="max-w-[200px] truncate" dir="auto">{a.filename}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-2xl rounded-se-md bg-accent px-4 py-2.5 text-[14.5px] leading-relaxed text-white shadow-card">
          <p className="whitespace-pre-wrap break-words" dir="auto">{m.content}</p>
        </div>
        <span className="px-1 text-[11px] text-fg-3" title={formatDateTime(m.createdAt, locale)}>
          {m.pending ? t("chat.sendingShort") : timeAgo(m.createdAt, t)}
        </span>
      </div>
    </div>
  );
}

function AssistantFrame({ slug, m, children, extra }: { slug: string; m: ChatMessage; children: React.ReactNode; extra?: React.ReactNode }) {
  const { t, locale } = useApp();
  return (
    <div className="flex gap-3">
      <AgentAvatar slug={slug} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-semibold text-fg"><AgentName slug={slug} /></span>
          {extra}
          <span className="text-[11px] text-fg-3" title={formatDateTime(m.createdAt, locale)}>{timeAgo(m.createdAt, t)}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function MessageItem({ m, onTaskFinished }: { m: ChatMessage; onTaskFinished?: (taskId: string, observed: boolean) => void }) {
  const { t } = useApp();
  if (m.role === "user") return <UserMessage m={m} />;
  if (m.role === "system") return <p className="text-center text-[12px] text-fg-3" dir="auto">{m.content}</p>;

  const meta = m.metadata ?? {};
  const slug = m.agentSlug ?? "orchestrator";

  if (meta.kind === "task_started" && m.taskId) {
    const taskId = m.taskId;
    return (
      <AssistantFrame slug={slug} m={m}>
        <p className="text-[14px] leading-relaxed text-fg-2" dir="auto">{m.content}</p>
        <TaskRunCard taskId={taskId} plan={meta.plan} onFinished={(s, observed) => { if (observed || s !== "cancelled") onTaskFinished?.(taskId, observed); }} />
      </AssistantFrame>
    );
  }

  if (meta.kind === "task_result") {
    const agents = meta.agents ?? [];
    return (
      <AssistantFrame slug={slug} m={m} extra={agents.length > 1 ? (
        <span className="flex items-center gap-1.5 text-[11.5px] text-fg-3">{t("chat.with")} <AgentStack agents={agents} /></span>
      ) : undefined}>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <div className="px-4 py-3.5"><Markdown text={m.content} /></div>
          {(meta.sources?.length || meta.artifacts?.length || m.taskId) ? (
            <div className="space-y-3 border-t border-border bg-surface-2/40 px-4 py-3">
              {meta.artifacts && meta.artifacts.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-3"><Package className="size-3.5" />{t("tasks.deliverables")}</p>
                  <DeliverableList artifacts={meta.artifacts} />
                </div>
              )}
              {meta.sources && meta.sources.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-3"><BookOpen className="size-3.5" />{t("tasks.sources")}</p>
                  <SourceList sources={meta.sources} />
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-fg-3">
                {meta.summary && <span dir="auto">{meta.summary}</span>}
                {m.taskId && (
                  <Link href={`/tasks/${m.taskId}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                    {t("chat.viewTask")}<ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
                  </Link>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </AssistantFrame>
    );
  }

  if (meta.kind === "task_failed" || meta.kind === "error") {
    return (
      <AssistantFrame slug={slug} m={m}>
        <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13.5px] text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap break-words" dir="auto">{m.content}</p>
            {m.taskId && (
              <Link href={`/tasks/${m.taskId}`} className="mt-1 inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
                {t("chat.inspectTask")}<ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
              </Link>
            )}
          </div>
        </div>
      </AssistantFrame>
    );
  }

  return (
    <AssistantFrame slug={slug} m={m}>
      <Markdown text={m.content} />
    </AssistantFrame>
  );
}

export function PlanningIndicator() {
  const { t } = useApp();
  return (
    <div className="flex gap-3" role="status" aria-live="polite">
      <AgentAvatar slug="orchestrator" />
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-[13px] text-fg-2 shadow-card">
        <Spinner className="text-accent" />{t("chat.planning")}
      </div>
    </div>
  );
}

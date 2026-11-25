"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, ListChecks, MessageSquarePlus, ShieldCheck } from "lucide-react";
import { useApi, timeAgo } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import { AgentAvatar, Badge, Card, EmptyState, ErrorState, Skeleton, StatusBadge, Table, Tabs, Td, Th, cx } from "@/components/ui";
import { ProgressBar } from "./execution";
import { LinkButton } from "./link-button";
import type { TaskListItem, TaskListResponse } from "./types";
import { formatDateTime } from "./utils";

const FILTERS = ["all", "running", "waiting_approval", "paused", "completed", "failed", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

export function AgentStack({ agents, max = 4 }: { agents: string[] | null; max?: number }) {
  const { t } = useApp();
  const list = (agents ?? []).filter(Boolean);
  if (!list.length) return <span className="text-fg-3">—</span>;
  return (
    <span className="flex items-center" aria-label={list.map((a) => t(`agent.${a}`)).join(", ")} title={list.map((a) => t(`agent.${a}`)).join(", ")}>
      {list.slice(0, max).map((a, i) => (
        <AgentAvatar key={a} slug={a} size="sm" className={cx("ring-2 ring-surface", i > 0 && "-ms-1.5")} />
      ))}
      {list.length > max && <span className="ms-1 text-[11.5px] text-fg-3">+{list.length - max}</span>}
    </span>
  );
}

export function TaskList() {
  const { t, locale } = useApp();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const path = `/api/tasks?limit=100${filter === "all" ? "" : `&status=${filter}`}`;
  const { data, error, loading, reload } = useApi<TaskListResponse>(path, { intervalMs: 10_000 });
  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const tasks = data?.tasks ?? [];

  const items = FILTERS.map((f) => ({
    value: f,
    label: f === "all" ? t("tasks.filter.all") : t(`status.${f}`),
    count: data ? (f === "all" ? total : counts[f] ?? 0) : undefined,
  }));

  const progress = (x: TaskListItem) => (
    <div className="flex min-w-[120px] items-center gap-2">
      <ProgressBar done={x.stepsDone} total={x.stepCount} status={x.status} />
      <span className="shrink-0 text-[11.5px] text-fg-3 tabular-nums">{x.stepsDone}/{x.stepCount}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <Tabs value={filter} onChange={setFilter} items={items} className="w-full sm:w-auto" />

      {error && !data ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? (
        <Card className="space-y-3 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</Card>
      ) : !tasks.length ? (
        <Card>
          <EmptyState icon={<ListChecks className="size-5" />} title={filter === "all" ? t("tasks.emptyTitle") : t("tasks.emptyFiltered")}
            description={filter === "all" ? t("tasks.emptyBody") : undefined}
            action={filter === "all" ? <LinkButton href="/chat" variant="primary" icon={<MessageSquarePlus className="size-4" />}>{t("tasks.startInWorkspace")}</LinkButton> : undefined} />
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>{t("tasks.col.task")}</Th>
                  <Th>{t("tasks.col.agents")}</Th>
                  <Th>{t("tasks.col.progress")}</Th>
                  <Th>{t("tasks.col.status")}</Th>
                  <Th className="hidden lg:table-cell">{t("tasks.col.createdBy")}</Th>
                  <Th>{t("tasks.col.updated")}</Th>
                  <Th><span className="sr-only">{t("action.view")}</span></Th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((x) => (
                  <tr key={x.id} className="cursor-pointer transition-colors hover:bg-surface-2/60" onClick={() => router.push(`/tasks/${x.id}`)}>
                    <Td className="max-w-[360px]">
                      <Link href={`/tasks/${x.id}`} className="block truncate font-medium text-fg hover:text-accent" dir="auto" onClick={(e) => e.stopPropagation()}>{x.title}</Link>
                      {x.summary && <p className="truncate text-[12px] text-fg-3" dir="auto">{x.summary}</p>}
                    </Td>
                    <Td><AgentStack agents={x.agents} /></Td>
                    <Td>{progress(x)}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={x.status} />
                        {x.pendingApprovals > 0 && <Badge tone="warning" className="tabular-nums"><ShieldCheck className="size-3" />{x.pendingApprovals}</Badge>}
                      </div>
                    </Td>
                    <Td className="hidden whitespace-nowrap lg:table-cell">{x.createdByName ?? t("tasks.system")}</Td>
                    <Td className="whitespace-nowrap"><span title={formatDateTime(x.updatedAt, locale)}>{timeAgo(x.updatedAt, t)}</span></Td>
                    <Td><ChevronRight className="size-4 text-fg-3 rtl:rotate-180" /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {/* Mobile cards */}
          <ul className="space-y-2.5 md:hidden">
            {tasks.map((x) => (
              <li key={x.id}>
                <Link href={`/tasks/${x.id}`} className="block rounded-2xl border border-border bg-surface p-4 shadow-card active:bg-surface-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-medium text-fg line-clamp-2" dir="auto">{x.title}</p>
                    <StatusBadge status={x.status} />
                  </div>
                  <div className="mt-3">{progress(x)}</div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-fg-3">
                    <AgentStack agents={x.agents} />
                    <span className="flex items-center gap-2">
                      {x.pendingApprovals > 0 && <Badge tone="warning"><ShieldCheck className="size-3" />{x.pendingApprovals}</Badge>}
                      {timeAgo(x.updatedAt, t)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

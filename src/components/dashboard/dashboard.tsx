"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, CheckCircle2, Coins, Loader, Package, ShieldCheck, Sparkles, ListChecks } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi, timeAgo } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import { AgentAvatar, Card, CardHeader, EmptyState, ErrorState, RiskBadge, Skeleton, Stat, StatusBadge, cx } from "@/components/ui";
import { Composer, type ComposerHandle } from "@/components/chat/composer";
import { SendErrorAlert } from "@/components/chat/chat-workspace";
import { SUGGESTED_PROMPTS } from "@/components/chat/suggested-prompts";
import type { ChatResponse } from "@/components/chat/types";
import { DeliverableChip } from "@/components/tasks/deliverables";
import { ProgressBar } from "@/components/tasks/execution";
import { AgentStack } from "@/components/tasks/task-list";
import type { Approval, TaskArtifact, TaskListResponse } from "@/components/tasks/types";
import { formatCost, formatNumber } from "@/components/tasks/utils";
import { OnboardingCard } from "@/components/onboarding/onboarding-view";

interface AgentRow {
  slug: string; name: string; nameAr: string | null; description: string; active: boolean;
  stats: { runs: number; completed: number; failed: number; lastRun: string | null };
}
interface Analytics {
  days: number;
  totals: { promptTokens: number; completionTokens: number; costUsd: number; calls: number };
  tasks: Array<{ status: string; n: number }>;
}

function Greeting() {
  const { t, session } = useApp();
  const first = session.user.name?.trim().split(/\s+/)[0] || session.user.email;
  // Time-of-day depends on the viewer's clock, so compute after mount to avoid hydration mismatches.
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 12 ? "morning" : h < 18 ? "afternoon" : "evening");
  }, []);
  return (
    <div className="mb-6">
      <h1 className="text-[26px] font-semibold tracking-tight text-fg" dir="auto">
        {part ? t(`dashboard.greeting.${part}`, { name: first }) : t("dashboard.greeting.default", { name: first })}
      </h1>
      <p className="mt-1 text-[14px] text-fg-3">{t("dashboard.subtitle")}</p>
    </div>
  );
}

function AskNexus() {
  const { t, can } = useApp();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const ref = useRef<ComposerHandle>(null);

  async function send(text: string): Promise<boolean> {
    setSending(true);
    setError(null);
    try {
      const r = await api<ChatResponse>("/api/chat", { method: "POST", body: { message: text } });
      router.push(`/chat/${r.conversationId}`);
      return true;
    } catch (e) {
      setError(e as Error);
      return false;
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -top-24 -end-24 size-64 rounded-full bg-accent-soft opacity-70 blur-3xl" />
      <div className="relative">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-white"><Sparkles className="size-4" /></span>
          <h2 className="text-[15px] font-semibold text-fg">{t("dashboard.askTitle")}</h2>
        </div>
        {can("member") ? (
          <>
            <Composer ref={ref} value={draft} onChange={setDraft} onSend={(text) => send(text)} sending={sending} attachments={false} placeholder={t("dashboard.askPlaceholder")} />
            {sending && <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-fg-3" role="status"><Loader className="size-3.5 animate-spin" />{t("chat.planning")}</p>}
            {error && <div className="mt-3"><SendErrorAlert error={error} onDismiss={() => setError(null)} /></div>}
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTED_PROMPTS.map((p) => {
                const Icon = p.icon;
                return (
                  <button key={p.id} type="button" onClick={() => { setDraft(t(`chat.prompt.${p.id}.text`)); ref.current?.focus(); }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-fg-2 transition-colors hover:border-accent/50 hover:text-fg">
                    <Icon className="size-3.5 text-accent" />{t(`chat.prompt.${p.id}.title`)}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-fg-3">{t("chat.viewerReadOnly")}</p>
        )}
      </div>
    </Card>
  );
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
      {children}<ArrowRight className="size-3.5 rtl:rotate-180" />
    </Link>
  );
}

export function Dashboard() {
  const { t, locale } = useApp();
  const tasks = useApi<TaskListResponse>("/api/tasks?limit=6", { intervalMs: 15_000 });
  const approvals = useApi<{ approvals: Approval[] }>("/api/approvals?status=pending", { intervalMs: 15_000 });
  const analytics = useApi<Analytics>("/api/analytics?days=30", { intervalMs: 60_000 });
  const agents = useApi<{ agents: AgentRow[] }>("/api/agents", { intervalMs: 60_000 });
  const artifacts = useApi<{ artifacts: TaskArtifact[] }>("/api/artifacts", { intervalMs: 30_000 });

  const counts = tasks.data?.counts ?? {};
  const running = (counts.running ?? 0) + (counts.planned ?? 0);
  const pending = approvals.data?.approvals ?? [];
  const completed = analytics.data?.tasks.find((x) => x.status === "completed")?.n ?? 0;
  const tokens = (analytics.data?.totals.promptTokens ?? 0) + (analytics.data?.totals.completionTokens ?? 0);
  const dash = (v: unknown, ok: boolean) => (ok ? v : "—") as React.ReactNode;

  return (
    <div>
      <Greeting />
      <OnboardingCard />
      <AskNexus />

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("dashboard.kpi.running")} icon={<Loader className="size-4" />} tone="accent"
          value={tasks.data ? running : <Skeleton className="h-7 w-10" />}
          hint={tasks.data && (counts.paused ?? 0) > 0 ? t("dashboard.kpi.pausedHint", { n: counts.paused ?? 0 }) : t("dashboard.kpi.runningHint")} />
        <Stat label={t("dashboard.kpi.approvals")} icon={<ShieldCheck className="size-4" />} tone="warning"
          value={approvals.data ? pending.length : <Skeleton className="h-7 w-10" />} hint={t("dashboard.kpi.approvalsHint")} />
        <Stat label={t("dashboard.kpi.completed")} icon={<CheckCircle2 className="size-4" />} tone="success"
          value={analytics.loading && !analytics.data ? <Skeleton className="h-7 w-10" /> : dash(formatNumber(completed), !!analytics.data)}
          hint={t("dashboard.kpi.period", { n: 30 })} />
        <Stat label={t("dashboard.kpi.cost")} icon={<Coins className="size-4" />} tone="info"
          value={analytics.loading && !analytics.data ? <Skeleton className="h-7 w-16" /> : dash(formatCost(analytics.data?.totals.costUsd), !!analytics.data)}
          hint={analytics.data ? t("dashboard.kpi.tokensHint", { n: formatNumber(tokens) }) : t("dashboard.kpi.period", { n: 30 })} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          {/* Needs your attention */}
          <Card className={cx(pending.length > 0 && "border-warning/40")}>
            <CardHeader title={t("dashboard.attention")} description={t("dashboard.attentionHint")}
              actions={pending.length > 0 ? <SectionLink href="/approvals">{t("action.viewAll")}</SectionLink> : undefined} />
            <div className="px-3 pb-3">
              {approvals.error && !approvals.data ? <div className="px-2 pb-2"><ErrorState error={approvals.error} onRetry={approvals.reload} /></div> : !approvals.data ? (
                <div className="space-y-2 px-2">{[0, 1].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
              ) : !pending.length ? (
                <div className="flex items-center gap-3 rounded-xl bg-success-soft px-4 py-3 text-[13.5px] text-success">
                  <CheckCircle2 className="size-4 shrink-0" />{t("dashboard.allClear")}
                </div>
              ) : (
                <ul className="space-y-1">
                  {pending.slice(0, 5).map((a) => (
                    <li key={a.id}>
                      <Link href="/approvals" className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-2">
                        {a.agentSlug ? <AgentAvatar slug={a.agentSlug} size="sm" /> : <ShieldCheck className="size-5 text-warning" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-medium text-fg" dir="auto">{a.summary}</p>
                          <p className="truncate text-[12px] text-fg-3">
                            <code className="font-mono">{a.toolName}</code>{a.taskTitle && <> · <span dir="auto">{a.taskTitle}</span></>} · {timeAgo(a.createdAt, t)}
                          </p>
                        </div>
                        <RiskBadge level={a.riskLevel} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Recent tasks */}
          <Card>
            <CardHeader title={t("dashboard.recentTasks")} actions={<SectionLink href="/tasks">{t("action.viewAll")}</SectionLink>} />
            <div className="px-3 pb-3">
              {tasks.error && !tasks.data ? <div className="px-2 pb-2"><ErrorState error={tasks.error} onRetry={tasks.reload} /></div> : !tasks.data ? (
                <div className="space-y-2 px-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
              ) : !tasks.data.tasks.length ? (
                <EmptyState icon={<ListChecks className="size-5" />} title={t("dashboard.noTasks")} description={t("dashboard.noTasksHint")} />
              ) : (
                <ul className="space-y-1">
                  {tasks.data.tasks.map((x) => (
                    <li key={x.id}>
                      <Link href={`/tasks/${x.id}`} className="flex flex-col gap-2 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-medium text-fg" dir="auto">{x.title}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <ProgressBar done={x.stepsDone} total={x.stepCount} status={x.status} className="max-w-[180px]" />
                            <span className="text-[11.5px] text-fg-3 tabular-nums">{x.stepsDone}/{x.stepCount}</span>
                            <span className="text-[11.5px] text-fg-3">· {timeAgo(x.updatedAt, t)}</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <AgentStack agents={x.agents} max={3} />
                          <StatusBadge status={x.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          {/* Agent roster */}
          <Card>
            <CardHeader title={t("dashboard.agents")} description={t("dashboard.agentsHint")} actions={<SectionLink href="/agents">{t("action.viewAll")}</SectionLink>} />
            <div className="px-3 pb-3">
              {agents.error && !agents.data ? <div className="px-2 pb-2"><ErrorState error={agents.error} onRetry={agents.reload} /></div> : !agents.data ? (
                <div className="space-y-2 px-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : !agents.data.agents.length ? (
                <EmptyState icon={<Bot className="size-5" />} title={t("dashboard.noAgents")} />
              ) : (
                <ul className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible">
                  {agents.data.agents.map((a) => (
                    <li key={a.slug} className="shrink-0">
                      <Link href="/agents" className={cx("flex items-center gap-2.5 rounded-xl border border-border px-2.5 py-2 transition-colors hover:bg-surface-2 lg:border-transparent", !a.active && "opacity-55")}>
                        <span className="relative">
                          <AgentAvatar slug={a.slug} size="sm" />
                          <span className={cx("absolute -bottom-0.5 -end-0.5 size-2 rounded-full ring-2 ring-surface", a.active ? "bg-success" : "bg-fg-3")} />
                        </span>
                        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[13px] font-medium text-fg">{locale === "ar" && a.nameAr ? a.nameAr : a.name}</span>
                        <span className="shrink-0 text-[11.5px] text-fg-3 tabular-nums">{t("dashboard.runs", { n: a.stats.runs })}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Recent deliverables */}
          <Card>
            <CardHeader title={t("dashboard.deliverables")} />
            <div className="px-4 pb-4">
              {artifacts.error && !artifacts.data ? <ErrorState error={artifacts.error} onRetry={artifacts.reload} /> : !artifacts.data ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : !artifacts.data.artifacts.length ? (
                <EmptyState icon={<Package className="size-5" />} title={t("dashboard.noDeliverables")} description={t("dashboard.noDeliverablesHint")} />
              ) : (
                <ul className="space-y-2">
                  {artifacts.data.artifacts.slice(0, 5).map((a) => (
                    <li key={a.id} className="space-y-1">
                      <DeliverableChip artifact={a} sizeBytes={a.sizeBytes} />
                      {a.taskTitle && a.taskId && (
                        <Link href={`/tasks/${a.taskId}`} className="block truncate px-1 text-[11.5px] text-fg-3 hover:text-accent" dir="auto">{a.taskTitle} · {timeAgo(a.createdAt, t)}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { History, ShieldCheck } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import { Card, EmptyState, ErrorState, Select, Skeleton, Tabs } from "@/components/ui";
import type { Approval } from "@/components/tasks/types";
import { ApprovalCard } from "./approval-card";

const HISTORY = ["approved", "rejected", "executed", "expired", "superseded"] as const;

export function ApprovalCenter() {
  const { t } = useApp();
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [historyFilter, setHistoryFilter] = useState<string>("all");

  const pending = useApi<{ approvals: Approval[] }>("/api/approvals?status=pending", { intervalMs: 15_000 });
  const historyPath = tab === "history" ? (historyFilter === "all" ? "/api/approvals" : `/api/approvals?status=${historyFilter}`) : null;
  const history = useApi<{ approvals: Approval[] }>(historyPath, { intervalMs: 30_000 });

  const pendingList = useMemo(
    // Highest risk and soonest expiry first.
    () => [...(pending.data?.approvals ?? [])].sort((a, b) => b.riskLevel - a.riskLevel || new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()),
    [pending.data],
  );
  const historyList = useMemo(() => (history.data?.approvals ?? []).filter((a) => a.status !== "pending"), [history.data]);

  const active = tab === "pending" ? pending : history;
  const list = tab === "pending" ? pendingList : historyList;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onChange={setTab} items={[
          { value: "pending", label: t("approvals.tab.pending"), count: pending.data ? pendingList.length : undefined },
          { value: "history", label: t("approvals.tab.history") },
        ]} />
        {tab === "history" && (
          <label className="flex items-center gap-2 text-[13px] text-fg-3">
            <span className="whitespace-nowrap">{t("approvals.filterStatus")}</span>
            <Select value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value)} className="w-44">
              <option value="all">{t("approvals.filter.all")}</option>
              {HISTORY.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
            </Select>
          </label>
        )}
      </div>

      {active.error && !active.data ? <ErrorState error={active.error} onRetry={active.reload} /> : active.loading && !active.data ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-2xl" />)}</div>
      ) : !list.length ? (
        <Card>
          {tab === "pending" ? (
            <EmptyState icon={<ShieldCheck className="size-5" />} title={t("approvals.emptyTitle")} description={t("approvals.emptyBody")} />
          ) : (
            <EmptyState icon={<History className="size-5" />} title={t("approvals.historyEmpty")} />
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((a) => (
            <ApprovalCard key={a.id} approval={a} compact={tab === "history"}
              onChanged={() => { void pending.reload(); void history.reload(); }} />
          ))}
        </div>
      )}
    </div>
  );
}

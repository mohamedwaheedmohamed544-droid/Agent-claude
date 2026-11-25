"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Braces, Check, ChevronDown, Clock, Copy, Fingerprint, Info, MapPin, MessageSquareText, ShieldAlert, X } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import {
  Alert, AgentAvatar, AgentName, Badge, Button, Card, Dialog, Field, RiskBadge, StatusBadge, Textarea, cx, useCopy,
} from "@/components/ui";
import { formatDateTime } from "@/components/tasks/utils";
import type { Approval } from "@/components/tasks/types";

type Notice = { tone: "warning" | "danger" | "info" | "success"; text: string };

function timeUntil(iso: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t("status.expired");
  const m = Math.round(ms / 60000);
  if (m < 60) return t("approvals.expiresInMinutes", { n: Math.max(1, m) });
  const h = Math.round(m / 60);
  if (h < 48) return t("approvals.expiresInHours", { n: h });
  return t("approvals.expiresInDays", { n: Math.round(h / 24) });
}

/** Human-readable view of the exact parameters, plus the raw JSON that the params hash covers. */
export function ParamsView({ params, defaultRaw = false }: { params: Record<string, unknown>; defaultRaw?: boolean }) {
  const { t } = useApp();
  const [raw, setRaw] = useState(defaultRaw);
  const [copied, copy] = useCopy();
  const json = JSON.stringify(params ?? {}, null, 2);
  const entries = params && typeof params === "object" && !Array.isArray(params) ? Object.entries(params) : [];
  const isLong = (v: unknown) => typeof v === "string" && (v.length > 90 || v.includes("\n"));
  const short = entries.filter(([, v]) => !isLong(v) && (v === null || typeof v !== "object"));
  const long = entries.filter(([, v]) => isLong(v));
  const nested = entries.filter(([, v]) => v !== null && typeof v === "object");

  return (
    <div className="rounded-xl border border-border bg-surface-2/60">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-3"><Braces className="size-3.5" />{t("approvals.exactParams")}</p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setRaw((r) => !r)} className="rounded-md px-2 py-1 text-[12px] font-medium text-fg-2 hover:bg-surface-3" aria-pressed={raw}>
            {raw ? t("approvals.readableView") : t("approvals.rawJson")}
          </button>
          <button type="button" onClick={() => copy(json)} className="rounded-md p-1.5 text-fg-3 hover:bg-surface-3 hover:text-fg" aria-label={t("approvals.copyJson")} title={t("approvals.copyJson")}>
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      </div>
      {raw || !entries.length ? (
        <pre dir="ltr" className="max-h-80 overflow-auto p-3 text-start font-mono text-[12px] leading-relaxed text-fg whitespace-pre-wrap break-words">{json}</pre>
      ) : (
        <div className="space-y-3 p-3">
          {short.length > 0 && (
            <dl className="grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
              {short.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-mono text-[12px] text-fg-3 break-all">{k}</dt>
                  <dd className="min-w-0 break-words text-fg" dir="auto">{v === null ? <span className="text-fg-3">null</span> : String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {long.map(([k, v]) => (
            <div key={k}>
              <p className="mb-1 font-mono text-[12px] text-fg-3">{k}</p>
              <div dir="auto" className="max-h-72 overflow-auto rounded-lg border border-border bg-surface p-3 text-[13px] leading-relaxed text-fg whitespace-pre-wrap break-words">{String(v)}</div>
            </div>
          ))}
          {nested.map(([k, v]) => (
            <div key={k}>
              <p className="mb-1 font-mono text-[12px] text-fg-3">{k}</p>
              <pre dir="ltr" className="max-h-60 overflow-auto rounded-lg border border-border bg-surface p-2.5 text-start font-mono text-[12px] text-fg whitespace-pre-wrap break-words">{JSON.stringify(v, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RiskExplanation({ level }: { level: number }) {
  const { t } = useApp();
  const tone = level >= 4 ? "border-danger/30 bg-danger-soft text-danger" : level === 3 ? "border-warning/30 bg-warning-soft text-warning" : "border-border bg-surface-2 text-fg-2";
  return (
    <div className={cx("flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px]", tone)}>
      {level >= 4 ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
      <p><span className="font-semibold">{t("approvals.whatHappens")} </span>{t(level >= 4 ? "approvals.explain.4" : level === 3 ? "approvals.explain.3" : "approvals.explain.low")}</p>
    </div>
  );
}

/**
 * One approval request. Decisions always send back the exact paramsHash rendered here, so the server
 * can refuse if the action changed after the user reviewed it.
 */
export function ApprovalCard({ approval: a, onChanged, compact, showTask = true }: {
  approval: Approval;
  /** Called after a decision or when the approval is stale and must be refetched. */
  onChanged?: () => void;
  compact?: boolean;
  showTask?: boolean;
}) {
  const { t, locale, can, session } = useApp();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);
  const [expanded, setExpanded] = useState(!compact);
  const pending = a.status === "pending";
  const expired = pending && new Date(a.expiresAt).getTime() < Date.now();
  const isOwner = a.taskCreatedBy === session.user.id;
  const allowed = can("member") && (isOwner || can("admin"));

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setNotice(null);
    try {
      await api(`/api/approvals/${a.id}`, { method: "POST", body: { decision, paramsHash: a.paramsHash, note: note.trim() || undefined } });
      setConfirm(null);
      setNotice({ tone: "success", text: t(decision === "approve" ? "approvals.approvedNotice" : "approvals.rejectedNotice") });
      onChanged?.();
    } catch (e) {
      setConfirm(null);
      if (e instanceof ApiError && e.status === 409 && e.code === "params_changed") {
        setNotice({ tone: "warning", text: t("approvals.paramsChanged") });
        setExpanded(true);
        onChanged?.();
      } else if (e instanceof ApiError && e.status === 409) {
        setNotice({ tone: "info", text: `${t("approvals.noLongerPending")} ${e.message}` });
        onChanged?.();
      } else if (e instanceof ApiError && e.status === 403) {
        setNotice({ tone: "danger", text: t("approvals.forbidden") });
      } else {
        setNotice({ tone: "danger", text: (e as Error).message });
      }
    } finally {
      setBusy(null);
    }
  }

  const onApprove = () => (a.riskLevel >= 4 ? setConfirm("approve") : decide("approve"));

  return (
    <Card className={cx("overflow-hidden", pending && a.riskLevel >= 4 && "border-danger/40", compact && "shadow-none")}>
      <div className={cx("space-y-3", compact ? "p-3" : "p-4 sm:p-5")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {a.agentSlug && <AgentAvatar slug={a.agentSlug} size="sm" />}
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] font-semibold text-fg">{a.toolName}</code>
                <RiskBadge level={a.riskLevel} />
                {!pending && <StatusBadge status={a.status} />}
                {expired && <StatusBadge status="expired" />}
              </p>
              {a.agentSlug && <p className="mt-0.5 text-[12px] text-fg-3">{t("approvals.requestedBy")} <AgentName slug={a.agentSlug} /></p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-fg-3">
            <Clock className="size-3.5" />
            <span title={formatDateTime(a.createdAt, locale)}>{timeAgo(a.createdAt, t)}</span>
            {pending && !expired && <span className="text-warning">· {timeUntil(a.expiresAt, t)}</span>}
          </div>
        </div>

        <p className="text-[14px] font-medium leading-relaxed text-fg" dir="auto">{a.summary}</p>

        <div className="flex flex-col gap-1.5 text-[13px] sm:flex-row sm:flex-wrap sm:gap-x-5">
          {a.destination && (
            <p className="flex min-w-0 items-center gap-1.5 text-fg-2">
              <MapPin className="size-3.5 shrink-0 text-fg-3" />
              <span className="text-fg-3">{t("approvals.destination")}:</span>
              <span className="min-w-0 truncate font-medium text-fg" dir="auto" title={a.destination}>{a.destination}</span>
            </p>
          )}
          {showTask && a.taskId && (
            <Link href={`/tasks/${a.taskId}`} className="flex min-w-0 items-center gap-1 text-accent hover:underline">
              <span className="text-fg-3">{t("approvals.task")}:</span>
              <span className="min-w-0 truncate" dir="auto">{a.taskTitle ?? a.taskId}</span>
              <ArrowUpRight className="size-3.5 shrink-0 rtl:-scale-x-100" />
            </Link>
          )}
        </div>

        {pending && <RiskExplanation level={a.riskLevel} />}

        {compact && (
          <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
            className="flex items-center gap-1 text-[12.5px] font-medium text-fg-2 hover:text-fg">
            <ChevronDown className={cx("size-3.5 transition-transform", expanded && "rotate-180")} />
            {expanded ? t("approvals.hideParams") : t("approvals.showParams")}
          </button>
        )}
        {expanded && <ParamsView params={a.params} />}

        <p className="flex items-center gap-1.5 text-[11px] text-fg-3" title={a.paramsHash}>
          <Fingerprint className="size-3" />{t("approvals.fingerprint")} <code className="font-mono" dir="ltr">{a.paramsHash.slice(0, 12)}</code>
        </p>

        {!pending && (a.decidedAt || a.decisionNote) && (
          <div className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
            {a.decidedAt && <p>{t(`approvals.decided.${a.status}`, { time: formatDateTime(a.decidedAt, locale) })}</p>}
            {a.decisionNote && <p className="mt-1 flex items-start gap-1.5" dir="auto"><MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-fg-3" />{a.decisionNote}</p>}
          </div>
        )}

        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

        {pending && !expired && (
          <div className="space-y-2 border-t border-border pt-3">
            {noteOpen && (
              <Field label={t("approvals.noteLabel")}>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={t("approvals.notePlaceholder")} dir="auto" />
              </Field>
            )}
            {!allowed && <p className="text-[12.5px] text-fg-3">{can("member") ? t("approvals.ownerOnly") : t("approvals.viewerOnly")}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!noteOpen && (
                <Button variant="ghost" size="sm" onClick={() => setNoteOpen(true)} disabled={!allowed} className="me-auto">{t("approvals.addNote")}</Button>
              )}
              <Button variant="outline" size="sm" icon={<X className="size-4" />} onClick={() => setConfirm("reject")} disabled={!allowed || busy !== null} loading={busy === "reject"}>
                {t("action.reject")}
              </Button>
              <Button variant={a.riskLevel >= 4 ? "danger" : "success"} size="sm" icon={<Check className="size-4" />} onClick={onApprove} disabled={!allowed || busy !== null} loading={busy === "approve"}>
                {t("action.approve")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={confirm === "reject"} onClose={() => setConfirm(null)} size="sm" title={t("approvals.rejectTitle")} description={t("approvals.rejectBody")}
        footer={<>
          <Button variant="outline" onClick={() => setConfirm(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={busy === "reject"} onClick={() => decide("reject")}>{t("action.reject")}</Button>
        </>}>
        <Field label={t("approvals.noteLabel")}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={t("approvals.rejectNotePlaceholder")} dir="auto" />
        </Field>
      </Dialog>

      <Dialog open={confirm === "approve"} onClose={() => setConfirm(null)} size="md" title={t("approvals.confirmL4Title")}
        footer={<>
          <Button variant="outline" onClick={() => setConfirm(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={busy === "approve"} onClick={() => decide("approve")}>{t("approvals.confirmL4Button")}</Button>
        </>}>
        <div className="space-y-3 text-sm">
          <Alert tone="danger" title={t("approvals.confirmL4Warning")}>{t("approvals.explain.4")}</Alert>
          <dl className="space-y-2">
            <div><dt className="text-[12px] text-fg-3">{t("approvals.action")}</dt><dd className="font-mono text-fg">{a.toolName}</dd></div>
            <div><dt className="text-[12px] text-fg-3">{t("approvals.destination")}</dt><dd className="font-semibold break-words text-fg" dir="auto">{a.destination ?? t("approvals.noDestination")}</dd></div>
            <div><dt className="text-[12px] text-fg-3">{t("approvals.summary")}</dt><dd className="text-fg" dir="auto">{a.summary}</dd></div>
          </dl>
          {note.trim() && <p className="text-[13px] text-fg-2" dir="auto"><span className="text-fg-3">{t("approvals.noteLabel")}: </span>{note}</p>}
        </div>
      </Dialog>
    </Card>
  );
}

export function ApprovalCountBadge({ n }: { n: number }) {
  const { t } = useApp();
  if (!n) return null;
  return <Badge tone="warning" dot>{t("tasks.pendingApprovals", { n })}</Badge>;
}

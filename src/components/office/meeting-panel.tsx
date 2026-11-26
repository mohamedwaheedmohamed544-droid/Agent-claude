"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowUpRight, CheckCircle2, ListTodo, X } from "lucide-react";
import { useApi, timeAgo } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import { Badge, Spinner, StatusBadge } from "@/components/ui";
import { PROFILE_BY_SLUG } from "@/lib/office/profiles";
import type { ActivityEvent, MeetingDetail } from "@/lib/office/types";

/** Transcript of a real meeting: every line is a persisted message produced by an agent's model call. */
export function MeetingPanel({ meetingId, onClose, liveVersion }: { meetingId: string; onClose: () => void; liveVersion: number }) {
  const { t } = useApp();
  const { data, reload } = useApi<{ meeting: MeetingDetail }>(`/api/office/meetings/${meetingId}`);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { void reload(); }, [liveVersion, reload]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [data?.meeting.messages.length]);
  const m = data?.meeting;
  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-s border-border bg-surface sm:w-[420px]" aria-label={t("office.meeting.transcript")}>
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-fg-3">{t("office.meeting.transcript")}</p>
          <h2 className="mt-1 text-[15px] font-semibold text-fg" dir="auto">{m?.objective ?? "…"}</h2>
          {m && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {m.status === "in_progress" ? <Badge tone="info"><span className="size-1.5 animate-soft-pulse rounded-full bg-current" />{t("office.meeting.live")}</Badge> : <StatusBadge status={m.status} />}
              {m.participants.map((p) => {
                const pr = PROFILE_BY_SLUG.get(p);
                return <span key={p} className="rounded-full px-2 py-0.5 text-[11.5px] font-medium text-white" style={{ background: pr?.color ?? "#64748b" }}>{pr?.nameAr ?? p}</span>;
              })}
            </div>
          )}
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label={t("action.close")}><X className="size-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {!m ? <Spinner /> : (
          <>
            {m.agenda.length > 0 && (
              <div className="mb-4 rounded-xl bg-surface-2 px-3.5 py-3">
                <p className="text-[11.5px] font-semibold text-fg-3">{t("office.meeting.agenda")}</p>
                <ul className="mt-1 list-disc ps-4 text-[12.5px] text-fg-2">{m.agenda.map((a, i) => <li key={i} dir="auto">{a}</li>)}</ul>
              </div>
            )}
            <ol className="space-y-3">
              {m.messages.map((msg) => {
                const pr = PROFILE_BY_SLUG.get(msg.agent);
                return (
                  <li key={msg.id} className="flex gap-2.5">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg text-[12px] font-semibold text-white" style={{ background: pr?.color ?? "#64748b" }}>{pr?.nameAr.slice(0, 1) ?? "?"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] text-fg-3">
                        <span className="font-semibold text-fg-2">{pr?.nameAr ?? msg.agent}</span>
                        {" · "}{msg.kind === "summary" ? t("office.meeting.summary") : t("office.meeting.round", { n: msg.round })}{" · "}{timeAgo(msg.createdAt, t)}
                      </p>
                      <p className={msg.kind === "summary" ? "mt-1 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-[13px] text-fg" : "mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-2"} dir="auto">{msg.content}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {m.status === "in_progress" && <p className="mt-4 flex items-center gap-2 text-[12.5px] text-fg-3"><Spinner className="size-3.5" />{t("office.meeting.live")}…</p>}
            {m.decisions.length > 0 && (
              <div className="mt-5">
                <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-fg-2"><CheckCircle2 className="size-3.5 text-success" />{t("office.meeting.decisions")}</p>
                <ul className="space-y-1 text-[12.5px] text-fg-2">{m.decisions.map((d, i) => <li key={i} dir="auto">• {d}</li>)}</ul>
              </div>
            )}
            {m.actionItems.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-fg-2"><ListTodo className="size-3.5 text-accent" />{t("office.meeting.actions")}</p>
                <ul className="space-y-1 text-[12.5px] text-fg-2">
                  {m.actionItems.map((a, i) => <li key={i} dir="auto"><span className="font-semibold" style={{ color: PROFILE_BY_SLUG.get(a.owner)?.color }}>{PROFILE_BY_SLUG.get(a.owner)?.nameAr ?? a.owner}:</span> {a.item}</li>)}
                </ul>
              </div>
            )}
            {m.taskId && (
              <Link href={`/tasks/${m.taskId}`} className="mt-5 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
                {m.taskTitle ?? t("action.view")}<ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
              </Link>
            )}
            <div ref={endRef} />
          </>
        )}
      </div>
    </aside>
  );
}

export function ActivityFeed({ events, onSelectAgent, onOpenMeeting }: { events: ActivityEvent[]; onSelectAgent: (s: string) => void; onOpenMeeting: (id: string) => void }) {
  const { t, locale } = useApp();
  const items = [...events].filter((e) => e.type !== "idle").reverse().slice(0, 40);
  if (!items.length) return <p className="px-4 py-6 text-center text-[12.5px] text-fg-3">{t("office.feed.empty")}</p>;
  return (
    <ul className="divide-y divide-border" aria-live="polite">
      {items.map((e) => {
        const pr = PROFILE_BY_SLUG.get(e.agent);
        const rel = e.relatedAgent ? PROFILE_BY_SLUG.get(e.relatedAgent) : undefined;
        return (
          <li key={e.id} className="px-4 py-2.5">
            <p className="text-[12.5px] leading-snug text-fg-2">
              <button className="font-semibold hover:underline" style={{ color: pr?.color }} onClick={() => onSelectAgent(e.agent)}>{pr?.nameAr ?? e.agent}</button>{" "}
              {t(`office.event.${e.type}`, { name: rel ? (locale === "ar" ? rel.nameAr : `${rel.nameAr}`) : "" })}
              {e.meetingId && (e.type === "meeting_started" || e.type === "meeting_message") && (
                <button className="ms-1 text-accent hover:underline" onClick={() => onOpenMeeting(e.meetingId!)}>↗</button>
              )}
            </p>
            {e.summary && e.type !== "idle" && <p className="mt-0.5 line-clamp-2 text-[12px] text-fg-3" dir="auto">{e.summary}</p>}
            <p className="mt-0.5 text-[10.5px] text-fg-3">{timeAgo(e.createdAt, t)}</p>
          </li>
        );
      })}
    </ul>
  );
}

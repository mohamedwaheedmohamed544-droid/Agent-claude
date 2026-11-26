"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Briefcase, CalendarClock, ListChecks, MessageSquare, Pause, Play, Send, UserRound, Users, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi, timeAgo } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import { Alert, Badge, Button, Dialog, Field, Spinner, StatusBadge, Textarea, cx } from "@/components/ui";
import type { ActivityEvent, AgentMessage, AgentPresence, MeetingSummary } from "@/lib/office/types";
import { useOfficeDirectory, zoneName, type DirectoryEntry } from "./office-directory";
import { STATUS_DOT, STATUS_TONE, displayName, displayTitle } from "./office-utils";

interface AgentDetail {
  profile: DirectoryEntry;
  presence: AgentPresence | null;
  events: ActivityEvent[];
  messages: AgentMessage[];
  meetings: MeetingSummary[];
  tasks: Array<{ taskId: string; taskTitle: string; stepTitle: string; status: string; updatedAt: string }>;
  metrics: { total: number; completed: number; failed: number; avgSeconds: number | null } | null;
  config: { active: boolean; tier: string; tools: string[]; description: string; descriptionAr: string | null; capabilities: string[] } | null;
}

export function eventLine(e: ActivityEvent, t: (k: string, v?: Record<string, string | number>) => string, locale: "en" | "ar", get: (s: string) => DirectoryEntry | undefined): string {
  const related = e.relatedAgent ? displayName(get(e.relatedAgent), locale, e.relatedAgent) : "";
  return t(`office.event.${e.type}`, { name: related });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4">
      <h3 className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-fg-3">{title}</h3>
      {children}
    </section>
  );
}

export function AgentPanel({ slug, presence, onClose, onMeeting, liveVersion }: {
  slug: string; presence: AgentPresence | undefined; onClose: () => void; onMeeting: (slug: string) => void; liveVersion: number;
}) {
  const { t, locale, can } = useApp();
  const dir = useOfficeDirectory();
  const { data, error, reload } = useApi<AgentDetail>(`/api/office/agents/${slug}`);
  const [assignOpen, setAssignOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => { void reload(); }, [liveVersion, reload]);

  const profile = dir.get(slug);
  if (!profile) return null;
  const p = presence ?? data?.presence ?? null;
  const isOrchestrator = profile.isOrchestrator;
  const active = data?.config?.active ?? true;

  const togglePause = async () => {
    setBusy(true); setActionError(null);
    try {
      await api(`/api/agents/${slug}`, { method: "PATCH", body: { active: !active } });
      await reload();
    } catch (e) { setActionError((e as Error).message); } finally { setBusy(false); }
  };

  const fmtSec = (s: number | null | undefined) => (s == null ? "—" : s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`);

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-s border-border bg-surface sm:w-[400px]" aria-label={displayName(profile, locale)}>
      <div className="flex items-start gap-3 px-5 pb-4 pt-5" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${profile.color} 12%, transparent), transparent)` }}>
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl text-lg font-semibold text-white shadow-card" style={{ background: profile.color }}>
          {profile.nameAr.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-fg" dir="rtl">{profile.nameAr}</h2>
          <p className="text-[12.5px] text-fg-3">{profile.nameEn} · <span className="font-mono" dir="ltr">{profile.slug}</span></p>
          <p className="mt-0.5 text-[13px] text-fg-2">{displayTitle(profile, locale)}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label={t("action.close")}><X className="size-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3 px-5 pb-4 text-[13px]">
          <div>
            <p className="text-[11.5px] text-fg-3">{t("office.panel.status")}</p>
            {p ? (
              <Badge tone={STATUS_TONE[p.status]} className="mt-1"><span className="size-1.5 rounded-full" style={{ background: STATUS_DOT[p.status] }} />{t(`office.status.${p.status}`)}</Badge>
            ) : <Spinner />}
          </div>
          <div>
            <p className="text-[11.5px] text-fg-3">{t("office.panel.location")}</p>
            <p className="mt-1 font-medium text-fg">{p ? zoneName(dir.layout, p.zone, locale, t) : "—"}</p>
          </div>
          <div className="col-span-2">
            <p className="text-[11.5px] text-fg-3">{t("office.panel.currentTask")}</p>
            {p?.activity ? (
              <div className="mt-1">
                <p className="font-medium text-fg" dir="auto">{p.activity}</p>
                {p.waitingFor && <p className="mt-0.5 text-[12px] text-warning">{p.waitingFor === "approval" ? t("office.waitingFor.approval") : t("office.waitingFor.agent", { name: displayName(dir.get(p.waitingFor), locale, p.waitingFor) })}</p>}
                {p.taskId && <Link href={`/tasks/${p.taskId}`} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">{p.taskTitle ?? t("action.view")}<ArrowUpRight className="size-3.5 rtl:-scale-x-100" /></Link>}
              </div>
            ) : <p className="mt-1 text-fg-3">{t("office.panel.noTask")}</p>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 px-5 pb-4">
          {!isOrchestrator && can("member") && <Button size="sm" icon={<Send className="size-3.5" />} onClick={() => setAssignOpen(true)} disabled={!active}>{t("office.action.assign")}</Button>}
          {can("member") && <Button size="sm" variant="outline" icon={<Users className="size-3.5" />} onClick={() => onMeeting(slug)}>{t("office.action.meeting")}</Button>}
          <Link href="/chat"><Button size="sm" variant="outline" icon={<MessageSquare className="size-3.5" />}>{t("office.action.chat")}</Button></Link>
          <Link href="/tasks"><Button size="sm" variant="ghost" icon={<ListChecks className="size-3.5" />}>{t("office.action.history")}</Button></Link>
          {!isOrchestrator && <Link href={`/agents/${slug}`}><Button size="sm" variant="ghost" icon={<UserRound className="size-3.5" />}>{t("office.action.profile")}</Button></Link>}
          {!isOrchestrator && can("admin") && (
            <Button size="sm" variant="ghost" loading={busy} icon={active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} onClick={togglePause}>
              {active ? t("office.action.pause") : t("office.action.resume")}
            </Button>
          )}
        </div>
        <p className="px-5 pb-3 text-[11.5px] text-fg-3">{isOrchestrator ? t("office.orchestratorNote") : t("office.pauseNote")}</p>
        {notice && <div className="px-5 pb-3"><Alert tone="success">{notice}</Alert></div>}
        {actionError && <div className="px-5 pb-3"><Alert tone="danger">{actionError}</Alert></div>}
        {error && <div className="px-5 pb-3"><Alert tone="danger">{error.message}</Alert></div>}

        <Section title={t("office.panel.metrics")}>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              ["office.panel.metric.total", data?.metrics?.total ?? 0],
              ["office.panel.metric.completed", data?.metrics?.completed ?? 0],
              ["office.panel.metric.failed", data?.metrics?.failed ?? 0],
              ["office.panel.metric.avg", fmtSec(data?.metrics?.avgSeconds)],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-surface-2 px-2 py-2">
                <p className="text-base font-semibold tabular-nums text-fg">{v}</p>
                <p className="text-[10.5px] leading-tight text-fg-3">{t(k as string)}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t("office.panel.recent")}>
          {!data ? <Spinner /> : data.events.length === 0 ? <p className="text-[13px] text-fg-3">{t("office.panel.empty")}</p> : (
            <ul className="space-y-2">
              {[...data.events].reverse().slice(0, 12).map((e) => (
                <li key={e.id} className="flex gap-2 text-[12.5px]">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-fg-3" />
                  <div className="min-w-0">
                    <p className="text-fg-2">{eventLine(e, t, locale, dir.get)}{e.summary && <span className="text-fg-3"> — <span dir="auto">{e.summary}</span></span>}</p>
                    <p className="text-[11px] text-fg-3">{timeAgo(e.createdAt, t)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("office.panel.collab")}>
          {!data ? <Spinner /> : data.messages.length === 0 ? <p className="text-[13px] text-fg-3">{t("office.panel.empty")}</p> : (
            <ul className="space-y-2.5">
              {[...data.messages].reverse().slice(0, 10).map((m) => {
                return (
                  <li key={m.id} className="rounded-xl border border-border px-3 py-2">
                    <p className="text-[11.5px] text-fg-3">
                      <span className="font-medium" style={{ color: dir.get(m.from)?.color }}>{dir.get(m.from)?.nameAr ?? m.from}</span>
                      {" → "}
                      <span className="font-medium" style={{ color: dir.get(m.to)?.color }}>{dir.get(m.to)?.nameAr ?? m.to}</span>
                      {" · "}{m.kind} · {timeAgo(m.createdAt, t)}
                    </p>
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12.5px] text-fg-2" dir="auto">{m.content}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title={t("office.panel.meetings")}>
          {!data ? <Spinner /> : data.meetings.length === 0 ? <p className="text-[13px] text-fg-3">{t("office.meeting.none")}</p> : (
            <ul className="space-y-1.5">
              {data.meetings.slice(0, 6).map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-[12.5px]">
                  <CalendarClock className="size-3.5 shrink-0 text-fg-3" />
                  <span className="min-w-0 flex-1 truncate text-fg-2" dir="auto">{m.objective}</span>
                  <StatusBadge status={m.status === "in_progress" ? "running" : m.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("office.panel.tasks")}>
          {!data ? <Spinner /> : data.tasks.length === 0 ? <p className="text-[13px] text-fg-3">{t("office.panel.empty")}</p> : (
            <ul className="space-y-1.5">
              {data.tasks.slice(0, 8).map((x, i) => (
                <li key={`${x.taskId}-${i}`}>
                  <Link href={`/tasks/${x.taskId}`} className="flex items-center gap-2 rounded-lg px-1 py-1 text-[12.5px] hover:bg-surface-2">
                    <Briefcase className="size-3.5 shrink-0 text-fg-3" />
                    <span className="min-w-0 flex-1 truncate text-fg-2" dir="auto">{x.stepTitle}</span>
                    <StatusBadge status={x.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <AssignDialog open={assignOpen} onClose={() => setAssignOpen(false)} profile={profile}
        onDone={() => { setNotice(t("office.assign.done", { name: profile.nameAr })); void reload(); }} />
    </aside>
  );
}

function AssignDialog({ open, onClose, profile, onDone }: { open: boolean; onClose: () => void; profile: DirectoryEntry; onDone: () => void }) {
  const { t } = useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (text.trim().length < 2) return;
    setBusy(true); setErr(null);
    try {
      await api("/api/office/assign", { body: { agent: profile.slug, message: text.trim() } });
      setText(""); onClose(); onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t("office.assign.title", { name: profile.nameAr })} description={t("office.assign.hint")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("action.cancel")}</Button><Button loading={busy} onClick={submit} disabled={text.trim().length < 2}>{t("office.assign.submit")}</Button></>}>
      <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("office.assign.placeholder")} dir="auto" autoFocus maxLength={20000} />
      {err && <div className="mt-3"><Alert tone="danger">{err}</Alert></div>}
    </Dialog>
  );
}

export function MeetingDialog({ open, onClose, initial, profiles }: { open: boolean; onClose: () => void; initial: string | null; profiles: DirectoryEntry[] }) {
  const { t, locale } = useApp();
  const [objective, setObjective] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (open) { setPicked(initial && initial !== "orchestrator" ? [initial] : []); setErr(null); setDone(false); }
  }, [open, initial]);
  const specialists = profiles.filter((p) => !p.isOrchestrator && p.lifecycle === "active");
  const toggle = (s: string) => setPicked((x) => (x.includes(s) ? x.filter((y) => y !== s) : x.length >= 4 ? x : [...x, s]));
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api("/api/office/meetings", { body: { objective: objective.trim(), participants: picked } });
      setDone(true); setObjective("");
      setTimeout(onClose, 1200);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t("office.meeting.title")} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t("action.cancel")}</Button><Button loading={busy} onClick={submit} disabled={objective.trim().length < 5 || picked.length < 2}>{t("office.meeting.submit")}</Button></>}>
      <div className="space-y-4">
        <Field label={t("office.meeting.objective")}><Textarea rows={4} value={objective} onChange={(e) => setObjective(e.target.value)} dir="auto" maxLength={4000} /></Field>
        <div>
          <p className="mb-2 text-[13px] font-medium text-fg-2">{t("office.meeting.participants")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {specialists.map((p) => (
              <button key={p.slug} type="button" onClick={() => toggle(p.slug)} aria-pressed={picked.includes(p.slug)}
                className={cx("rounded-xl border px-3 py-2 text-start text-[12.5px] transition-colors", picked.includes(p.slug) ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}>
                <span className="block font-semibold" style={{ color: p.color }} dir="rtl">{p.nameAr}</span>
                <span className="block truncate text-fg-3">{displayTitle(p, locale)}</span>
              </button>
            ))}
          </div>
        </div>
        {done && <Alert tone="success">{t("office.meeting.done")}</Alert>}
        {err && <Alert tone="danger">{err}</Alert>}
      </div>
    </Dialog>
  );
}

"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Building2, ChevronDown, LayoutGrid, ListChecks, Users, Volume2, VolumeX } from "lucide-react";
import { useApi, timeAgo } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import { Alert, Badge, ErrorState, Select, Spinner, StatusBadge, Tabs, cx } from "@/components/ui";
import type { AgentStatus, OfficeZone } from "@/lib/office/types";
import { PROFILE_BY_SLUG } from "@/lib/office/profiles";
import { useOffice } from "./use-office";
import { AgentPanel, MeetingDialog } from "./agent-panel";
import { ActivityFeed, MeetingPanel } from "./meeting-panel";
import { STATUS_DOT, STATUS_TONE, ZONES, displayTitle, speak } from "./office-utils";

const OfficeScene = dynamic(() => import("./scene/office-scene"), {
  ssr: false,
  loading: () => <SceneLoading />,
});

function SceneLoading() {
  const { t } = useApp();
  return <div className="grid h-full place-items-center text-sm text-fg-3"><span className="flex items-center gap-2"><Spinner />{t("office.loading3d")}</span></div>;
}

type View = "office" | "departments" | "agents" | "tasks";
type Filter = "all" | "active" | "idle" | "meeting" | "error";

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const matchesFilter = (status: AgentStatus, f: Filter) =>
  f === "all" ? true : f === "active" ? ["working", "waiting", "meeting"].includes(status) : f === "idle" ? status === "idle" || status === "paused" : f === "meeting" ? status === "meeting" : status === "error";

export function OfficeView() {
  const { t, locale, can } = useApp();
  const { state, error, connected, reload, onEvents } = useOffice();
  const [view, setView] = useState<View>("office");
  const [filter, setFilter] = useState<Filter>("all");
  const [zone, setZone] = useState<OfficeZone>("executive");
  const [selected, setSelected] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<"orbit" | "follow">("orbit");
  const [quality, setQuality] = useState<"auto" | "high" | "low">("auto");
  const [voice, setVoice] = useState(false);
  const [feedOpen, setFeedOpen] = useState(true);
  const [meetingDialog, setMeetingDialog] = useState<{ open: boolean; initial: string | null }>({ open: false, initial: null });
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [liveVersion, setLiveVersion] = useState(0);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    const ok = webglAvailable();
    setWebgl(ok);
    if (!ok) setView("agents");
    try {
      const q = localStorage.getItem("nexus-office-quality");
      if (q === "auto" || q === "high" || q === "low") setQuality(q);
    } catch { /* storage unavailable */ }
  }, []);

  // React to live events: refresh open panels; optionally read meeting lines aloud.
  useEffect(() => onEvents((events) => {
    setLiveVersion((v) => v + 1);
    if (voiceRef.current) {
      for (const e of events) {
        if (e.type === "meeting_message" && typeof e.payload.content === "string") {
          speak(e.payload.content, Math.max(0, [...PROFILE_BY_SLUG.keys()].indexOf(e.agent)));
        }
      }
    }
    const started = events.find((e) => e.type === "meeting_started" && e.meetingId);
    if (started?.meetingId) setMeetingId((cur) => cur ?? started.meetingId);
  }), [onEvents]);

  const presenceBy = useMemo(() => new Map((state?.presence ?? []).map((p) => [p.agent, p])), [state?.presence]);
  const dimmed = useMemo(
    () => (state?.profiles ?? []).filter((p) => !matchesFilter(presenceBy.get(p.slug)?.status ?? "idle", filter)).map((p) => p.slug),
    [state?.profiles, presenceBy, filter],
  );
  const selectAgent = useCallback((s: string | null) => { setSelected(s); if (s) setMeetingId(null); }, []);
  const openMeeting = useCallback((id: string) => { setMeetingId(id); setSelected(null); }, []);
  const setQ = (q: "auto" | "high" | "low") => { setQuality(q); try { localStorage.setItem("nexus-office-quality", q); } catch { /* ignore */ } };

  if (error && !state) return <div className="p-6"><ErrorState error={error} onRetry={() => void reload()} /></div>;
  if (!state) return <div className="grid h-full place-items-center"><Spinner className="size-6" /></div>;

  const d = state.dashboard;
  const liveMeeting = state.meetings.find((m) => m.status === "in_progress");
  const stats: Array<[string, number, string?]> = [
    ["office.stat.total", d.totalAgents], ["office.stat.active", d.activeAgents, "text-accent"], ["office.stat.idle", d.idleAgents],
    ["office.stat.inMeetings", d.inMeetings, "text-info"], ["office.stat.running", d.runningTasks], ["office.stat.completed", d.completedTasks, "text-success"],
    ["office.stat.approvals", d.pendingApprovals, d.pendingApprovals ? "text-warning" : undefined], ["office.stat.meetings", d.currentMeetings],
  ];
  const showScene = (view === "office" || view === "departments") && webgl;
  const panelOpen = Boolean(selected || meetingId);

  return (
    <div className="flex h-full flex-col">
      {/* Header + dashboard */}
      <div className="border-b border-border bg-bg px-4 pb-3 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent-text"><Building2 className="size-[18px]" /></span>
            <div>
              <h1 className="text-[17px] font-semibold tracking-tight text-fg">{t("office.title")}</h1>
              <p className="hidden text-[12px] text-fg-3 md:block">{t("office.subtitle")}</p>
            </div>
          </div>
          <Badge tone={connected ? "success" : "warning"} className="ms-auto sm:ms-0">
            <span className={cx("size-1.5 rounded-full bg-current", connected && "animate-soft-pulse")} />{connected ? t("office.live") : t("office.reconnecting")}
          </Badge>
          {can("member") && (
            <button onClick={() => setMeetingDialog({ open: true, initial: null })} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-hover sm:ms-auto">
              <Users className="size-3.5" />{t("office.meeting.title")}
            </button>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8" data-testid="office-dashboard">
          {stats.map(([k, v, tone]) => (
            <div key={k} className="rounded-xl border border-border bg-surface px-2.5 py-2">
              <dd className={cx("text-lg font-semibold tabular-nums leading-tight text-fg", tone)} data-stat={k.split(".").pop()}>{v}</dd>
              <dt className="truncate text-[10.5px] text-fg-3">{t(k)}</dt>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Tabs value={view} onChange={(v) => setView(v)} items={[
            { value: "office" as View, label: <span className="flex items-center gap-1.5"><Building2 className="size-3.5" />{t("office.view.office")}</span> },
            { value: "departments" as View, label: <span className="flex items-center gap-1.5"><LayoutGrid className="size-3.5" />{t("office.view.departments")}</span> },
            { value: "agents" as View, label: <span className="flex items-center gap-1.5"><Users className="size-3.5" />{t("office.view.agents")}</span> },
            { value: "tasks" as View, label: <span className="flex items-center gap-1.5"><ListChecks className="size-3.5" />{t("office.view.tasks")}</span> },
          ]} />
          <div className="flex flex-wrap gap-1" role="group" aria-label="filter">
            {(["all", "active", "idle", "meeting", "error"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={cx("rounded-full border px-2.5 py-1 text-[12px] font-medium", filter === f ? "border-accent bg-accent-soft text-accent-text" : "border-border text-fg-3 hover:text-fg")}>
                {t(`office.filter.${f}`)}
              </button>
            ))}
          </div>
          {showScene && (
            <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
              {view === "departments" && (
                <Select value={zone} onChange={(e) => setZone(e.target.value as OfficeZone)} className="h-8 text-[12.5px]" style={{ width: "auto" }} aria-label={t("office.view.departments")}>
                  {ZONES.map((z) => <option key={z} value={z}>{t(`office.zone.${z}`)}</option>)}
                </Select>
              )}
              <Select value={cameraMode} onChange={(e) => setCameraMode(e.target.value as "orbit" | "follow")} className="h-8 text-[12.5px]" style={{ width: "auto" }} aria-label="camera">
                <option value="orbit">{t("office.camera.orbit")}</option>
                <option value="follow" disabled={!selected}>{t("office.camera.follow")}</option>
              </Select>
              <Select value={quality} onChange={(e) => setQ(e.target.value as "auto" | "high" | "low")} className="h-8 text-[12.5px]" style={{ width: "auto" }} aria-label={t("office.quality")}>
                {(["auto", "high", "low"] as const).map((q) => <option key={q} value={q}>{t("office.quality")}: {t(`office.quality.${q}`)}</option>)}
              </Select>
              <button onClick={() => setVoice(!voice)} aria-pressed={voice} title={t("office.voice")} aria-label={t("office.voice")}
                className={cx("grid size-8 place-items-center rounded-lg border", voice ? "border-accent bg-accent-soft text-accent-text" : "border-border text-fg-3")}>
                {voice ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </button>
            </div>
          )}
        </div>
        {webgl === false && <div className="mt-3"><Alert tone="info">{t("office.noWebgl")}</Alert></div>}
      </div>

      {/* Body */}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1" data-testid="office-main">
          {showScene ? (
            <>
              <OfficeScene
                profiles={state.profiles} presence={state.presence} events={state.events} messages={state.messages}
                selectedAgent={selected} onSelectAgent={selectAgent}
                cameraMode={cameraMode === "follow" && selected ? "follow" : "orbit"}
                focusZone={view === "departments" ? zone : null} dimmedAgents={dimmed} quality={quality} locale={locale}
              />
              {liveMeeting && !meetingId && (
                <button onClick={() => openMeeting(liveMeeting.id)} className="absolute start-3 top-3 flex max-w-[70%] items-center gap-2 rounded-xl border border-border bg-surface/95 px-3 py-2 text-start text-[12.5px] shadow-pop backdrop-blur">
                  <span className="size-2 shrink-0 animate-soft-pulse rounded-full bg-info" />
                  <span className="min-w-0"><span className="block font-semibold text-fg">{t("office.meeting.live")}</span><span className="block truncate text-fg-3" dir="auto">{liveMeeting.objective}</span></span>
                </button>
              )}
              <div className={cx("absolute bottom-3 start-3 w-[min(340px,calc(100%-1.5rem))] overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-pop backdrop-blur", !feedOpen && "w-auto")}>
                <button onClick={() => setFeedOpen(!feedOpen)} className="flex w-full items-center gap-2 px-4 py-2.5 text-[12.5px] font-semibold text-fg">
                  <Activity className="size-3.5 text-accent" />{t("office.feed")}<ChevronDown className={cx("ms-auto size-4 text-fg-3 transition-transform", !feedOpen && "rotate-180")} />
                </button>
                {feedOpen && <div className="max-h-[32vh] overflow-y-auto border-t border-border"><ActivityFeed events={state.events} onSelectAgent={selectAgent} onOpenMeeting={openMeeting} /></div>}
              </div>
            </>
          ) : view === "tasks" ? (
            <TaskOverview />
          ) : (
            <AgentList filter={filter} onSelect={selectAgent} presenceBy={presenceBy} profiles={state.profiles} />
          )}
          {(view === "agents" || view === "tasks") && (
            <div className="border-t border-border px-4 py-4 sm:px-6">
              <MeetingsList meetings={state.meetings} onOpen={openMeeting} />
            </div>
          )}
        </div>
        {panelOpen && (
          <div className="absolute inset-y-0 end-0 z-20 w-full sm:static sm:w-auto">
            {selected ? (
              <AgentPanel slug={selected} presence={presenceBy.get(selected)} onClose={() => setSelected(null)} liveVersion={liveVersion}
                onMeeting={(s) => setMeetingDialog({ open: true, initial: s })} />
            ) : meetingId ? (
              <MeetingPanel meetingId={meetingId} onClose={() => setMeetingId(null)} liveVersion={liveVersion} />
            ) : null}
          </div>
        )}
      </div>
      <MeetingDialog open={meetingDialog.open} initial={meetingDialog.initial} profiles={state.profiles} onClose={() => setMeetingDialog({ open: false, initial: null })} />
    </div>
  );
}

function AgentList({ filter, onSelect, presenceBy, profiles }: {
  filter: Filter; onSelect: (s: string) => void; presenceBy: Map<string, import("@/lib/office/types").AgentPresence>; profiles: import("@/lib/office/types").AgentProfile[];
}) {
  const { t, locale } = useApp();
  const list = profiles.filter((p) => matchesFilter(presenceBy.get(p.slug)?.status ?? "idle", filter));
  return (
    <div className="grid gap-3 overflow-y-auto p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-4" data-testid="office-agent-list">
      {list.map((p) => {
        const pr = presenceBy.get(p.slug);
        return (
          <button key={p.slug} onClick={() => onSelect(p.slug)} data-agent={p.slug} data-status={pr?.status}
            className="rounded-2xl border border-border bg-surface p-4 text-start shadow-card transition-colors hover:border-border-strong">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl text-base font-semibold text-white" style={{ background: p.color }}>{p.nameAr.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-fg" dir="rtl">{p.nameAr}</p>
                <p className="truncate text-[12px] text-fg-3">{displayTitle(p, locale)}</p>
              </div>
              {pr && <Badge tone={STATUS_TONE[pr.status]}><span className="size-1.5 rounded-full" style={{ background: STATUS_DOT[pr.status] }} />{t(`office.status.${pr.status}`)}</Badge>}
            </div>
            <dl className="mt-3 space-y-1 text-[12px]">
              <div className="flex gap-2"><dt className="text-fg-3">{t("office.agentsList.location")}</dt><dd className="text-fg-2">{pr ? t(`office.zone.${pr.zone}`) : "—"}</dd></div>
              <div className="flex gap-2"><dt className="shrink-0 text-fg-3">{t("office.agentsList.activity")}</dt><dd className="truncate text-fg-2" dir="auto">{pr?.activity ?? "—"}</dd></div>
            </dl>
          </button>
        );
      })}
    </div>
  );
}

function TaskOverview() {
  const { t } = useApp();
  const { data, loading } = useApi<{ tasks: Array<{ id: string; title: string; status: string; agents: string[] | null; stepCount: number; stepsDone: number; updatedAt: string }> }>("/api/tasks?limit=30", { intervalMs: 10_000 });
  if (loading && !data) return <div className="p-6"><Spinner /></div>;
  if (!data?.tasks.length) return <p className="p-6 text-sm text-fg-3">{t("office.tasks.empty")}</p>;
  return (
    <ul className="divide-y divide-border overflow-y-auto" data-testid="office-task-list">
      {data.tasks.map((task) => (
        <li key={task.id}>
          <Link href={`/tasks/${task.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 sm:px-6">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg" dir="auto">{task.title}</p>
              <p className="mt-0.5 flex flex-wrap gap-1 text-[11.5px] text-fg-3">
                {(task.agents ?? []).map((a) => <span key={a} style={{ color: PROFILE_BY_SLUG.get(a)?.color }}>{PROFILE_BY_SLUG.get(a)?.nameAr ?? a}</span>)}
                <span>· {task.stepsDone}/{task.stepCount}</span><span>· {timeAgo(task.updatedAt, t)}</span>
              </p>
            </div>
            <StatusBadge status={task.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MeetingsList({ meetings, onOpen }: { meetings: import("@/lib/office/types").MeetingSummary[]; onOpen: (id: string) => void }) {
  const { t } = useApp();
  return (
    <div>
      <h2 className="mb-2 text-[13px] font-semibold text-fg">{t("office.meeting.recent")}</h2>
      {meetings.length === 0 ? <p className="text-[12.5px] text-fg-3">{t("office.meeting.none")}</p> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {meetings.slice(0, 6).map((m) => (
            <li key={m.id}>
              <button onClick={() => onOpen(m.id)} className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-start text-[12.5px] hover:border-border-strong" data-meeting={m.id}>
                <span className="min-w-0 flex-1 truncate text-fg-2" dir="auto">{m.objective}</span>
                <span className="flex -space-x-1 rtl:space-x-reverse">{m.participants.map((p) => <span key={p} className="size-2.5 rounded-full ring-2 ring-surface" style={{ background: PROFILE_BY_SLUG.get(p)?.color }} />)}</span>
                <StatusBadge status={m.status === "in_progress" ? "running" : m.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

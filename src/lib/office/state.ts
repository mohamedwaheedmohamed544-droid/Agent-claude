import { query, queryOne } from "../db";
import { ensureWorkspaceSeeded } from "../agents/registry";
import { getAgentRuntime } from "../agents/runtime";
import { eventsAfter, getPresence, recentMessages } from "./events";
import { listMeetings } from "./meetings";
import { computeLayoutSpec, getDirectory, toProfiles } from "./directory";
import type { OfficeDashboard, OfficeState } from "./types";

export async function getOfficeState(workspaceId: string): Promise<OfficeState> {
  await ensureWorkspaceSeeded(workspaceId);
  const dir = await getDirectory(workspaceId);
  const profiles = toProfiles(dir);
  const [layout, presence, meetings, events, messages, counts] = await Promise.all([
    computeLayoutSpec(workspaceId, profiles),
    getPresence(workspaceId),
    listMeetings(workspaceId, { limit: 20 }),
    eventsAfter(workspaceId, null, 100),
    recentMessages(workspaceId, { limit: 60 }),
    queryOne<{ running: number; completed: number; approvals: number }>(
      `SELECT (SELECT count(*)::int FROM tasks WHERE workspace_id=$1 AND status IN ('planned','running','waiting_approval')) AS running,
              (SELECT count(*)::int FROM tasks WHERE workspace_id=$1 AND status='completed') AS completed,
              (SELECT count(*)::int FROM approvals WHERE workspace_id=$1 AND status='pending') AS approvals`, [workspaceId],
    ),
  ]);
  const inOffice = new Set(profiles.map((p) => p.slug));
  const live = presence.filter((p) => inOffice.has(p.agent));
  const dashboard: OfficeDashboard = {
    totalAgents: profiles.length,
    activeAgents: live.filter((p) => ["working", "thinking", "collaborating", "meeting", "waiting"].includes(p.status)).length,
    idleAgents: live.filter((p) => p.status === "idle").length,
    inMeetings: live.filter((p) => p.status === "meeting").length,
    runningTasks: counts?.running ?? 0,
    completedTasks: counts?.completed ?? 0,
    pendingApprovals: counts?.approvals ?? 0,
    currentMeetings: meetings.filter((m) => m.status === "in_progress").length,
  };
  return {
    profiles, layout, presence, dashboard, meetings, events, messages, lastEventId: events.at(-1)?.id ?? null,
    directory: dir.map((d) => ({ slug: d.slug, nameAr: d.nameAr, nameEn: d.nameEn, titleEn: d.titleEn, titleAr: d.titleAr, color: d.color, lifecycle: d.lifecycle, isOrchestrator: d.isOrchestrator })),
  };
}

export async function getAgentDetail(workspaceId: string, slug: string) {
  await ensureWorkspaceSeeded(workspaceId);
  const entry = (await getDirectory(workspaceId)).find((d) => d.slug === slug);
  if (!entry) return null;
  const rt = await getAgentRuntime(workspaceId, slug);
  const isOrchestrator = entry.isOrchestrator;
  const [presence, events, messages, meetings, tasks, metrics] = await Promise.all([
    getPresence(workspaceId).then((p) => p.find((x) => x.agent === slug) ?? null),
    query(
      `SELECT id::text, agent_slug AS agent, event_type AS type, task_id AS "taskId", step_id AS "stepId", meeting_id AS "meetingId",
              related_agent AS "relatedAgent", zone, summary, payload, created_at AS "createdAt"
         FROM agent_activity_events WHERE workspace_id=$1 AND agent_slug=$2 ORDER BY id DESC LIMIT 40`, [workspaceId, slug]),
    recentMessages(workspaceId, { agent: slug, limit: 40 }),
    listMeetings(workspaceId, { agent: slug, limit: 15 }),
    isOrchestrator
      ? query(`SELECT t.id AS "taskId", t.title AS "taskTitle", t.title AS "stepTitle", t.status, t.updated_at AS "updatedAt"
                 FROM tasks t WHERE t.workspace_id=$1 ORDER BY t.updated_at DESC LIMIT 20`, [workspaceId])
      : query(`SELECT s.task_id AS "taskId", t.title AS "taskTitle", s.title AS "stepTitle", s.status, s.updated_at AS "updatedAt"
                 FROM task_steps s JOIN tasks t ON t.id=s.task_id WHERE s.workspace_id=$1 AND (s.agent_slug=$2 OR $2 = ANY(s.participants))
                ORDER BY s.updated_at DESC LIMIT 20`, [workspaceId, slug]),
    isOrchestrator
      ? queryOne(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='completed')::int AS completed, count(*) FILTER (WHERE status='failed')::int AS failed,
                         avg(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE status='completed')::float AS "avgSeconds"
                    FROM tasks WHERE workspace_id=$1`, [workspaceId])
      : queryOne(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='completed')::int AS completed, count(*) FILTER (WHERE status='failed')::int AS failed,
                         avg(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE status='completed')::float AS "avgSeconds"
                    FROM task_steps WHERE workspace_id=$1 AND (agent_slug=$2 OR $2 = ANY(participants))`, [workspaceId, slug]),
  ]);
  return {
    profile: { slug, nameAr: entry.nameAr, nameEn: entry.nameEn, titleEn: entry.titleEn, titleAr: entry.titleAr, color: entry.color, deskZone: entry.departmentKey },
    lifecycle: entry.lifecycle,
    presence, events: (events as unknown[]).reverse(), messages, meetings, tasks, metrics,
    config: rt ? { active: rt.assignable, tier: rt.tier, tools: rt.allowedTools, description: rt.description, descriptionAr: rt.descriptionAr, capabilities: rt.capabilities } : null,
  };
}

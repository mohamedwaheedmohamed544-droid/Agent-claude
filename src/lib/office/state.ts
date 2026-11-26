import { query, queryOne } from "../db";
import { listAgents } from "../agents/store";
import { AGENT_PROFILES, PROFILE_BY_SLUG } from "./profiles";
import { eventsAfter, getPresence, recentMessages, syncAgentProfiles } from "./events";
import { listMeetings } from "./meetings";
import type { OfficeDashboard, OfficeState } from "./types";

export async function getOfficeState(workspaceId: string): Promise<OfficeState> {
  await syncAgentProfiles();
  const [presence, meetings, events, messages, counts] = await Promise.all([
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
  const dashboard: OfficeDashboard = {
    totalAgents: AGENT_PROFILES.length,
    activeAgents: presence.filter((p) => p.status === "working" || p.status === "meeting" || p.status === "waiting").length,
    idleAgents: presence.filter((p) => p.status === "idle").length,
    inMeetings: presence.filter((p) => p.status === "meeting").length,
    runningTasks: counts?.running ?? 0,
    completedTasks: counts?.completed ?? 0,
    pendingApprovals: counts?.approvals ?? 0,
    currentMeetings: meetings.filter((m) => m.status === "in_progress").length,
  };
  return { profiles: AGENT_PROFILES, presence, dashboard, meetings, events, messages, lastEventId: events.at(-1)?.id ?? null };
}

export async function getAgentDetail(workspaceId: string, slug: string) {
  const profile = PROFILE_BY_SLUG.get(slug);
  if (!profile) return null;
  const isOrchestrator = slug === "orchestrator";
  const [presence, agents, events, messages, meetings, tasks, metrics] = await Promise.all([
    getPresence(workspaceId).then((p) => p.find((x) => x.agent === slug) ?? null),
    isOrchestrator ? Promise.resolve([]) : listAgents(workspaceId),
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
  const agent = (agents as Awaited<ReturnType<typeof listAgents>>).find((a) => a.slug === slug);
  return {
    profile, presence, events: (events as unknown[]).reverse(), messages, meetings, tasks, metrics,
    config: agent ? { active: agent.active, tier: agent.tier, tools: agent.allowedTools, description: agent.description, descriptionAr: agent.descriptionAr, capabilities: agent.capabilities } : null,
  };
}

export const DEFAULT_OFFICE_SETTINGS = { quality: "auto", voice: { enabled: false } } as const;

export async function getOfficeSettings(workspaceId: string) {
  const row = await queryOne<{ settings: Record<string, unknown> }>("SELECT settings FROM office_settings WHERE workspace_id=$1", [workspaceId]);
  return { ...DEFAULT_OFFICE_SETTINGS, ...(row?.settings ?? {}) };
}

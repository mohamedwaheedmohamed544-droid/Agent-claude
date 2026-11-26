import { query, queryOne } from "../db";
import { redactSecrets } from "../security/crypto";
import { AGENT_PROFILES, OFFICE_AGENT_SLUGS, deskZoneOf } from "./profiles";
import type { ActivityEvent, ActivityEventType, AgentMessage, AgentPresence, AgentStatus, OfficeZone } from "./types";

/**
 * Office event layer. Everything here is a side channel of the real orchestration engine:
 * failures are logged and swallowed so visualization can never break task execution.
 */

const EVENT_COLS = `id::text, agent_slug AS agent, event_type AS type, task_id AS "taskId", step_id AS "stepId",
  meeting_id AS "meetingId", related_agent AS "relatedAgent", zone, summary, payload, created_at AS "createdAt"`;
const MSG_COLS = `id, from_agent AS "from", to_agent AS "to", kind, content, task_id AS "taskId", step_id AS "stepId",
  meeting_id AS "meetingId", created_at AS "createdAt"`;
const PRESENCE_COLS = `p.agent_slug AS agent, p.status, p.zone, p.activity, p.task_id AS "taskId", t.title AS "taskTitle", p.step_id AS "stepId",
  p.meeting_id AS "meetingId", p.waiting_for AS "waitingFor", p.since`;

export interface EmitInput {
  workspaceId: string;
  agent: string;
  type: ActivityEventType;
  taskId?: string | null;
  stepId?: string | null;
  meetingId?: string | null;
  relatedAgent?: string | null;
  zone?: OfficeZone | null;
  summary?: string;
  payload?: Record<string, unknown>;
}

export async function emitEvent(e: EmitInput, opts: { refresh?: boolean } = {}): Promise<void> {
  try {
    await query(
      `INSERT INTO agent_activity_events(workspace_id, agent_slug, event_type, task_id, step_id, meeting_id, related_agent, zone, summary, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [e.workspaceId, e.agent, e.type, e.taskId ?? null, e.stepId ?? null, e.meetingId ?? null, e.relatedAgent ?? null,
        e.zone ?? null, redactSecrets(e.summary ?? "").slice(0, 500), e.payload ?? {}],
    );
    if (opts.refresh !== false) await refreshPresence(e.workspaceId);
  } catch (err) {
    console.error("[office] emit failed:", (err as Error).message);
  }
}

/** Records a real agent-to-agent message and emits the matching sent/received events. */
export async function sendAgentMessage(m: {
  workspaceId: string; from: string; to: string; kind: AgentMessage["kind"]; content: string;
  taskId?: string | null; stepId?: string | null; meetingId?: string | null;
}): Promise<string | null> {
  try {
    const content = redactSecrets(m.content).slice(0, 4000);
    const row = await queryOne<{ id: string }>(
      `INSERT INTO agent_messages(workspace_id, task_id, step_id, meeting_id, from_agent, to_agent, kind, content)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [m.workspaceId, m.taskId ?? null, m.stepId ?? null, m.meetingId ?? null, m.from, m.to, m.kind, content],
    );
    const brief = content.replace(/\s+/g, " ").slice(0, 160);
    await emitEvent({ workspaceId: m.workspaceId, agent: m.from, type: "message_sent", relatedAgent: m.to, taskId: m.taskId, stepId: m.stepId, meetingId: m.meetingId, summary: brief, payload: { messageId: row!.id, kind: m.kind } }, { refresh: false });
    await emitEvent({ workspaceId: m.workspaceId, agent: m.to, type: "message_received", relatedAgent: m.from, taskId: m.taskId, stepId: m.stepId, meetingId: m.meetingId, summary: brief, payload: { messageId: row!.id, kind: m.kind } }, { refresh: false });
    return row!.id;
  } catch (err) {
    console.error("[office] message failed:", (err as Error).message);
    return null;
  }
}

interface Computed { status: AgentStatus; zone: OfficeZone; activity: string | null; taskId: string | null; stepId: string | null; meetingId: string | null; waitingFor: string | null }

/**
 * Derives every agent's presence from the source of truth (steps, meetings, tasks, agent
 * enablement) and persists changes. Emits an "idle" event when an agent becomes idle.
 */
export async function refreshPresence(workspaceId: string): Promise<void> {
  const [inactive, meetingRows, running, waitingApproval, blocked, failed, orchestratorTasks] = await Promise.all([
    query<{ slug: string; active: boolean }>(
      `SELECT DISTINCT ON (slug) slug, active FROM agents WHERE workspace_id=$1 OR workspace_id IS NULL ORDER BY slug, (workspace_id IS NULL)`, [workspaceId],
    ).then((r) => new Set(r.filter((x) => !x.active).map((x) => x.slug))),
    query<{ agent_slug: string; meeting_id: string; task_id: string | null; objective: string }>(
      `SELECT mp.agent_slug, m.id AS meeting_id, m.task_id, m.objective FROM meeting_participants mp JOIN meetings m ON m.id=mp.meeting_id
        WHERE m.workspace_id=$1 AND m.status='in_progress' AND mp.left_at IS NULL`, [workspaceId]),
    query<{ agent_slug: string; id: string; title: string; task_id: string }>(
      `SELECT s.agent_slug, s.id, s.title, s.task_id FROM task_steps s WHERE s.workspace_id=$1 AND s.status='running' AND s.kind='agent'
        ORDER BY s.started_at DESC NULLS LAST`, [workspaceId]),
    query<{ agent_slug: string; id: string; title: string; task_id: string }>(
      `SELECT s.agent_slug, s.id, s.title, s.task_id FROM task_steps s JOIN tasks t ON t.id=s.task_id
        WHERE s.workspace_id=$1 AND s.status='waiting_approval' AND t.status IN ('running','waiting_approval')`, [workspaceId]),
    query<{ agent_slug: string; id: string; title: string; task_id: string; waiting_for: string }>(
      `SELECT s.agent_slug, s.id, s.title, s.task_id, MIN(d2.agent_slug) AS waiting_for
         FROM task_steps s JOIN tasks t ON t.id=s.task_id
         JOIN task_dependencies d ON d.step_id=s.id JOIN task_steps d2 ON d2.id=d.depends_on_step_id
        WHERE s.workspace_id=$1 AND s.status='pending' AND s.kind='agent' AND t.status IN ('running','planned','waiting_approval')
          AND d2.status IN ('pending','running','waiting_approval')
        GROUP BY s.agent_slug, s.id, s.title, s.task_id`, [workspaceId]),
    query<{ agent_slug: string; id: string; title: string; task_id: string }>(
      `SELECT s.agent_slug, s.id, s.title, s.task_id FROM task_steps s JOIN tasks t ON t.id=s.task_id
        WHERE s.workspace_id=$1 AND s.status='failed' AND t.status='failed' AND s.updated_at > now() - interval '15 minutes'`, [workspaceId]),
    query<{ id: string; title: string; status: string }>(
      `SELECT id, title, status FROM tasks WHERE workspace_id=$1 AND status IN ('planned','running','waiting_approval') ORDER BY updated_at DESC`, [workspaceId]),
  ]);

  const computed = new Map<string, Computed>();
  for (const slug of OFFICE_AGENT_SLUGS) {
    const base: Computed = { status: "idle", zone: deskZoneOf(slug), activity: null, taskId: null, stepId: null, meetingId: null, waitingFor: null };
    const meeting = meetingRows.find((r) => r.agent_slug === slug);
    const run = running.find((r) => r.agent_slug === slug);
    const appr = waitingApproval.find((r) => r.agent_slug === slug);
    const blk = blocked.find((r) => r.agent_slug === slug);
    const fail = failed.find((r) => r.agent_slug === slug);
    let c = base;
    if (meeting) c = { ...base, status: "meeting", zone: "meeting_room", activity: meeting.objective, taskId: meeting.task_id, meetingId: meeting.meeting_id };
    else if (slug === "orchestrator") {
      const active = orchestratorTasks.find((t) => t.status !== "waiting_approval");
      const waiting = orchestratorTasks.find((t) => t.status === "waiting_approval");
      if (active) c = { ...base, status: "working", activity: active.title, taskId: active.id };
      else if (waiting) c = { ...base, status: "waiting", activity: waiting.title, taskId: waiting.id, waitingFor: "approval" };
    } else if (run) c = { ...base, status: "working", activity: run.title, taskId: run.task_id, stepId: run.id };
    else if (appr) c = { ...base, status: "waiting", activity: appr.title, taskId: appr.task_id, stepId: appr.id, waitingFor: "approval" };
    else if (blk) c = { ...base, status: "waiting", activity: blk.title, taskId: blk.task_id, stepId: blk.id, waitingFor: blk.waiting_for };
    else if (fail) c = { ...base, status: "error", activity: fail.title, taskId: fail.task_id, stepId: fail.id };
    if (inactive.has(slug) && c.status !== "meeting" && c.status !== "working") c = { ...c, status: "paused" };
    computed.set(slug, c);
  }

  const previous = new Map((await query<{ agent_slug: string; status: string }>(
    "SELECT agent_slug, status FROM agent_presence WHERE workspace_id=$1", [workspaceId],
  )).map((r) => [r.agent_slug, r.status]));

  for (const [slug, c] of computed) {
    await query(
      `INSERT INTO agent_presence(workspace_id, agent_slug, status, zone, activity, task_id, step_id, meeting_id, waiting_for)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (workspace_id, agent_slug) DO UPDATE SET
         since = CASE WHEN agent_presence.status <> EXCLUDED.status OR agent_presence.zone <> EXCLUDED.zone THEN now() ELSE agent_presence.since END,
         status=EXCLUDED.status, zone=EXCLUDED.zone, activity=EXCLUDED.activity, task_id=EXCLUDED.task_id, step_id=EXCLUDED.step_id,
         meeting_id=EXCLUDED.meeting_id, waiting_for=EXCLUDED.waiting_for, updated_at=now()`,
      [workspaceId, slug, c.status, c.zone, c.activity?.slice(0, 300) ?? null, c.taskId, c.stepId, c.meetingId, c.waitingFor],
    );
    const prev = previous.get(slug);
    if (prev && prev !== "idle" && c.status === "idle") {
      await query(
        `INSERT INTO agent_activity_events(workspace_id, agent_slug, event_type, zone, summary) VALUES ($1,$2,'idle',$3,'Now idle')`,
        [workspaceId, slug, c.zone],
      );
    }
  }
}

export async function getPresence(workspaceId: string): Promise<AgentPresence[]> {
  let rows = await query<AgentPresence>(
    `SELECT ${PRESENCE_COLS} FROM agent_presence p LEFT JOIN tasks t ON t.id=p.task_id WHERE p.workspace_id=$1`, [workspaceId],
  );
  if (rows.length < OFFICE_AGENT_SLUGS.length) {
    await refreshPresence(workspaceId);
    rows = await query<AgentPresence>(
      `SELECT ${PRESENCE_COLS} FROM agent_presence p LEFT JOIN tasks t ON t.id=p.task_id WHERE p.workspace_id=$1`, [workspaceId],
    );
  }
  const order = OFFICE_AGENT_SLUGS;
  return rows.sort((a, b) => order.indexOf(a.agent) - order.indexOf(b.agent));
}

export async function eventsAfter(workspaceId: string, afterId: string | null, limit = 200): Promise<ActivityEvent[]> {
  if (afterId && /^\d+$/.test(afterId)) {
    return query<ActivityEvent>(
      `SELECT ${EVENT_COLS} FROM agent_activity_events WHERE workspace_id=$1 AND id > $2 ORDER BY id LIMIT $3`, [workspaceId, afterId, limit],
    );
  }
  return (await query<ActivityEvent>(
    `SELECT ${EVENT_COLS} FROM agent_activity_events WHERE workspace_id=$1 ORDER BY id DESC LIMIT $2`, [workspaceId, limit],
  )).reverse();
}

export async function messagesByIds(workspaceId: string, ids: string[]): Promise<AgentMessage[]> {
  const valid = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
  if (!valid.length) return [];
  return query<AgentMessage>(`SELECT ${MSG_COLS} FROM agent_messages WHERE workspace_id=$1 AND id = ANY($2::uuid[]) ORDER BY created_at`, [workspaceId, valid]);
}

export async function recentMessages(workspaceId: string, opts: { agent?: string; limit?: number } = {}): Promise<AgentMessage[]> {
  return (await query<AgentMessage>(
    `SELECT ${MSG_COLS} FROM agent_messages WHERE workspace_id=$1 AND ($2::text IS NULL OR from_agent=$2 OR to_agent=$2)
      ORDER BY created_at DESC LIMIT $3`, [workspaceId, opts.agent ?? null, opts.limit ?? 50],
  )).reverse();
}

/** Seeds/updates the global character profiles table from code. */
let profilesSynced = false;
export async function syncAgentProfiles(): Promise<void> {
  if (profilesSynced) return;
  for (const [i, p] of AGENT_PROFILES.entries()) {
    await query(
      `INSERT INTO agent_profiles(slug, name_ar, name_en, title_ar, title_en, color, desk_zone, appearance, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (slug) DO UPDATE SET name_ar=EXCLUDED.name_ar, name_en=EXCLUDED.name_en, title_ar=EXCLUDED.title_ar, title_en=EXCLUDED.title_en,
         color=EXCLUDED.color, desk_zone=EXCLUDED.desk_zone, appearance=EXCLUDED.appearance, sort_order=EXCLUDED.sort_order, updated_at=now()`,
      [p.slug, p.nameAr, p.nameEn, p.titleAr, p.titleEn, p.color, p.deskZone, p.appearance, i],
    );
  }
  profilesSynced = true;
}

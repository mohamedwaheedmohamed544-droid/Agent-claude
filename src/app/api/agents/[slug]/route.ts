import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { query } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { deleteAgent, getAgentRecord, listDepartments, listVersions, stripRecord, updateAgent, validateAgentConfig } from "@/lib/agents/registry";
import { getAgentRuntime, toolCatalog } from "@/lib/agents/runtime";
import { getPresence } from "@/lib/office/events";
import { listMeetings } from "@/lib/office/meetings";
import { getWorkspaceSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Full agent profile: configuration, versions, live state, effective tools, runtime preview and history. */
export const GET = workspaceRoute(async ({ workspaceId, params }) => {
  const agent = await getAgentRecord(workspaceId, params.slug);
  if (!agent) throw notFound("Agent not found");
  const slug = agent.slug;
  const [versions, presence, runtime, settings, departments, meetings] = await Promise.all([
    listVersions(workspaceId, slug),
    getPresence(workspaceId).then((p) => p.find((x) => x.agent === slug) ?? null),
    getAgentRuntime(workspaceId, slug),
    getWorkspaceSettings(workspaceId),
    listDepartments(workspaceId),
    listMeetings(workspaceId, { agent: slug, limit: 20 }),
  ]);
  const { validation } = await validateAgentConfig(workspaceId, stripRecord(agent), slug);
  const allowed = new Set(runtime?.allowedTools ?? []);
  const blocked = new Map((runtime?.blockedTools ?? []).map((b) => [b.name, b.reason]));
  const effectiveTools = toolCatalog().filter((t) => agent.tools.includes(t.name)).map((t) => ({
    ...t, allowed: allowed.has(t.name), reason: blocked.get(t.name) ?? null,
    requiresApproval: t.riskLevel === 4 || (t.riskLevel === 3 && (!settings.autoApproveLevel3 || agent.permissions.alwaysApproveModify)),
  }));
  const [stats, recentSteps, toolUsage, tasks, conversations, memory, activity, workstation] = await Promise.all([
    query(`SELECT count(*)::int AS runs, count(*) FILTER (WHERE status='completed')::int AS completed, count(*) FILTER (WHERE status='failed')::int AS failed,
                  avg(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE completed_at IS NOT NULL)::float AS "avgMs", max(started_at) AS "lastRun"
             FROM task_steps WHERE workspace_id=$1 AND (agent_slug=$2 OR $2 = ANY(participants))`, [workspaceId, slug]).then((r) => r[0]),
    query(`SELECT s.id, s.title, s.status, s.task_id AS "taskId", t.title AS "taskTitle", s.started_at AS "startedAt", s.completed_at AS "completedAt"
             FROM task_steps s JOIN tasks t ON t.id=s.task_id WHERE s.workspace_id=$1 AND s.agent_slug=$2 ORDER BY s.created_at DESC LIMIT 20`, [workspaceId, slug]),
    query(`SELECT tool_name AS tool, count(*)::int AS calls, count(*) FILTER (WHERE status='succeeded')::int AS succeeded
             FROM tool_executions WHERE workspace_id=$1 AND agent_slug=$2 GROUP BY tool_name ORDER BY calls DESC`, [workspaceId, slug]),
    query(`SELECT DISTINCT ON (s.task_id) s.task_id AS "taskId", t.title AS "taskTitle", s.title AS "stepTitle", s.status, s.updated_at AS "updatedAt"
             FROM task_steps s JOIN tasks t ON t.id=s.task_id WHERE s.workspace_id=$1 AND (s.agent_slug=$2 OR $2 = ANY(s.participants))
            ORDER BY s.task_id, s.updated_at DESC LIMIT 30`, [workspaceId, slug]),
    query(`SELECT DISTINCT c.id, c.title, c.updated_at AS "updatedAt" FROM conversations c JOIN messages m ON m.conversation_id=c.id
            WHERE c.workspace_id=$1 AND m.agent_slug=$2 ORDER BY c.updated_at DESC LIMIT 20`, [workspaceId, slug]),
    query(`SELECT id, kind, content, scope, created_at AS "createdAt" FROM memory_items WHERE workspace_id=$1 AND scope='agent' AND agent_slug=$2 AND status='active'
            ORDER BY updated_at DESC LIMIT 50`, [workspaceId, slug]),
    query(`SELECT id::text, agent_slug AS agent, event_type AS type, task_id AS "taskId", related_agent AS "relatedAgent", summary, created_at AS "createdAt"
             FROM agent_activity_events WHERE workspace_id=$1 AND agent_slug=$2 ORDER BY id DESC LIMIT 50`, [workspaceId, slug]),
    query<{ id: string; index: number }>(`SELECT w.id, w.idx AS index FROM office_workstations w WHERE w.agent_id=$1`, [agent.id]).then((r) => r[0] ?? null),
  ]);
  return {
    agent, versions, presence, skills: runtime?.skills ?? [], validation, effectiveTools,
    runtime: { version: runtime?.version ?? agent.version, systemPromptPreview: runtime?.systemPrompt ?? "", cachedAt: runtime?.builtAt ?? null },
    stats, recentSteps, toolUsage, tasks, conversations, meetings, memory, activity,
    department: departments.find((d) => d.key === agent.office.departmentKey) ?? null, workstation,
  };
});

const Patch = z.object({ config: z.record(z.string(), z.unknown()), changeNote: z.string().max(300).nullish() });

/** Edit configuration (admins). Creates a new immutable version; future tasks use it, running ones are unaffected. */
export const PATCH = workspaceRoute(async ({ req, user, workspaceId, params, ip }) => {
  const b = Patch.parse(await readJson(req, 200_000));
  return { agent: await updateAgent(workspaceId, user.id, params.slug, b.config, b.changeNote ?? null, ip) };
}, { minRole: "admin", rate: { limit: 60, windowSec: 60, bucket: "agent-admin" } });

/** Permanent removal from the workforce (soft tombstone; history preserved). Requires ?confirm=<slug>. */
export const DELETE = workspaceRoute(async ({ req, user, workspaceId, params, ip }) => {
  await deleteAgent(workspaceId, user.id, params.slug, new URL(req.url).searchParams.get("confirm") ?? "", ip);
  return { ok: true };
}, { minRole: "admin" });

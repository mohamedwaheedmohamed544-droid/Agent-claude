import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
import { agentVersions, getAgent, resetWorkspaceAgent, updateWorkspaceAgent } from "@/lib/agents/store";
import { getAgentDefinition } from "@/lib/agents/definitions";
import { allTools } from "@/lib/tools/registry";

export const GET = workspaceRoute(async ({ workspaceId, params }) => {
  const a = await getAgent(workspaceId, params.slug);
  if (!a) throw notFound("Agent not found");
  const versions = await agentVersions(a.id);
  const recentSteps = await query(
    `SELECT s.id, s.title, s.status, s.task_id AS "taskId", t.title AS "taskTitle", s.started_at AS "startedAt", s.completed_at AS "completedAt"
       FROM task_steps s JOIN tasks t ON t.id=s.task_id WHERE s.workspace_id=$1 AND s.agent_slug=$2 ORDER BY s.created_at DESC LIMIT 20`,
    [workspaceId, params.slug],
  );
  const toolUsage = await query(
    `SELECT tool_name AS tool, count(*)::int AS calls, count(*) FILTER (WHERE status='succeeded')::int AS succeeded
       FROM tool_executions WHERE workspace_id=$1 AND agent_slug=$2 GROUP BY tool_name ORDER BY calls DESC`,
    [workspaceId, params.slug],
  );
  const tools = allTools().map((t) => ({ name: t.name, description: t.description, riskLevel: t.riskLevel, category: t.category, integration: t.integration ?? null }));
  return {
    agent: { ...a, builtInPrompt: getAgentDefinition(a.slug)?.prompt ?? null },
    versions, recentSteps, toolUsage, availableTools: tools,
  };
});

const Patch = z.object({
  systemPrompt: z.string().min(20).max(20_000).optional(),
  allowedTools: z.array(z.string()).max(40).optional(),
  tier: z.enum(["fast", "standard", "advanced"]).optional(),
  modelOverride: z.string().max(100).nullable().optional(),
  active: z.boolean().optional(),
});

/** Customise an agent for this workspace (admins). Each change creates a new immutable version. */
export const PATCH = workspaceRoute(async ({ req, workspaceId, user, params, ip }) => {
  const p = Patch.parse(await readJson(req, 64_000));
  if (p.allowedTools) {
    const known = new Set(allTools().map((t) => t.name));
    const bad = p.allowedTools.filter((t) => !known.has(t));
    if (bad.length) throw badRequest(`Unknown tools: ${bad.join(", ")}`);
  }
  const a = await updateWorkspaceAgent(workspaceId, params.slug, user.id, p);
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "agent.updated", targetType: "agent", targetId: params.slug, metadata: { version: a.version, fields: Object.keys(p) }, ip });
  return { agent: a };
}, { minRole: "admin" });

/** Revert to the built-in definition. */
export const DELETE = workspaceRoute(async ({ workspaceId, user, params, ip }) => {
  await resetWorkspaceAgent(workspaceId, params.slug);
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "agent.reset", targetType: "agent", targetId: params.slug, ip });
  return { ok: true };
}, { minRole: "admin" });

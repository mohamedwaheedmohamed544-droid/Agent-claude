import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { query } from "@/lib/db";
import { createAgent, listAgentRecords, listDepartments, listSkills } from "@/lib/agents/registry";
import { getPresence } from "@/lib/office/events";

export const dynamic = "force-dynamic";

const LIFECYCLES = new Set(["active", "inactive", "draft", "archived", "all"]);

/** Agent Management list: database-driven workforce with live status and stats. */
export const GET = workspaceRoute(async ({ req, workspaceId }) => {
  const sp = new URL(req.url).searchParams;
  const lc = sp.get("lifecycle");
  const lifecycle = lc && LIFECYCLES.has(lc) ? (lc as "active") : undefined;
  const dept = sp.get("department");
  const q = sp.get("q")?.slice(0, 80) || undefined;
  const [agents, all, departments, skills, presence, stats, current] = await Promise.all([
    listAgentRecords(workspaceId, { lifecycle, department: dept && /^[a-z0-9_]+$/.test(dept) ? dept : undefined, q }),
    listAgentRecords(workspaceId, { lifecycle: "all" }),
    listDepartments(workspaceId),
    listSkills(workspaceId),
    getPresence(workspaceId),
    query<{ agent: string; runs: number; completed: number; failed: number; last_run: string | null }>(
      `SELECT agent_slug AS agent, count(*)::int AS runs, count(*) FILTER (WHERE status='completed')::int AS completed,
              count(*) FILTER (WHERE status='failed')::int AS failed, max(started_at) AS last_run
         FROM task_steps WHERE workspace_id=$1 GROUP BY agent_slug`, [workspaceId]),
    query<{ agent: string; id: string; title: string }>(
      `SELECT DISTINCT ON (s.agent_slug) s.agent_slug AS agent, t.id, t.title FROM task_steps s JOIN tasks t ON t.id=s.task_id
        WHERE s.workspace_id=$1 AND s.status IN ('running','waiting_approval') ORDER BY s.agent_slug, s.updated_at DESC`, [workspaceId]),
  ]);
  const dep = new Map(departments.map((d) => [d.key, d]));
  const sk = new Map(skills.map((s) => [s.key, s]));
  const pres = new Map(presence.map((p) => [p.agent, p]));
  const st = new Map(stats.map((s) => [s.agent, s]));
  const cur = new Map(current.map((c) => [c.agent, c]));
  const live = all.filter((a) => a.lifecycle !== "archived");
  const status = (slug: string) => pres.get(slug)?.status;
  return {
    agents: agents.map((a) => ({
      ...a,
      departmentName: dep.get(a.office.departmentKey)?.name ?? a.office.departmentKey,
      departmentNameAr: dep.get(a.office.departmentKey)?.nameAr ?? a.office.departmentKey,
      presence: pres.get(a.slug) ?? null,
      skillNames: a.skills.map((s) => sk.get(s.key)?.name ?? s.key),
      currentTask: cur.get(a.slug) ? { id: cur.get(a.slug)!.id, title: cur.get(a.slug)!.title } : null,
      stats: { runs: st.get(a.slug)?.runs ?? 0, completed: st.get(a.slug)?.completed ?? 0, failed: st.get(a.slug)?.failed ?? 0, lastRun: st.get(a.slug)?.last_run ?? null },
    })),
    counts: {
      total: live.length,
      active: live.filter((a) => a.lifecycle === "active").length,
      working: live.filter((a) => ["working", "thinking", "collaborating", "waiting"].includes(status(a.slug) ?? "")).length,
      idle: live.filter((a) => a.lifecycle === "active" && status(a.slug) === "idle").length,
      inMeetings: live.filter((a) => status(a.slug) === "meeting").length,
      inactive: live.filter((a) => a.lifecycle === "inactive").length,
      draft: live.filter((a) => a.lifecycle === "draft").length,
      archived: all.filter((a) => a.lifecycle === "archived").length,
    },
  };
});

const Create = z.object({ config: z.unknown(), lifecycle: z.enum(["draft", "active"]).optional(), templateKey: z.string().max(80).nullish() });

/** Create an agent from configuration (admins). It registers with the orchestrator and appears in the office immediately. */
export const POST = workspaceRoute(async ({ req, user, workspaceId, ip }) => {
  const b = Create.parse(await readJson(req, 200_000));
  const agent = await createAgent(workspaceId, user.id, b.config, { lifecycle: b.lifecycle ?? "active", templateKey: b.templateKey ?? null, ip });
  return new Response(JSON.stringify({ agent }), { status: 201, headers: { "content-type": "application/json" } });
}, { minRole: "admin", rate: { limit: 60, windowSec: 60, bucket: "agent-admin" } });

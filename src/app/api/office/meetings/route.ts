import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { isAiConfigured } from "@/lib/ai/llm";
import { unavailable } from "@/lib/errors";
import { listMeetings } from "@/lib/office/meetings";
import { handleChatMessage } from "@/lib/orchestrator/chat";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export const GET = workspaceRoute(async ({ req, workspaceId }) => {
  const agent = new URL(req.url).searchParams.get("agent");
  return { meetings: await listMeetings(workspaceId, { agent: agent && /^[a-z_]+$/.test(agent) ? agent : undefined, limit: 50 }) };
});

const Body = z.object({
  objective: z.string().trim().min(5).max(4000),
  participants: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,60}$/)).min(2).max(4),
});

/**
 * Convene a real meeting: creates a task whose single step is a meeting chaired by راشد.
 * Runs through the normal engine (permissions, emergency stop, budgets, audit).
 */
export const POST = workspaceRoute(async ({ req, user, workspaceId }) => {
  if (!isAiConfigured()) throw unavailable("AI is not configured on this deployment (ANTHROPIC_API_KEY)");
  const b = Body.parse(await readJson(req));
  const r = await handleChatMessage({ workspaceId, userId: user.id, locale: user.locale, text: b.objective, meetingParticipants: b.participants });
  return { conversationId: r.conversationId, taskId: r.taskId };
}, { minRole: "member", rate: { limit: 20, windowSec: 60, bucket: "office-meeting" } });

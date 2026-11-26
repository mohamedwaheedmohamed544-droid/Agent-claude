import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { isAiConfigured } from "@/lib/ai/llm";
import { unavailable } from "@/lib/errors";
import { handleChatMessage } from "@/lib/orchestrator/chat";

export const maxDuration = 300;

const Body = z.object({
  agent: z.string().regex(/^[a-z][a-z0-9_]{0,60}$/),
  message: z.string().trim().min(2).max(20_000),
  conversationId: z.string().uuid().nullish(),
});

/**
 * Assign a task directly to one specialist from the office. Creates a real single-step task that
 * runs through the engine with the same approvals, permissions and audit as any chat request.
 */
export const POST = workspaceRoute(async ({ req, user, workspaceId }) => {
  if (!isAiConfigured()) throw unavailable("AI is not configured on this deployment (ANTHROPIC_API_KEY)");
  const b = Body.parse(await readJson(req, 100_000));
  const r = await handleChatMessage({
    workspaceId, userId: user.id, locale: user.locale, conversationId: b.conversationId ?? null, text: b.message, targetAgent: b.agent,
  });
  return { conversationId: r.conversationId, taskId: r.taskId };
}, { minRole: "member", rate: { limit: 30, windowSec: 60, bucket: "office-assign" } });

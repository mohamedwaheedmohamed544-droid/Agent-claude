import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { handleChatMessage } from "@/lib/orchestrator/chat";
import { isAiConfigured } from "@/lib/ai/llm";
import { unavailable } from "@/lib/errors";

export const maxDuration = 300; // background task execution continues via after()
export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().min(1).max(20_000),
  conversationId: z.string().uuid().nullish(),
  fileIds: z.array(z.string().uuid()).max(10).optional(),
});

/**
 * Sends a user message. The orchestrator either answers directly or creates a persistent task
 * that executes in the background; poll GET /api/tasks/:id for progress.
 */
export const POST = workspaceRoute(async ({ req, user, workspaceId }) => {
  if (!isAiConfigured()) throw unavailable("AI is not configured on this deployment (ANTHROPIC_API_KEY)");
  const b = Body.parse(await readJson(req, 100_000));
  const r = await handleChatMessage({
    workspaceId, userId: user.id, locale: user.locale, conversationId: b.conversationId ?? null, text: b.message, fileIds: b.fileIds,
  });
  return { conversationId: r.conversationId, userMessage: r.userMessage, reply: r.reply, taskId: r.taskId, mode: r.plan.mode };
}, { minRole: "member", rate: { limit: 30, windowSec: 60, bucket: "chat" } });

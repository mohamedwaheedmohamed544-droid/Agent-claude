import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { isAiConfigured } from "@/lib/ai/llm";
import { unavailable } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { draftAgent } from "@/lib/agents/draft";

export const maxDuration = 120;
const Body = z.object({ prompt: z.string().trim().min(10).max(4000) });

/** Natural-language agent design by راشد. Returns a proposal only — creating it requires an explicit POST /api/agents. */
export const POST = workspaceRoute(async ({ req, user, workspaceId }) => {
  if (!isAiConfigured()) throw unavailable("AI is not configured on this deployment (ANTHROPIC_API_KEY)");
  const { prompt } = Body.parse(await readJson(req));
  const proposal = await draftAgent(workspaceId, user.id, prompt);
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "agent.draft_proposed", targetType: "agent", targetId: proposal.config.nameEn });
  return proposal;
}, { minRole: "admin", rate: { limit: 20, windowSec: 60, bucket: "agent-draft" } });

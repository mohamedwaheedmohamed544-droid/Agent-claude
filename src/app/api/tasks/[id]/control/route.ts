import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { controlTask } from "@/lib/orchestrator/engine";

export const maxDuration = 300;
const Body = z.object({ action: z.enum(["pause", "resume", "cancel", "retry"]) });

export const POST = workspaceRoute(async ({ req, workspaceId, user, params }) => {
  const { action } = Body.parse(await readJson(req));
  return { status: await controlTask(workspaceId, params.id, action, user.id) };
}, { minRole: "member" });

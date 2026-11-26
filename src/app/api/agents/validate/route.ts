import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { validateAgentConfig } from "@/lib/agents/registry";

const Body = z.object({ config: z.unknown(), slug: z.string().max(80).nullish() });

/** Live builder validation: schema errors, unknown tools/skills, missing dependencies, relationship cycles. */
export const POST = workspaceRoute(async ({ req, workspaceId }) => {
  const b = Body.parse(await readJson(req, 200_000));
  return (await validateAgentConfig(workspaceId, b.config, b.slug ?? null)).validation;
}, { minRole: "member", rate: { limit: 240, windowSec: 60, bucket: "agent-validate" } });

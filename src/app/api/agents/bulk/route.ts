import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { setLifecycle } from "@/lib/agents/registry";

const Body = z.object({ slugs: z.array(z.string().max(80)).min(1).max(100), action: z.enum(["activate", "deactivate"]) });

/** Bulk activate/deactivate (admins). The orchestrator is skipped; failures are reported per agent. */
export const POST = workspaceRoute(async ({ req, user, workspaceId, ip }) => {
  const b = Body.parse(await readJson(req));
  const results: Array<{ slug: string; ok: boolean; error?: string }> = [];
  for (const slug of [...new Set(b.slugs)]) {
    try {
      await setLifecycle(workspaceId, user.id, slug, b.action, { ip });
      results.push({ slug, ok: true });
    } catch (e) {
      results.push({ slug, ok: false, error: e instanceof AppError ? e.message : "Failed" });
    }
  }
  return { results };
}, { minRole: "admin", rate: { limit: 20, windowSec: 60, bucket: "agent-admin" } });

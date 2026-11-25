import { z } from "zod";
import { readJson, workspaceRoute, hasRole } from "@/lib/api";
import { audit } from "@/lib/audit";
import { forbidden } from "@/lib/errors";
import { addMemory, listMemory } from "@/lib/memory/store";

export const GET = workspaceRoute(async ({ req, workspaceId, user }) => {
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope");
  const status = sp.get("status");
  return {
    memories: await listMemory(workspaceId, user.id, {
      scope: scope === "user" || scope === "workspace" || scope === "task" ? scope : undefined,
      status: status === "active" || status === "proposed" || status === "archived" ? status : undefined,
    }),
  };
});

const Create = z.object({
  content: z.string().trim().min(2).max(4000),
  scope: z.enum(["user", "workspace"]),
  kind: z.enum(["preference", "fact", "decision", "context", "workflow", "note"]).optional(),
  importance: z.number().min(0).max(1).optional(),
});

export const POST = workspaceRoute(async ({ req, workspaceId, user, role }) => {
  const b = Create.parse(await readJson(req));
  if (b.scope === "workspace" && !hasRole(role, "member")) throw forbidden();
  const m = await addMemory({ workspaceId, scope: b.scope, kind: b.kind, content: b.content, source: "user", userId: user.id, importance: b.importance, createdBy: user.id });
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "memory.created", targetType: "memory", targetId: m.id, metadata: { scope: b.scope } });
  return { memory: m };
});

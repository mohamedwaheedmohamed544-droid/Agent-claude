import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createBase, listBases } from "@/lib/knowledge/bases";

export const dynamic = "force-dynamic";

export const GET = workspaceRoute(async ({ workspaceId }) => listBases(workspaceId));

const Create = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
});

export const POST = workspaceRoute(async ({ req, workspaceId, user, ip }) => {
  const body = Create.parse(await readJson(req));
  const base = await createBase(workspaceId, user.id, body);
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "knowledge_base.created", targetType: "knowledge_base", targetId: base.id, ip, metadata: { name: base.name } });
  return Response.json({ base }, { status: 201 });
}, { minRole: "member" });

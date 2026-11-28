import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { editBlueprint } from "@/lib/onboarding/store";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,60}$/);
const Edit = z.discriminatedUnion("op", [
  z.object({ op: z.literal("remove_agent"), agent: key }),
  z.object({ op: z.literal("add_agent"), role: key, function: key.optional() }),
  z.object({ op: z.literal("update_agent"), agent: key, nameEn: z.string().trim().min(1).max(60).optional(), nameAr: z.string().trim().min(1).max(60).optional(),
    duties: z.string().max(2000).optional(), riskCap: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]).optional() }),
  z.object({ op: z.literal("remove_department"), department: key }),
  z.object({ op: z.literal("rename_department"), department: key, name: z.string().trim().min(2).max(80), nameAr: z.string().trim().min(1).max(80) }),
  z.object({ op: z.literal("set_integration"), integration: z.string().regex(/^[a-z0-9_]{2,60}$/), decision: z.enum(["accepted", "rejected"]) }),
  z.object({ op: z.literal("set_approval"), approval: key, enabled: z.boolean() }),
]);
const Body = z.object({ edit: Edit, baseHash: z.string().regex(/^[0-9a-f]{64}$/) });

/** Customer edit of a pending proposal. `baseHash` must match the version the customer is looking at. */
export const PATCH = workspaceRoute(async ({ req, workspaceId, user, role, params, ip }) => {
  if (!z.string().uuid().safeParse(params.id).success) throw badRequest("Invalid id");
  const b = Body.parse(await readJson(req, 16_000));
  return { blueprint: await editBlueprint({ workspaceId, userId: user.id, role, id: params.id, edit: b.edit, baseHash: b.baseHash, ip }) };
}, { minRole: "admin", rate: { limit: 120, windowSec: 60, bucket: "onboarding-edit" } });

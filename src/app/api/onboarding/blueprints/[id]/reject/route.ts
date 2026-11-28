import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { rejectBlueprint } from "@/lib/onboarding/store";

const Body = z.object({ note: z.string().max(2000).nullish() });

export const POST = workspaceRoute(async ({ req, workspaceId, user, role, params, ip }) => {
  if (!z.string().uuid().safeParse(params.id).success) throw badRequest("Invalid id");
  const b = Body.parse(await readJson(req));
  return { blueprint: await rejectBlueprint({ workspaceId, userId: user.id, role, id: params.id, note: b.note, ip }) };
}, { minRole: "admin" });

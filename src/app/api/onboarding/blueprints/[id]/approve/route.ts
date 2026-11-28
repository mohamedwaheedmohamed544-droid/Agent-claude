import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { approveAndGenerate } from "@/lib/onboarding/store";

export const maxDuration = 300;
const Body = z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/) });

/** Approves the exact proposal reviewed (hash-bound) and generates the workforce. */
export const POST = workspaceRoute(async ({ req, workspaceId, user, role, params, ip }) => {
  if (!z.string().uuid().safeParse(params.id).success) throw badRequest("Invalid id");
  const b = Body.parse(await readJson(req));
  return { blueprint: await approveAndGenerate({ workspaceId, userId: user.id, role, id: params.id, hash: b.hash, ip }) };
}, { minRole: "admin", rate: { limit: 10, windowSec: 60, bucket: "onboarding-approve" } });

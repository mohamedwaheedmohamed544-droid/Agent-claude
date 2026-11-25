import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { decideApproval } from "@/lib/approvals";

export const maxDuration = 300;

const Body = z.object({
  decision: z.enum(["approve", "reject"]),
  /** The params hash shown to the user — binds the decision to the exact action reviewed. */
  paramsHash: z.string().regex(/^[0-9a-f]{64}$/),
  note: z.string().max(1000).optional(),
});

export const POST = workspaceRoute(async ({ req, workspaceId, user, role, params, ip }) => {
  const b = Body.parse(await readJson(req));
  return { approval: await decideApproval({ workspaceId, approvalId: params.id, userId: user.id, role, decision: b.decision, paramsHash: b.paramsHash, note: b.note, ip }) };
}, { minRole: "member", rate: { limit: 60, windowSec: 60, bucket: "approvals" } });

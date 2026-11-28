import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { createProposal } from "@/lib/onboarding/store";

const Body = z.object({ revisionNote: z.string().max(2000).nullish() });

/** Generates a new Workforce Blueprint version from the saved answers (supersedes a pending one). */
export const POST = workspaceRoute(async ({ req, workspaceId, user, role, ip }) => {
  const b = Body.parse(await readJson(req));
  const blueprint = await createProposal({ workspaceId, userId: user.id, role, revisionNote: b.revisionNote, ip });
  return Response.json({ blueprint }, { status: 201 });
}, { minRole: "admin", rate: { limit: 20, windowSec: 60, bucket: "onboarding-proposal" } });

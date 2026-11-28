import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { getOnboardingState, previewImpact, saveStep } from "@/lib/onboarding/store";

export const dynamic = "force-dynamic";

/** Onboarding state: answers, derived operating profile, latest blueprint and (for admins) its impact. */
export const GET = workspaceRoute(async ({ workspaceId, role }) => {
  const state = await getOnboardingState(workspaceId, role);
  const impact = state.canManage && state.blueprint && ["proposed", "failed"].includes(state.blueprint.status)
    ? await previewImpact(workspaceId, state.blueprint.blueprint) : null;
  return { ...state, impact };
});

const Save = z.object({ step: z.string().max(40), data: z.unknown() });

export const PUT = workspaceRoute(async ({ req, workspaceId, user, role, ip }) => {
  const b = Save.parse(await readJson(req, 64_000));
  return saveStep({ workspaceId, userId: user.id, role, step: b.step, data: b.data, ip });
}, { minRole: "admin", rate: { limit: 60, windowSec: 60, bucket: "onboarding" } });

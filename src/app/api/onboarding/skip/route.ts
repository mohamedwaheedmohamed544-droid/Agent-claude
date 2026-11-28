import { workspaceRoute } from "@/lib/api";
import { skipOnboarding } from "@/lib/onboarding/store";

export const POST = workspaceRoute(async ({ workspaceId, user, role }) => {
  await skipOnboarding(workspaceId, user.id, role);
  return { ok: true };
}, { minRole: "admin" });

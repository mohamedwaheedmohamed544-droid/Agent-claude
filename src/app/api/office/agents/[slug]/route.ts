import { workspaceRoute } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { getAgentDetail } from "@/lib/office/state";

export const dynamic = "force-dynamic";

/** Character panel data: profile, live presence, recent activity, collaborations, meetings, tasks, metrics. */
export const GET = workspaceRoute(async ({ workspaceId, params }) => {
  const detail = await getAgentDetail(workspaceId, params.slug);
  if (!detail) throw notFound("Agent not found");
  return detail;
});

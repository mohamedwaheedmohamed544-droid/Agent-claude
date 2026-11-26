import { workspaceRoute } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { getMeeting } from "@/lib/office/meetings";

export const dynamic = "force-dynamic";

/** Full meeting record: participants, agenda, transcript (real messages), decisions, action items. */
export const GET = workspaceRoute(async ({ workspaceId, params }) => {
  const meeting = await getMeeting(workspaceId, params.id);
  if (!meeting) throw notFound("Meeting not found");
  return { meeting };
});

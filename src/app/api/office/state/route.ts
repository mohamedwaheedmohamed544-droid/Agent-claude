import { workspaceRoute } from "@/lib/api";
import { getOfficeState } from "@/lib/office/state";

export const dynamic = "force-dynamic";

/** Snapshot of the office: profiles, presence, dashboard counts, meetings, recent events and agent messages. */
export const GET = workspaceRoute(async ({ workspaceId }) => getOfficeState(workspaceId));

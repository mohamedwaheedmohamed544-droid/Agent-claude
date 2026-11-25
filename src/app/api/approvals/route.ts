import { workspaceRoute } from "@/lib/api";
import { listApprovals } from "@/lib/approvals";

const STATUSES = new Set(["pending", "approved", "rejected", "expired", "executed", "superseded"]);

export const GET = workspaceRoute(async ({ req, workspaceId }) => {
  const s = new URL(req.url).searchParams.get("status");
  const t = new URL(req.url).searchParams.get("taskId");
  return { approvals: await listApprovals(workspaceId, s && STATUSES.has(s) ? s : undefined, t && /^[0-9a-f-]{36}$/i.test(t) ? t : undefined) };
});

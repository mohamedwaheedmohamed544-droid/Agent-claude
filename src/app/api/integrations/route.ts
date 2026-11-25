import { workspaceRoute } from "@/lib/api";
import { listIntegrationCatalog } from "@/lib/integrations/catalog";
import { requestOrigin } from "@/lib/integrations/providers";

export const dynamic = "force-dynamic";

/** Lists integrations for the current workspace: configuration presence and connection state only, never secrets. */
export const GET = workspaceRoute(async ({ req, workspaceId }) => {
  return { integrations: await listIntegrationCatalog(workspaceId, requestOrigin(req)) };
});

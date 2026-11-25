import { workspaceRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { testConnection } from "@/lib/integrations/oauth";
import { getIntegration } from "@/lib/integrations/store";
import { isOAuthProvider } from "@/lib/integrations/providers";

export const dynamic = "force-dynamic";

/** Makes a harmless read call (Gmail profile / Graph /me) and reports ok, latency and account. Admins/owners only. */
export const POST = workspaceRoute(async ({ params, workspaceId, user, ip }) => {
  const provider = params.provider;
  if (!isOAuthProvider(provider)) throw notFound("Unknown integration provider");
  const row = await getIntegration(workspaceId, provider);
  const result = row
    ? await testConnection(workspaceId, provider)
    : { ok: false, latencyMs: 0, account: null, error: "Integration is not connected" };
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "integration.tested", targetType: "integration", targetId: provider, metadata: { ok: result.ok, latencyMs: result.latencyMs, error: result.error }, ip });
  return result;
}, { minRole: "admin", rate: { limit: 20, windowSec: 60, bucket: "integration-test" } });

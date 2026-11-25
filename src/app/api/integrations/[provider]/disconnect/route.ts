import { workspaceRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { disconnectIntegration } from "@/lib/integrations/oauth";
import { isOAuthProvider } from "@/lib/integrations/providers";

export const dynamic = "force-dynamic";

/** Revokes the grant where supported (Google) and deletes stored tokens. Admins/owners only. */
export const POST = workspaceRoute(async ({ params, workspaceId, user, ip }) => {
  const provider = params.provider;
  if (!isOAuthProvider(provider)) throw notFound("Unknown integration provider");
  const result = await disconnectIntegration(workspaceId, provider);
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "integration.disconnected", targetType: "integration", targetId: provider, metadata: result, ip });
  return { ok: true, ...result };
}, { minRole: "admin" });

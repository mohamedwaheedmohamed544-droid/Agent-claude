import { workspaceRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { OAuthFlowError, createAuthorization } from "@/lib/integrations/oauth";
import { isOAuthProvider, requestOrigin } from "@/lib/integrations/providers";

export const dynamic = "force-dynamic";

/** Starts the OAuth flow (admins/owners only). Returns the provider consent URL for the browser to open. */
export const POST = workspaceRoute(async ({ req, params, workspaceId, user, ip }) => {
  const provider = params.provider;
  if (!isOAuthProvider(provider)) throw notFound("Unknown integration provider");
  try {
    const { authorizeUrl } = await createAuthorization({ workspaceId, userId: user.id, provider, origin: requestOrigin(req) });
    await audit({ workspaceId, userId: user.id, actorType: "user", action: "integration.connect_started", targetType: "integration", targetId: provider, ip });
    return { authorizeUrl };
  } catch (e) {
    if (e instanceof OAuthFlowError) throw new AppError(e.code === "not_configured" || e.code === "encryption_key_missing" ? 503 : 400, e.code, e.message);
    throw e;
  }
}, { minRole: "admin", rate: { limit: 20, windowSec: 60, bucket: "integration-connect" } });

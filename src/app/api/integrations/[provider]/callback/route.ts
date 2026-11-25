import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { publicRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { ROLE_RANK, WORKSPACE_COOKIE, getMembership, getSessionUser } from "@/lib/auth/session";
import { OAuthFlowError, completeAuthorization, consumeOAuthState, type OAuthErrorCode } from "@/lib/integrations/oauth";
import { appBaseUrl, isOAuthProvider, requestOrigin } from "@/lib/integrations/providers";
import { redactSecrets } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";

function back(origin: string, query: Record<string, string>): NextResponse {
  const url = new URL("/integrations", appBaseUrl(origin));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url, 303);
  // The incoming URL carries an authorization code: never leak it through Referer or caches.
  res.headers.set("referrer-policy", "no-referrer");
  res.headers.set("cache-control", "no-store");
  return res;
}

/**
 * OAuth redirect target. Verifies the single-use state belongs to the logged-in user, their current workspace and
 * this provider and is unexpired; requires the user to still be an admin/owner; exchanges the code; stores
 * encrypted tokens; then redirects to /integrations?connected=<provider> or ?error=<code>.
 */
export const GET = publicRoute(async ({ req, params, ip }) => {
  const origin = requestOrigin(req);
  const provider = params.provider;
  if (!isOAuthProvider(provider)) return back(origin, { error: "unknown_provider" });
  const sp = new URL(req.url).searchParams;
  const state = sp.get("state") ?? "";
  const user = await getSessionUser();
  if (!user) {
    const login = new URL("/login", appBaseUrl(origin));
    login.searchParams.set("next", "/integrations");
    return NextResponse.redirect(login, 303);
  }
  const jar = await cookies();
  const currentWorkspace = jar.get(WORKSPACE_COOKIE)?.value ?? user.lastWorkspaceId;
  let workspaceId: string | null = null;
  try {
    const consumed = await consumeOAuthState({ state, provider, userId: user.id, workspaceId: currentWorkspace });
    workspaceId = consumed.workspaceId;
    const providerError = sp.get("error");
    if (providerError) {
      throw new OAuthFlowError(providerError === "access_denied" || providerError === "consent_required" ? "access_denied" : "provider_error", `Provider returned ${providerError.slice(0, 60)}`);
    }
    const membership = await getMembership(user.id, consumed.workspaceId);
    if (!membership || ROLE_RANK[membership.role] < ROLE_RANK.admin) throw new OAuthFlowError("forbidden", "Only admins can connect integrations");
    const { accountLabel, scopes } = await completeAuthorization({ consumed, code: sp.get("code") ?? "", origin });
    await audit({
      workspaceId: consumed.workspaceId, userId: user.id, actorType: "user", action: "integration.connected",
      targetType: "integration", targetId: provider, metadata: { account: accountLabel, scopes }, ip,
    });
    return back(origin, { connected: provider });
  } catch (e) {
    const code: OAuthErrorCode = e instanceof OAuthFlowError ? e.code : "provider_error";
    const message = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 300);
    if (!(e instanceof OAuthFlowError)) console.error("[integrations] callback failed:", message);
    await audit({
      workspaceId, userId: user.id, actorType: "user", action: "integration.connect_failed",
      targetType: "integration", targetId: provider, metadata: { code, message }, ip,
    });
    return back(origin, { error: code, provider });
  }
}, { rate: { limit: 30, windowSec: 60, bucket: "integration-callback" } });

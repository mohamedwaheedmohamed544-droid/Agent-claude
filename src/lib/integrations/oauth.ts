import { createHash } from "node:crypto";
import { query, queryOne } from "../db";
import { hasEncryptionKey, randomToken, redactSecrets } from "../security/crypto";
import { deleteConnection, saveConnection, tokenRequest, type TokenResponse } from "./store";
import { providerApi } from "./http";
import { isProviderConfigured, normalizeScopes, providerConfig, redirectUri, type OAuthProviderId } from "./providers";

export const STATE_TTL_MS = 10 * 60 * 1000;

/** Failure codes surfaced to the UI as /integrations?error=<code>. */
export type OAuthErrorCode =
  | "not_configured" | "encryption_key_missing" | "access_denied" | "invalid_state" | "state_expired"
  | "wrong_user" | "forbidden" | "exchange_failed" | "missing_refresh_token" | "provider_error";

export class OAuthFlowError extends Error {
  constructor(public code: OAuthErrorCode, message: string) { super(message); }
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Starts an authorization-code + PKCE flow. Stores a single-use `state` (10-minute expiry) bound to the
 * workspace, the initiating user and the provider, and returns the provider's consent URL.
 */
export async function createAuthorization(args: {
  workspaceId: string; userId: string; provider: OAuthProviderId; origin?: string;
}): Promise<{ authorizeUrl: string; state: string; redirectUri: string }> {
  const cfg = providerConfig(args.provider);
  if (!isProviderConfigured(args.provider)) throw new OAuthFlowError("not_configured", `${cfg.name} is not configured on this server`);
  if (!hasEncryptionKey()) throw new OAuthFlowError("encryption_key_missing", "NEXUS_ENCRYPTION_KEY must be set before connecting integrations");
  const state = randomToken(32);
  const verifier = cfg.supportsPkce ? randomToken(48) : null;
  // Opportunistic cleanup of abandoned states.
  await query("DELETE FROM oauth_states WHERE expires_at < now()");
  await query(
    "INSERT INTO oauth_states(state, workspace_id, user_id, provider, code_verifier, expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [state, args.workspaceId, args.userId, args.provider, verifier, new Date(Date.now() + STATE_TTL_MS)],
  );
  const redirect = redirectUri(args.provider, args.origin);
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set("client_id", cfg.clientId!);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scopes.join(" "));
  url.searchParams.set("state", state);
  if (verifier) {
    url.searchParams.set("code_challenge", pkceChallenge(verifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(cfg.extraAuthParams)) url.searchParams.set(k, v);
  return { authorizeUrl: url.toString(), state, redirectUri: redirect };
}

export interface ConsumedState { workspaceId: string; userId: string; provider: OAuthProviderId; codeVerifier: string | null }

/**
 * Validates and atomically deletes (single use) an OAuth state. The state must belong to the provider,
 * the currently logged-in user and their current workspace, and must not be expired.
 */
export async function consumeOAuthState(args: {
  state: string; provider: OAuthProviderId; userId: string; workspaceId: string | null;
}): Promise<ConsumedState> {
  if (!args.state || args.state.length > 200) throw new OAuthFlowError("invalid_state", "Missing or malformed state");
  // DELETE … RETURNING makes the state single-use even under concurrent callbacks.
  const row = await queryOne<{ workspace_id: string; user_id: string; provider: string; code_verifier: string | null; expires_at: Date }>(
    "DELETE FROM oauth_states WHERE state=$1 RETURNING workspace_id, user_id, provider, code_verifier, expires_at", [args.state],
  );
  if (!row) throw new OAuthFlowError("invalid_state", "Unknown or already-used state");
  if (row.provider !== args.provider) throw new OAuthFlowError("invalid_state", "State was issued for another provider");
  if (row.expires_at.getTime() < Date.now()) throw new OAuthFlowError("state_expired", "The authorization request expired; start again");
  if (row.user_id !== args.userId) throw new OAuthFlowError("wrong_user", "The authorization was started by a different user");
  if (args.workspaceId && row.workspace_id !== args.workspaceId) throw new OAuthFlowError("wrong_user", "The authorization was started in a different workspace");
  return { workspaceId: row.workspace_id, userId: row.user_id, provider: args.provider, codeVerifier: row.code_verifier };
}

/** Decodes the email claim of an ID token received directly from the token endpoint over TLS (OIDC §3.1.3.7). */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown; preferred_username?: unknown };
    const v = typeof payload.email === "string" ? payload.email : typeof payload.preferred_username === "string" ? payload.preferred_username : null;
    return v ? v.slice(0, 200) : null;
  } catch {
    return null;
  }
}

async function exchangeCode(provider: OAuthProviderId, code: string, verifier: string | null, origin?: string): Promise<TokenResponse> {
  let res: { status: number; body: TokenResponse };
  try {
    res = await tokenRequest(provider, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(provider, origin),
      ...(verifier ? { code_verifier: verifier } : {}),
      ...(provider === "microsoft" ? { scope: providerConfig(provider).scopes.join(" ") } : {}),
    });
  } catch (e) {
    throw new OAuthFlowError("exchange_failed", `Token exchange failed: ${redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
  if (res.status >= 400 || !res.body.access_token) {
    throw new OAuthFlowError("exchange_failed", `Token exchange was rejected (${res.body.error ?? `HTTP ${res.status}`})`);
  }
  if (!res.body.refresh_token) {
    // Without a refresh token the connection would silently die within an hour; refuse rather than pretend.
    throw new OAuthFlowError("missing_refresh_token", "The provider did not return a refresh token");
  }
  return res.body;
}

/** Completes the flow: exchanges the code, resolves the account label, stores encrypted tokens. */
export async function completeAuthorization(args: {
  consumed: ConsumedState; code: string; origin?: string;
}): Promise<{ accountLabel: string | null; scopes: string[] }> {
  const { workspaceId, userId, provider, codeVerifier } = args.consumed;
  if (!args.code || args.code.length > 4096) throw new OAuthFlowError("exchange_failed", "Missing authorization code");
  const tokens = await exchangeCode(provider, args.code, codeVerifier, args.origin);
  let label = emailFromIdToken(tokens.id_token);
  const scopes = normalizeScopes(tokens.scope ?? providerConfig(provider).scopes.join(" "));
  await saveConnection({ workspaceId, provider, userId, tokens, accountLabel: label, scopes });
  if (provider === "microsoft" || !label) {
    try {
      label = (await fetchAccountIdentity(workspaceId, provider)).account ?? label;
      if (label) await query("UPDATE integrations SET account_label=$3 WHERE workspace_id=$1 AND provider=$2", [workspaceId, provider, label.slice(0, 200)]);
    } catch { /* label is cosmetic; the connection itself is valid */ }
  }
  return { accountLabel: label, scopes };
}

/** Harmless read call that proves the connection works: Gmail profile / Graph /me. */
export async function fetchAccountIdentity(workspaceId: string, provider: OAuthProviderId): Promise<{ account: string | null }> {
  if (provider === "google") {
    const r = await providerApi<{ emailAddress?: string }>(workspaceId, provider, "https://gmail.googleapis.com/gmail/v1/users/me/profile", { service: "Gmail" });
    return { account: r.data?.emailAddress ?? null };
  }
  const r = await providerApi<{ mail?: string | null; userPrincipalName?: string }>(
    workspaceId, provider, "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", { service: "Microsoft Graph" },
  );
  return { account: r.data?.mail || r.data?.userPrincipalName || null };
}

export async function testConnection(workspaceId: string, provider: OAuthProviderId): Promise<{ ok: boolean; latencyMs: number; account: string | null; error?: string }> {
  const started = Date.now();
  try {
    const { account } = await fetchAccountIdentity(workspaceId, provider);
    return { ok: true, latencyMs: Date.now() - started, account };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, account: null, error: redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

/**
 * Disconnects: deletes the stored tokens and, where the provider supports it (Google), revokes the grant.
 * Microsoft has no per-application revocation endpoint for delegated tokens; users can remove consent at
 * https://myapps.microsoft.com. Revocation failure never blocks local deletion.
 */
export async function disconnectIntegration(workspaceId: string, provider: OAuthProviderId): Promise<{ removed: boolean; revoked: boolean | null }> {
  const bundle = await deleteConnection(workspaceId, provider);
  if (!bundle) return { removed: false, revoked: null };
  const cfg = providerConfig(provider);
  if (!cfg.revokeUrl) return { removed: true, revoked: null };
  try {
    const res = await fetch(cfg.revokeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: bundle.refresh_token ?? bundle.access_token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    return { removed: true, revoked: res.ok };
  } catch {
    return { removed: true, revoked: false };
  }
}

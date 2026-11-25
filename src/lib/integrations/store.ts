import { query, queryOne, transaction, type Queryable } from "../db";
import { decryptSecret, encryptSecret, redactSecrets } from "../security/crypto";
import { IntegrationNotConnectedError, IntegrationReconnectRequiredError } from "./errors";
import { providerConfig, normalizeScopes, type OAuthProviderId } from "./providers";

/** Decrypted token bundle. Lives only inside the integrations module; never returned by an API or logged. */
export interface TokenBundle {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  token_type?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export interface IntegrationRow {
  id: string;
  workspace_id: string;
  provider: string;
  status: "connected" | "disconnected" | "error" | "pending";
  account_label: string | null;
  scopes: string[];
  token_expires_at: Date | null;
  connected_by: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Public, token-free view of an integration row. */
const PUBLIC_COLUMNS = "id, workspace_id, provider, status, account_label, scopes, token_expires_at, connected_by, last_error, created_at, updated_at";

export async function getIntegration(workspaceId: string, provider: string, client?: Queryable): Promise<IntegrationRow | null> {
  return queryOne<IntegrationRow>(`SELECT ${PUBLIC_COLUMNS} FROM integrations WHERE workspace_id=$1 AND provider=$2`, [workspaceId, provider], client);
}

export async function listIntegrationRows(workspaceId: string): Promise<IntegrationRow[]> {
  return query<IntegrationRow>(`SELECT ${PUBLIC_COLUMNS} FROM integrations WHERE workspace_id=$1`, [workspaceId]);
}

export async function connectedProviders(workspaceId: string, candidates: OAuthProviderId[]): Promise<OAuthProviderId[]> {
  const rows = await query<{ provider: OAuthProviderId }>(
    "SELECT provider FROM integrations WHERE workspace_id=$1 AND provider = ANY($2) AND status='connected' AND encrypted_tokens IS NOT NULL",
    [workspaceId, candidates],
  );
  const set = new Set(rows.map((r) => r.provider));
  return candidates.filter((c) => set.has(c));
}

function expiryFrom(res: TokenResponse): Date | null {
  const s = Number(res.expires_in);
  return Number.isFinite(s) && s > 0 ? new Date(Date.now() + s * 1000) : null;
}

function encryptBundle(b: TokenBundle): string {
  return encryptSecret(JSON.stringify({ access_token: b.access_token, refresh_token: b.refresh_token, token_type: b.token_type }));
}

function decryptBundle(payload: string): TokenBundle {
  const parsed = JSON.parse(decryptSecret(payload)) as TokenBundle;
  if (!parsed?.access_token) throw new Error("Stored token bundle is invalid");
  return parsed;
}

/** Persists a freshly authorised connection (upsert on workspace+provider). Tokens are encrypted at rest. */
export async function saveConnection(args: {
  workspaceId: string; provider: OAuthProviderId; userId: string | null; tokens: TokenResponse; accountLabel: string | null; scopes?: string[];
}): Promise<IntegrationRow> {
  if (!args.tokens.access_token) throw new Error("Token response did not include an access token");
  const scopes = args.scopes ?? normalizeScopes(args.tokens.scope);
  const enc = encryptBundle({ access_token: args.tokens.access_token, refresh_token: args.tokens.refresh_token, token_type: args.tokens.token_type });
  const row = await queryOne<IntegrationRow>(
    `INSERT INTO integrations(workspace_id, provider, status, account_label, scopes, encrypted_tokens, token_expires_at, connected_by, last_error)
     VALUES ($1,$2,'connected',$3,$4,$5,$6,$7,NULL)
     ON CONFLICT (workspace_id, provider) DO UPDATE SET status='connected', account_label=EXCLUDED.account_label, scopes=EXCLUDED.scopes,
       encrypted_tokens=EXCLUDED.encrypted_tokens, token_expires_at=EXCLUDED.token_expires_at, connected_by=EXCLUDED.connected_by,
       last_error=NULL, created_at=CASE WHEN integrations.status='connected' THEN integrations.created_at ELSE now() END, updated_at=now()
     RETURNING ${PUBLIC_COLUMNS}`,
    [args.workspaceId, args.provider, args.accountLabel?.slice(0, 200) ?? null, scopes, enc, expiryFrom(args.tokens), args.userId],
  );
  return row!;
}

export async function markIntegrationError(workspaceId: string, provider: OAuthProviderId, message: string, client?: Queryable): Promise<void> {
  await query(
    "UPDATE integrations SET status='error', last_error=$3, updated_at=now() WHERE workspace_id=$1 AND provider=$2",
    [workspaceId, provider, redactSecrets(message).slice(0, 500)], client,
  );
}

/** Removes the connection and its tokens. Returns the decrypted bundle (for revocation) if one existed. */
export async function deleteConnection(workspaceId: string, provider: OAuthProviderId): Promise<TokenBundle | null> {
  const row = await queryOne<{ encrypted_tokens: string | null }>(
    "DELETE FROM integrations WHERE workspace_id=$1 AND provider=$2 RETURNING encrypted_tokens", [workspaceId, provider],
  );
  if (!row?.encrypted_tokens) return null;
  try { return decryptBundle(row.encrypted_tokens); } catch { return null; }
}

/** POSTs a form to a provider token endpoint. Never includes the body in thrown errors. */
export async function tokenRequest(provider: OAuthProviderId, params: Record<string, string>): Promise<{ status: number; body: TokenResponse }> {
  const cfg = providerConfig(provider);
  if (!cfg.clientId || !cfg.clientSecret) throw new Error(`${cfg.name} OAuth client is not configured`);
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ ...params, client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  let body: TokenResponse = {};
  try { body = (await res.json()) as TokenResponse; } catch { body = {}; }
  return { status: res.status, body };
}

const EXPIRY_SKEW_MS = 60_000;

/**
 * Returns a usable access token, refreshing it when it is (about to be) expired.
 * Pass `rejectedToken` after a 401 to force a refresh unless another request already rotated it.
 */
export async function getAccessToken(workspaceId: string, provider: OAuthProviderId, rejectedToken?: string): Promise<string> {
  const row = await queryOne<{ status: string; encrypted_tokens: string | null; token_expires_at: Date | null }>(
    "SELECT status, encrypted_tokens, token_expires_at FROM integrations WHERE workspace_id=$1 AND provider=$2",
    [workspaceId, provider],
  );
  if (!row || !row.encrypted_tokens || row.status === "disconnected" || row.status === "pending") throw new IntegrationNotConnectedError(provider);
  if (row.status === "error") throw new IntegrationReconnectRequiredError(provider);
  const bundle = decryptBundle(row.encrypted_tokens);
  const fresh = !row.token_expires_at || row.token_expires_at.getTime() - Date.now() > EXPIRY_SKEW_MS;
  if (fresh && bundle.access_token !== rejectedToken) return bundle.access_token;
  return refreshAccessToken(workspaceId, provider, bundle.access_token);
}

type RefreshOutcome = { ok: true; token: string } | { ok: false; reconnect: boolean; message: string };

/**
 * Refreshes under a row lock (SELECT … FOR UPDATE) so concurrent callers in any process perform at most one
 * refresh: the second caller waits for the lock, then sees the rotated token and uses it instead of refreshing again.
 */
async function refreshAccessToken(workspaceId: string, provider: OAuthProviderId, staleToken: string): Promise<string> {
  const outcome = await transaction<RefreshOutcome>(async (c) => {
    const row = await queryOne<{ status: string; encrypted_tokens: string | null; token_expires_at: Date | null }>(
      "SELECT status, encrypted_tokens, token_expires_at FROM integrations WHERE workspace_id=$1 AND provider=$2 FOR UPDATE",
      [workspaceId, provider], c,
    );
    if (!row?.encrypted_tokens || row.status !== "connected") return { ok: false, reconnect: true, message: "Integration is not connected" };
    const bundle = decryptBundle(row.encrypted_tokens);
    const stillFresh = !row.token_expires_at || row.token_expires_at.getTime() - Date.now() > EXPIRY_SKEW_MS;
    if (bundle.access_token !== staleToken && stillFresh) return { ok: true, token: bundle.access_token };
    if (!bundle.refresh_token) {
      await markIntegrationError(workspaceId, provider, "Access expired and no refresh token is available — reconnect required", c);
      return { ok: false, reconnect: true, message: "no refresh token" };
    }
    const cfg = providerConfig(provider);
    let res: { status: number; body: TokenResponse };
    try {
      res = await tokenRequest(provider, {
        grant_type: "refresh_token",
        refresh_token: bundle.refresh_token,
        ...(provider === "microsoft" ? { scope: cfg.scopes.join(" ") } : {}),
      });
    } catch (e) {
      return { ok: false, reconnect: false, message: `Token refresh failed: ${redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200)}` };
    }
    if (res.status >= 400 || !res.body.access_token) {
      const code = res.body.error ?? `http_${res.status}`;
      // invalid_grant / unauthorized_client / 400-401 → the grant is dead; 5xx/429 are transient.
      if (res.status < 500 && res.status !== 429) {
        await markIntegrationError(workspaceId, provider, `Token refresh rejected (${code}) — reconnect required`, c);
        return { ok: false, reconnect: true, message: code };
      }
      return { ok: false, reconnect: false, message: `Token refresh temporarily failed (${code})` };
    }
    const next: TokenBundle = {
      access_token: res.body.access_token,
      // Google usually omits refresh_token on refresh; Microsoft rotates it.
      refresh_token: res.body.refresh_token ?? bundle.refresh_token,
      token_type: res.body.token_type ?? bundle.token_type,
    };
    const scopes = res.body.scope ? normalizeScopes(res.body.scope) : null;
    await query(
      `UPDATE integrations SET encrypted_tokens=$3, token_expires_at=$4, scopes=COALESCE($5, scopes), last_error=NULL, updated_at=now()
        WHERE workspace_id=$1 AND provider=$2`,
      [workspaceId, provider, encryptBundle(next), expiryFrom(res.body), scopes], c,
    );
    return { ok: true, token: next.access_token };
  });
  if (outcome.ok) return outcome.token;
  if (outcome.reconnect) throw new IntegrationReconnectRequiredError(provider);
  throw new Error(outcome.message);
}

/** Scopes actually granted for a connected provider. */
export async function grantedScopes(workspaceId: string, provider: OAuthProviderId): Promise<string[]> {
  const row = await getIntegration(workspaceId, provider);
  return row?.scopes ?? [];
}

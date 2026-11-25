/**
 * OAuth provider configuration for external integrations. Only server code may import this module.
 * Client credentials come from environment variables; their VALUES are never returned by any API.
 */

export type OAuthProviderId = "google" | "microsoft";
export const OAUTH_PROVIDERS: OAuthProviderId[] = ["google", "microsoft"];

export function isOAuthProvider(v: unknown): v is OAuthProviderId {
  return v === "google" || v === "microsoft";
}

export interface OAuthProviderConfig {
  id: OAuthProviderId;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Token revocation endpoint (null when the provider has no per-app revocation for delegated tokens). */
  revokeUrl: string | null;
  scopes: string[];
  /** Extra query parameters on the authorization request. */
  extraAuthParams: Record<string, string>;
  /** Env var NAMES required for this provider (never their values). */
  requiredEnv: string[];
  optionalEnv: string[];
  supportsPkce: boolean;
  clientId: string | undefined;
  clientSecret: string | undefined;
}

export const GOOGLE_SCOPES = {
  openid: "openid",
  email: "email",
  gmailRead: "https://www.googleapis.com/auth/gmail.readonly",
  gmailSend: "https://www.googleapis.com/auth/gmail.send",
  calendarEvents: "https://www.googleapis.com/auth/calendar.events",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  driveMetadataRead: "https://www.googleapis.com/auth/drive.metadata.readonly",
} as const;

export const MICROSOFT_SCOPES = {
  offline: "offline_access",
  userRead: "User.Read",
  mailRead: "Mail.Read",
  mailSend: "Mail.Send",
  calendarsReadWrite: "Calendars.ReadWrite",
} as const;

export function microsoftTenant(): string {
  const t = (process.env.MICROSOFT_TENANT_ID ?? "").trim();
  // Tenant is interpolated into a URL path: accept only GUIDs, verified domains, or the well-known aliases.
  return /^[A-Za-z0-9.-]{1,100}$/.test(t) ? t : "common";
}

export function providerConfig(id: OAuthProviderId): OAuthProviderConfig {
  if (id === "google") {
    return {
      id,
      name: "Google Workspace",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revokeUrl: "https://oauth2.googleapis.com/revoke",
      scopes: Object.values(GOOGLE_SCOPES),
      extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
      requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NEXUS_ENCRYPTION_KEY"],
      optionalEnv: ["NEXUS_APP_URL"],
      supportsPkce: true,
      clientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
    };
  }
  const tenant = microsoftTenant();
  return {
    id,
    name: "Microsoft 365",
    authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    revokeUrl: null,
    scopes: Object.values(MICROSOFT_SCOPES),
    extraAuthParams: { response_mode: "query", prompt: "select_account" },
    requiredEnv: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "NEXUS_ENCRYPTION_KEY"],
    optionalEnv: ["MICROSOFT_TENANT_ID", "NEXUS_APP_URL"],
    supportsPkce: true,
    clientId: process.env.MICROSOFT_CLIENT_ID?.trim() || undefined,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET?.trim() || undefined,
  };
}

/** Client credentials present (the encryption key is checked separately so the UI can explain which is missing). */
export function isProviderConfigured(id: OAuthProviderId): boolean {
  const c = providerConfig(id);
  return Boolean(c.clientId && c.clientSecret);
}

export function missingEnv(id: OAuthProviderId): string[] {
  return providerConfig(id).requiredEnv.filter((k) => !process.env[k]?.trim());
}

/**
 * Public base URL used to build OAuth redirect URIs. NEXUS_APP_URL wins (it must match what is registered
 * with the provider); otherwise the request's origin (honouring reverse-proxy headers).
 */
export function appBaseUrl(fallbackOrigin?: string): string {
  const configured = process.env.NEXUS_APP_URL?.trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { /* fall through to request origin */ }
  }
  if (fallbackOrigin) return new URL(fallbackOrigin).origin;
  return "http://localhost:3000";
}

export function requestOrigin(req: { headers: Headers; url: string }): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")).split(",")[0].trim();
  if (host && /^[A-Za-z0-9.:[\]-]+$/.test(host) && (proto === "http" || proto === "https")) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export function redirectUri(id: OAuthProviderId, fallbackOrigin?: string): string {
  return `${appBaseUrl(fallbackOrigin)}/api/integrations/${id}/callback`;
}

/** Normalises granted scopes so they compare against the configured names (Microsoft may prefix the Graph resource). */
export function normalizeScopes(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return Array.from(new Set(raw.split(/\s+/).filter(Boolean).map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, ""))));
}

export function hasScope(granted: string[], scope: string): boolean {
  const g = granted.map((s) => s.toLowerCase());
  return g.includes(scope.toLowerCase());
}

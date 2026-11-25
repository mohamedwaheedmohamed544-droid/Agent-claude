import { redactSecrets } from "../security/crypto";
import { ProviderApiError } from "./errors";
import { getAccessToken } from "./store";
import type { OAuthProviderId } from "./providers";

const ALLOWED_HOSTS = new Set([
  "gmail.googleapis.com", "www.googleapis.com", "openidconnect.googleapis.com", "graph.microsoft.com",
]);

export interface ApiCall {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** JSON body (serialised automatically) */
  json?: unknown;
  /** Raw body with explicit content type (e.g. multipart uploads) */
  body?: BodyInit;
  contentType?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Service label used in error messages, e.g. "Gmail". */
  service: string;
  /** HTTP statuses that should be returned to the caller rather than thrown (e.g. 409 for idempotent creates). */
  allowStatus?: number[];
}

export interface ApiResult<T> { status: number; data: T }

function extractErrorDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const e = (body as { error?: unknown }).error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    const code = (e as { code?: unknown }).code;
    return [typeof code === "string" ? code : null, typeof m === "string" ? m : null].filter(Boolean).join(": ");
  }
  return "";
}

/**
 * Authenticated call to an official provider REST endpoint. On a 401 it refreshes the access token once
 * (under a DB lock) and retries once. Tokens never appear in thrown errors.
 */
export async function providerApi<T = unknown>(
  workspaceId: string, provider: OAuthProviderId, url: string, call: ApiCall,
): Promise<ApiResult<T>> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) throw new Error(`Refusing to call non-provider host ${u.hostname}`);
  let token = await getAccessToken(workspaceId, provider);
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers: Record<string, string> = { accept: "application/json", ...call.headers, authorization: `Bearer ${token}` };
    let body: BodyInit | undefined = call.body;
    if (call.json !== undefined) { body = JSON.stringify(call.json); headers["content-type"] = "application/json"; }
    else if (call.contentType) headers["content-type"] = call.contentType;
    let res: Response;
    try {
      res = await fetch(u, { method: call.method ?? "GET", headers, body, signal: AbortSignal.timeout(call.timeoutMs ?? 25_000) });
    } catch (e) {
      throw new Error(`${call.service} request failed: ${redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
    if (res.status === 401 && attempt === 0) {
      await res.body?.cancel().catch(() => {});
      token = await getAccessToken(workspaceId, provider, token);
      continue;
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (res.ok || call.allowStatus?.includes(res.status)) return { status: res.status, data: data as T };
    throw new ProviderApiError(provider, res.status, call.service, extractErrorDetail(data) || (typeof data === "string" ? data.slice(0, 200) : ""));
  }
  throw new ProviderApiError(provider, 401, call.service, "authorization was rejected after refresh");
}

/** Truncate untrusted text for model consumption. */
export function clip(s: unknown, max: number): string {
  const v = typeof s === "string" ? s : s == null ? "" : String(s);
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

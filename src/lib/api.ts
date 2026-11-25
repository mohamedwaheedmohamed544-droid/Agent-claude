import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ZodError } from "zod";
import { query } from "./db";
import { AppError, forbidden, unauthorized } from "./errors";
import { rateLimit } from "./security/rate-limit";
import { redactSecrets } from "./security/crypto";
import {
  ROLE_RANK, SESSION_COOKIE, WORKSPACE_COOKIE, getMembership, listMemberships, userFromToken,
  type Role, type SessionUser,
} from "./auth/session";

export interface PublicContext {
  req: NextRequest;
  ip: string;
  params: Record<string, string>;
}
export interface UserContext extends PublicContext {
  user: SessionUser;
}
export interface WorkspaceContext extends UserContext {
  workspaceId: string;
  role: Role;
}

type Handler<C> = (ctx: C) => Promise<Response | unknown>;
type RouteArgs = { params: Promise<Record<string, string>> };

interface RateOpts { limit: number; windowSec: number; bucket?: string }

export function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Rejects cross-site state-changing requests (CSRF defence in addition to SameSite=Lax cookies). */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin) {
    let originHost = "";
    try { originHost = new URL(origin).host; } catch { /* invalid */ }
    if (!host || originHost !== host) throw forbidden("Cross-origin request rejected");
  } else if (req.headers.get("sec-fetch-site") === "cross-site") {
    throw forbidden("Cross-origin request rejected");
  }
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid input", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
      { status: 400 },
    );
  }
  if (e instanceof SyntaxError) {
    return NextResponse.json({ error: { code: "bad_request", message: "Malformed JSON body" } }, { status: 400 });
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[api] unhandled error:", redactSecrets(msg));
  return NextResponse.json({ error: { code: "internal_error", message: "Something went wrong. The error has been logged." } }, { status: 500 });
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  return NextResponse.json(result ?? { ok: true });
}

function logRequest(req: NextRequest, status: number, started: number, userId?: string, workspaceId?: string) {
  const route = new URL(req.url).pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
  query(
    "INSERT INTO api_request_logs(workspace_id, user_id, method, route, status, duration_ms) VALUES ($1,$2,$3,$4,$5,$6)",
    [workspaceId ?? null, userId ?? null, req.method, route.slice(0, 200), status, Date.now() - started],
  ).catch(() => {});
}

async function resolveUser(req: NextRequest): Promise<SessionUser> {
  const jar = await cookies();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const user = await userFromToken(jar.get(SESSION_COOKIE)?.value ?? bearer);
  if (!user) throw unauthorized();
  return user;
}

async function resolveWorkspace(req: NextRequest, user: SessionUser): Promise<{ workspaceId: string; role: Role }> {
  const jar = await cookies();
  const requested = req.headers.get("x-nexus-workspace") ?? jar.get(WORKSPACE_COOKIE)?.value ?? user.lastWorkspaceId;
  if (requested) {
    const m = await getMembership(user.id, requested);
    if (m) return { workspaceId: m.workspaceId, role: m.role };
    if (req.headers.get("x-nexus-workspace")) throw forbidden("You are not a member of this workspace");
  }
  const all = await listMemberships(user.id);
  if (!all.length) throw forbidden("No workspace available");
  return { workspaceId: all[0].workspaceId, role: all[0].role };
}

async function applyRate(rate: RateOpts | undefined, key: string, path: string) {
  if (rate) await rateLimit(`${rate.bucket ?? path}:${key}`, rate.limit, rate.windowSec);
}

/** Unauthenticated route (login, signup, health). */
export function publicRoute(handler: Handler<PublicContext>, opts: { rate?: RateOpts; csrf?: boolean } = {}) {
  return async (req: NextRequest, args: RouteArgs) => {
    const started = Date.now();
    let status = 200;
    try {
      if (opts.csrf !== false) assertSameOrigin(req);
      const ip = clientIp(req);
      await applyRate(opts.rate, `ip:${ip}`, new URL(req.url).pathname);
      const res = toResponse(await handler({ req, ip, params: (await args?.params) ?? {} }));
      status = res.status;
      return res;
    } catch (e) {
      const res = errorResponse(e);
      status = res.status;
      return res;
    } finally {
      logRequest(req, status, started);
    }
  };
}

/** Authenticated route that is not tied to a workspace (profile, workspace list). */
export function userRoute(handler: Handler<UserContext>, opts: { rate?: RateOpts } = {}) {
  return async (req: NextRequest, args: RouteArgs) => {
    const started = Date.now();
    let status = 200;
    let userId: string | undefined;
    try {
      assertSameOrigin(req);
      const user = await resolveUser(req);
      userId = user.id;
      await applyRate(opts.rate, `u:${user.id}`, new URL(req.url).pathname);
      const res = toResponse(await handler({ req, ip: clientIp(req), user, params: (await args?.params) ?? {} }));
      status = res.status;
      return res;
    } catch (e) {
      const res = errorResponse(e);
      status = res.status;
      return res;
    } finally {
      logRequest(req, status, started, userId);
    }
  };
}

/**
 * Authenticated, workspace-scoped route. Every query in the handler MUST filter on ctx.workspaceId.
 * minRole defaults to 'viewer' for GET and 'member' for mutations.
 */
export function workspaceRoute(handler: Handler<WorkspaceContext>, opts: { minRole?: Role; rate?: RateOpts } = {}) {
  return async (req: NextRequest, args: RouteArgs) => {
    const started = Date.now();
    let status = 200;
    let userId: string | undefined;
    let wsId: string | undefined;
    try {
      assertSameOrigin(req);
      const user = await resolveUser(req);
      userId = user.id;
      const { workspaceId, role } = await resolveWorkspace(req, user);
      wsId = workspaceId;
      const min = opts.minRole ?? (req.method === "GET" ? "viewer" : "member");
      if (ROLE_RANK[role] < ROLE_RANK[min]) throw forbidden();
      await applyRate(opts.rate ?? { limit: 240, windowSec: 60, bucket: "ws-default" }, `u:${user.id}`, new URL(req.url).pathname);
      const res = toResponse(await handler({ req, ip: clientIp(req), user, workspaceId, role, params: (await args?.params) ?? {} }));
      status = res.status;
      return res;
    } catch (e) {
      const res = errorResponse(e);
      status = res.status;
      return res;
    } finally {
      logRequest(req, status, started, userId, wsId);
    }
  };
}

export function hasRole(role: Role, min: Role) {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function readJson<T = unknown>(req: NextRequest, maxBytes = 256 * 1024): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError(413, "payload_too_large", "Request body too large");
  return (text ? JSON.parse(text) : {}) as T;
}

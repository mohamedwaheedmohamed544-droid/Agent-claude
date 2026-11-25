import { cookies } from "next/headers";
import { query, queryOne, transaction, type Queryable } from "../db";
import { randomToken, sha256 } from "../security/crypto";

export const SESSION_COOKIE = "nexus_session";
export const WORKSPACE_COOKIE = "nexus_ws";
const SESSION_DAYS = 30;

export type Role = "owner" | "admin" | "member" | "viewer";
export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  locale: "en" | "ar";
  theme: "light" | "dark" | "system";
  isPlatformAdmin: boolean;
  lastWorkspaceId: string | null;
}

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await query(
    "INSERT INTO sessions(user_id, token_hash, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)",
    [userId, sha256(token), expires, meta.ip ?? null, (meta.userAgent ?? "").slice(0, 300)],
  );
  return { token, expires };
}

export async function setSessionCookie(token: string, expires: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(WORKSPACE_COOKIE);
}

export async function userFromToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const row = await queryOne<{
    id: string; email: string; name: string; locale: "en" | "ar"; theme: SessionUser["theme"];
    is_platform_admin: boolean; last_workspace_id: string | null;
  }>(
    `SELECT u.id, u.email, u.name, u.locale, u.theme, u.is_platform_admin, u.last_workspace_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (!row) return null;
  return {
    id: row.id, email: row.email, name: row.name, locale: row.locale, theme: row.theme,
    isPlatformAdmin: row.is_platform_admin, lastWorkspaceId: row.last_workspace_id,
  };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
}

export async function destroySession(token: string | undefined) {
  if (token) await query("DELETE FROM sessions WHERE token_hash=$1", [sha256(token)]);
}

export interface Membership {
  workspaceId: string;
  workspaceName: string;
  role: Role;
}

export async function listMemberships(userId: string): Promise<Membership[]> {
  const rows = await query<{ id: string; name: string; role: Role }>(
    `SELECT w.id, w.name, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 ORDER BY w.created_at`,
    [userId],
  );
  return rows.map((r) => ({ workspaceId: r.id, workspaceName: r.name, role: r.role }));
}

export async function getMembership(userId: string, workspaceId: string): Promise<Membership | null> {
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return null;
  const r = await queryOne<{ id: string; name: string; role: Role }>(
    `SELECT w.id, w.name, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND m.workspace_id = $2`,
    [userId, workspaceId],
  );
  return r ? { workspaceId: r.id, workspaceName: r.name, role: r.role } : null;
}

/** Creates a workspace and makes the user its owner. */
export async function createWorkspace(userId: string, name: string, client?: Queryable): Promise<string> {
  const run = async (c: Queryable) => {
    const ws = await queryOne<{ id: string }>(
      "INSERT INTO workspaces(name, owner_id) VALUES ($1,$2) RETURNING id",
      [name.slice(0, 120), userId],
      c,
    );
    await query("INSERT INTO workspace_members(workspace_id, user_id, role) VALUES ($1,$2,'owner')", [ws!.id, userId], c);
    await query("INSERT INTO knowledge_bases(workspace_id, name, description, created_by) VALUES ($1,'General','Default knowledge base',$2)", [ws!.id, userId], c);
    return ws!.id;
  };
  return client ? run(client) : transaction(run);
}

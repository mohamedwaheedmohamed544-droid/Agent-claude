import { z } from "zod";
import { cookies } from "next/headers";
import { readJson, userRoute } from "@/lib/api";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { forbidden } from "@/lib/errors";
import { WORKSPACE_COOKIE, createWorkspace, getMembership, listMemberships } from "@/lib/auth/session";

export const GET = userRoute(async ({ user }) => ({ workspaces: await listMemberships(user.id) }));

const Create = z.object({ name: z.string().trim().min(1).max(120) });

export const POST = userRoute(async ({ req, user }) => {
  const { name } = Create.parse(await readJson(req));
  const id = await createWorkspace(user.id, name);
  await audit({ workspaceId: id, userId: user.id, actorType: "user", action: "workspace.created" });
  return { id, name };
}, { rate: { limit: 10, windowSec: 3600, bucket: "ws-create" } });

const Switch = z.object({ workspaceId: z.string().uuid() });

/** Switch the active workspace (membership is re-verified on every request). */
export const PUT = userRoute(async ({ req, user }) => {
  const { workspaceId } = Switch.parse(await readJson(req));
  const m = await getMembership(user.id, workspaceId);
  if (!m) throw forbidden("You are not a member of this workspace");
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, workspaceId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 31536000 });
  await query("UPDATE users SET last_workspace_id=$2 WHERE id=$1", [user.id, workspaceId]);
  return { currentWorkspace: m };
});

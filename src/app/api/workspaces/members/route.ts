import { z } from "zod";
import { readJson, workspaceRoute } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";

export const GET = workspaceRoute(async ({ workspaceId }) => ({
  members: await query(
    `SELECT u.id, u.name, u.email, m.role, m.created_at AS "joinedAt" FROM workspace_members m JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=$1 ORDER BY m.created_at`, [workspaceId],
  ),
}));

const Add = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["admin", "member", "viewer"]) });

/** Adds an existing Nexus user to the workspace by email (admins only). */
export const POST = workspaceRoute(async ({ req, workspaceId, user, ip }) => {
  const b = Add.parse(await readJson(req));
  const target = await queryOne<{ id: string }>("SELECT id FROM users WHERE email=$1", [b.email]);
  if (!target) throw notFound("No Nexus account exists for that email. Ask them to sign up first.");
  const exists = await queryOne("SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [workspaceId, target.id]);
  if (exists) throw conflict("This user is already a member");
  await query("INSERT INTO workspace_members(workspace_id, user_id, role) VALUES ($1,$2,$3)", [workspaceId, target.id, b.role]);
  await audit({ workspaceId, userId: user.id, actorType: "user", action: "member.added", targetType: "user", targetId: target.id, metadata: { role: b.role }, ip });
  return { ok: true };
}, { minRole: "admin" });

const Update = z.object({ userId: z.string().uuid(), role: z.enum(["admin", "member", "viewer"]).optional(), remove: z.boolean().optional() });

export const PATCH = workspaceRoute(async ({ req, workspaceId, user, ip }) => {
  const b = Update.parse(await readJson(req));
  const target = await queryOne<{ role: string }>("SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [workspaceId, b.userId]);
  if (!target) throw notFound("Member not found");
  if (target.role === "owner") throw forbidden("The workspace owner cannot be changed or removed");
  if (b.userId === user.id) throw badRequest("You cannot change your own membership");
  if (b.remove) {
    await query("DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [workspaceId, b.userId]);
    await audit({ workspaceId, userId: user.id, actorType: "user", action: "member.removed", targetType: "user", targetId: b.userId, ip });
  } else if (b.role) {
    await query("UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2", [workspaceId, b.userId, b.role]);
    await audit({ workspaceId, userId: user.id, actorType: "user", action: "member.role_changed", targetType: "user", targetId: b.userId, metadata: { role: b.role }, ip });
  }
  return { ok: true };
}, { minRole: "admin" });

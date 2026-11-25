import { z } from "zod";
import { publicRoute, readJson } from "@/lib/api";
import { queryOne, transaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, forbidden } from "@/lib/errors";
import { hashPassword, passwordPolicyError } from "@/lib/auth/password";
import { createSession, createWorkspace, setSessionCookie } from "@/lib/auth/session";

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  locale: z.enum(["en", "ar"]).optional(),
  workspaceName: z.string().trim().min(1).max(120).optional(),
});

export const POST = publicRoute(async ({ req, ip }) => {
  // Optional invite-only mode: set NEXUS_ALLOWED_SIGNUP_DOMAINS="example.com,acme.com"
  const body = Body.parse(await readJson(req));
  const allowed = (process.env.NEXUS_ALLOWED_SIGNUP_DOMAINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(body.email.split("@")[1])) throw forbidden("Sign-up is restricted for this deployment");
  if (process.env.NEXUS_DISABLE_SIGNUP === "1") {
    const any = await queryOne("SELECT 1 FROM users LIMIT 1");
    if (any) throw forbidden("Sign-up is disabled. Ask an administrator for an invitation.");
  }
  const policy = passwordPolicyError(body.password);
  if (policy) throw badRequest(policy);
  const exists = await queryOne("SELECT 1 FROM users WHERE email=$1", [body.email]);
  if (exists) throw conflict("An account with this email already exists");
  const hash = await hashPassword(body.password);

  const { userId, workspaceId } = await transaction(async (c) => {
    const first = !(await queryOne("SELECT 1 FROM users LIMIT 1", [], c));
    const u = await queryOne<{ id: string }>(
      "INSERT INTO users(email, name, password_hash, locale, is_platform_admin) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [body.email, body.name, hash, body.locale ?? "en", first], c,
    );
    const ws = await createWorkspace(u!.id, body.workspaceName ?? `${body.name.split(" ")[0]}'s Workspace`, c);
    await queryOne("UPDATE users SET last_workspace_id=$2 WHERE id=$1", [u!.id, ws], c);
    return { userId: u!.id, workspaceId: ws };
  });
  const s = await createSession(userId, { ip, userAgent: req.headers.get("user-agent") });
  await setSessionCookie(s.token, s.expires);
  await audit({ workspaceId, userId, actorType: "user", action: "auth.signup", ip });
  return { user: { id: userId, email: body.email, name: body.name }, workspaceId };
}, { rate: { limit: 5, windowSec: 600, bucket: "signup" } });

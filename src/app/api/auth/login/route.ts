import { z } from "zod";
import { publicRoute, readJson } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/session";

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) });

// Constant-cost dummy hash so unknown emails take as long as wrong passwords.
const DUMMY = "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

export const POST = publicRoute(async ({ req, ip }) => {
  const body = Body.parse(await readJson(req));
  await rateLimit(`login-email:${body.email}`, 10, 900); // per-account brute-force protection
  const u = await queryOne<{ id: string; name: string; password_hash: string; last_workspace_id: string | null }>(
    "SELECT id, name, password_hash, last_workspace_id FROM users WHERE email=$1", [body.email],
  );
  const ok = await verifyPassword(body.password, u?.password_hash ?? DUMMY);
  if (!u || !ok) {
    await audit({ actorType: "system", action: "auth.login_failed", metadata: { email: body.email }, ip });
    throw new AppError(401, "invalid_credentials", "Invalid email or password");
  }
  const s = await createSession(u.id, { ip, userAgent: req.headers.get("user-agent") });
  await setSessionCookie(s.token, s.expires);
  await audit({ workspaceId: u.last_workspace_id, userId: u.id, actorType: "user", action: "auth.login", ip });
  return { user: { id: u.id, email: body.email, name: u.name } };
}, { rate: { limit: 20, windowSec: 300, bucket: "login" } });

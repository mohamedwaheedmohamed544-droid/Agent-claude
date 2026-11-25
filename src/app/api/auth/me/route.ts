import { z } from "zod";
import { cookies } from "next/headers";
import { readJson, userRoute } from "@/lib/api";
import { query } from "@/lib/db";
import { WORKSPACE_COOKIE, getMembership, listMemberships } from "@/lib/auth/session";
import { getWorkspaceSettings } from "@/lib/settings";

export const GET = userRoute(async ({ user }) => {
  const memberships = await listMemberships(user.id);
  const jar = await cookies();
  const wanted = jar.get(WORKSPACE_COOKIE)?.value ?? user.lastWorkspaceId;
  const current = (wanted && (await getMembership(user.id, wanted))) || memberships[0] || null;
  const settings = current ? await getWorkspaceSettings(current.workspaceId) : null;
  return {
    user: { id: user.id, email: user.email, name: user.name, locale: user.locale, theme: user.theme, isPlatformAdmin: user.isPlatformAdmin },
    workspaces: memberships,
    currentWorkspace: current,
    emergencyStop: settings?.emergencyStop ?? false,
  };
});

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  locale: z.enum(["en", "ar"]).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
});

export const PATCH = userRoute(async ({ req, user }) => {
  const p = Patch.parse(await readJson(req));
  await query(
    "UPDATE users SET name=COALESCE($2,name), locale=COALESCE($3,locale), theme=COALESCE($4,theme), updated_at=now() WHERE id=$1",
    [user.id, p.name ?? null, p.locale ?? null, p.theme ?? null],
  );
  const jar = await cookies();
  if (p.locale) jar.set("nexus_locale", p.locale, { path: "/", sameSite: "lax", maxAge: 31536000 });
  return { ok: true };
});

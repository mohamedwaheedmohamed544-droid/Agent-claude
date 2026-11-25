import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WORKSPACE_COOKIE, getMembership, getSessionUser, listMemberships } from "./session";
import { getWorkspaceSettings } from "../settings";
import type { SessionInfo } from "@/components/providers";

/** Server-side session bootstrap for app pages. Redirects to /login when the session is invalid. */
export async function requirePageSession(): Promise<SessionInfo> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const workspaces = await listMemberships(user.id);
  const jar = await cookies();
  const wanted = jar.get(WORKSPACE_COOKIE)?.value ?? user.lastWorkspaceId;
  const current = (wanted && (await getMembership(user.id, wanted))) || workspaces[0] || null;
  const settings = current ? await getWorkspaceSettings(current.workspaceId) : null;
  const locale = (jar.get("nexus_locale")?.value as "en" | "ar" | undefined) ?? user.locale;
  return {
    user: { id: user.id, email: user.email, name: user.name, locale, theme: user.theme, isPlatformAdmin: user.isPlatformAdmin },
    workspaces,
    currentWorkspace: current,
    emergencyStop: settings?.emergencyStop ?? false,
  };
}

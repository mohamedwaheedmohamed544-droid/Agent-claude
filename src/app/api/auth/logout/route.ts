import { cookies } from "next/headers";
import { publicRoute } from "@/lib/api";
import { SESSION_COOKIE, clearSessionCookie, destroySession } from "@/lib/auth/session";

export const POST = publicRoute(async () => {
  const jar = await cookies();
  await destroySession(jar.get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  return { ok: true };
});

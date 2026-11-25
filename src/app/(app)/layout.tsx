import { AppProvider } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { requirePageSession } from "@/lib/auth/server-session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();
  return (
    <AppProvider initial={session}>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}

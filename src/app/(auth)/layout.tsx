import { cookies } from "next/headers";
import { LocaleOnlyProvider } from "@/components/providers";
import { normalizeLocale } from "@/i18n";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = normalizeLocale((await cookies()).get("nexus_locale")?.value);
  return <LocaleOnlyProvider locale={locale}>{children}</LocaleOnlyProvider>;
}

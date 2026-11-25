"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Languages } from "lucide-react";
import { api } from "@/lib/client/api";
import { useT } from "@/components/providers";
import { Alert, Button, Field, Input } from "@/components/ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const { t, locale } = useT();
  const params = useSearchParams();
  const [form, setForm] = useState({ name: "", email: "", password: "", workspaceName: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await api("/api/auth/login", { body: { email: form.email, password: form.password } });
      else await api("/api/auth/signup", { body: { name: form.name, email: form.email, password: form.password, locale, workspaceName: form.workspaceName || undefined } });
      const next = params.get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const switchLocale = () => {
    document.cookie = `nexus_locale=${locale === "en" ? "ar" : "en"}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[#0d0c1d] p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-40 -start-40 size-[520px] rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-48 end-0 size-[480px] rounded-full bg-violet-600/25 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M6 18V6l12 12V6" /></svg>
          </span>
          <span className="text-lg font-semibold tracking-tight">{t("app.name")}</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-[34px] font-semibold leading-tight tracking-tight">{t("auth.createSub")}</h2>
          <ul className="mt-8 space-y-3.5 text-[15px] text-white/80">
            {["auth.feature1", "auth.feature2", "auth.feature3"].map((k) => (
              <li key={k} className="flex items-center gap-3"><CheckCircle2 className="size-5 text-indigo-300" />{t(k)}</li>
            ))}
          </ul>
        </div>
        <p className="relative mt-16 text-sm text-white/40">{t("app.tagline")}</p>
      </section>
      <section className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex justify-end">
          <button onClick={switchLocale} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-fg-2 hover:bg-surface-2">
            <Languages className="size-4" />{locale === "en" ? "العربية" : "English"}
          </button>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{mode === "login" ? t("auth.welcome") : t("auth.createTitle")}</h1>
          <p className="mt-1.5 text-sm text-fg-3">{mode === "login" ? t("auth.welcomeSub") : t("auth.createSub")}</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            {mode === "signup" && <Field label={t("auth.name")}><Input required autoComplete="name" value={form.name} onChange={set("name")} maxLength={120} /></Field>}
            <Field label={t("auth.email")}><Input required type="email" autoComplete="email" value={form.email} onChange={set("email")} dir="ltr" /></Field>
            <Field label={t("auth.password")} hint={mode === "signup" ? t("auth.passwordHint") : undefined}>
              <Input required type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={set("password")} minLength={mode === "signup" ? 10 : 1} dir="ltr" />
            </Field>
            {mode === "signup" && <Field label={`${t("auth.workspaceName")}`}><Input value={form.workspaceName} onChange={set("workspaceName")} maxLength={120} /></Field>}
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" size="lg" className="w-full justify-center" loading={busy}>{mode === "login" ? t("auth.signIn") : t("auth.signUp")}</Button>
          </form>
          <p className="mt-6 text-center text-sm text-fg-3">
            {mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
            <Link href={mode === "login" ? "/signup" : "/login"} className="font-medium text-accent hover:underline">{mode === "login" ? t("auth.signUp") : t("auth.signIn")}</Link>
          </p>
        </div>
      </section>
    </div>
  );
}

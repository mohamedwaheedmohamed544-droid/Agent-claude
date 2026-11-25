"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createT, dirOf, type Locale, type TFunction } from "@/i18n";
import { api } from "@/lib/client/api";

export type Theme = "light" | "dark" | "system";
export type Role = "owner" | "admin" | "member" | "viewer";

export interface SessionInfo {
  user: { id: string; email: string; name: string; locale: Locale; theme: Theme; isPlatformAdmin: boolean };
  workspaces: Array<{ workspaceId: string; workspaceName: string; role: Role }>;
  currentWorkspace: { workspaceId: string; workspaceName: string; role: Role } | null;
  emergencyStop: boolean;
}

interface AppContextValue {
  session: SessionInfo;
  refreshSession: () => Promise<void>;
  locale: Locale;
  setLocale: (l: Locale) => Promise<void>;
  theme: Theme;
  setTheme: (t: Theme) => void;
  t: TFunction;
  dir: "rtl" | "ltr";
  role: Role;
  can: (min: Role) => boolean;
}

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
const AppContext = createContext<AppContextValue | null>(null);

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

export function AppProvider({ initial, children }: { initial: SessionInfo; children: React.ReactNode }) {
  const [session, setSession] = useState(initial);
  const [locale, setLocaleState] = useState<Locale>(initial.user.locale);
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    let saved: Theme = initial.user.theme;
    try { saved = (localStorage.getItem("nexus-theme") as Theme) || initial.user.theme; } catch { /* storage unavailable */ }
    setThemeState(saved);
    applyTheme(saved);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { try { if ((localStorage.getItem("nexus-theme") ?? "system") === "system") applyTheme("system"); } catch { applyTheme("system"); } };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [initial.user.theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirOf(locale);
  }, [locale]);

  const refreshSession = useCallback(async () => {
    setSession(await api<SessionInfo>("/api/auth/me"));
  }, []);

  const setLocale = useCallback(async (l: Locale) => {
    setLocaleState(l);
    document.cookie = `nexus_locale=${l}; path=/; max-age=31536000; samesite=lax`;
    await api("/api/auth/me", { method: "PATCH", body: { locale: l } }).catch(() => {});
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem("nexus-theme", t); } catch { /* ignore */ }
    applyTheme(t);
    void api("/api/auth/me", { method: "PATCH", body: { theme: t } }).catch(() => {});
  }, []);

  const role: Role = session.currentWorkspace?.role ?? "viewer";
  const value = useMemo<AppContextValue>(() => ({
    session, refreshSession, locale, setLocale, theme, setTheme, t: createT(locale), dir: dirOf(locale), role,
    can: (min: Role) => RANK[role] >= RANK[min],
  }), [session, refreshSession, locale, setLocale, theme, setTheme, role]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

/** Translation hook. Also usable on auth pages via LocaleOnlyProvider. */
export function useT(): { t: TFunction; locale: Locale; dir: "rtl" | "ltr" } {
  const app = useContext(AppContext);
  const lo = useContext(LocaleOnlyContext);
  const locale = app?.locale ?? lo ?? "en";
  return { t: app?.t ?? createT(locale), locale, dir: dirOf(locale) };
}

const LocaleOnlyContext = createContext<Locale | null>(null);
export function LocaleOnlyProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleOnlyContext.Provider value={locale}>{children}</LocaleOnlyContext.Provider>;
}

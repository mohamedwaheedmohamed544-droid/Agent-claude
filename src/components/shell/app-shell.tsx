"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity, BarChart3, Bot, BookOpen, Brain, Check, ChevronDown, FolderOpen, Languages, LayoutDashboard, ListChecks, LogOut,
  Building2, Menu, MessageSquare, Monitor, Moon, OctagonX, Plug, Plus, Settings, ShieldCheck, Sun, X,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { useApp, type Theme } from "../providers";
import { Button, Dialog, Field, Input, cx } from "../ui";

const NAV = [
  { section: "nav.section.work", items: [
    { href: "/", key: "nav.dashboard", icon: LayoutDashboard },
    { href: "/chat", key: "nav.chat", icon: MessageSquare },
    { href: "/office", key: "nav.office", icon: Building2 },
    { href: "/tasks", key: "nav.tasks", icon: ListChecks },
    { href: "/approvals", key: "nav.approvals", icon: ShieldCheck, badge: "approvals" as const },
    { href: "/agents", key: "nav.agents", icon: Bot },
  ] },
  { section: "nav.section.knowledge", items: [
    { href: "/knowledge", key: "nav.knowledge", icon: BookOpen },
    { href: "/files", key: "nav.files", icon: FolderOpen },
    { href: "/memory", key: "nav.memory", icon: Brain },
  ] },
  { section: "nav.section.control", items: [
    { href: "/integrations", key: "nav.integrations", icon: Plug },
    { href: "/analytics", key: "nav.analytics", icon: BarChart3 },
    { href: "/activity", key: "nav.activity", icon: Activity },
    { href: "/settings", key: "nav.settings", icon: Settings },
  ] },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, session } = useApp();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: pending } = useApi<{ approvals: unknown[] }>("/api/approvals?status=pending", { intervalMs: 20_000 });
  const pendingCount = pending?.approvals.length ?? 0;

  useEffect(() => setMobileOpen(false), [pathname]);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 px-3 py-4">
      <Link href="/" className="mb-4 flex items-center gap-2.5 px-2">
        <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-card">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M6 18V6l12 12V6" /></svg>
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-fg">{t("app.name")}</span>
      </Link>
      <WorkspaceSwitcher />
      <div className="mt-3 flex-1 space-y-5 overflow-y-auto">
        {NAV.map((g) => (
          <div key={g.section}>
            <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{t(g.section)}</p>
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const active = isActive(pathname, it.href);
                const Icon = it.icon;
                return (
                  <li key={it.href}>
                    <Link href={it.href} aria-current={active ? "page" : undefined}
                      className={cx("group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium transition-colors",
                        active ? "bg-surface text-fg shadow-card border border-border" : "text-fg-2 hover:bg-surface-2 hover:text-fg border border-transparent")}>
                      <Icon className={cx("size-4 shrink-0", active ? "text-accent" : "text-fg-3 group-hover:text-fg-2")} />
                      <span className="truncate">{t(it.key)}</span>
                      {"badge" in it && it.badge === "approvals" && pendingCount > 0 && (
                        <span className="ms-auto rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white tabular-nums">{pendingCount}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <UserMenu />
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[252px] shrink-0 border-e border-border bg-bg lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-[280px] max-w-[85vw] border-e border-border bg-bg shadow-modal">
            <button className="absolute end-3 top-4 rounded-lg p-1.5 text-fg-3 hover:bg-surface-2" onClick={() => setMobileOpen(false)} aria-label={t("action.close")}><X className="size-4" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} pendingCount={pendingCount} />
        {session.emergencyStop && <EmergencyBanner />}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function TopBar({ onMenu, pendingCount }: { onMenu: () => void; pendingCount: number }) {
  const { t, locale, setLocale, theme, setTheme, session, refreshSession, can } = useApp();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const engage = async () => {
    setBusy(true);
    try { await api("/api/settings/emergency-stop", { body: { active: true } }); await refreshSession(); router.refresh(); }
    finally { setBusy(false); setConfirm(false); }
  };
  const nextTheme: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur sm:px-5">
      <button onClick={onMenu} className="rounded-lg p-2 text-fg-2 hover:bg-surface-2 lg:hidden" aria-label={t("shell.menu")}><Menu className="size-5" /></button>
      <div className="min-w-0 flex-1 truncate text-sm text-fg-3 lg:hidden">{session.currentWorkspace?.workspaceName}</div>
      <div className="ms-auto flex items-center gap-1.5">
        {pendingCount > 0 && (
          <Link href="/approvals" className="hidden items-center gap-1.5 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12.5px] font-medium text-warning sm:inline-flex">
            <ShieldCheck className="size-3.5" />{t("shell.pendingApprovals", { n: pendingCount })}
          </Link>
        )}
        <button onClick={() => setLocale(locale === "en" ? "ar" : "en")} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-fg-2 hover:bg-surface-2" title={t("shell.language")}>
          <Languages className="size-4" />{locale === "en" ? "العربية" : "English"}
        </button>
        <button onClick={() => setTheme(nextTheme[theme])} className="grid size-9 place-items-center rounded-lg text-fg-2 hover:bg-surface-2" title={`${t("shell.theme")}: ${t(`shell.theme.${theme}`)}`} aria-label={t("shell.theme")}>
          <ThemeIcon className="size-4" />
        </button>
        {!session.emergencyStop && can("member") && (
          <Button variant="outline" size="sm" className="text-danger hover:bg-danger-soft" icon={<OctagonX className="size-4" />} onClick={() => setConfirm(true)}>
            <span className="hidden sm:inline">{t("shell.emergencyStop")}</span>
          </Button>
        )}
      </div>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={t("shell.emergencyStop")} description={t("shell.emergencyStopConfirm")} size="sm"
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>{t("action.cancel")}</Button><Button variant="danger" loading={busy} onClick={engage}>{t("shell.emergencyStop")}</Button></>} />
    </header>
  );
}

function EmergencyBanner() {
  const { t, can, refreshSession } = useApp();
  const [busy, setBusy] = useState(false);
  const release = async () => {
    setBusy(true);
    try { await api("/api/settings/emergency-stop", { body: { active: false } }); await refreshSession(); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-3 border-b border-danger/30 bg-danger-soft px-5 py-2.5 text-sm font-medium text-danger">
      <OctagonX className="size-4 shrink-0" />
      <span className="flex-1">{t("shell.emergencyStopActive")}</span>
      {can("admin") && <Button size="sm" variant="danger" loading={busy} onClick={release}>{t("shell.release")}</Button>}
    </div>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onOut]);
}

function WorkspaceSwitcher() {
  const { t, session, refreshSession } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const current = session.currentWorkspace;
  const switchTo = async (id: string) => {
    await api("/api/workspaces", { method: "PUT", body: { workspaceId: id } });
    setOpen(false);
    await refreshSession();
    router.push("/");
    router.refresh();
  };
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const ws = await api<{ id: string }>("/api/workspaces", { body: { name } });
      setCreating(false); setName("");
      await switchTo(ws.id);
    } finally { setBusy(false); }
  };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-2.5 py-2 text-start shadow-card hover:border-border-strong">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-[12px] font-semibold text-accent-text">{current?.workspaceName.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-fg-3">{t("shell.workspace")}</span>
          <span className="block truncate text-[13px] font-medium text-fg">{current?.workspaceName}</span>
        </span>
        <ChevronDown className="size-4 text-fg-3" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-xl border border-border bg-surface p-1 shadow-pop">
          {session.workspaces.map((w) => (
            <button key={w.workspaceId} onClick={() => switchTo(w.workspaceId)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] hover:bg-surface-2">
              <span className="min-w-0 flex-1 truncate text-fg">{w.workspaceName}</span>
              <span className="text-[11px] text-fg-3">{w.role}</span>
              {w.workspaceId === current?.workspaceId && <Check className="size-3.5 text-accent" />}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button onClick={() => { setCreating(true); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-fg-2 hover:bg-surface-2">
            <Plus className="size-3.5" />{t("shell.newWorkspace")}
          </button>
        </div>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title={t("shell.newWorkspace")} size="sm"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>{t("action.cancel")}</Button><Button loading={busy} onClick={create}>{t("action.create")}</Button></>}>
        <Field label={t("auth.workspaceName")}><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} onKeyDown={(e) => e.key === "Enter" && create()} /></Field>
      </Dialog>
    </div>
  );
}

function UserMenu() {
  const { t, session } = useApp();
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  };
  return (
    <div className="mt-2 flex items-center gap-2.5 rounded-xl px-2 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-[13px] font-semibold text-fg-2">{session.user.name.slice(0, 1).toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-fg">{session.user.name}</span>
        <span className="block truncate text-[11.5px] text-fg-3">{session.user.email}</span>
      </span>
      <button onClick={logout} className="rounded-lg p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg" title={t("shell.signOut")} aria-label={t("shell.signOut")}><LogOut className="size-4" /></button>
    </div>
  );
}

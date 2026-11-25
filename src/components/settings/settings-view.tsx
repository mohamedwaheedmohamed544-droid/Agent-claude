"use client";

import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { ErrorState, LoadingBlock, PageHeader, Tabs } from "@/components/ui";
import { useApp } from "@/components/providers";
import { useApi } from "@/lib/client/hooks";
import { ProfileSection } from "./profile-section";
import { MembersSection, WorkspaceSection } from "./workspace-section";
import { AutonomySection } from "./autonomy-section";
import { ToolsSection } from "./tools-section";
import { ModelsSection } from "./models-section";
import { EmergencySection } from "./emergency-section";
import { ReadOnlyNote, type SettingsResponse } from "./shared";

const TABS = ["profile", "workspace", "autonomy", "tools", "models", "emergency"] as const;
type Tab = (typeof TABS)[number];

function tabFromHash(): Tab | null {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  if (h === "members") return "workspace";
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : null;
}

export function SettingsView() {
  const { t, can } = useApp();
  const [tab, setTab] = useState<Tab>("profile");
  const settings = useApi<SettingsResponse>("/api/settings");
  const reload = async () => { await settings.reload(); };

  // Deep-linkable tabs (#autonomy, #tools …) without useSearchParams.
  useEffect(() => {
    const sync = () => { const h = tabFromHash(); if (h) setTab(h); };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const change = (v: Tab) => {
    setTab(v);
    try { history.replaceState(null, "", `#${v}`); } catch { /* ignore */ }
  };

  const needsSettings = tab !== "profile";
  const body = () => {
    if (tab === "profile") return <ProfileSection />;
    if (tab === "emergency") return <EmergencySection onChanged={reload} />;
    if (settings.error && !settings.data) return <ErrorState error={settings.error} onRetry={settings.reload} />;
    if (!settings.data) return <LoadingBlock rows={4} />;
    const d = settings.data;
    switch (tab) {
      case "workspace": return <div className="space-y-6"><WorkspaceSection data={d} onSaved={reload} /><MembersSection /></div>;
      case "autonomy": return <AutonomySection data={d} onSaved={reload} />;
      case "tools": return <ToolsSection data={d} onSaved={reload} />;
      case "models": return <ModelsSection data={d} onSaved={reload} />;
    }
  };

  return (
    <>
      <PageHeader icon={<Settings className="size-5" />} title={t("nav.settings")} description={t("settings.subtitle")} />
      <Tabs<Tab> value={tab} onChange={change} className="mb-5"
        items={TABS.map((v) => ({ value: v, label: t(`settings.tab.${v}`) }))} />
      {needsSettings && tab !== "emergency" && !can("admin") && <div className="mb-4"><ReadOnlyNote /></div>}
      <div role="tabpanel" aria-label={t(`settings.tab.${tab}`)}>{body()}</div>
    </>
  );
}

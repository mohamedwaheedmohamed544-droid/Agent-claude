"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, FileUp, LayoutTemplate, Plus, Puzzle, Users, Wand2, Box } from "lucide-react";
import { Button, PageHeader, Tabs } from "@/components/ui";
import { useApp } from "@/components/providers";
import { OfficeSettingsPanel } from "@/components/office/office-settings-panel";
import { AgentList } from "./agent-list";
import { SkillsTab } from "./skills-tab";
import { DepartmentsTab } from "./departments-tab";
import { ImportDialog, NaturalLanguageDialog, TemplateGallery } from "./creation";
import { SectionTitle } from "./shared";

const TABS = ["agents", "skills", "templates", "departments", "office"] as const;
type Tab = (typeof TABS)[number];

/** Agent Management (/agents): the admin console for the database-driven AI workforce. */
export function AgentManagement() {
  const { t, can } = useApp();
  const admin = can("admin");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "agents";
  const [nlOpen, setNlOpen] = useState(params.get("ask") === "1");
  const [importOpen, setImportOpen] = useState(false);

  const setTab = (next: Tab) => {
    const q = new URLSearchParams(params.toString());
    if (next === "agents") q.delete("tab"); else q.set("tab", next);
    router.replace(`${pathname}${q.toString() ? `?${q}` : ""}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        icon={<Users className="size-5" />}
        title={t("agents.title")}
        description={admin ? t("agents.subtitle") : t("agents.subtitleReadOnly")}
        actions={admin ? (
          <>
            <Button variant="outline" icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)}>{t("agents.import.button")}</Button>
            <Button variant="outline" icon={<Wand2 className="size-4" />} onClick={() => setNlOpen(true)}>{t("agents.nl.button")}</Button>
            <Button icon={<Plus className="size-4" />} onClick={() => router.push("/agents/new")}>{t("agents.create")}</Button>
          </>
        ) : undefined}
      />

      <Tabs<Tab> className="mb-5" value={tab} onChange={setTab} items={[
        { value: "agents", label: <><Users className="size-3.5" />{t("agents.tab.agents")}</> },
        { value: "skills", label: <><Puzzle className="size-3.5" />{t("agents.tab.skills")}</> },
        { value: "templates", label: <><LayoutTemplate className="size-3.5" />{t("agents.tab.templates")}</> },
        { value: "departments", label: <><Building2 className="size-3.5" />{t("agents.tab.departments")}</> },
        { value: "office", label: <><Box className="size-3.5" />{t("agents.tab.office")}</> },
      ]} />

      <div role="tabpanel">
        {tab === "agents" && <AgentList />}
        {tab === "skills" && <SkillsTab />}
        {tab === "templates" && (
          <section>
            <SectionTitle title={t("agents.templates.title")} description={t("agents.templates.subtitle")} />
            <TemplateGallery manage onPick={(tpl) => router.push(`/agents/new?template=${encodeURIComponent(tpl.key)}`)} />
          </section>
        )}
        {tab === "departments" && <DepartmentsTab />}
        {tab === "office" && <OfficeSettingsPanel />}
      </div>

      {admin && <NaturalLanguageDialog open={nlOpen} onClose={() => setNlOpen(false)} />}
      {admin && <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />}
    </>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Bot, Brain, Building2, Check, LayoutTemplate, ListChecks, Network, Puzzle, ShieldCheck, UserRound } from "lucide-react";
import { Alert, Badge, Button, Card, ErrorState, Input, LoadingBlock, RiskBadge, Spinner, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api, ApiError } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import type { TemplateRecord } from "@/lib/agents/types";
import { AgentFace, ChipRow } from "./shared";
import { TemplateDialog } from "./creation";
import {
  AISection, IdentitySection, OfficeSection, RelationshipsSection, ResponsibilitiesSection, SkillsSection, ToolsSection,
  type BuilderLookups, type SectionProps,
} from "./builder-sections";
import {
  configOf, emptyConfig, fieldErrorsOf, localDept, localName, localRole, localSkill, normalizeConfig, slugPreview, takeDraft,
  type AgentDefinitionInput, type AgentDetail, type AgentListResponse, type AgentRecord, type AgentValidation, type DepartmentRecord,
  type ModelsResponse, type OfficeSettingsResponse, type SkillRecord, type ToolInfo,
} from "./types";

const SECTIONS = [
  { key: "identity", icon: UserRound, prefixes: ["nameAr", "nameEn", "slug", "roleTitle", "roleTitleAr", "description", "descriptionAr", "personality", "color", "office.avatarPreset", "office.appearance"] },
  { key: "responsibilities", icon: ListChecks, prefixes: ["responsibilities", "capabilities"] },
  { key: "ai", icon: Brain, prefixes: ["ai"] },
  { key: "skills", icon: Puzzle, prefixes: ["skills"] },
  { key: "tools", icon: ShieldCheck, prefixes: ["tools", "permissions"] },
  { key: "relationships", icon: Network, prefixes: ["relationships"] },
  { key: "office", icon: Building2, prefixes: ["office.departmentKey", "office.defaultAnimation", "office.preferredMeetingRoom", "office.visible", "office.workstationId"] },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

const matches = (field: string, prefix: string) => field === prefix || field.startsWith(`${prefix}.`) || field.startsWith(`${prefix}[`);
function clientCheck(cfg: AgentDefinitionInput, t: (k: string) => string, editing: boolean) {
  const req = t("agents.validation.required");
  const out: Array<{ field: string; message: string }> = [];
  if (!cfg.nameAr.trim()) out.push({ field: "nameAr", message: req });
  if (!cfg.nameEn.trim()) out.push({ field: "nameEn", message: req });
  else if (!editing && !slugPreview(cfg.nameEn)) out.push({ field: "nameEn", message: t("agents.validation.latinName") });
  if (!cfg.roleTitle.trim() && !cfg.roleTitleAr.trim()) out.push({ field: "roleTitleAr", message: t("agents.validation.roleRequired") });
  if (!cfg.office.departmentKey) out.push({ field: "office.departmentKey", message: req });
  return out;
}

const sectionOf = (field: string): SectionKey => SECTIONS.find((s) => s.prefixes.some((p) => matches(field, p)))?.key ?? "identity";

/**
 * Agent Builder (create + edit). Left: section navigation; centre: the active section; right: live preview.
 * The server validates continuously (debounced POST /api/agents/validate); nothing is saved until the admin clicks a
 * save button in the sticky footer.
 */
export function AgentBuilder({ slug }: { slug?: string }) {
  const { t, locale, can } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const editing = Boolean(slug);

  // Lookups
  const skills = useApi<{ skills: SkillRecord[] }>("/api/skills");
  const tools = useApi<{ tools: ToolInfo[] }>("/api/tools");
  const models = useApi<ModelsResponse>("/api/agents/models");
  const agents = useApi<AgentListResponse>("/api/agents?lifecycle=all");
  const depts = useApi<{ departments: DepartmentRecord[] }>("/api/departments");
  const office = useApi<OfficeSettingsResponse>("/api/office/settings");
  const existing = useApi<AgentDetail>(slug ? `/api/agents/${encodeURIComponent(slug)}` : null);

  const [c, setC] = useState<AgentDefinitionInput | null>(null);
  const [initial, setInitial] = useState<string>("");
  const [record, setRecord] = useState<AgentRecord | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>("identity");
  const [validation, setValidation] = useState<AgentValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"draft" | "activate" | "save" | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const initDone = useRef(false);
  const mainRef = useRef<HTMLDivElement>(null);

  // ── Initial config (edit → record; new → template / stashed draft / blank) ──
  useEffect(() => {
    if (initDone.current) return;
    if (editing) {
      if (!existing.data) return;
      initDone.current = true;
      const cfg = configOf(existing.data.agent);
      setRecord(existing.data.agent); setC(cfg); setInitial(JSON.stringify(cfg));
      if (params.get("from") === "duplicate") setOrigin("duplicate");
      return;
    }
    const tplKey = params.get("template");
    if (tplKey) {
      initDone.current = true;
      api<{ templates: TemplateRecord[] }>("/api/agent-templates").then((r) => {
        const tpl = r.templates.find((x) => x.key === tplKey);
        const cfg = tpl ? normalizeConfig(tpl.config) : emptyConfig();
        if (!tpl) setInitError(t("agents.builder.templateMissing"));
        setTemplateKey(tpl?.key ?? null); setOrigin(tpl ? "template" : null);
        setC(cfg); setInitial(JSON.stringify(cfg));
      }).catch((err: Error) => { setInitError(err.message); const cfg = emptyConfig(); setC(cfg); setInitial(JSON.stringify(cfg)); });
      return;
    }
    if (params.get("source") === "draft") {
      initDone.current = true;
      const d = takeDraft();
      const cfg = d?.config ?? emptyConfig();
      if (!d) setInitError(t("agents.builder.draftMissing"));
      setOrigin(d ? d.source : null);
      setC(cfg); setInitial("");
      return;
    }
    if (!depts.data && depts.loading) return;
    initDone.current = true;
    const first = depts.data?.departments.find((d) => d.kind === "department")?.key ?? "";
    const cfg = emptyConfig(first);
    setC(cfg); setInitial(JSON.stringify(cfg));
  }, [editing, existing.data, depts.data, depts.loading, params, t]);

  const dirty = c !== null && JSON.stringify(c) !== initial;
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ── Debounced server validation ──
  const cJson = c ? JSON.stringify(c) : "";
  useEffect(() => {
    if (!cJson) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setValidating(true);
      try {
        const v = await api<AgentValidation>("/api/agents/validate", { body: { config: JSON.parse(cJson), slug }, signal: ctrl.signal });
        setValidation(v);
      } catch { /* validation is advisory while typing; save re-validates */ }
      finally { if (!ctrl.signal.aborted) setValidating(false); }
    }, 700);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [cJson, slug]);

  const set = useCallback((fn: (c: AgentDefinitionInput) => AgentDefinitionInput) => {
    setC((prev) => (prev ? fn(prev) : prev));
    setServerErrors([]);
  }, []);

  // Required-field errors appear after the first save attempt; server validation errors appear as soon as they are reported.
  const allErrors = useMemo(() => [
    ...(attempted && c ? clientCheck(c, t, editing) : []), ...serverErrors, ...(validation?.errors ?? []),
  ], [attempted, c, t, editing, serverErrors, validation]);
  const err = useCallback((field: string) => allErrors.find((e) => e.field === field)?.message, [allErrors]);
  const countFor = (key: SectionKey) => allErrors.filter((e) => sectionOf(e.field) === key).length;

  const lookups: BuilderLookups = {
    skills: skills.data?.skills ?? [],
    tools: tools.data?.tools ?? [],
    models: models.data ?? null,
    agents: agents.data?.agents ?? [],
    departments: depts.data?.departments ?? [],
    meetingRooms: office.data?.layout.meetingRooms ?? [],
    validation, validating,
    reloadSkills: skills.reload,
    reloadDepartments: depts.reload,
  };

  const goToFirstError = (errs: Array<{ field: string }>) => {
    if (!errs.length) return;
    setSection(sectionOf(errs[0].field));
    mainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const save = async (kind: "draft" | "activate" | "save") => {
    if (!c) return;
    setSaveError(null); setServerErrors([]);
    const ce = clientCheck(c, t, editing);
    setAttempted(true);
    if (ce.length) { setSaveError(t("agents.builder.fixErrors")); goToFirstError(ce); return; }
    setSaving(kind);
    try {
      const v = await api<AgentValidation>("/api/agents/validate", { body: { config: c, slug } });
      setValidation(v);
      if (v.errors.length) { setSaveError(t("agents.builder.fixErrors")); goToFirstError(v.errors); setSaving(null); return; }
      if (editing && slug) {
        await api(`/api/agents/${encodeURIComponent(slug)}`, { method: "PATCH", body: { config: c, changeNote: changeNote.trim() || undefined } });
        if (kind === "activate" && record?.lifecycle !== "active") {
          await api(`/api/agents/${encodeURIComponent(slug)}/lifecycle`, { body: { action: record?.lifecycle === "archived" ? "restore" : "activate" } });
        }
        setInitial(JSON.stringify(c));
        router.push(`/agents/${slug}?saved=${kind === "activate" ? "active" : "1"}`);
      } else {
        const res = await api<{ agent: AgentRecord }>("/api/agents", { body: { config: c, lifecycle: kind === "activate" ? "active" : "draft", templateKey: templateKey ?? undefined } });
        setInitial(JSON.stringify(c));
        router.push(`/agents/${res.agent.slug}?created=${kind === "activate" ? "active" : "draft"}`);
      }
    } catch (e) {
      const fe = e instanceof ApiError ? fieldErrorsOf(e.details) : [];
      setServerErrors(fe);
      setSaveError((e as Error).message);
      goToFirstError(fe);
      setSaving(null);
    }
  };

  const cancel = () => {
    if (dirty && !window.confirm(t("agents.builder.discardConfirm"))) return;
    setInitial(cJson);
    router.push(slug ? `/agents/${slug}` : "/agents");
  };

  const applyTemplate = (tpl: TemplateRecord) => {
    if (dirty && !window.confirm(t("agents.builder.replaceConfirm"))) return;
    const cfg = normalizeConfig(tpl.config);
    setC(cfg); setTemplateKey(tpl.key); setOrigin("template"); setSection("identity");
  };

  if (!can("admin")) {
    return <Alert tone="warning" title={t("agents.builder.adminOnly")}>{t("agents.builder.adminOnlyBody")}</Alert>;
  }
  if (editing && existing.error && !existing.data) return <ErrorState error={existing.error} onRetry={existing.reload} />;
  if (!c) return <LoadingBlock rows={6} />;

  const idx = SECTIONS.findIndex((s) => s.key === section);
  const props: SectionProps = { c, set, err, lk: lookups, slug: slug ?? null };
  const lc = record?.lifecycle;

  return (
    <div className="pb-28">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={slug ? `/agents/${slug}` : "/agents"} className="mb-2 inline-flex items-center gap-1 text-[13px] text-fg-3 hover:text-fg">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />{slug ? localName(c, locale) : t("agents.title")}
          </Link>
          <h1 className="text-[22px] font-semibold tracking-tight text-fg">{editing ? t("agents.builder.editTitle") : t("agents.builder.createTitle")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-3">{editing ? t("agents.builder.editSubtitle") : t("agents.builder.createSubtitle")}</p>
        </div>
        {!editing && <Button variant="outline" icon={<LayoutTemplate className="size-4" />} onClick={() => setTplOpen(true)}>{t("agents.templates.fromTemplate")}</Button>}
      </div>

      {initError && <div className="mb-4"><Alert tone="warning">{initError}</Alert></div>}
      {origin && (
        <div className="mb-4"><Alert tone="info" title={t(`agents.builder.origin.${origin}`)}>{t("agents.builder.originBody")}</Alert></div>
      )}

      <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_300px]">
        <nav aria-label={t("agents.builder.sections")} className="lg:sticky lg:top-20 lg:self-start">
          <ol className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {SECTIONS.map((s, i) => {
              const n = countFor(s.key);
              const on = s.key === section;
              const Icon = s.icon;
              return (
                <li key={s.key} className="shrink-0">
                  <button type="button" onClick={() => setSection(s.key)} aria-current={on ? "step" : undefined}
                    className={cx("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-[13px] font-medium transition-colors",
                      on ? "bg-accent-soft text-accent-text" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}>
                    <span className={cx("grid size-5 shrink-0 place-items-center rounded-md text-[11px]", on ? "bg-accent text-white" : "bg-surface-2 text-fg-3")}>{i + 1}</span>
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="whitespace-nowrap">{t(`agents.builder.section.${s.key}`)}</span>
                    {n > 0 && <span className="ms-auto rounded-full bg-danger-soft px-1.5 text-[11px] text-danger" aria-label={t("agents.builder.errorCount", { n })}>{n}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div ref={mainRef} className="min-w-0 scroll-mt-20">
          <Card className="p-5 sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-fg-3">{t("agents.builder.step", { n: idx + 1, total: SECTIONS.length })}</p>
                <h2 className="text-lg font-semibold text-fg">{t(`agents.builder.section.${section}`)}</h2>
                <p className="mt-0.5 text-[13px] text-fg-3">{t(`agents.builder.section.${section}.desc`)}</p>
              </div>
              {validating && <span className="inline-flex items-center gap-1.5 text-xs text-fg-3" role="status"><Spinner className="size-3.5" />{t("agents.builder.validating")}</span>}
            </div>
            {section === "identity" && <IdentitySection {...props} />}
            {section === "responsibilities" && <ResponsibilitiesSection {...props} />}
            {section === "ai" && <AISection {...props} />}
            {section === "skills" && <SkillsSection {...props} />}
            {section === "tools" && <ToolsSection {...props} />}
            {section === "relationships" && <RelationshipsSection {...props} />}
            {section === "office" && <OfficeSection {...props} />}
            <div className="mt-6 flex justify-between gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" disabled={idx === 0} onClick={() => setSection(SECTIONS[idx - 1].key)} icon={<ArrowLeft className="size-4 rtl:rotate-180" />}>{t("agents.builder.prev")}</Button>
              {idx < SECTIONS.length - 1 && (
                <Button type="button" variant="secondary" onClick={() => setSection(SECTIONS[idx + 1].key)}>
                  {t("agents.builder.next")}<ArrowRight className="size-4 rtl:rotate-180" />
                </Button>
              )}
            </div>
          </Card>
        </div>

        <aside className="lg:col-span-2 xl:col-span-1 xl:sticky xl:top-20 xl:self-start" aria-label={t("agents.builder.preview")}>
          <PreviewCard c={c} slug={slug ?? null} lookups={lookups} />
        </aside>
      </div>

      {/* Sticky footer */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:px-8">
          <div className="min-w-0 flex-1" aria-live="polite">
            {saveError ? <p className="truncate text-[13px] text-danger">{saveError}</p>
              : dirty ? <p className="text-[13px] text-fg-3">{t("agents.builder.unsaved")}</p>
                : <p className="text-[13px] text-fg-3">{editing ? t("agents.builder.noChanges") : t("agents.builder.nothingSaved")}</p>}
          </div>
          {editing && (
            <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder={t("agents.builder.changeNote")} aria-label={t("agents.builder.changeNote")} className="lg:w-64" maxLength={200} />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={cancel}>{t("action.cancel")}</Button>
            {editing ? (
              <>
                <Button variant={lc === "active" ? "primary" : "outline"} loading={saving === "save"} disabled={!!saving || !dirty} onClick={() => void save("save")}>{t("agents.builder.saveChanges")}</Button>
                {lc !== "active" && !record?.isOrchestrator && (
                  <Button loading={saving === "activate"} disabled={!!saving} icon={<Check className="size-4" />} onClick={() => void save("activate")}>{t("agents.builder.saveActivate")}</Button>
                )}
              </>
            ) : (
              <>
                <Button variant="outline" loading={saving === "draft"} disabled={!!saving} onClick={() => void save("draft")}>{t("agents.builder.saveDraft")}</Button>
                <Button loading={saving === "activate"} disabled={!!saving} icon={<Check className="size-4" />} onClick={() => void save("activate")}>{t("agents.builder.saveActivate")}</Button>
              </>
            )}
          </div>
        </div>
      </div>

      <TemplateDialog open={tplOpen} onClose={() => setTplOpen(false)} onPick={applyTemplate} />
    </div>
  );
}

function PreviewCard({ c, slug, lookups: lk }: { c: AgentDefinitionInput; slug: string | null; lookups: BuilderLookups }) {
  const { t, locale } = useApp();
  const dept = lk.departments.find((d) => d.key === c.office.departmentKey);
  const toolMap = new Map(lk.tools.map((x) => [x.name, x]));
  const skillMap = new Map(lk.skills.map((s) => [s.key, s]));
  const byLevel = [1, 2, 3, 4].map((l) => c.tools.filter((n) => toolMap.get(n)?.riskLevel === l).length);
  const external = c.tools.filter((n) => toolMap.get(n)?.riskLevel === 4);
  const v = lk.validation;
  const model = c.ai.model ? lk.models?.models.find((m) => m.id === c.ai.model)?.displayName ?? c.ai.model : t("agents.builder.ai.default");
  return (
    <Card className="overflow-hidden">
      <div className="h-16" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${c.color} 40%, transparent), color-mix(in srgb, ${dept?.color ?? c.color} 15%, transparent))` }} aria-hidden />
      <div className="-mt-10 px-4 pb-4">
        <AgentFace color={c.color} appearance={c.office.appearance} name={c.nameEn} size="xl" className="shadow-card" />
        <p className="mt-2 text-xl font-semibold text-fg" dir="rtl" lang="ar">{c.nameAr || <span className="text-fg-3">{t("agents.builder.preview.noNameAr")}</span>}</p>
        <p className="text-sm text-fg-2" dir="ltr">{c.nameEn || <span className="text-fg-3">{t("agents.builder.preview.noNameEn")}</span>}</p>
        <p className="mt-0.5 font-mono text-[11.5px] text-fg-3" dir="ltr">{slug ?? (slugPreview(c.nameEn) || "—")}</p>
        <p className="mt-2 text-[13px] font-medium text-fg-2">{localRole(c, locale) || "—"}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {dept ? <Badge tone="neutral"><span className="size-2 rounded-full" style={{ background: dept.color }} aria-hidden />{localDept(dept, locale)}</Badge>
            : <Badge tone="warning">{t("agents.builder.preview.noDepartment")}</Badge>}
          <Badge tone="neutral">{t(`agents.tier.${c.ai.tier}`)}</Badge>
          <Badge tone="neutral"><Bot className="size-3" />{model}</Badge>
          {!c.office.visible && <Badge tone="neutral">{t("agents.builder.preview.hidden")}</Badge>}
        </div>

        <div className="mt-4 space-y-3 border-t border-border pt-3 text-[13px]">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">{t("agents.builder.section.skills")}</p>
            {c.skills.length ? <ChipRow items={c.skills.map((s) => { const r = skillMap.get(s.key); return `${r ? localSkill(r, locale) : s.key}${s.mandatory ? " ★" : ""}`; })} max={6} tone="accent" />
              : <p className="text-fg-3">{t("agents.builder.skills.none")}</p>}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">{t("agents.builder.preview.risk")}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-fg-3">{t("agents.builder.perm.maxRisk")}:</span><RiskBadge level={c.permissions.maxRiskLevel} />
            </div>
            <p className="mt-1 text-fg-2">{t("agents.builder.preview.toolsByLevel", { total: c.tools.length, l1: byLevel[0], l2: byLevel[1], l3: byLevel[2], l4: byLevel[3] })}</p>
            {external.length > 0 && <p className="mt-1 text-danger">{t("agents.builder.preview.external", { list: external.join(", ") })}</p>}
            {c.permissions.alwaysApproveModify && byLevel[2] > 0 && <p className="mt-1 text-warning">{t("agents.builder.perm.alwaysApproveShort")}</p>}
          </div>
          <div aria-live="polite">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">{t("agents.builder.preview.validation")}</p>
            {!v ? <p className="text-fg-3">{lk.validating ? t("agents.builder.validating") : "—"}</p>
              : v.errors.length === 0 && v.warnings.length === 0 && v.missingTools.length === 0 && v.missingSkills.length === 0
                ? <p className="inline-flex items-center gap-1 text-success"><Check className="size-3.5" />{t("agents.builder.preview.valid")}</p>
                : (
                  <ul className="space-y-0.5">
                    {v.errors.length > 0 && <li className="text-danger">{t("agents.builder.preview.errors", { n: v.errors.length })}</li>}
                    {v.warnings.length > 0 && <li className="text-warning">{t("agents.builder.preview.warnings", { n: v.warnings.length })}</li>}
                    {(v.missingTools.length > 0 || v.missingSkills.length > 0) && <li className="text-warning">{t("agents.builder.preview.missing", { n: v.missingTools.length + v.missingSkills.length })}</li>}
                  </ul>
                )}
            {v && v.warnings.length > 0 && (
              <ul className="mt-1.5 space-y-1 text-[12px] text-fg-3">{v.warnings.slice(0, 4).map((w, i) => <li key={i}>• {w.message}</li>)}</ul>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

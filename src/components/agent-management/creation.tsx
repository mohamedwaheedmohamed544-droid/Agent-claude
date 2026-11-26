"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, LayoutTemplate, Pencil, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Alert, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, LoadingBlock, Select, Textarea, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { AgentFace } from "./shared";
import { ConfigSummary, ValidationList } from "./config-summary";
import { SkillDialog, type SkillDraft } from "./skill-dialog";
import {
  normalizeConfig, stashDraft, type AgentDefinitionInput, type AgentListResponse, type AgentRecord, type AgentValidation,
  type DepartmentRecord, type SkillRecord, type ToolInfo,
} from "./types";
import type { AgentDraftProposal, TemplateRecord } from "@/lib/agents/types";

/** Lookups shared by the preview dialogs; only fetched while a dialog is open. */
function useLookups(open: boolean) {
  const skills = useApi<{ skills: SkillRecord[] }>(open ? "/api/skills" : null);
  const tools = useApi<{ tools: ToolInfo[] }>(open ? "/api/tools" : null);
  const departments = useApi<{ departments: DepartmentRecord[] }>(open ? "/api/departments" : null);
  const agents = useApi<AgentListResponse>(open ? "/api/agents?lifecycle=all" : null);
  const agentsBySlug = useMemo(() => new Map((agents.data?.agents ?? []).map((a) => [a.slug, a])), [agents.data]);
  return { skills: skills.data?.skills, tools: tools.data?.tools, departments: departments.data?.departments, agentsBySlug, reloadSkills: skills.reload };
}

// ───────────── Natural-language creation ─────────────

/**
 * "Ask راشد to design an agent": POST /api/agents/draft returns a proposal that is never saved. The admin reviews
 * it, can create missing skills, then either opens it in the builder or explicitly clicks "Create agent".
 */
export function NaturalLanguageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useApp();
  const router = useRouter();
  const lookups = useLookups(open);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"draft" | "create" | "validate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AgentDraftProposal | null>(null);
  const [config, setConfig] = useState<AgentDefinitionInput | null>(null);
  const [validation, setValidation] = useState<AgentValidation | null>(null);
  const [skillFor, setSkillFor] = useState<{ capability: string; draft: Partial<SkillDraft> } | null>(null);
  const [created, setCreated] = useState<string[]>([]);

  const reset = () => { setProposal(null); setConfig(null); setValidation(null); setError(null); setCreated([]); };
  const close = () => { reset(); setPrompt(""); onClose(); };

  const draft = async () => {
    if (!prompt.trim()) return;
    setBusy("draft"); setError(null);
    try {
      const p = await api<AgentDraftProposal>("/api/agents/draft", { body: { prompt: prompt.trim() } });
      setProposal(p); setConfig(normalizeConfig(p.config)); setValidation(p.validation); setCreated([]);
    } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  };

  const revalidate = async (c: AgentDefinitionInput) => {
    setBusy("validate");
    try { setValidation(await api<AgentValidation>("/api/agents/validate", { body: { config: c } })); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(null); }
  };

  const onSkillCreated = (skill: SkillRecord) => {
    if (!config || !skillFor) return;
    const next = { ...config, skills: config.skills.some((s) => s.key === skill.key) ? config.skills : [...config.skills, { key: skill.key, mandatory: false }] };
    setConfig(next);
    setCreated((c) => [...c, skillFor.capability]);
    void lookups.reloadSkills();
    void revalidate(next);
  };

  const create = async () => {
    if (!config) return;
    setBusy("create"); setError(null);
    try {
      const res = await api<{ agent: AgentRecord }>("/api/agents", { body: { config, lifecycle: "active" } });
      close();
      router.push(`/agents/${res.agent.slug}?created=1`);
    } catch (err) { setError((err as Error).message); setBusy(null); }
  };

  const editInBuilder = () => {
    if (!config) return;
    if (!stashDraft(config, "nl")) { setError(t("agents.nl.storageError")); return; }
    close();
    router.push("/agents/new?source=draft");
  };

  const errors = validation?.errors ?? [];
  return (
    <>
      <Dialog open={open} onClose={close} size="xl" title={<span className="inline-flex items-center gap-2"><Wand2 className="size-4 text-accent" />{t("agents.nl.title")}</span>}
        description={t("agents.nl.subtitle")}
        footer={proposal && config ? (
          <>
            <Button variant="ghost" onClick={reset}>{t("agents.nl.startOver")}</Button>
            <Button variant="outline" icon={<Pencil className="size-4" />} onClick={editInBuilder}>{t("agents.nl.editInBuilder")}</Button>
            <Button icon={<CheckCircle2 className="size-4" />} loading={busy === "create"} disabled={busy === "validate" || errors.length > 0} onClick={() => void create()}>{t("agents.nl.create")}</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>{t("action.cancel")}</Button>
            <Button icon={<Sparkles className="size-4" />} loading={busy === "draft"} disabled={!prompt.trim()} onClick={() => void draft()}>{t("agents.nl.generate")}</Button>
          </>
        )}>
        {!proposal || !config ? (
          <div className="space-y-3">
            <Field label={t("agents.nl.promptLabel")} hint={t("agents.nl.promptHint")}>
              <Textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("agents.nl.placeholder")} autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void draft(); }} />
            </Field>
            {busy === "draft" && <p className="text-[13px] text-fg-3" role="status">{t("agents.nl.thinking")}</p>}
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
            <div className="space-y-4">
              <Alert tone="info" title={t("agents.nl.notSaved")}>{t("agents.nl.notSavedBody")}</Alert>
              {proposal.rationale && (
                <section>
                  <h3 className="mb-1.5 text-[13px] font-semibold text-fg">{t("agents.nl.rationale")}</h3>
                  <p className="whitespace-pre-line text-[13px] leading-relaxed text-fg-2">{proposal.rationale}</p>
                </section>
              )}
              {proposal.missingCapabilities.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-[13px] font-semibold text-fg">{t("agents.nl.missing")}</h3>
                  <ul className="space-y-2">
                    {proposal.missingCapabilities.map((m) => {
                      const done = created.includes(m.capability);
                      return (
                        <li key={m.capability} className="rounded-xl border border-border p-3">
                          <p className="text-[13px] font-medium text-fg">{m.capability}</p>
                          <p className="mt-0.5 text-[12.5px] text-fg-3">{m.suggestedSkill.name} — {m.suggestedSkill.description}</p>
                          {m.suggestedSkill.requiredTools.length > 0 && <p className="mt-1 font-mono text-[11.5px] text-fg-3" dir="ltr">{m.suggestedSkill.requiredTools.join(", ")}</p>}
                          <div className="mt-2">
                            {done ? <Badge tone="success"><CheckCircle2 className="size-3" />{t("agents.nl.skillCreated")}</Badge> : (
                              <Button size="sm" variant="outline" onClick={() => setSkillFor({
                                capability: m.capability,
                                draft: { key: m.suggestedSkill.key, name: m.suggestedSkill.name, nameAr: "", description: m.suggestedSkill.description, instructions: m.suggestedSkill.description, requiredTools: m.suggestedSkill.requiredTools },
                              })}>{t("agents.nl.createSkill")}</Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {validation && (validation.errors.length > 0 || validation.warnings.length > 0 || validation.missingTools.length > 0 || validation.missingSkills.length > 0) && (
                <section>
                  <h3 className="mb-1.5 text-[13px] font-semibold text-fg">{t("agents.nl.validation")}</h3>
                  <ValidationList errors={validation.errors} warnings={validation.warnings} />
                  {validation.missingTools.length > 0 && <p className="mt-2 text-[12.5px] text-warning">{t("agents.builder.skills.missingTools", { list: validation.missingTools.join(", ") })}</p>}
                  {validation.missingSkills.length > 0 && <p className="mt-1 text-[12.5px] text-warning">{t("agents.builder.skills.missingSkills", { list: validation.missingSkills.join(", ") })}</p>}
                  {errors.length > 0 && <p className="mt-2 text-[12.5px] text-fg-3">{t("agents.nl.fixInBuilder")}</p>}
                </section>
              )}
              {error && <Alert tone="danger">{error}</Alert>}
            </div>
            <ConfigSummary config={config} skills={lookups.skills} tools={lookups.tools} departments={lookups.departments} agentsBySlug={lookups.agentsBySlug} />
          </div>
        )}
      </Dialog>
      <SkillDialog open={!!skillFor} onClose={() => setSkillFor(null)} initial={skillFor?.draft} onSaved={onSkillCreated} />
    </>
  );
}

// ───────────── Templates ─────────────

export function TemplateGallery({ onPick, manage, compact }: { onPick: (tpl: TemplateRecord) => void; manage?: boolean; compact?: boolean }) {
  const { t, locale, can } = useApp();
  const { data, error, loading, reload } = useApi<{ templates: TemplateRecord[] }>("/api/agent-templates");
  const [cat, setCat] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [delError, setDelError] = useState<string | null>(null);
  const templates = data?.templates ?? [];
  const cats = [...new Set(templates.map((x) => x.category).filter(Boolean))];
  const list = templates.filter((x) => !cat || x.category === cat);

  const remove = async (tpl: TemplateRecord) => {
    if (!window.confirm(t("agents.templates.deleteConfirm", { name: locale === "ar" ? tpl.nameAr || tpl.name : tpl.name }))) return;
    setBusy(tpl.key); setDelError(null);
    try { await api(`/api/agent-templates/${encodeURIComponent(tpl.key)}`, { method: "DELETE" }); await reload(); }
    catch (err) { setDelError((err as Error).message); } finally { setBusy(null); }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingBlock rows={3} />;
  if (!templates.length) return <EmptyState icon={<LayoutTemplate className="size-5" />} title={t("agents.templates.empty")} />;
  return (
    <div className="space-y-3">
      {cats.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("agents.templates.category")}>
          {["", ...cats].map((c) => (
            <button key={c || "all"} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}
              className={cx("rounded-full border px-2.5 py-1 text-[12.5px]", cat === c ? "border-accent bg-accent-soft text-accent-text" : "border-border text-fg-2 hover:bg-surface-2")}>
              {c ? c : t("agents.filter.all")}
            </button>
          ))}
        </div>
      )}
      {delError && <Alert tone="danger">{delError}</Alert>}
      <ul className={cx("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>
        {list.map((tpl) => {
          const c = normalizeConfig(tpl.config);
          return (
            <li key={tpl.key}>
              <Card className="flex h-full flex-col p-4">
                <div className="flex items-start gap-3">
                  <AgentFace color={c.color} appearance={c.office.appearance} name={tpl.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-fg">{locale === "ar" ? tpl.nameAr || tpl.name : tpl.name}</p>
                    <p className="truncate text-[12.5px] text-fg-3">{locale === "ar" ? tpl.name : tpl.nameAr}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={tpl.builtin ? "neutral" : "accent"}>{tpl.builtin ? t("agents.templates.builtin") : t("agents.templates.custom")}</Badge>
                      {tpl.category && <Badge tone="neutral">{tpl.category}</Badge>}
                    </div>
                  </div>
                </div>
                <p className="mt-2 line-clamp-3 flex-1 text-[13px] leading-relaxed text-fg-2">{tpl.description}</p>
                <p className="mt-2 text-[12px] text-fg-3">{t("agents.templates.contents", { skills: c.skills.length, tools: c.tools.length })}</p>
                <div className="mt-3 flex items-center gap-2">
                  {can("admin") && <Button size="sm" onClick={() => onPick(tpl)}>{t("agents.templates.use")}</Button>}
                  {manage && can("admin") && !tpl.builtin && (
                    <Button size="sm" variant="ghost" loading={busy === tpl.key} icon={<Trash2 className="size-4" />} onClick={() => void remove(tpl)} aria-label={t("action.delete")}>{t("action.delete")}</Button>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TemplateDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (tpl: TemplateRecord) => void }) {
  const { t } = useApp();
  return (
    <Dialog open={open} onClose={onClose} size="xl" title={t("agents.templates.galleryTitle")} description={t("agents.templates.gallerySubtitle")}>
      {open && <TemplateGallery compact onPick={(tpl) => { onPick(tpl); onClose(); }} />}
    </Dialog>
  );
}

// ───────────── Import ─────────────

interface ExportFile { format: "nexus-agent"; version: number; exportedAt?: string; config: AgentDefinitionInput }

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useApp();
  const router = useRouter();
  const lookups = useLookups(open);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: ExportFile } | null>(null);
  const [lifecycle, setLifecycle] = useState<"draft" | "active">("draft");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => { setFile(null); setError(null); setLifecycle("draft"); onClose(); };

  const onFile = async (f: File | undefined) => {
    setError(null); setFile(null);
    if (!f) return;
    if (f.size > 512_000) { setError(t("agents.import.tooLarge")); return; }
    try {
      const data = JSON.parse(await f.text()) as Partial<ExportFile>;
      if (data?.format !== "nexus-agent" || !data.config || typeof data.config !== "object") throw new Error("format");
      setFile({ name: f.name, data: data as ExportFile });
    } catch { setError(t("agents.import.invalid")); }
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const res = await api<{ agent: AgentRecord }>("/api/agents/import", { body: { data: file.data, lifecycle } });
      close();
      router.push(`/agents/${res.agent.slug}?created=1`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  };

  const openInBuilder = () => {
    if (!file) return;
    if (!stashDraft(normalizeConfig(file.data.config), "import")) { setError(t("agents.nl.storageError")); return; }
    close();
    router.push("/agents/new?source=draft");
  };

  return (
    <Dialog open={open} onClose={close} size="lg" title={t("agents.import.title")} description={t("agents.import.subtitle")}
      footer={<>
        <Button variant="ghost" onClick={close}>{t("action.cancel")}</Button>
        {file && <Button variant="outline" onClick={openInBuilder} icon={<Pencil className="size-4" />}>{t("agents.nl.editInBuilder")}</Button>}
        <Button disabled={!file} loading={busy} onClick={() => void submit()}>{t("agents.import.submit")}</Button>
      </>}>
      <div className="space-y-4">
        <input ref={input} type="file" accept="application/json,.json" className="sr-only" id="agent-import-file"
          onChange={(e) => void onFile(e.target.files?.[0])} />
        <label htmlFor="agent-import-file"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-4 py-6 text-center hover:bg-surface-2">
          <FileUp className="size-5 text-fg-3" />
          <span className="text-sm font-medium text-fg">{file ? file.name : t("agents.import.choose")}</span>
          <span className="text-[12.5px] text-fg-3">{t("agents.import.hint")}</span>
        </label>
        {error && <Alert tone="danger">{error}</Alert>}
        {file && (
          <>
            <Field label={t("agents.import.lifecycle")}>
              <Select value={lifecycle} onChange={(e) => setLifecycle(e.target.value as "draft" | "active")}>
                <option value="draft">{t("agents.lifecycle.draft")}</option>
                <option value="active">{t("agents.lifecycle.active")}</option>
              </Select>
            </Field>
            <ConfigSummary config={normalizeConfig(file.data.config)} skills={lookups.skills} tools={lookups.tools} departments={lookups.departments} agentsBySlug={lookups.agentsBySlug} />
          </>
        )}
      </div>
    </Dialog>
  );
}

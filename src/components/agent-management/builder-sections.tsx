"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Info, Plus, Search, ShieldAlert, Star, X } from "lucide-react";
import { Alert, Badge, Button, Dialog, Field, Input, RiskBadge, Select, Switch, Textarea, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { tOr } from "@/components/analytics/format";
import { ApprovalLevels } from "@/components/agents/approval-levels";
import { AVATAR_PRESETS } from "@/lib/office/avatars";
import type { CharacterAppearance, LayoutMeetingRoom } from "@/lib/office/types";
import type { AgentPermissions, AvatarAnimation, ModelTier } from "@/lib/agents/types";
import { AgentFace, AgentMultiPick, ChipsInput, ListInput } from "./shared";
import { SkillDialog } from "./skill-dialog";
import {
  TOOL_CATEGORY_ORDER, localDept, localName, localSkill, slugPreview,
  type AgentDefinitionInput, type AgentListItem, type AgentValidation, type DepartmentRecord, type ModelsResponse, type SkillRecord, type ToolInfo,
} from "./types";

export interface BuilderLookups {
  skills: SkillRecord[];
  tools: ToolInfo[];
  models: ModelsResponse | null;
  agents: AgentListItem[];
  departments: DepartmentRecord[];
  meetingRooms: LayoutMeetingRoom[];
  validation: AgentValidation | null;
  validating: boolean;
  reloadSkills: () => Promise<void>;
  reloadDepartments: () => Promise<void>;
}

export interface SectionProps {
  c: AgentDefinitionInput;
  set: (fn: (c: AgentDefinitionInput) => AgentDefinitionInput) => void;
  err: (field: string) => string | undefined;
  lk: BuilderLookups;
  slug: string | null;
}

function Group({ title, description, children }: { title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <div aria-hidden="true">
        <h3 className="text-[14px] font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-3">{description}</p>}
      </div>
      {children}
    </fieldset>
  );
}

function SwitchRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-fg">{label}</p>
        {hint && <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-3">{hint}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  );
}

// ───────────── 1. Identity ─────────────

const SKINS = ["#f1d2bd", "#e0b394", "#c99a7e", "#c69276", "#b98466", "#a9785d", "#9c6d55", "#7d5640", "#5e3f2e"];
const OUTFITS: CharacterAppearance["outfit"][] = ["thobe", "suit", "abaya", "blazer", "shirt", "turtleneck", "cardigan"];
const HEADWEAR: CharacterAppearance["headwear"][] = ["none", "ghutra", "shemagh", "hijab"];
const ACCESSORIES: CharacterAppearance["accessory"][] = ["none", "glasses", "headset", "tablet", "pen", "watch", "laptop", "folder"];
const GENDERS: CharacterAppearance["gender"][] = ["neutral", "female", "male"];

export function IdentitySection({ c, set, err, slug }: SectionProps) {
  const { t, locale } = useApp();
  const id = slug ?? slugPreview(c.nameEn);
  const ap = c.office.appearance;
  const setAp = (patch: Partial<CharacterAppearance>) => set((x) => ({ ...x, office: { ...x.office, avatarPreset: "custom", appearance: { ...x.office.appearance, ...patch } } }));
  const custom = c.office.avatarPreset === "custom";

  return (
    <div className="space-y-6">
      <Group title={t("agents.builder.identity.names")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("agents.builder.nameAr")} error={err("nameAr")}>
            <Input dir="rtl" lang="ar" value={c.nameAr} onChange={(e) => set((x) => ({ ...x, nameAr: e.target.value }))} aria-invalid={!!err("nameAr")} placeholder="مثال: مشتري" required />
          </Field>
          <Field label={t("agents.builder.nameEn")} error={err("nameEn")} hint={slug ? undefined : t("agents.builder.nameEnHint")}>
            <Input dir="ltr" value={c.nameEn} onChange={(e) => set((x) => ({ ...x, nameEn: e.target.value }))} aria-invalid={!!err("nameEn")} placeholder="e.g. Mushtari" required />
          </Field>
        </div>
        <Field label={t("agents.builder.agentId")} hint={slug ? t("agents.builder.agentIdFixed") : t("agents.builder.agentIdPreview")} error={err("slug")}>
          <Input dir="ltr" readOnly value={id || "—"} className="bg-surface-2 font-mono text-fg-2" aria-readonly="true" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("agents.builder.roleAr")} error={err("roleTitleAr")}>
            <Input dir="rtl" lang="ar" value={c.roleTitleAr} onChange={(e) => set((x) => ({ ...x, roleTitleAr: e.target.value }))} aria-invalid={!!err("roleTitleAr")} />
          </Field>
          <Field label={t("agents.builder.roleEn")} error={err("roleTitle")}>
            <Input dir="ltr" value={c.roleTitle} onChange={(e) => set((x) => ({ ...x, roleTitle: e.target.value }))} aria-invalid={!!err("roleTitle")} />
          </Field>
          <Field label={t("agents.builder.descAr")} error={err("descriptionAr")}>
            <Textarea dir="rtl" lang="ar" rows={3} value={c.descriptionAr} onChange={(e) => set((x) => ({ ...x, descriptionAr: e.target.value }))} />
          </Field>
          <Field label={t("agents.builder.descEn")} error={err("description")}>
            <Textarea dir="ltr" rows={3} value={c.description} onChange={(e) => set((x) => ({ ...x, description: e.target.value }))} />
          </Field>
        </div>
        <Field label={t("agents.builder.personality")} hint={t("agents.builder.personalityHint")} error={err("personality")}>
          <Textarea rows={2} value={c.personality} onChange={(e) => set((x) => ({ ...x, personality: e.target.value }))} />
        </Field>
      </Group>

      <Group title={t("agents.builder.identity.avatar")} description={t("agents.builder.identity.avatarHint")}>
        <div role="radiogroup" aria-label={t("agents.builder.identity.avatar")} className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {AVATAR_PRESETS.map((p) => {
            const on = c.office.avatarPreset === p.key;
            return (
              <button key={p.key} type="button" role="radio" aria-checked={on} title={locale === "ar" ? p.labelAr : p.label}
                onClick={() => set((x) => ({ ...x, office: { ...x.office, avatarPreset: p.key, appearance: { ...p.appearance } } }))}
                className={cx("flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition-colors", on ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}>
                <AgentFace color={c.color} appearance={p.appearance} size="md" />
                <span className="line-clamp-2 text-[11px] leading-tight text-fg-2">{locale === "ar" ? p.labelAr : p.label}</span>
                {p.appearance.gender === "neutral" && <span className="text-[10px] text-fg-3">{t("agents.builder.avatar.neutral")}</span>}
              </button>
            );
          })}
          <button type="button" role="radio" aria-checked={custom} onClick={() => setAp({})}
            className={cx("flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-2 text-center", custom ? "border-accent bg-accent-soft" : "border-border-strong hover:bg-surface-2")}>
            <span className="grid size-12 place-items-center rounded-xl bg-surface-2 text-fg-3"><Plus className="size-5" /></span>
            <span className="text-[11px] text-fg-2">{t("agents.builder.avatar.custom")}</span>
          </button>
        </div>

        {custom && (
          <div className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
            <Field label={t("agents.builder.avatar.gender")}>
              <Select value={ap.gender} onChange={(e) => setAp({ gender: e.target.value as CharacterAppearance["gender"] })}>
                {GENDERS.map((g) => <option key={g} value={g}>{t(`agents.builder.avatar.gender.${g}`)}</option>)}
              </Select>
            </Field>
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-fg-2" id="skin-label">{t("agents.builder.avatar.skin")}</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="skin-label">
                {SKINS.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={ap.skin === s} aria-label={s} onClick={() => setAp({ skin: s })}
                    className={cx("size-7 rounded-full border-2", ap.skin === s ? "border-accent" : "border-transparent")} style={{ background: s }} />
                ))}
              </div>
            </div>
            <Field label={t("agents.builder.avatar.outfit")}>
              <Select value={ap.outfit} onChange={(e) => setAp({ outfit: e.target.value as CharacterAppearance["outfit"] })}>
                {OUTFITS.map((o) => <option key={o} value={o}>{t(`agents.builder.avatar.outfit.${o}`)}</option>)}
              </Select>
            </Field>
            <ColorField label={t("agents.builder.avatar.outfitColor")} value={ap.outfitColor} onChange={(v) => setAp({ outfitColor: v })} />
            <Field label={t("agents.builder.avatar.headwear")}>
              <Select value={ap.headwear} onChange={(e) => setAp({ headwear: e.target.value as CharacterAppearance["headwear"] })}>
                {HEADWEAR.map((o) => <option key={o} value={o}>{t(`agents.builder.avatar.headwear.${o}`)}</option>)}
              </Select>
            </Field>
            {ap.headwear !== "none"
              ? <ColorField label={t("agents.builder.avatar.headwearColor")} value={ap.headwearColor} onChange={(v) => setAp({ headwearColor: v })} />
              : <ColorField label={t("agents.builder.avatar.hairColor")} value={ap.hairColor} onChange={(v) => setAp({ hairColor: v })} />}
            <Field label={t("agents.builder.avatar.accessory")}>
              <Select value={ap.accessory} onChange={(e) => setAp({ accessory: e.target.value as CharacterAppearance["accessory"] })}>
                {ACCESSORIES.map((o) => <option key={o} value={o}>{t(`agents.builder.avatar.accessory.${o}`)}</option>)}
              </Select>
            </Field>
            <Field label={t("agents.builder.avatar.height", { n: ap.height.toFixed(2) })}>
              <input type="range" min={1.6} max={1.88} step={0.01} value={ap.height} onChange={(e) => setAp({ height: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
            </Field>
          </div>
        )}
        <ColorField label={t("agents.builder.avatar.color")} hint={t("agents.builder.avatar.colorHint")} value={c.color} onChange={(v) => set((x) => ({ ...x, color: v }))} error={err("color")} />
      </Group>
    </div>
  );
}

function ColorField({ label, hint, value, onChange, error }: { label: string; hint?: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field label={label} hint={hint} error={error}>
      <div className="flex items-center gap-2">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} aria-label={label}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1" />
        <Input dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} className="w-28 font-mono" aria-label={`${label} (hex)`} />
      </div>
    </Field>
  );
}

// ───────────── 2. Responsibilities ─────────────

export function ResponsibilitiesSection({ c, set, err }: SectionProps) {
  const { t } = useApp();
  const r = c.responsibilities;
  const setR = <K extends keyof typeof r>(k: K, v: (typeof r)[K]) => set((x) => ({ ...x, responsibilities: { ...x.responsibilities, [k]: v } }));
  return (
    <div className="space-y-5">
      <Field label={t("agents.builder.resp.main")} hint={t("agents.builder.resp.mainHint")} error={err("responsibilities.main")}>
        <Textarea rows={2} value={r.main} onChange={(e) => setR("main", e.target.value)} aria-invalid={!!err("responsibilities.main")} />
      </Field>
      <Field label={t("agents.builder.resp.instructions")} hint={t("agents.builder.resp.instructionsHint")} error={err("responsibilities.instructions")}>
        <Textarea rows={6} value={r.instructions} onChange={(e) => setR("instructions", e.target.value)} />
      </Field>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-fg-2" id="exp-label">{t("agents.builder.resp.expertise")}</span>
        <ChipsInput value={r.expertise} onChange={(v) => setR("expertise", v)} placeholder={t("agents.builder.resp.expertisePlaceholder")} />
        {err("responsibilities.expertise") && <p className="mt-1 text-xs text-danger">{err("responsibilities.expertise")}</p>}
      </div>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{t("agents.builder.resp.deliverables")}</span>
        <ListInput value={r.deliverables} onChange={(v) => setR("deliverables", v)} addLabel={t("agents.builder.resp.deliverable")} placeholder={t("agents.builder.resp.deliverablePlaceholder")} />
      </div>
      <Field label={t("agents.builder.resp.methodology")} error={err("responsibilities.methodology")}>
        <Textarea rows={3} value={r.methodology} onChange={(e) => setR("methodology", e.target.value)} />
      </Field>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{t("agents.builder.resp.success")}</span>
        <ListInput value={r.successCriteria} onChange={(v) => setR("successCriteria", v)} addLabel={t("agents.builder.resp.criterion")} placeholder={t("agents.builder.resp.criterionPlaceholder")} />
      </div>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{t("agents.builder.resp.capabilities")}</span>
        <ChipsInput value={c.capabilities} onChange={(v) => set((x) => ({ ...x, capabilities: v }))} placeholder={t("agents.builder.resp.capabilitiesPlaceholder")} />
        <p className="mt-1 text-xs text-fg-3">{t("agents.builder.resp.capabilitiesHint")}</p>
      </div>
    </div>
  );
}

// ───────────── 3. AI configuration ─────────────

const TIERS: ModelTier[] = ["fast", "standard", "advanced"];

export function AISection({ c, set, err, lk }: SectionProps) {
  const { t } = useApp();
  const ai = c.ai;
  const setAI = <K extends keyof typeof ai>(k: K, v: (typeof ai)[K]) => set((x) => ({ ...x, ai: { ...x.ai, [k]: v } }));
  const setMem = <K extends keyof typeof ai.memory>(k: K, v: (typeof ai.memory)[K]) => set((x) => ({ ...x, ai: { ...x.ai, memory: { ...x.ai.memory, [k]: v } } }));
  const models = lk.models?.models ?? [];
  const unknownModel = ai.model && lk.models && !models.some((m) => m.id === ai.model);
  return (
    <div className="space-y-6">
      <Group title={t("agents.builder.ai.model")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("agents.builder.ai.provider")} hint={t("agents.builder.ai.providerHint")}>
            <Input value="Anthropic" readOnly disabled />
          </Field>
          <Field label={t("agents.builder.ai.modelLabel")} error={err("ai.model")}
            hint={lk.models ? (lk.models.checked ? t("agents.builder.ai.modelChecked") : t("agents.builder.ai.modelUnchecked")) : undefined}>
            <Select value={ai.model ?? ""} onChange={(e) => setAI("model", e.target.value || null)}>
              <option value="">{t("agents.builder.ai.workspaceDefault", { model: lk.models?.defaultModel ?? "—" })}</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
              {unknownModel && <option value={ai.model!}>{ai.model}</option>}
            </Select>
          </Field>
        </div>
        {unknownModel && <Alert tone="warning">{t("agents.builder.ai.unknownModel", { model: ai.model! })}</Alert>}
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-fg-2" id="tier-label">{t("agents.builder.ai.tier")}</span>
          <div role="radiogroup" aria-labelledby="tier-label" className="grid gap-2 sm:grid-cols-3">
            {TIERS.map((tier) => {
              const on = ai.tier === tier;
              return (
                <button key={tier} type="button" role="radio" aria-checked={on} onClick={() => setAI("tier", tier)}
                  className={cx("rounded-xl border p-3 text-start transition-colors", on ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}>
                  <p className={cx("text-sm font-medium", on ? "text-accent-text" : "text-fg")}>{t(`agents.tier.${tier}`)}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-3">{t(`agents.tier.${tier}.desc`)}</p>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-fg-3">{t("agents.builder.ai.tierHint")}</p>
        </div>
        <Field label={t("agents.builder.ai.temperature")} hint={t("agents.builder.ai.temperatureHint")}>
          <Input type="number" value="" placeholder="—" disabled className="w-32" />
        </Field>
      </Group>

      <Group title={t("agents.builder.ai.systemInstructions")} description={t("agents.builder.ai.systemInstructionsHint")}>
        <Textarea rows={6} value={ai.systemInstructions} onChange={(e) => setAI("systemInstructions", e.target.value)} aria-label={t("agents.builder.ai.systemInstructions")} className="font-mono text-[13px]" />
        {err("ai.systemInstructions") && <p className="text-xs text-danger">{err("ai.systemInstructions")}</p>}
      </Group>

      <Group title={t("agents.builder.ai.memory")} description={t("agents.builder.ai.memoryHint")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <SwitchRow label={t("agents.builder.ai.useWorkspaceMemory")} checked={ai.memory.useWorkspaceMemory} onChange={(v) => setMem("useWorkspaceMemory", v)} />
          <SwitchRow label={t("agents.builder.ai.useAgentMemory")} checked={ai.memory.useAgentMemory} onChange={(v) => setMem("useAgentMemory", v)} />
          <SwitchRow label={t("agents.builder.ai.useKnowledgeBase")} checked={ai.memory.useKnowledgeBase} onChange={(v) => setMem("useKnowledgeBase", v)} />
        </div>
        <Field label={t("agents.builder.ai.maxContext")} hint={t("agents.builder.ai.maxContextHint")} error={err("ai.memory.maxContextTokens")}>
          <Input type="number" min={2000} max={200000} step={1000} value={ai.memory.maxContextTokens} className="w-40"
            onChange={(e) => setMem("maxContextTokens", Math.max(0, Math.round(Number(e.target.value) || 0)))} />
        </Field>
      </Group>
    </div>
  );
}

// ───────────── 4. Skills ─────────────

export function SkillsSection({ c, set, err, lk }: SectionProps) {
  const { t, locale } = useApp();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [creating, setCreating] = useState(false);
  const byKey = useMemo(() => new Map(lk.skills.map((s) => [s.key, s])), [lk.skills]);
  const toolMap = useMemo(() => new Map(lk.tools.map((x) => [x.name, x])), [lk.tools]);
  const assigned = new Set(c.skills.map((s) => s.key));
  const cats = [...new Set(lk.skills.map((s) => s.category))].sort();
  const available = lk.skills.filter((s) => !assigned.has(s.key) && (!cat || s.category === cat)
    && (!q.trim() || `${s.name} ${s.nameAr} ${s.description} ${s.key}`.toLowerCase().includes(q.trim().toLowerCase())));
  const v = lk.validation;

  const assign = (key: string) => set((x) => (x.skills.some((s) => s.key === key) ? x : { ...x, skills: [...x.skills, { key, mandatory: false }] }));
  const addTool = (name: string) => set((x) => ({ ...x, tools: x.tools.includes(name) ? x.tools : [...x.tools, name] }));

  return (
    <div className="space-y-6">
      <Alert tone="info">{t("agents.skills.grantNote")}</Alert>

      <Group title={t("agents.builder.skills.assigned", { n: c.skills.length })}>
        {c.skills.length === 0 ? <p className="text-[13px] text-fg-3">{t("agents.builder.skills.none")}</p> : (
          <ul className="space-y-2">
            {c.skills.map((a) => {
              const s = byKey.get(a.key);
              const missTools = (s?.requiredTools ?? []).filter((x) => !c.tools.includes(x));
              const missDeps = (s?.dependsOn ?? []).filter((x) => !assigned.has(x));
              return (
                <li key={a.key} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{s ? localSkill(s, locale) : a.key}</p>
                      {s ? <p className="truncate text-[12px] text-fg-3">{s.description}</p> : <p className="text-[12px] text-warning">{t("agents.builder.skills.unknown")}</p>}
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
                      <input type="checkbox" checked={a.mandatory} className="size-4 accent-[var(--accent)]"
                        onChange={(e) => set((x) => ({ ...x, skills: x.skills.map((k) => (k.key === a.key ? { ...k, mandatory: e.target.checked } : k)) }))} />
                      <Star className="size-3.5" aria-hidden />{t("agents.builder.skills.mandatory")}
                    </label>
                    <Button type="button" size="icon" variant="ghost" aria-label={t("agents.common.removeItem", { item: s ? localSkill(s, locale) : a.key })}
                      onClick={() => set((x) => ({ ...x, skills: x.skills.filter((k) => k.key !== a.key) }))}><X className="size-4" /></Button>
                  </div>
                  {(missTools.length > 0 || missDeps.length > 0) ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                      <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                      {missTools.map((x) => <Badge key={x} tone="warning"><span dir="ltr" className="font-mono">{x}</span></Badge>)}
                      {missDeps.map((x) => <Badge key={x} tone="warning">{byKey.get(x) ? localSkill(byKey.get(x)!, locale) : x}</Badge>)}
                    </div>
                  ) : s && (s.requiredTools.length > 0 || s.dependsOn.length > 0) ? (
                    <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-success"><Check className="size-3.5" />{t("agents.builder.skills.depsOk")}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {err("skills") && <p className="text-xs text-danger">{err("skills")}</p>}
      </Group>

      {v && (v.missingTools.length > 0 || v.missingSkills.length > 0) && (
        <Group title={t("agents.builder.skills.missingTitle")} description={t("agents.builder.skills.missingHint")}>
          <ul className="space-y-2">
            {v.missingTools.map((name) => {
              const tool = toolMap.get(name);
              const tooRisky = tool ? tool.riskLevel > c.permissions.maxRiskLevel : false;
              const restricted = tool ? c.permissions.restrictedCategories.includes(tool.category) : false;
              return (
                <li key={`t-${name}`} className="flex flex-wrap items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px]">
                  <span className="text-warning">{t("agents.builder.skills.missingTool")}</span>
                  <span className="font-mono text-fg" dir="ltr">{name}</span>
                  {tool && <RiskBadge level={tool.riskLevel} />}
                  <span className="ms-auto">
                    {!tool ? <span className="text-xs text-fg-3">{t("agents.builder.skills.toolUnavailable")}</span>
                      : tooRisky || restricted ? <span className="text-xs text-fg-2">{tooRisky ? t("agents.builder.skills.raiseRisk", { n: tool.riskLevel }) : t("agents.builder.skills.unrestrict")}</span>
                        : <Button type="button" size="sm" variant="outline" onClick={() => addTool(name)}>{t("agents.builder.skills.addTool")}</Button>}
                  </span>
                </li>
              );
            })}
            {v.missingSkills.map((key) => {
              const s = byKey.get(key);
              return (
                <li key={`s-${key}`} className="flex flex-wrap items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px]">
                  <span className="text-warning">{t("agents.builder.skills.missingSkill")}</span>
                  <span className="text-fg">{s ? localSkill(s, locale) : key}</span>
                  <span className="ms-auto">
                    {s ? <Button type="button" size="sm" variant="outline" onClick={() => assign(key)}>{t("agents.builder.skills.addSkill")}</Button>
                      : <span className="text-xs text-fg-3">{t("agents.builder.skills.unknown")}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Group>
      )}

      <Group title={t("agents.builder.skills.library")}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("agents.skills.search")} aria-label={t("agents.skills.search")} className="ps-9" />
          </div>
          <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t("agents.skills.category")} className="sm:w-48">
            <option value="">{t("agents.filter.allCategories")}</option>
            {cats.map((x) => <option key={x} value={x}>{tOr(t, `agents.skillCategory.${x}`, x)}</option>)}
          </Select>
          <Button type="button" variant="outline" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t("agents.skills.createNew")}</Button>
        </div>
        {available.length === 0 ? <p className="text-[13px] text-fg-3">{lk.skills.length ? t("agents.empty.noMatch") : t("agents.skills.empty")}</p> : (
          <ul className="grid max-h-[420px] gap-2 overflow-y-auto pe-1 sm:grid-cols-2">
            {available.map((s) => (
              <li key={s.key} className="flex items-start gap-2 rounded-xl border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{localSkill(s, locale)}</p>
                  <p className="line-clamp-2 text-[12px] text-fg-3">{s.description}</p>
                  {s.requiredTools.length > 0 && <p className="mt-1 truncate font-mono text-[11px] text-fg-3" dir="ltr">{s.requiredTools.join(", ")}</p>}
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => assign(s.key)} aria-label={t("agents.builder.skills.assignNamed", { name: localSkill(s, locale) })}>{t("agents.builder.skills.assign")}</Button>
              </li>
            ))}
          </ul>
        )}
      </Group>
      <SkillDialog open={creating} onClose={() => setCreating(false)} onSaved={(s) => { void lk.reloadSkills(); assign(s.key); }} />
    </div>
  );
}

// ───────────── 5. Tools & permissions ─────────────

export function ToolsSection({ c, set, err, lk }: SectionProps) {
  const { t } = useApp();
  const p = c.permissions;
  const [removed, setRemoved] = useState<string[]>([]);
  const toolMap = useMemo(() => new Map(lk.tools.map((x) => [x.name, x])), [lk.tools]);
  const categories = useMemo(() => {
    const cs = [...new Set(lk.tools.map((x) => x.category))];
    return cs.sort((a, b) => (TOOL_CATEGORY_ORDER.indexOf(a) + 100 * Number(!TOOL_CATEGORY_ORDER.includes(a))) - (TOOL_CATEGORY_ORDER.indexOf(b) + 100 * Number(!TOOL_CATEGORY_ORDER.includes(b))));
  }, [lk.tools]);

  /** Changing permissions removes tools that are no longer allowed, and tells the admin which ones. */
  const setPerm = (patch: Partial<AgentPermissions>) => {
    const perm = { ...c.permissions, ...patch };
    const allowed = (n: string) => { const tool = toolMap.get(n); return !tool || (tool.riskLevel <= perm.maxRiskLevel && !perm.restrictedCategories.includes(tool.category)); };
    setRemoved(c.tools.filter((n) => !allowed(n)));
    set((x) => ({ ...x, permissions: perm, tools: x.tools.filter(allowed) }));
  };
  const toggleTool = (name: string, on: boolean) => set((x) => ({ ...x, tools: on ? [...new Set([...x.tools, name])] : x.tools.filter((n) => n !== name) }));
  const unknown = c.tools.filter((n) => lk.tools.length && !toolMap.has(n));

  return (
    <div className="space-y-6">
      <Alert tone="warning" title={t("agents.builder.perm.l4Title")}>{t("agents.builder.perm.l4Body")}</Alert>

      <Group title={t("agents.builder.perm.maxRisk")} description={t("agents.builder.perm.maxRiskHint")}>
        <div role="radiogroup" aria-label={t("agents.builder.perm.maxRisk")} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {([1, 2, 3, 4] as const).map((l) => {
            const on = p.maxRiskLevel === l;
            return (
              <button key={l} type="button" role="radio" aria-checked={on} onClick={() => setPerm({ maxRiskLevel: l })}
                className={cx("rounded-xl border p-3 text-start transition-colors", on ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}>
                <RiskBadge level={l} />
                <p className="mt-1.5 text-[12px] leading-relaxed text-fg-3">{t(`agents.builder.perm.level${l}`)}</p>
              </button>
            );
          })}
        </div>
        {removed.length > 0 && <Alert tone="info">{t("agents.builder.perm.removedTools", { list: removed.join(", ") })}</Alert>}
        {err("permissions.maxRiskLevel") && <p className="text-xs text-danger">{err("permissions.maxRiskLevel")}</p>}
      </Group>

      <Group title={t("agents.builder.perm.policy")}>
        <SwitchRow label={t("agents.builder.perm.alwaysApprove")} hint={t("agents.builder.perm.alwaysApproveHint")} checked={p.alwaysApproveModify} onChange={(v) => setPerm({ alwaysApproveModify: v })} />
        <Field label={t("agents.builder.perm.memoryAccess")} hint={t("agents.builder.perm.memoryAccessHint")} error={err("permissions.memoryAccess")}>
          <Select value={p.memoryAccess} onChange={(e) => setPerm({ memoryAccess: e.target.value as "own" | "shared" })}>
            <option value="own">{t("agents.builder.perm.memory.own")}</option>
            <option value="shared">{t("agents.builder.perm.memory.shared")}</option>
          </Select>
        </Field>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-fg-2" id="restricted-label">{t("agents.builder.perm.restricted")}</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="restricted-label">
            {categories.map((cat) => {
              const on = p.restrictedCategories.includes(cat);
              return (
                <button key={cat} type="button" aria-pressed={on}
                  onClick={() => setPerm({ restrictedCategories: on ? p.restrictedCategories.filter((x) => x !== cat) : [...p.restrictedCategories, cat] })}
                  className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px] transition-colors", on ? "border-danger bg-danger-soft text-danger" : "border-border text-fg-2 hover:bg-surface-2")}>
                  {on && <ShieldAlert className="size-3" aria-hidden />}{tOr(t, `agents.category.${cat}`, cat)}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-fg-3">{t("agents.builder.perm.restrictedHint")}</p>
        </div>
      </Group>

      <Group title={t("agents.builder.tools.title", { n: c.tools.length })} description={t("agents.builder.tools.hint")}>
        {err("tools") && <p className="text-xs text-danger">{err("tools")}</p>}
        {unknown.length > 0 && <Alert tone="warning">{t("agents.builder.tools.unknown", { list: unknown.join(", ") })}</Alert>}
        <div className="space-y-4">
          {categories.map((cat) => {
            const list = lk.tools.filter((x) => x.category === cat).sort((a, b) => a.riskLevel - b.riskLevel || a.name.localeCompare(b.name));
            const restricted = p.restrictedCategories.includes(cat);
            return (
              <section key={cat} aria-label={tOr(t, `agents.category.${cat}`, cat)}>
                <h4 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-3">
                  {tOr(t, `agents.category.${cat}`, cat)}
                  {restricted && <Badge tone="danger">{t("agents.builder.tools.restricted")}</Badge>}
                </h4>
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {list.map((tool) => {
                    const above = tool.riskLevel > p.maxRiskLevel;
                    const disabled = above || restricted;
                    const on = c.tools.includes(tool.name);
                    return (
                      <li key={tool.name}>
                        <label className={cx("flex items-start gap-3 px-3 py-2.5", disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-surface-2/60")}>
                          <input type="checkbox" checked={on} disabled={disabled && !on} onChange={(e) => toggleTool(tool.name, e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[13px] text-fg" dir="ltr">{tool.name}</span>
                              <RiskBadge level={tool.riskLevel} />
                              {tool.riskLevel === 4 && <Badge tone="danger">{t("agents.approval.always")}</Badge>}
                              {tool.riskLevel === 3 && p.alwaysApproveModify && <Badge tone="warning">{t("agents.approval.required")}</Badge>}
                              {tool.integration && <Badge tone={tool.integrationConnected ? "success" : "neutral"}>{tool.integrationConnected ? t("status.connected") : t("status.disconnected")}</Badge>}
                              {tool.enabled === false && <Badge tone="neutral">{t("agents.tools.disabled")}</Badge>}
                            </span>
                            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-fg-3">{tool.description}</span>
                            {above && <span className="mt-0.5 block text-[12px] text-fg-3">{t("agents.builder.tools.aboveMax", { n: tool.riskLevel })}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </Group>

      <Group title={t("agents.levels.title")}>
        <ApprovalLevels />
      </Group>
    </div>
  );
}

// ───────────── 6. Relationships ─────────────

export function RelationshipsSection({ c, set, err, lk, slug }: SectionProps) {
  const { t, locale } = useApp();
  const r = c.relationships;
  const setR = <K extends keyof typeof r>(k: K, v: (typeof r)[K]) => set((x) => ({ ...x, relationships: { ...x.relationships, [k]: v } }));
  const others = lk.agents.filter((a) => a.slug !== slug && a.lifecycle !== "archived");
  const options = others.map((a) => ({ slug: a.slug, label: localName(a, locale), color: a.color }));
  const relErrors = (lk.validation?.errors ?? []).filter((e) => e.field.startsWith("relationships"));
  return (
    <div className="space-y-5">
      {relErrors.length > 0 && <Alert tone="danger" title={t("agents.builder.rel.invalid")}><ul className="list-disc ps-4">{relErrors.map((e, i) => <li key={i}>{e.message}</li>)}</ul></Alert>}
      <Field label={t("agents.builder.rel.supervisor")} hint={t("agents.builder.rel.supervisorHint")} error={err("relationships.supervisor")}>
        <Select value={r.supervisor ?? ""} onChange={(e) => setR("supervisor", e.target.value || null)}>
          <option value="">{t("agents.builder.rel.noSupervisor")}</option>
          {others.map((a) => <option key={a.slug} value={a.slug}>{localName(a, locale)}{a.lifecycle !== "active" ? ` (${t(`agents.lifecycle.${a.lifecycle}`)})` : ""}</option>)}
        </Select>
      </Field>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{t("agents.builder.rel.delegatesTo")}</span>
        <AgentMultiPick options={options} value={r.delegatesTo} onChange={(v) => setR("delegatesTo", v)} emptyText={t("agents.builder.rel.noAgents")} />
        <p className="mt-1 text-xs text-fg-3">{t("agents.builder.rel.delegatesToHint")}</p>
        {err("relationships.delegatesTo") && <p className="mt-1 text-xs text-danger">{err("relationships.delegatesTo")}</p>}
      </div>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{t("agents.builder.rel.collaboratesWith")}</span>
        <AgentMultiPick options={options} value={r.collaboratesWith} onChange={(v) => setR("collaboratesWith", v)} emptyText={t("agents.builder.rel.noAgents")} />
        {err("relationships.collaboratesWith") && <p className="mt-1 text-xs text-danger">{err("relationships.collaboratesWith")}</p>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <SwitchRow label={t("agents.builder.rel.canJoinMeetings")} checked={r.canJoinMeetings} onChange={(v) => setR("canJoinMeetings", v)} />
        <SwitchRow label={t("agents.builder.rel.canInitiate")} hint={t("agents.builder.rel.canInitiateHint")} checked={r.canInitiateCollaboration} onChange={(v) => setR("canInitiateCollaboration", v)} />
      </div>
    </div>
  );
}

// ───────────── 7. Office ─────────────

const ANIMATIONS: AvatarAnimation[] = ["working", "idle", "reading", "thinking"];

export function OfficeSection({ c, set, err, lk }: SectionProps) {
  const { t, locale } = useApp();
  const o = c.office;
  const setO = <K extends keyof typeof o>(k: K, v: (typeof o)[K]) => set((x) => ({ ...x, office: { ...x.office, [k]: v } }));
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-5">
      <Alert tone="info">{t("agents.builder.office.workstationNote")}</Alert>
      <Field label={t("agents.builder.office.department")} error={err("office.departmentKey")}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={o.departmentKey} onChange={(e) => setO("departmentKey", e.target.value)} aria-invalid={!!err("office.departmentKey")}>
            <option value="">{t("agents.builder.office.chooseDepartment")}</option>
            {lk.departments.map((d) => <option key={d.key} value={d.key}>{localDept(d, locale)}</option>)}
          </Select>
          <Button type="button" variant="outline" icon={<Plus className="size-4" />} onClick={() => setCreating(true)} className="shrink-0">{t("agents.departments.create")}</Button>
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("agents.builder.office.animation")} error={err("office.defaultAnimation")}>
          <Select value={o.defaultAnimation} onChange={(e) => setO("defaultAnimation", e.target.value as AvatarAnimation)}>
            {ANIMATIONS.map((a) => <option key={a} value={a}>{t(`agents.builder.office.anim.${a}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("agents.builder.office.meetingRoom")} error={err("office.preferredMeetingRoom")} hint={lk.meetingRooms.length ? undefined : t("agents.departments.noRooms")}>
          <Select value={o.preferredMeetingRoom ?? ""} onChange={(e) => setO("preferredMeetingRoom", e.target.value || null)}>
            <option value="">{t("agents.departments.anyRoom")}</option>
            {lk.meetingRooms.map((r) => <option key={r.key} value={r.key}>{locale === "ar" ? r.nameAr : r.name}</option>)}
          </Select>
        </Field>
      </div>
      <SwitchRow label={t("agents.builder.office.visible")} hint={t("agents.builder.office.visibleHint")} checked={o.visible} onChange={(v) => setO("visible", v)} />
      <QuickDepartmentDialog open={creating} onClose={() => setCreating(false)}
        onCreated={async (key) => { await lk.reloadDepartments(); setO("departmentKey", key); }} />
    </div>
  );
}

function QuickDepartmentDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (key: string) => Promise<void> }) {
  const { t } = useApp();
  const [v, setV] = useState({ name: "", nameAr: "", color: "#0d9488" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!v.name.trim() || !v.nameAr.trim()) { setError(t("agents.departments.nameRequired")); return; }
    setBusy(true); setError(null);
    try {
      const res = await api<{ department: DepartmentRecord }>("/api/departments", { body: { name: v.name.trim(), nameAr: v.nameAr.trim(), color: v.color } });
      await onCreated(res.department.key);
      setV({ name: "", nameAr: "", color: "#0d9488" });
      onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} size="sm" title={t("agents.departments.createTitle")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("action.cancel")}</Button><Button loading={busy} onClick={() => void submit()}>{t("action.create")}</Button></>}>
      <div className="space-y-3">
        <Field label={t("agents.departments.nameAr")}><Input dir="rtl" value={v.nameAr} onChange={(e) => setV((x) => ({ ...x, nameAr: e.target.value }))} /></Field>
        <Field label={t("agents.departments.nameEn")}><Input dir="ltr" value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} /></Field>
        <ColorField label={t("agents.departments.color")} value={v.color} onChange={(color) => setV((x) => ({ ...x, color }))} />
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="flex items-start gap-1.5 text-[12.5px] text-fg-3"><Info className="mt-0.5 size-3.5 shrink-0" />{t("agents.departments.layoutNote")}</p>
      </div>
    </Dialog>
  );
}

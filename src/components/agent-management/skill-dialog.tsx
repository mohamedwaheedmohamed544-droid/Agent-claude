"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api, ApiError } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { tOr } from "@/components/analytics/format";
import { ChipsInput } from "./shared";
import { SKILL_CATEGORIES, fieldErrorsOf, localSkill, type SkillRecord, type ToolInfo } from "./types";

export interface SkillDraft {
  key?: string; name: string; nameAr: string; description: string; category: string; instructions: string; requiredTools: string[]; dependsOn: string[];
}

const EMPTY: SkillDraft = { name: "", nameAr: "", description: "", category: "general", instructions: "", requiredTools: [], dependsOn: [] };

/**
 * Create (POST /api/skills) or edit a custom skill (PATCH /api/skills/:key). Skills only add instructions and
 * declare required tools — they never grant tools or permissions, which the dialog states explicitly.
 */
export function SkillDialog({ open, onClose, initial, editKey, onSaved }: {
  open: boolean; onClose: () => void; initial?: Partial<SkillDraft>; editKey?: string; onSaved: (skill: SkillRecord) => void;
}) {
  const { t, locale } = useApp();
  const tools = useApi<{ tools: ToolInfo[] }>(open ? "/api/tools" : null);
  const skills = useApi<{ skills: SkillRecord[] }>(open ? "/api/skills" : null);
  const [v, setV] = useState<SkillDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) { setV({ ...EMPTY, ...initial }); setError(null); setFieldErrors({}); }
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toolNames = useMemo(() => new Set((tools.data?.tools ?? []).map((x) => x.name)), [tools.data]);
  const unknownTools = tools.data ? v.requiredTools.filter((x) => !toolNames.has(x)) : [];
  const categories = useMemo(() => [...new Set([...SKILL_CATEGORIES, ...(skills.data?.skills ?? []).map((s) => s.category), v.category].filter(Boolean))], [skills.data, v.category]);
  const set = <K extends keyof SkillDraft>(k: K, val: SkillDraft[K]) => setV((p) => ({ ...p, [k]: val }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!v.name.trim()) fe.name = t("agents.validation.required");
    if (!v.nameAr.trim()) fe.nameAr = t("agents.validation.required");
    if (!v.instructions.trim()) fe.instructions = t("agents.validation.required");
    setFieldErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy(true); setError(null);
    try {
      const body = { ...v, name: v.name.trim(), nameAr: v.nameAr.trim(), key: editKey ? undefined : v.key || undefined };
      const res = editKey
        ? await api<{ skill: SkillRecord }>(`/api/skills/${encodeURIComponent(editKey)}`, { method: "PATCH", body })
        : await api<{ skill: SkillRecord }>("/api/skills", { body });
      onSaved(res.skill);
      onClose();
    } catch (err) {
      const fes = err instanceof ApiError ? fieldErrorsOf(err.details) : [];
      if (fes.length) setFieldErrors(Object.fromEntries(fes.map((x) => [x.field, x.message])));
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg"
      title={editKey ? t("agents.skills.editTitle") : t("agents.skills.createTitle")}
      description={t("agents.skills.grantNote")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("action.cancel")}</Button>
        <Button type="submit" form="skill-form" loading={busy}>{editKey ? t("action.save") : t("agents.skills.create")}</Button>
      </>}>
      <form id="skill-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("agents.skills.nameEn")} error={fieldErrors.name}>
            <Input value={v.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!fieldErrors.name} required dir="ltr" />
          </Field>
          <Field label={t("agents.skills.nameAr")} error={fieldErrors.nameAr}>
            <Input value={v.nameAr} onChange={(e) => set("nameAr", e.target.value)} aria-invalid={!!fieldErrors.nameAr} required dir="rtl" />
          </Field>
          <Field label={t("agents.skills.category")} error={fieldErrors.category}>
            <Select value={v.category} onChange={(e) => set("category", e.target.value)}>
              {categories.map((c) => <option key={c} value={c}>{tOr(t, `agents.skillCategory.${c}`, c)}</option>)}
            </Select>
          </Field>
          {!editKey && (
            <Field label={t("agents.skills.key")} hint={t("agents.skills.keyHint")} error={fieldErrors.key}>
              <Input value={v.key ?? ""} onChange={(e) => set("key", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} dir="ltr" className="font-mono" />
            </Field>
          )}
        </div>
        <Field label={t("agents.skills.description")} error={fieldErrors.description}>
          <Textarea rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label={t("agents.skills.instructions")} hint={t("agents.skills.instructionsHint")} error={fieldErrors.instructions}>
          <Textarea rows={5} value={v.instructions} onChange={(e) => set("instructions", e.target.value)} aria-invalid={!!fieldErrors.instructions} />
        </Field>
        <Field label={t("agents.skills.requiredTools")} hint={t("agents.skills.requiredToolsHint")} error={fieldErrors.requiredTools}>
          <Select value="" onChange={(e) => { if (e.target.value) set("requiredTools", [...new Set([...v.requiredTools, e.target.value])]); }} aria-label={t("agents.skills.addTool")}>
            <option value="">{t("agents.skills.addTool")}</option>
            {(tools.data?.tools ?? []).filter((x) => !v.requiredTools.includes(x.name)).map((x) => <option key={x.name} value={x.name}>{x.name} · L{x.riskLevel}</option>)}
          </Select>
        </Field>
        <ChipsInput value={v.requiredTools} onChange={(x) => set("requiredTools", x)} placeholder={t("agents.skills.toolsPlaceholder")} />
        {unknownTools.length > 0 && <Alert tone="warning">{t("agents.skills.unknownTools", { tools: unknownTools.join(", ") })}</Alert>}
        <Field label={t("agents.skills.dependsOn")} hint={t("agents.skills.dependsOnHint")} error={fieldErrors.dependsOn}>
          <Select value="" onChange={(e) => { if (e.target.value) set("dependsOn", [...new Set([...v.dependsOn, e.target.value])]); }} aria-label={t("agents.skills.addDependency")}>
            <option value="">{t("agents.skills.addDependency")}</option>
            {(skills.data?.skills ?? []).filter((s) => s.key !== editKey && !v.dependsOn.includes(s.key)).map((s) => <option key={s.key} value={s.key}>{localSkill(s, locale)}</option>)}
          </Select>
        </Field>
        <ChipsInput value={v.dependsOn} onChange={(x) => set("dependsOn", x)} />
      </form>
    </Dialog>
  );
}

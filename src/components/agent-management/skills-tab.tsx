"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Puzzle, Search, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, LoadingBlock, Select } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { tOr } from "@/components/analytics/format";
import { FeedbackMessage, useFeedback } from "@/components/settings/shared";
import { SkillDialog } from "./skill-dialog";
import { SectionTitle } from "./shared";
import { localSkill, type SkillRecord } from "./types";

/** Skills registry: built-in (read-only) + custom (create/edit/delete when unassigned). */
export function SkillsTab() {
  const { t, locale, can } = useApp();
  const admin = can("admin");
  const { data, error, loading, reload } = useApi<{ skills: SkillRecord[] }>("/api/skills");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [dialog, setDialog] = useState<{ edit?: SkillRecord } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fb, setFb] = useFeedback();

  const skills = useMemo(() => data?.skills ?? [], [data]);
  const byKey = useMemo(() => new Map(skills.map((s) => [s.key, s])), [skills]);
  const cats = [...new Set(skills.map((s) => s.category))].sort();
  const rows = skills.filter((s) => (!cat || s.category === cat)
    && (!q.trim() || `${s.name} ${s.nameAr} ${s.key} ${s.description}`.toLowerCase().includes(q.trim().toLowerCase())));

  const remove = async (s: SkillRecord) => {
    if (!window.confirm(t("agents.skills.deleteConfirm", { name: localSkill(s, locale) }))) return;
    setBusy(s.key);
    try {
      await api(`/api/skills/${encodeURIComponent(s.key)}`, { method: "DELETE" });
      setFb({ tone: "success", text: t("agents.skills.deleted", { name: localSkill(s, locale) }) });
      await reload();
    } catch (err) { setFb({ tone: "danger", text: (err as Error).message }); } finally { setBusy(null); }
  };

  return (
    <Card className="p-5">
      <SectionTitle title={t("agents.skills.title")} description={t("agents.skills.subtitle")}
        actions={admin ? <Button icon={<Plus className="size-4" />} onClick={() => setDialog({})}>{t("agents.skills.create")}</Button> : undefined} />
      <Alert tone="info">{t("agents.skills.grantNote")}</Alert>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("agents.skills.search")} aria-label={t("agents.skills.search")} className="ps-9" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t("agents.skills.category")} className="sm:w-52">
          <option value="">{t("agents.filter.allCategories")}</option>
          {cats.map((c) => <option key={c} value={c}>{tOr(t, `agents.skillCategory.${c}`, c)}</option>)}
        </Select>
      </div>
      <FeedbackMessage fb={fb} onDismiss={() => setFb(null)} className="mt-3" />
      <div className="mt-4">
        {error ? <ErrorState error={error} onRetry={reload} />
          : loading && !data ? <LoadingBlock rows={4} />
            : rows.length === 0 ? <EmptyState icon={<Puzzle className="size-5" />} title={skills.length ? t("agents.empty.noMatch") : t("agents.skills.empty")} />
              : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {rows.map((s) => (
                    <li key={s.key} className="flex flex-col rounded-xl border border-border p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-fg">{localSkill(s, locale)}</p>
                          <p className="truncate text-[12.5px] text-fg-3">{locale === "ar" ? s.name : s.nameAr} · <span className="font-mono" dir="ltr">{s.key}</span></p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Badge tone={s.builtin ? "neutral" : "accent"}>{s.builtin ? t("agents.templates.builtin") : t("agents.templates.custom")}</Badge>
                          <Badge tone="neutral">{tOr(t, `agents.skillCategory.${s.category}`, s.category)}</Badge>
                        </div>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[13px] text-fg-2">{s.description}</p>
                      <div className="mt-2 space-y-1 text-[12px] text-fg-3">
                        {s.requiredTools.length > 0 && <p>{t("agents.skills.requiresTools")}: <span className="font-mono" dir="ltr">{s.requiredTools.join(", ")}</span></p>}
                        {s.dependsOn.length > 0 && <p>{t("agents.skills.dependsOn")}: {s.dependsOn.map((k) => (byKey.get(k) ? localSkill(byKey.get(k)!, locale) : k)).join("، ")}</p>}
                        <p>{t("agents.skills.usedBy", { n: s.agentCount ?? 0 })}</p>
                      </div>
                      {admin && !s.builtin && (
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" variant="outline" icon={<Pencil className="size-3.5" />} onClick={() => setDialog({ edit: s })}>{t("action.edit")}</Button>
                          <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} loading={busy === s.key}
                            disabled={(s.agentCount ?? 0) > 0} title={(s.agentCount ?? 0) > 0 ? t("agents.skills.inUse") : undefined}
                            onClick={() => void remove(s)}>{t("action.delete")}</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
      </div>
      <SkillDialog open={!!dialog} onClose={() => setDialog(null)} editKey={dialog?.edit?.key}
        initial={dialog?.edit ? {
          name: dialog.edit.name, nameAr: dialog.edit.nameAr, description: dialog.edit.description, category: dialog.edit.category,
          instructions: dialog.edit.instructions, requiredTools: dialog.edit.requiredTools, dependsOn: dialog.edit.dependsOn,
        } : undefined}
        onSaved={(s) => { setFb({ tone: "success", text: t("agents.skills.saved", { name: localSkill(s, locale) }) }); void reload(); }} />
    </Card>
  );
}

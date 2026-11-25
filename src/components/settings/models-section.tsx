"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Alert, Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { FeedbackMessage, useFeedback, type SettingsResponse } from "./shared";

const ROLES = ["primary", "fallback", "fast", "advanced"] as const;
type ModelRole = (typeof ROLES)[number];

export function ModelsSection({ data, onSaved }: { data: SettingsResponse; onSaved: () => Promise<void> }) {
  const { t, can } = useApp();
  const admin = can("admin");
  const current = data.settings.models;
  const initial = () => Object.fromEntries(ROLES.map((r) => [r, current[r] ?? ""])) as Record<ModelRole, string>;
  const [form, setForm] = useState<Record<ModelRole, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [fb, setFb] = useFeedback();

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync only when the saved overrides change
  useEffect(() => setForm(initial()), [JSON.stringify(current)]);

  const dirty = ROLES.some((r) => form[r].trim() !== (current[r] ?? ""));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Empty string clears an override (falls back to the environment default).
      await api("/api/settings", { method: "PATCH", body: { models: Object.fromEntries(ROLES.map((r) => [r, form[r].trim()])) } });
      await onSaved();
      setFb({ tone: "success", text: t("settings.models.saved") });
    } catch (err) {
      setFb({ tone: "danger", text: (err as Error).message });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t("settings.models.effective")} description={t("settings.models.effectiveDesc")} />
        <dl className="grid gap-3 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-5">
          {([...ROLES, "embedding"] as const).map((r) => {
            const v = data.effectiveModels[r];
            const overridden = r !== "embedding" && Boolean(current[r]);
            return (
              <div key={r} className="rounded-xl border border-border bg-surface-2/50 p-3">
                <dt className="flex items-center justify-between gap-2 text-[12px] text-fg-3">
                  {t(`analytics.health.role.${r}`)}
                  <span className="text-[11px]">{overridden ? t("settings.models.override") : t("settings.models.fromEnv")}</span>
                </dt>
                <dd className="mt-1 break-all font-mono text-[13px] font-medium text-fg" dir="ltr">{v ?? <span className="text-fg-3">{t("analytics.health.notSet")}</span>}</dd>
              </div>
            );
          })}
        </dl>
        <div className="border-t border-border px-5 py-3">
          <Link href="/analytics#health" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
            {t("settings.models.verify")}<ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
          </Link>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("settings.models.overrides")} description={admin ? t("settings.models.overridesDesc") : t("settings.adminOnlyEdit")} />
        <form onSubmit={save} className="space-y-4 px-5 pb-5">
          <Alert tone="warning" title={t("settings.models.warnTitle")}>{t("settings.models.warn")}</Alert>
          <div className="grid gap-4 sm:grid-cols-2">
            {ROLES.map((r) => (
              <Field key={r} label={t(`analytics.health.role.${r}`)} hint={t(`settings.models.hint.${r}`)}>
                <Input value={form[r]} onChange={(e) => setForm((cur) => ({ ...cur, [r]: e.target.value }))} disabled={!admin} maxLength={100}
                  placeholder={t("settings.models.placeholder")} className="font-mono" dir="ltr" spellCheck={false} autoComplete="off" />
              </Field>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <FeedbackMessage fb={fb} onDismiss={() => setFb(null)} />
            {admin && <Button type="submit" className="sm:ms-auto" loading={saving} disabled={!dirty}>{t("action.save")}</Button>}
          </div>
        </form>
      </Card>
    </div>
  );
}

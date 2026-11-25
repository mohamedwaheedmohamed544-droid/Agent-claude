"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, Input, Select, cx } from "@/components/ui";
import { useApp, type Theme } from "@/components/providers";
import { api } from "@/lib/client/api";
import type { Locale } from "@/i18n";
import { FeedbackMessage, SettingRow, useFeedback } from "./shared";

export function ProfileSection() {
  const { t, session, refreshSession, locale, setLocale, theme, setTheme } = useApp();
  const [name, setName] = useState(session.user.name);
  const [saving, setSaving] = useState(false);
  const [fb, setFb] = useFeedback();

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/auth/me", { method: "PATCH", body: { name: name.trim() } });
      await refreshSession();
      setFb({ tone: "success", text: t("state.saved") });
    } catch (err) {
      setFb({ tone: "danger", text: (err as Error).message });
    } finally { setSaving(false); }
  };

  const changeLocale = async (l: Locale) => {
    try {
      await setLocale(l);
      await refreshSession();
      setFb({ tone: "success", text: t("settings.profile.languageSaved") });
    } catch (err) {
      setFb({ tone: "danger", text: (err as Error).message });
    }
  };

  const themes: Array<{ v: Theme; icon: typeof Sun }> = [{ v: "light", icon: Sun }, { v: "dark", icon: Moon }, { v: "system", icon: Monitor }];

  return (
    <Card>
      <CardHeader title={t("settings.profile.title")} description={t("settings.profile.desc")} />
      <div className="px-5 pb-5">
        <form onSubmit={saveName} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label={t("settings.profile.name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoComplete="name" />
            </Field>
          </div>
          <Button type="submit" loading={saving} disabled={!name.trim() || name.trim() === session.user.name}>{t("action.save")}</Button>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-fg-3">
          <span>{t("settings.profile.email")}</span>
          <span className="font-medium text-fg-2" dir="ltr">{session.user.email}</span>
          {session.currentWorkspace && <Badge tone="accent">{t(`settings.role.${session.currentWorkspace.role}`)}</Badge>}
        </div>

        <div className="mt-2 divide-y divide-border border-t border-border">
          <SettingRow title={t("settings.profile.language")} description={t("settings.profile.languageDesc")}>
            <Select value={locale} onChange={(e) => void changeLocale(e.target.value as Locale)} aria-label={t("settings.profile.language")} className="sm:w-44">
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          </SettingRow>
          <SettingRow title={t("settings.profile.theme")} description={t("settings.profile.themeDesc")}>
            <div role="radiogroup" aria-label={t("settings.profile.theme")} className="inline-flex rounded-xl border border-border bg-surface-2 p-1">
              {themes.map(({ v, icon: Icon }) => (
                <button key={v} type="button" role="radio" aria-checked={theme === v} onClick={() => { setTheme(v); setFb({ tone: "success", text: t("state.saved") }); }}
                  className={cx("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                    theme === v ? "bg-surface text-fg shadow-card" : "text-fg-3 hover:text-fg")}>
                  <Icon className="size-3.5" aria-hidden />{t(`shell.theme.${v}`)}
                </button>
              ))}
            </div>
          </SettingRow>
        </div>
        <FeedbackMessage fb={fb} onDismiss={() => setFb(null)} className="mt-2" />
      </div>
    </Card>
  );
}

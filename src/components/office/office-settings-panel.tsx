"use client";

import { useEffect, useState } from "react";
import { Building, LayoutGrid } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, ErrorState, Field, Input, LoadingBlock, Select, Switch, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { FeedbackMessage, useFeedback } from "@/components/settings/shared";
import type { OfficeSettings, OfficeSettingsResponse } from "@/components/agent-management/types";

const MODES: OfficeSettings["layoutMode"][] = ["auto", "compact", "standard", "expanded", "large", "multi_floor", "custom"];

/**
 * Virtual Office layout & presentation settings (GET/PATCH /api/office/settings). Shows the layout the server
 * computed from departments, workstations and visible agents. Read-only for non-admins.
 */
export function OfficeSettingsPanel() {
  const { t, locale, can } = useApp();
  const admin = can("admin");
  const { data, error, loading, reload, setData } = useApi<OfficeSettingsResponse>("/api/office/settings");
  const [v, setV] = useState<OfficeSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useFeedback();

  useEffect(() => { if (data && !v) setV(data.settings); }, [data, v]);

  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data || !v) return loading ? <LoadingBlock rows={4} /> : null;

  const dirty = JSON.stringify(v) !== JSON.stringify(data.settings);
  const set = <K extends keyof OfficeSettings>(k: K, val: OfficeSettings[K]) => setV((p) => (p ? { ...p, [k]: val } : p));
  const layout = data.layout;
  const floors = Array.from({ length: Math.max(1, layout.floors) }, (_, i) => i);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api<OfficeSettingsResponse>("/api/office/settings", { method: "PATCH", body: v });
      setData(res); setV(res.settings);
      setFb({ tone: "success", text: t("agents.office.saved") });
    } catch (err) { setFb({ tone: "danger", text: (err as Error).message }); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <Card>
        <CardHeader title={t("agents.office.title")} description={admin ? t("agents.office.subtitle") : t("agents.office.readOnly")} />
        <fieldset disabled={!admin || busy} className="space-y-5 px-5 pb-5">
          <section className="space-y-3">
            <h3 className="text-[13px] font-semibold text-fg">{t("agents.office.sizing")}</h3>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("agents.office.sizing")}>
              {(["auto", "manual"] as const).map((m) => {
                const on = m === "auto" ? v.layoutMode === "auto" : v.layoutMode !== "auto";
                return (
                  <button key={m} type="button" role="radio" aria-checked={on}
                    onClick={() => set("layoutMode", m === "auto" ? "auto" : v.layoutMode === "auto" ? (layout.mode ?? "standard") : v.layoutMode)}
                    className={cx("rounded-xl border p-3 text-start transition-colors disabled:opacity-60", on ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}>
                    <p className={cx("text-sm font-medium", on ? "text-accent-text" : "text-fg")}>{t(`agents.office.sizing.${m}`)}</p>
                    <p className="mt-0.5 text-[12.5px] text-fg-3">{t(`agents.office.sizing.${m}.desc`)}</p>
                  </button>
                );
              })}
            </div>
            {v.layoutMode !== "auto" && (
              <Field label={t("agents.office.mode")}>
                <Select value={v.layoutMode} onChange={(e) => set("layoutMode", e.target.value as OfficeSettings["layoutMode"])}>
                  {MODES.filter((m) => m !== "auto").map((m) => <option key={m} value={m}>{t(`agents.office.mode.${m}`)}</option>)}
                </Select>
              </Field>
            )}
            <p className="text-[12.5px] leading-relaxed text-fg-3">{t("agents.office.thresholds")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <AutoNumber label={t("agents.office.floors")} value={v.floors} min={1} max={10} onChange={(n) => set("floors", n)} autoLabel={t("agents.office.auto")} />
              <AutoNumber label={t("agents.office.meetingRooms")} value={v.meetingRooms} min={1} max={12} onChange={(n) => set("meetingRooms", n)} autoLabel={t("agents.office.auto")} />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-[13px] font-semibold text-fg">{t("agents.office.presentation")}</h3>
            <Field label={t("agents.office.characterScale", { n: v.characterScale.toFixed(2) })}>
              <input type="range" min={0.8} max={1.25} step={0.05} value={v.characterScale}
                onChange={(e) => set("characterScale", Number(e.target.value))} className="w-full accent-[var(--accent)]" />
            </Field>
            <ToggleRow label={t("agents.office.showLabels")} checked={v.showLabels} onChange={(x) => set("showLabels", x)} disabled={!admin} />
            <ToggleRow label={t("agents.office.ambientLounge")} hint={t("agents.office.ambientLoungeHint")} checked={v.ambientLounge} onChange={(x) => set("ambientLounge", x)} disabled={!admin} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("agents.office.cameraView")}>
                <Select value={v.camera.defaultView} onChange={(e) => set("camera", { ...v.camera, defaultView: e.target.value as "overview" | "executive" })}>
                  <option value="overview">{t("agents.office.camera.overview")}</option>
                  <option value="executive">{t("agents.office.camera.executive")}</option>
                </Select>
              </Field>
              <Field label={t("agents.office.quality")}>
                <Select value={v.quality} onChange={(e) => set("quality", e.target.value as OfficeSettings["quality"])}>
                  {(["auto", "high", "low"] as const).map((q) => <option key={q} value={q}>{t(`agents.office.quality.${q}`)}</option>)}
                </Select>
              </Field>
            </div>
            <ToggleRow label={t("agents.office.autoRotate")} checked={v.camera.autoRotate} onChange={(x) => set("camera", { ...v.camera, autoRotate: x })} disabled={!admin} />
            <ToggleRow label={t("agents.office.voice")} hint={t("agents.office.voiceHint")} checked={v.voice.enabled} onChange={(x) => set("voice", { enabled: x })} disabled={!admin} />
          </section>

          <FeedbackMessage fb={fb} onDismiss={() => setFb(null)} />
          {admin && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={!dirty} onClick={() => setV(data.settings)}>{t("agents.office.reset")}</Button>
              <Button loading={busy} disabled={!dirty} onClick={() => void save()}>{t("action.save")}</Button>
            </div>
          )}
        </fieldset>
      </Card>

      <Card>
        <CardHeader title={t("agents.office.current")} description={t("agents.office.currentDesc")} />
        <div className="space-y-4 px-5 pb-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone="accent"><LayoutGrid className="size-3" />{t(`agents.office.mode.${layout.mode}`)}</Badge>
            <Badge tone="neutral">{layout.auto ? t("agents.office.sizing.auto") : t("agents.office.sizing.manual")}</Badge>
            <Badge tone="neutral"><Building className="size-3" />{t("agents.office.floorCount", { n: layout.floors })}</Badge>
            <Badge tone="neutral">{t("agents.office.roomCount", { n: layout.meetingRooms.length })}</Badge>
          </div>
          {floors.map((f) => {
            const ds = layout.departments.filter((d) => d.floor === f);
            const rs = layout.meetingRooms.filter((r) => r.floor === f);
            return (
              <section key={f} className="rounded-xl border border-border p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">{t("agents.office.floorN", { n: f + 1 })}</h4>
                {ds.length === 0 && rs.length === 0 ? <p className="text-[12.5px] text-fg-3">—</p> : (
                  <ul className="space-y-1.5 text-[13px]">
                    {ds.map((d) => {
                      const used = d.workstations.filter((w) => w.agentSlug).length;
                      return (
                        <li key={d.key} className="flex items-center gap-2">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color }} aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-fg-2">{locale === "ar" ? d.nameAr || d.name : d.name}</span>
                          <span className="shrink-0 tabular-nums text-fg-3">{t("agents.office.desks", { used, total: d.workstations.length })}</span>
                        </li>
                      );
                    })}
                    {rs.map((r) => (
                      <li key={r.key} className="flex items-center gap-2 text-fg-3">
                        <span className="size-2.5 shrink-0 rounded-sm border border-border-strong" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{locale === "ar" ? r.nameAr : r.name}</span>
                        <span className="shrink-0 tabular-nums">{t("agents.office.seats", { n: r.seats })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {dirty && <Alert tone="info">{t("agents.office.unsaved")}</Alert>}
        </div>
      </Card>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-fg">{label}</p>
        {hint && <p className="text-[12.5px] text-fg-3">{hint}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  );
}

function AutoNumber({ label, value, min, max, onChange, autoLabel }: { label: string; value: number | null; min: number; max: number; onChange: (v: number | null) => void; autoLabel: string }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <Select value={value === null ? "auto" : "fixed"} onChange={(e) => onChange(e.target.value === "auto" ? null : (value ?? min))} aria-label={label} className="w-28">
          <option value="auto">{autoLabel}</option>
          <option value="fixed">#</option>
        </Select>
        {value !== null && (
          <Input type="number" min={min} max={max} value={value} aria-label={label}
            onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} className="w-24" />
        )}
      </div>
    </Field>
  );
}

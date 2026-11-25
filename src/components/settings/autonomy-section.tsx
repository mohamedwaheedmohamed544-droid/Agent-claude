"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Alert, Button, Card, CardHeader, Dialog, Input, Select, Switch } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { ApprovalLevels } from "@/components/agents/approval-levels";
import { FeedbackMessage, SettingRow, useFeedback, type SettingsResponse, type WorkspaceSettings } from "./shared";

export function AutonomySection({ data, onSaved }: { data: SettingsResponse; onSaved: () => Promise<void> }) {
  const { t, can } = useApp();
  const admin = can("admin");
  const s = data.settings;
  const [fb, setFb] = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmL3, setConfirmL3] = useState(false);
  const [parallel, setParallel] = useState(String(s.maxParallelSteps));
  const [limit, setLimit] = useState(String(s.dailyCostLimitUsd));

  useEffect(() => { setParallel(String(s.maxParallelSteps)); setLimit(String(s.dailyCostLimitUsd)); }, [s.maxParallelSteps, s.dailyCostLimitUsd]);

  const patch = async (body: Partial<WorkspaceSettings>, key: string) => {
    setBusy(key);
    try {
      await api("/api/settings", { method: "PATCH", body });
      await onSaved();
      setFb({ tone: "success", text: t("state.saved") });
      return true;
    } catch (err) {
      setFb({ tone: "danger", text: (err as Error).message });
      return false;
    } finally { setBusy(null); }
  };

  const limitNum = Number(limit);
  const limitValid = limit.trim() !== "" && Number.isFinite(limitNum) && limitNum >= 0;
  const limitsDirty = Number(parallel) !== s.maxParallelSteps || (limitValid && limitNum !== s.dailyCostLimitUsd);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t("settings.autonomy.levelsTitle")} description={t("settings.autonomy.levelsDesc")} />
        <div className="px-5 pb-5"><ApprovalLevels autoApproveLevel3={s.autoApproveLevel3} /></div>
      </Card>

      <Card>
        <CardHeader title={t("settings.autonomy.title")} description={admin ? t("settings.autonomy.desc") : t("settings.adminOnlyEdit")} />
        <div className="divide-y divide-border px-5">
          <SettingRow title={t("settings.autonomy.l3")} description={
            <>
              <p>{t("settings.autonomy.l3Desc")}</p>
              {s.autoApproveLevel3 && <p className="mt-1 font-medium text-warning">{t("settings.autonomy.l3On")}</p>}
            </>
          }>
            <Switch checked={s.autoApproveLevel3} disabled={!admin || busy === "l3"} label={t("settings.autonomy.l3")}
              onChange={(v) => (v ? setConfirmL3(true) : void patch({ autoApproveLevel3: false }, "l3"))} />
          </SettingRow>
          <SettingRow title={t("settings.autonomy.memories")} description={t("settings.autonomy.memoriesDesc")}>
            <Switch checked={s.autoApproveAgentMemories} disabled={!admin || busy === "mem"} label={t("settings.autonomy.memories")}
              onChange={(v) => void patch({ autoApproveAgentMemories: v }, "mem")} />
          </SettingRow>
          <SettingRow title={t("settings.autonomy.parallel")} description={t("settings.autonomy.parallelDesc")}>
            <Select value={parallel} onChange={(e) => setParallel(e.target.value)} disabled={!admin} aria-label={t("settings.autonomy.parallel")} className="w-28">
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </SettingRow>
          <SettingRow title={t("settings.autonomy.costLimit")} description={t("settings.autonomy.costLimitDesc")}>
            <div className="relative w-36">
              <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-fg-3" aria-hidden>$</span>
              <Input type="number" inputMode="decimal" min={0} step="0.5" value={limit} onChange={(e) => setLimit(e.target.value)} disabled={!admin}
                aria-label={t("settings.autonomy.costLimit")} aria-invalid={!limitValid} className="ps-7 tabular-nums" dir="ltr" />
            </div>
          </SettingRow>
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <FeedbackMessage fb={fb} onDismiss={() => setFb(null)} />
          {admin && (
            <Button className="sm:ms-auto" loading={busy === "limits"} disabled={!limitsDirty || !limitValid}
              onClick={() => void patch({ maxParallelSteps: Number(parallel), dailyCostLimitUsd: limitNum }, "limits")}>{t("action.save")}</Button>
          )}
        </div>
      </Card>

      <Dialog open={confirmL3} onClose={() => setConfirmL3(false)} title={t("settings.autonomy.l3ConfirmTitle")}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmL3(false)}>{t("action.cancel")}</Button>
          <Button variant="danger" icon={<ShieldAlert className="size-4" />} loading={busy === "l3"}
            onClick={async () => { await patch({ autoApproveLevel3: true }, "l3"); setConfirmL3(false); }}>
            {t("settings.autonomy.l3ConfirmCta")}
          </Button>
        </>}>
        <Alert tone="danger" title={t("settings.autonomy.l3WarnTitle")}>{t("settings.autonomy.l3Warn")}</Alert>
        <p className="mt-3 text-sm text-fg-2">{t("settings.autonomy.l3WarnL4")}</p>
      </Dialog>
    </div>
  );
}

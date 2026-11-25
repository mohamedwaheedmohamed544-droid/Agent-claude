"use client";

import { useState } from "react";
import { OctagonX, PlayCircle } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { FeedbackMessage, useFeedback } from "./shared";

export function EmergencySection({ onChanged }: { onChanged: () => Promise<void> }) {
  const { t, can, session, refreshSession } = useApp();
  const active = session.emergencyStop;
  const canEngage = can("member");
  const canRelease = can("admin");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useFeedback();

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ emergencyStop: boolean; tasksPaused: number }>("/api/settings/emergency-stop", { method: "POST", body: { active: !active } });
      await Promise.all([refreshSession(), onChanged()]);
      setFb({ tone: "success", text: r.emergencyStop ? t("settings.emergency.engagedMsg", { n: r.tasksPaused }) : t("settings.emergency.releasedMsg") });
    } catch (err) {
      setFb({ tone: "danger", text: (err as Error).message });
    } finally { setBusy(false); setConfirm(false); }
  };

  return (
    <Card className={cx(active && "border-danger/50")}>
      <CardHeader title={t("settings.emergency.title")} description={t("settings.emergency.desc")}
        actions={active ? <Badge tone="danger" dot>{t("settings.emergency.active")}</Badge> : <Badge tone="success" dot>{t("settings.emergency.inactive")}</Badge>} />
      <div className="space-y-4 px-5 pb-5">
        {active ? (
          <Alert tone="danger" title={t("shell.emergencyStopActive")}>{t("settings.emergency.activeDesc")}</Alert>
        ) : (
          <ul className="list-disc space-y-1 ps-5 text-[13px] text-fg-2">
            <li>{t("settings.emergency.effect1")}</li>
            <li>{t("settings.emergency.effect2")}</li>
            <li>{t("settings.emergency.effect3")}</li>
          </ul>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {active ? (
            <Button variant="success" icon={<PlayCircle className="size-4" />} disabled={!canRelease} onClick={() => setConfirm(true)}>{t("settings.emergency.release")}</Button>
          ) : (
            <Button variant="danger" icon={<OctagonX className="size-4" />} disabled={!canEngage} onClick={() => setConfirm(true)}>{t("settings.emergency.engage")}</Button>
          )}
          <p className="text-[12.5px] text-fg-3">{active && !canRelease ? t("settings.emergency.releaseAdminOnly") : !canEngage ? t("settings.emergency.viewerNote") : t("settings.emergency.whoCan")}</p>
        </div>
        <FeedbackMessage fb={fb} onDismiss={() => setFb(null)} />
      </div>
      <Dialog open={confirm} onClose={() => setConfirm(false)} size="sm"
        title={active ? t("settings.emergency.releaseTitle") : t("settings.emergency.engageTitle")}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirm(false)}>{t("action.cancel")}</Button>
          <Button variant={active ? "success" : "danger"} loading={busy} onClick={submit}>{active ? t("settings.emergency.release") : t("settings.emergency.engage")}</Button>
        </>}>
        <p className="text-sm text-fg-2">{active ? t("settings.emergency.releaseBody") : t("shell.emergencyStopConfirm")}</p>
      </Dialog>
    </Card>
  );
}

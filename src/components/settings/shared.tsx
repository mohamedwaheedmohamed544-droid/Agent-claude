"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { Alert, cx } from "@/components/ui";
import { useApp } from "@/components/providers";

export interface WorkspaceSettings {
  emergencyStop: boolean;
  autoApproveLevel3: boolean;
  disabledTools: string[];
  maxParallelSteps: number;
  models: { primary?: string; fallback?: string; fast?: string; advanced?: string };
  dailyCostLimitUsd: number;
  autoApproveAgentMemories: boolean;
}

export interface SettingsResponse {
  workspaceName: string;
  settings: WorkspaceSettings;
  effectiveModels: { primary: string | null; fallback: string | null; fast: string | null; advanced: string | null; embedding: string };
}

export type Feedback = { tone: "success" | "danger"; text: string } | null;

/** Feedback state that auto-clears success messages after a few seconds; errors stay until dismissed. */
export function useFeedback(): [Feedback, (f: Feedback) => void] {
  const [fb, setFb] = useState<Feedback>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const set = useCallback((f: Feedback) => {
    if (timer.current) clearTimeout(timer.current);
    setFb(f);
    if (f?.tone === "success") timer.current = setTimeout(() => setFb(null), 4000);
  }, []);
  return [fb, set];
}

export function FeedbackMessage({ fb, onDismiss, className }: { fb: Feedback; onDismiss: () => void; className?: string }) {
  const { t } = useApp();
  return (
    <div role="status" aria-live="polite" className={cx(!fb && "sr-only", className)}>
      {fb && (fb.tone === "success" ? (
        <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success"><CheckCircle2 className="size-4" aria-hidden />{fb.text}</p>
      ) : (
        <Alert tone="danger" action={<button type="button" onClick={onDismiss} aria-label={t("action.close")} className="opacity-70 hover:opacity-100"><X className="size-4" /></button>}>{fb.text}</Alert>
      ))}
    </div>
  );
}

/** A settings row: label + description on the start side, control on the end side; stacks on mobile. */
export function SettingRow({ title, description, children, className }: { title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8", className)}>
      <div className="min-w-0 max-w-xl">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description && <div className="mt-0.5 text-[13px] leading-relaxed text-fg-3">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function ReadOnlyNote() {
  const { t } = useApp();
  return <Alert tone="info">{t("settings.readOnly")}</Alert>;
}

"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { cx } from "@/components/ui";
import type { Bi, Option } from "@/lib/onboarding/schema";
import type { Origin } from "@/lib/onboarding/types";
import { useT } from "@/components/providers";

export function useBi() {
  const { locale } = useT();
  return (b: Bi | undefined | null) => (b ? b[locale] ?? b.en : "");
}

export function Question({ label, hint, required, children }: { label: React.ReactNode; hint?: React.ReactNode; required?: boolean; children: React.ReactNode }) {
  const { t } = useT();
  return (
    <fieldset className="space-y-2">
      <legend className="flex items-center gap-2 text-[14px] font-medium text-fg">
        {label}
        <span className="text-[11.5px] font-normal text-fg-3">{required ? t("onb.required") : t("onb.optional")}</span>
      </legend>
      {hint && <p className="-mt-1 text-[12.5px] text-fg-3">{hint}</p>}
      {children}
    </fieldset>
  );
}

/** Multi-select chips. `ordered` shows the selection order (used for ranked priorities). */
export function Chips<K extends string>({ options, value, onChange, max, ordered, badge }: {
  options: readonly Option<K>[]; value: K[]; onChange: (v: K[]) => void; max?: number; ordered?: boolean; badge?: (k: K) => React.ReactNode;
}) {
  const bi = useBi();
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const i = value.indexOf(o.key);
        const on = i >= 0;
        const disabled = !on && max !== undefined && value.length >= max;
        return (
          <button key={o.key} type="button" aria-pressed={on} disabled={disabled}
            onClick={() => onChange(on ? value.filter((v) => v !== o.key) : [...value, o.key])}
            className={cx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-40",
              on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-fg-2 hover:border-border-strong hover:text-fg")}>
            {on && (ordered ? <span className="grid size-4 place-items-center rounded-full bg-accent text-[10px] font-semibold text-white">{i + 1}</span> : <Check className="size-3.5" />)}
            {bi(o.label)}
            {badge?.(o.key)}
          </button>
        );
      })}
    </div>
  );
}

export function RadioCards<K extends string>({ options, value, onChange, name, columns = 3 }: {
  options: readonly Option<K>[]; value: K | undefined; onChange: (v: K) => void; name: string; columns?: 2 | 3 | 4;
}) {
  const bi = useBi();
  return (
    <div role="radiogroup" aria-label={name} className={cx("grid gap-2", { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" }[columns])}>
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}
          className={cx("rounded-xl border px-3 py-2.5 text-start text-[13px] transition-colors",
            value === o.key ? "border-accent bg-accent-soft text-accent font-medium" : "border-border bg-surface text-fg-2 hover:border-border-strong")}>
          {bi(o.label)}
        </button>
      ))}
    </div>
  );
}

/** Segmented single choice used in compact rows (e.g. function status). */
export function Segmented<K extends string>({ options, value, onChange, label }: { options: readonly Option<K>[]; value: K | undefined; onChange: (v: K) => void; label: string }) {
  const bi = useBi();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-surface-2 p-1">
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}
          className={cx("rounded-lg px-2.5 py-1 text-[12.5px] transition-colors", value === o.key ? "bg-surface text-fg shadow-card font-medium" : "text-fg-3 hover:text-fg")}>
          {bi(o.label)}
        </button>
      ))}
    </div>
  );
}

export function TagInput({ value, onChange, placeholder, max = 10, label }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; max?: number; label: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v) && value.length < max) onChange([...value, v.slice(0, 120)]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 focus-within:border-accent">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[12.5px] text-fg" dir="auto">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="text-fg-3 hover:text-fg"><X className="size-3" /></button>
        </span>
      ))}
      <input aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={value.length ? "" : placeholder} dir="auto"
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} onBlur={add}
        className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-fg placeholder:text-fg-3 focus:outline-none" />
    </div>
  );
}

const ORIGIN_TONE: Record<Origin, string> = {
  provided: "bg-success-soft text-success", inferred: "bg-info-soft text-info", needs_confirmation: "bg-warning-soft text-warning", customer_edit: "bg-accent-soft text-accent",
};
export function OriginBadge({ origin }: { origin: Origin }) {
  const { t } = useT();
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", ORIGIN_TONE[origin])}>{t(`onb.origin.${origin}`)}</span>;
}

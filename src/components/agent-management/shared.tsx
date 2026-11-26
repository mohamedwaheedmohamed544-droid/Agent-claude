"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal, Plus, X } from "lucide-react";
import { Badge, Button, Input, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import type { AgentLifecycle } from "@/lib/agents/types";
import type { AgentPresence, AgentStatus, CharacterAppearance } from "@/lib/office/types";

// ───────────── Avatar ─────────────

/** Flat, stylised bust that mirrors the 3D character's look (skin, outfit, headwear, accessory). */
export function AvatarFigure({ appearance: a, className }: { appearance: CharacterAppearance; className?: string }) {
  const draped = a.headwear === "ghutra" || a.headwear === "shemagh";
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      {/* body */}
      <path d="M10 64c0-14 9-22 22-22s22 8 22 22z" fill={a.outfitColor} stroke="rgb(0 0 0 / 0.12)" strokeWidth="0.6" />
      {a.outfit === "suit" || a.outfit === "blazer" ? (
        <path d="M26 43l6 10 6-10" fill="none" stroke={a.outfit === "suit" ? "#f4f4f5" : "rgb(255 255 255 / 0.55)"} strokeWidth="2.2" strokeLinejoin="round" />
      ) : a.outfit === "turtleneck" ? (
        <rect x="26" y="38" width="12" height="6" rx="2.5" fill={a.outfitColor} stroke="rgb(0 0 0 / 0.18)" strokeWidth="0.6" />
      ) : a.outfit === "cardigan" ? (
        <path d="M32 43v21" stroke="rgb(0 0 0 / 0.22)" strokeWidth="1.4" />
      ) : a.outfit === "thobe" ? (
        <path d="M32 43v9" stroke="rgb(0 0 0 / 0.18)" strokeWidth="1.2" />
      ) : null}
      {/* headwear behind the head */}
      {a.headwear === "hijab" && <path d="M18 30c0-9 6-16 14-16s14 7 14 16c0 6-2 11-5 14H23c-3-3-5-8-5-14z" fill={a.headwearColor} />}
      {draped && <path d="M17 33c0-11 7-19 15-19s15 8 15 19l1 13H16z" fill={a.headwearColor} stroke="rgb(0 0 0 / 0.12)" strokeWidth="0.6" />}
      {/* neck + head */}
      <rect x="28.5" y="34" width="7" height="8" rx="3" fill={a.skin} />
      <ellipse cx="32" cy="27" rx="9" ry="10.5" fill={a.skin} />
      {a.headwear === "none" && <path d="M22.6 25c0-7 4-11.5 9.4-11.5s9.4 4.5 9.4 11.5c-2-3.5-5.5-5.4-9.4-5.4s-7.4 1.9-9.4 5.4z" fill={a.hairColor} />}
      {a.headwear === "hijab" && <path d="M22.5 24c1-6 4.5-9 9.5-9s8.5 3 9.5 9c-2.5-2.2-5.8-3.3-9.5-3.3s-7 1.1-9.5 3.3z" fill={a.headwearColor} />}
      {draped && (
        <>
          <path d="M21 25c1-7 5-10.5 11-10.5S42 18 43 25c-3-2.6-6.6-3.8-11-3.8S24 22.4 21 25z" fill={a.headwearColor} />
          <path d="M22 19.5c3-2.4 6.3-3.4 10-3.4s7 1 10 3.4" fill="none" stroke="#111" strokeWidth="1.6" strokeLinecap="round" />
          {a.headwear === "shemagh" && <path d="M24 22l3 2m3-2l3 2m3-2l3 2" stroke="rgb(255 255 255 / 0.55)" strokeWidth="0.8" />}
        </>
      )}
      {/* accessory */}
      {a.accessory === "glasses" && (
        <g fill="none" stroke="#1f2937" strokeWidth="1"><circle cx="28.3" cy="27.5" r="2.6" /><circle cx="35.7" cy="27.5" r="2.6" /><path d="M30.9 27.5h2.2" /></g>
      )}
      {a.accessory === "headset" && (
        <g fill="none" stroke="#1f2937" strokeWidth="1.6" strokeLinecap="round"><path d="M22.5 27a9.5 9.5 0 0 1 19 0" /><path d="M23 29.5c0 3 2 5 5 5.5" /></g>
      )}
      {(a.accessory === "tablet" || a.accessory === "laptop" || a.accessory === "folder") && (
        <rect x="38" y="50" width="11" height="8" rx="1.2" fill={a.accessory === "folder" ? "#d97706" : "#334155"} stroke="rgb(255 255 255 / 0.4)" strokeWidth="0.6" />
      )}
      {a.accessory === "pen" && <path d="M41 49l5 9" stroke="#1e3a8a" strokeWidth="1.6" strokeLinecap="round" />}
      {a.accessory === "watch" && <circle cx="47" cy="58" r="1.8" fill="#e5e7eb" stroke="#475569" strokeWidth="0.6" />}
    </svg>
  );
}

const FACE_SIZE = { xs: "size-7 rounded-lg", sm: "size-9 rounded-lg", md: "size-12 rounded-xl", lg: "size-16 rounded-2xl", xl: "size-24 rounded-3xl" };

export function AgentFace({ color, appearance, name, size = "md", className }: {
  color: string; appearance?: CharacterAppearance | null; name?: string; size?: keyof typeof FACE_SIZE; className?: string;
}) {
  return (
    <span className={cx("relative grid shrink-0 place-items-center overflow-hidden border border-border", FACE_SIZE[size], className)}
      style={{ background: `color-mix(in srgb, ${color} 16%, var(--surface))` }}>
      {appearance ? <AvatarFigure appearance={appearance} className="size-full translate-y-[6%]" />
        : <span className="text-base font-semibold" style={{ color }}>{(name ?? "?").trim().charAt(0).toUpperCase()}</span>}
      <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: color }} aria-hidden="true" />
    </span>
  );
}

// ───────────── Status ─────────────

const LIFECYCLE_TONE = { active: "success", draft: "neutral", inactive: "warning", archived: "neutral" } as const;
export function LifecycleBadge({ lifecycle, hideActive }: { lifecycle: AgentLifecycle; hideActive?: boolean }) {
  const { t } = useApp();
  if (hideActive && lifecycle === "active") return null;
  return <Badge tone={LIFECYCLE_TONE[lifecycle]} dot>{t(`agents.lifecycle.${lifecycle}`)}</Badge>;
}

const PRESENCE_TONE: Record<AgentStatus, "neutral" | "accent" | "success" | "warning" | "danger" | "info"> = {
  idle: "neutral", working: "accent", thinking: "info", collaborating: "info", waiting: "warning", meeting: "success", error: "danger", paused: "neutral",
};
export function PresenceBadge({ presence, lifecycle }: { presence: AgentPresence | null; lifecycle?: AgentLifecycle }) {
  const { t } = useApp();
  if (lifecycle && lifecycle !== "active") return null;
  const s: AgentStatus = presence?.status ?? "idle";
  const live = s === "working" || s === "thinking" || s === "collaborating" || s === "meeting";
  return (
    <Badge tone={PRESENCE_TONE[s]}>
      <span className={cx("size-1.5 rounded-full bg-current", live && "animate-soft-pulse")} />
      {t(`agents.presence.${s}`)}
    </Badge>
  );
}

// ───────────── Inputs ─────────────

/** Free-text chips (expertise, capabilities, categories). Enter or comma adds; Backspace on empty removes last. */
export function ChipsInput({ value, onChange, placeholder, id, disabled, max = 30 }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string; disabled?: boolean; max?: number;
}) {
  const { t } = useApp();
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])].slice(0, max));
    setDraft("");
  };
  return (
    <div className={cx("flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 focus-within:border-accent focus-within:ring-3 focus-within:ring-[var(--ring)]", disabled && "opacity-60")}>
      {value.map((v) => (
        <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[12.5px] text-fg-2">
          <span className="truncate">{v}</span>
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={t("agents.common.removeItem", { item: v })} className="text-fg-3 hover:text-fg">
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      <input
        id={id} value={draft} disabled={disabled} placeholder={value.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-fg placeholder:text-fg-3 focus:outline-none"
      />
    </div>
  );
}

/** Ordered list of short lines (deliverables, success criteria). */
export function ListInput({ value, onChange, placeholder, addLabel, disabled }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; addLabel: string; disabled?: boolean;
}) {
  const { t } = useApp();
  const [draft, setDraft] = useState("");
  const add = () => { const v = draft.trim(); if (v) { onChange([...value, v]); setDraft(""); } };
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ol className="space-y-1.5">
          {value.map((v, i) => (
            <li key={`${i}-${v}`} className="flex items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-[11px] font-medium text-fg-3 tabular-nums">{i + 1}</span>
              <Input value={v} disabled={disabled} aria-label={`${addLabel} ${i + 1}`}
                onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
              {!disabled && (
                <Button type="button" variant="ghost" size="icon" aria-label={t("agents.common.removeItem", { item: v })}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="size-4" /></Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <Input value={draft} placeholder={placeholder} aria-label={addLabel} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <Button type="button" variant="outline" onClick={add} icon={<Plus className="size-4" />} disabled={!draft.trim()}>{t("action.add")}</Button>
        </div>
      )}
    </div>
  );
}

/** Multi-select of agents as toggle chips. */
export function AgentMultiPick({ options, value, onChange, disabled, emptyText }: {
  options: Array<{ slug: string; label: string; color: string }>; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; emptyText: string;
}) {
  if (!options.length) return <p className="text-[13px] text-fg-3">{emptyText}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.slug);
        return (
          <button key={o.slug} type="button" disabled={disabled} aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o.slug) : [...value, o.slug])}
            className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] transition-colors disabled:opacity-60",
              on ? "border-accent bg-accent-soft text-accent-text" : "border-border bg-surface text-fg-2 hover:bg-surface-2")}>
            <span className="size-2 rounded-full" style={{ background: o.color }} aria-hidden="true" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; disabled?: boolean; className?: string }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 text-[13px] text-fg-2", disabled && "cursor-not-allowed opacity-60", className)}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-border accent-[var(--accent)]" />
      {label}
    </label>
  );
}

// ───────────── Menu ─────────────

export interface MenuItem { key: string; label: string; icon?: React.ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; hidden?: boolean }

/** Small accessible dropdown menu (click outside / Escape closes; arrow keys move focus). */
export function ActionMenu({ items, label, className }: { items: MenuItem[]; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const visible = items.filter((i) => !i.hidden);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])")?.focus();
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  if (!visible.length) return null;
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
  };
  return (
    <div ref={ref} className={cx("relative", className)}>
      <Button type="button" variant="ghost" size="icon" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>
        <MoreHorizontal className="size-4" />
      </Button>
      {open && (
        <div id={id} role="menu" onKeyDown={move}
          className="absolute end-0 top-full z-30 mt-1 w-52 rounded-xl border border-border bg-surface p-1 shadow-pop">
          {visible.map((it) => (
            <button key={it.key} type="button" role="menuitem" disabled={it.disabled}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); it.onSelect(); }}
              className={cx("flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[13px] transition-colors focus:outline-none disabled:opacity-40",
                it.danger ? "text-danger hover:bg-danger-soft focus:bg-danger-soft" : "text-fg-2 hover:bg-surface-2 hover:text-fg focus:bg-surface-2")}>
              <span className="grid size-4 place-items-center" aria-hidden="true">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Truncated chip row with "+N". */
export function ChipRow({ items, max = 4, tone = "neutral" }: { items: string[]; max?: number; tone?: "neutral" | "accent" }) {
  const { t } = useApp();
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.slice(0, max).map((s) => <Badge key={s} tone={tone} className="max-w-[12rem] truncate">{s}</Badge>)}
      {items.length > max && <Badge tone="neutral">{t("agents.common.more", { n: items.length - max })}</Badge>}
    </div>
  );
}

/** Section heading used inside long forms/panels. */
export function SectionTitle({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import {
  Activity, AlertTriangle, BarChart3, Bot, Briefcase, FileText, Loader2, Megaphone, PenLine, Search, Workflow, X, Sparkles,
} from "lucide-react";
import { useT } from "./providers";

export const cx = clsx;

// ───────────── Buttons ─────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover shadow-card",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3 border border-border",
  outline: "bg-surface text-fg border border-border hover:bg-surface-2",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg",
  danger: "bg-danger text-white hover:opacity-90 shadow-card",
  success: "bg-success text-white hover:opacity-90 shadow-card",
};
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-lg justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center font-medium transition-colors select-none whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none",
        BTN_VARIANT[variant], BTN_SIZE[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ───────────── Surfaces ─────────────

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-2xl border border-border bg-surface shadow-card", className)} {...rest}>{children}</div>;
}

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-fg-3">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, icon }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-3 min-w-0">
        {icon && <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1 text-sm text-fg-3 max-w-2xl">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ───────────── Badges ─────────────

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-2 border-border",
  accent: "bg-accent-soft text-accent-text border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
};

export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap", TONE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral", planned: "info", running: "accent", waiting_approval: "warning", paused: "neutral", completed: "success",
  failed: "danger", cancelled: "neutral", pending: "neutral", skipped: "neutral", approved: "success", rejected: "danger",
  expired: "neutral", executed: "success", superseded: "neutral", succeeded: "success", blocked: "danger", awaiting_approval: "warning",
  ready: "success", processing: "accent", connected: "success", disconnected: "neutral", error: "danger", active: "success",
  proposed: "warning", archived: "neutral",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { t } = useT();
  const live = status === "running" || status === "processing";
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} className={className}>
      <span className={cx("size-1.5 rounded-full bg-current", live && "animate-soft-pulse")} />
      {t(`status.${status}`)}
    </Badge>
  );
}

const RISK_TONE: Record<number, Tone> = { 1: "info", 2: "neutral", 3: "warning", 4: "danger" };
export function RiskBadge({ level }: { level: number }) {
  const { t } = useT();
  return <Badge tone={RISK_TONE[level] ?? "neutral"} className="font-mono">L{level} · {t(`risk.${level}`)}</Badge>;
}

// ───────────── Form controls ─────────────

const FIELD = "w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-3 transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-[var(--ring)] disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(FIELD, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(FIELD, "py-2 leading-relaxed", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(FIELD, "h-9 pe-8", className)} {...rest}>{children}</select>;
}

export function Field({ label, hint, error, children }: { label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-fg-3">{hint}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-surface-3 border border-border")}
    >
      <span className={cx("inline-block size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px] rtl:-translate-x-[18px]" : "translate-x-0.5 rtl:-translate-x-0.5")} />
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: React.ReactNode; count?: number }>; className?: string }) {
  return (
    <div role="tablist" className={cx("inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-surface-2 p-1 gap-0.5", className)}>
      {items.map((it) => (
        <button
          key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={cx("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
            value === it.value ? "bg-surface text-fg shadow-card" : "text-fg-3 hover:text-fg")}
        >
          {it.label}
          {it.count !== undefined && <span className="rounded-full bg-surface-3 px-1.5 text-[11px] text-fg-2">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ───────────── Feedback ─────────────

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-4 animate-spin text-fg-3", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("block animate-pulse rounded-lg bg-surface-2", className)} />;
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3 p-1">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-surface-2 text-fg-3">{icon ?? <Sparkles className="size-5" />}</div>
      <p className="text-[15px] font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-fg-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "warning", title, children, action }: { tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={cx("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", TONE[tone])}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="mt-0.5 opacity-90">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { t } = useT();
  return <Alert tone="danger" title={t("state.error")} action={onRetry && <Button size="sm" variant="outline" onClick={onRetry}>{t("action.retry")}</Button>}>{error.message}</Alert>;
}

// ───────────── Dialog ─────────────

/** Open dialogs, innermost last — only the innermost closes on Escape. */
const DIALOG_STACK: symbol[] = [];

export function Dialog({ open, onClose, title, description, children, footer, size = "md" }: {
  open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md" | "lg" | "xl";
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const token = Symbol("dialog");
    DIALOG_STACK.push(token);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && DIALOG_STACK[DIALOG_STACK.length - 1] === token) onClose(); };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = DIALOG_STACK.lastIndexOf(token);
      if (i >= 0) DIALOG_STACK.splice(i, 1);
    };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id}
        className={cx("relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-border bg-surface shadow-modal sm:rounded-2xl", w)}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id={id} className="text-base font-semibold text-fg">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-fg-3">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────── Data display ─────────────

export function Stat({ label, value, hint, icon, tone = "accent" }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: Tone }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-fg-3">{label}</p>
        {icon && <span className={cx("grid size-8 place-items-center rounded-lg", TONE[tone])}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</div>
      {hint && <p className="mt-0.5 text-xs text-fg-3">{hint}</p>}
    </Card>
  );
}

const AGENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  research: Search, business_development: Briefcase, documents: FileText, writing: PenLine, analytics: BarChart3,
  operations: Workflow, marketing: Megaphone, orchestrator: Activity,
};
const AGENT_COLORS: Record<string, string> = {
  research: "#2563eb", business_development: "#0d9488", documents: "#7c3aed", writing: "#db2777", analytics: "#ea580c",
  operations: "#16a34a", marketing: "#ca8a04", orchestrator: "#4f46e5",
};

export function AgentAvatar({ slug, size = "md", className }: { slug: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = AGENT_ICONS[slug] ?? Bot;
  const color = AGENT_COLORS[slug] ?? "#6366f1";
  const s = { sm: "size-6 rounded-md", md: "size-8 rounded-lg", lg: "size-11 rounded-xl" }[size];
  const i = { sm: "size-3.5", md: "size-4", lg: "size-5" }[size];
  return (
    <span className={cx("grid shrink-0 place-items-center", s, className)} style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      <Icon className={i} />
    </span>
  );
}

export function AgentName({ slug }: { slug: string }) {
  const { t } = useT();
  return <>{t(`agent.${slug}`)}</>;
}

/** Copies text to clipboard with brief feedback. */
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  return [copied, (text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }];
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("overflow-x-auto", className)}><table className="w-full text-sm">{children}</table></div>;
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cx("border-b border-border px-4 py-2.5 text-start text-xs font-medium uppercase tracking-wide text-fg-3 whitespace-nowrap", className)}>{children}</th>;
}
export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cx("border-b border-border px-4 py-3 align-middle text-fg-2", className)}>{children}</td>;
}

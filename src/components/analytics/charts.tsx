"use client";

import { useId, useState } from "react";
import { cx } from "@/components/ui";
import { useApp } from "@/components/providers";

/**
 * Dependency-free charts built from HTML/CSS so they inherit design tokens (light/dark)
 * and document direction (RTL flips the time axis naturally). Every chart exposes its
 * values as text: screen-reader labels on each mark plus an optional data table.
 */

export interface BarDatum { key: string; label: string; value: number; display: string }

/** Single-series vertical bar chart (e.g. daily tokens). Hover/focus shows a tooltip. */
export function BarChart({ data, title, maxLabel, height = 180, emptyLabel }: {
  data: BarDatum[]; title: string; maxLabel?: string; height?: number; emptyLabel?: string;
}) {
  const { t } = useApp();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const max = Math.max(0, ...data.map((d) => d.value));
  const empty = max === 0;
  // Show at most ~8 axis labels so they never collide on narrow screens.
  const every = Math.max(1, Math.ceil(data.length / 8));

  return (
    <figure className="m-0">
      <figcaption className="sr-only">{title}</figcaption>
      <div className="relative" style={{ height }}>
        {/* recessive grid: top, middle, baseline */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          <div className="border-t border-dashed border-border" />
          <div className="border-t border-dashed border-border" />
          <div className="border-t border-border-strong" />
        </div>
        {!empty && maxLabel && (
          <span aria-hidden className="absolute -top-2 end-0 rounded bg-surface px-1 text-[11px] tabular-nums text-fg-3">{maxLabel}</span>
        )}
        {empty ? (
          <div className="absolute inset-0 grid place-items-center text-[13px] text-fg-3">{emptyLabel ?? t("analytics.chart.noData")}</div>
        ) : (
          <ul aria-label={title} className="relative flex h-full items-end gap-[2px] pt-3">
            {data.map((d, i) => {
              const h = max ? (d.value / max) * 100 : 0;
              return (
                <li key={d.key} className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                  onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
                  <button
                    type="button"
                    onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                    className="flex h-full w-full items-end justify-center focus-visible:outline-offset-0"
                    aria-label={`${d.label}: ${d.display}`}
                  >
                    <span
                      className={cx("block w-full max-w-7 rounded-t-[4px] transition-colors", active === i ? "bg-accent-hover" : "bg-accent")}
                      style={{ height: `${Math.max(h, d.value > 0 ? 1.5 : 0)}%` }}
                    />
                  </button>
                  {active === i && (
                    <span role="status" className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-fg shadow-pop">
                      <span className="block text-fg-3">{d.label}</span>
                      <span className="font-semibold tabular-nums">{d.display}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {!empty && (
        <div aria-hidden className="mt-1.5 flex gap-[2px] text-[10.5px] text-fg-3">
          {data.map((d, i) => (
            <span key={d.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
              {i % every === 0 ? d.label : ""}
            </span>
          ))}
        </div>
      )}
      {!empty && (
        <div className="mt-3">
          <button type="button" className="text-[12px] font-medium text-accent hover:underline" aria-expanded={showTable} aria-controls={tableId}
            onClick={() => setShowTable((v) => !v)}>
            {showTable ? t("analytics.chart.hideTable") : t("analytics.chart.showTable")}
          </button>
          {showTable && (
            <div id={tableId} className="mt-2 max-h-56 overflow-auto rounded-lg border border-border">
              <table className="w-full text-[12.5px]">
                <caption className="sr-only">{title}</caption>
                <tbody>
                  {data.map((d) => (
                    <tr key={d.key} className="border-b border-border last:border-0">
                      <th scope="row" className="px-3 py-1.5 text-start font-normal text-fg-2">{d.label}</th>
                      <td className="px-3 py-1.5 text-end tabular-nums text-fg">{d.display}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

export interface Segment { key: string; label: string; value: number; color: string }

/**
 * Part-to-whole breakdown: a single stacked bar plus a legend that always carries the
 * label, count and share as text (identity never depends on color alone).
 */
export function BreakdownBar({ segments, title, emptyLabel }: { segments: Segment[]; title: string; emptyLabel?: string }) {
  const { t } = useApp();
  const total = segments.reduce((a, s) => a + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  if (!total) return <p className="py-6 text-center text-[13px] text-fg-3">{emptyLabel ?? t("analytics.chart.noData")}</p>;
  const pct = (v: number) => `${Math.round((v / total) * 1000) / 10}%`;
  return (
    <figure className="m-0">
      <figcaption className="sr-only">{title}</figcaption>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
        {visible.map((s) => (
          <span key={s.key} title={`${s.label}: ${s.value} (${pct(s.value)})`} className="h-full first:rounded-s-full last:rounded-e-full"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color, minWidth: 3 }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-2" aria-label={title}>
        {segments.map((s) => (
          <li key={s.key} className={cx("flex items-center gap-2", s.value === 0 && "opacity-60")}>
            <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-fg-2">{s.label}</span>
            <span className="tabular-nums font-medium text-fg">{s.value}</span>
            <span className="w-12 text-end tabular-nums text-fg-3">{pct(s.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Inline ratio meter for table cells (e.g. success rate). The numeric value is rendered beside it. */
export function Meter({ value, tone = "accent", label }: { value: number | null; tone?: "accent" | "success" | "warning" | "danger"; label: string }) {
  const color = { accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? undefined : Math.round(value * 100)}
      className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-surface-3 align-middle">
      {value != null && <span className={cx("block h-full rounded-full", color)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />}
    </span>
  );
}

/** Stacked outcome bar for a row (succeeded / failed / gated / other) — values shown as text elsewhere in the row. */
export function OutcomeBar({ parts }: { parts: Array<{ value: number; className: string }> }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return <span className="inline-block h-1.5 w-20 rounded-full bg-surface-3 align-middle" aria-hidden />;
  return (
    <span aria-hidden className="inline-flex h-1.5 w-20 gap-px overflow-hidden rounded-full bg-surface-3 align-middle">
      {parts.filter((p) => p.value > 0).map((p, i) => <span key={i} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />)}
    </span>
  );
}

/** CSS colors for status segments, via design tokens so they adapt to dark mode. */
export const STATUS_COLOR: Record<string, string> = {
  completed: "var(--success)", succeeded: "var(--success)", approved: "var(--success)",
  executed: "var(--info)", planned: "var(--info)",
  running: "var(--accent)",
  waiting_approval: "var(--warning)", pending: "var(--warning)", awaiting_approval: "var(--warning)",
  failed: "var(--danger)", rejected: "var(--danger)", blocked: "var(--danger)",
  paused: "var(--text-3)", cancelled: "var(--border-strong)", expired: "var(--border-strong)", superseded: "var(--surface-3)", draft: "var(--surface-3)",
};

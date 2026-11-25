"use client";

import { useMemo } from "react";
import { useApp } from "@/components/providers";

/**
 * Locale-aware number/duration formatting shared by the control pages.
 * Arabic uses Latin digits to stay consistent with timestamps and IDs across the app.
 */
export function useFormat() {
  const { locale, t } = useApp();
  return useMemo(() => {
    const tag = locale === "ar" ? "ar-u-nu-latn" : "en";
    const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
    const n1 = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
    const compact = new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 });
    const usd = new Intl.NumberFormat(tag, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const usdSmall = new Intl.NumberFormat(tag, { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });
    const dateFmt = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" });
    const dayFmt = new Intl.DateTimeFormat(tag, { month: "short", day: "numeric", timeZone: "UTC" });
    const timeFmt = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" });
    const fullDay = new Intl.DateTimeFormat(tag, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    return {
      num: (v: number | null | undefined) => (v == null ? "—" : n0.format(v)),
      dec: (v: number | null | undefined) => (v == null ? "—" : n1.format(v)),
      compact: (v: number | null | undefined) => (v == null ? "—" : compact.format(v)),
      usd: (v: number | null | undefined) => (v == null ? "—" : v > 0 && v < 0.01 ? usdSmall.format(v) : usd.format(v)),
      pct: (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${n1.format(v * 100)}%`),
      /** Milliseconds → "820 ms" / "12.3 s" / "4m 12s". */
      ms: (v: number | null | undefined) => {
        if (v == null || !Number.isFinite(v)) return "—";
        if (v < 1000) return t("analytics.fmt.ms", { n: n0.format(Math.round(v)) });
        if (v < 60_000) return t("analytics.fmt.s", { n: n1.format(v / 1000) });
        const m = Math.floor(v / 60_000);
        const s = Math.round((v % 60_000) / 1000);
        if (m < 60) return t("analytics.fmt.ms_m", { m: n0.format(m), s: n0.format(s) });
        return t("analytics.fmt.h_m", { h: n0.format(Math.floor(m / 60)), m: n0.format(m % 60) });
      },
      date: (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—"),
      time: (iso: string) => timeFmt.format(new Date(iso)),
      /** "YYYY-MM-DD" (UTC day) → "Nov 25". */
      day: (ymd: string) => dayFmt.format(new Date(`${ymd}T00:00:00Z`)),
      fullDay: (d: Date) => fullDay.format(d),
    };
  }, [locale, t]);
}

/** Success ratio of completed vs. failed, or null when there is nothing finished yet. */
export function successRate(completed: number, failed: number): number | null {
  const done = completed + failed;
  return done ? completed / done : null;
}

/** Translate a key, falling back to a given string when the key is missing. */
export function tOr(t: (k: string, v?: Record<string, string | number>) => string, key: string, fallback: string): string {
  const s = t(key);
  return s === key ? fallback : s;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Fetches JSON from the API with optional polling. `intervalMs` may be a function of the
 * latest data so polling can stop when, e.g., a task reaches a terminal state.
 */
export function useApi<T>(path: string | null, opts: { intervalMs?: number | ((d: T | null) => number | null) } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const dataRef = useRef<T | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      dataRef.current = d;
      setData(d);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!path) { setLoading(false); return; }
    setLoading(true);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      await load();
      if (stopped) return;
      const iv = optsRef.current.intervalMs;
      const next = typeof iv === "function" ? iv(dataRef.current) : iv;
      if (next && next > 0) timer = setTimeout(tick, document.hidden ? Math.max(next, 15_000) : next);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [path, load]);

  return { data, error, loading, reload: load, setData };
}

export function timeAgo(iso: string | null | undefined, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return t("time.justNow");
  if (s < 3600) return t("time.minutesAgo", { n: Math.round(s / 60) });
  if (s < 86400) return t("time.hoursAgo", { n: Math.round(s / 3600) });
  return t("time.daysAgo", { n: Math.round(s / 86400) });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

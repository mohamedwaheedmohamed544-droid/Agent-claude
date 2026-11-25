"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { TaskDetail, TaskStep } from "./types";

export const TERMINAL = new Set(["completed", "failed", "cancelled"]);
export const isTerminal = (s: string | undefined | null) => Boolean(s && TERMINAL.has(s));

/** Poll cadence for a task: fast while executing, slower while waiting on a human, stop when done. */
export function taskPollInterval(status: string | undefined | null): number | null {
  if (!status) return 2000;
  if (status === "planned" || status === "running") return 2000;
  if (status === "waiting_approval" || status === "paused" || status === "draft") return 6000;
  return null;
}

/**
 * Loads a task's full execution trace and keeps it fresh. Unlike useApi, polling can be restarted
 * with `kick()` after a control action (e.g. retrying a failed task).
 */
/** `onTerminal(status, observed)`: observed=false when the task was already finished on first load. */
export function useTaskDetail(taskId: string | null, opts: { onTerminal?: (status: string, observed: boolean) => void } = {}) {
  const [data, setData] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(Boolean(taskId));
  const [generation, setGeneration] = useState(0);
  const lastStatus = useRef<string | null>(null);
  const onTerminalRef = useRef(opts.onTerminal);
  onTerminalRef.current = opts.onTerminal;

  const load = useCallback(async (): Promise<TaskDetail | null> => {
    if (!taskId) return null;
    try {
      const d = await api<TaskDetail>(`/api/tasks/${taskId}`);
      setData(d);
      setError(null);
      const prev = lastStatus.current;
      lastStatus.current = d.task.status;
      // Report reaching a terminal state once: on an observed transition, or on first load
      // (a fast task may finish before the first poll; callers de-duplicate cheaply).
      if (isTerminal(d.task.status) && (!prev || !isTerminal(prev))) onTerminalRef.current?.(d.task.status, Boolean(prev));
      return d;
    } catch (e) {
      setError(e as Error);
      return null;
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const d = await load();
      if (stopped) return;
      const next = d ? taskPollInterval(d.task.status) : 8000;
      if (next) timer = setTimeout(tick, document.hidden ? Math.max(next, 15_000) : next);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [taskId, load, generation]);

  const kick = useCallback(() => setGeneration((g) => g + 1), []);
  return { data, error, loading, reload: load, kick };
}

/** Groups steps into layers by dependency depth: steps in the same layer can run in parallel. */
export function computeLayers(steps: TaskStep[]): TaskStep[][] {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const d = (s: TaskStep): number => {
    if (depth.has(s.key)) return depth.get(s.key)!;
    if (visiting.has(s.key)) return 0; // defensive: cycles should not exist
    visiting.add(s.key);
    const deps = (s.dependsOn ?? []).map((k) => byKey.get(k)).filter(Boolean) as TaskStep[];
    const v = deps.length ? Math.max(...deps.map(d)) + 1 : 0;
    visiting.delete(s.key);
    depth.set(s.key, v);
    return v;
  };
  steps.forEach(d);
  const layers: TaskStep[][] = [];
  for (const s of [...steps].sort((a, b) => a.position - b.position)) {
    const i = depth.get(s.key) ?? 0;
    (layers[i] ??= []).push(s);
  }
  return layers.filter(Boolean);
}

/** Unique agent-to-agent handoffs implied by step dependencies (e.g. research → writing). */
export function computeHandoffs(steps: Array<{ key: string; agent: string; dependsOn?: string[]; depends_on?: string[] }>): Array<[string, string]> {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const s of steps) {
    for (const k of s.dependsOn ?? s.depends_on ?? []) {
      const from = byKey.get(k);
      if (!from || from.agent === s.agent) continue;
      const id = `${from.agent}>${s.agent}`;
      if (!seen.has(id)) { seen.add(id); out.push([from.agent, s.agent]); }
    }
  }
  return out;
}

export function stepDurationMs(s: { startedAt: string | null; completedAt: string | null; status: string }): number | null {
  if (!s.startedAt) return null;
  const end = s.completedAt ? new Date(s.completedAt).getTime() : s.status === "running" ? Date.now() : null;
  if (end === null) return null;
  return Math.max(0, end - new Date(s.startedAt).getTime());
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function formatCost(usd: number | null | undefined): string {
  const v = Number(usd ?? 0);
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function formatNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat("en-US").format(Number(n ?? 0));
}

export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

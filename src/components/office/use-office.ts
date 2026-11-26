"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { ActivityEvent, AgentMessage, AgentPresence, OfficeState, OfficeStreamEvent } from "@/lib/office/types";

const MAX_EVENTS = 300;
const MAX_MESSAGES = 300;

function mergeById<T extends { id: string }>(a: T[], b: T[], max: number, numeric = false): T[] {
  const map = new Map(a.map((x) => [x.id, x]));
  for (const x of b) map.set(x.id, x);
  const all = [...map.values()];
  if (numeric) all.sort((x, y) => Number(x.id) - Number(y.id));
  else all.sort((x, y) => String((x as unknown as AgentMessage).createdAt).localeCompare(String((y as unknown as AgentMessage).createdAt)));
  return all.slice(-max);
}

/**
 * Live office data: initial snapshot from /api/office/state, then real-time updates over SSE
 * (/api/office/stream). Periodically re-syncs counts and meetings. Nothing is synthesized client-side.
 */
export function useOffice() {
  const [state, setState] = useState<OfficeState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [connected, setConnected] = useState(false);
  const lastIdRef = useRef<string | null>(null);
  const listeners = useRef(new Set<(events: ActivityEvent[]) => void>());

  const reload = useCallback(async () => {
    try {
      const s = await api<OfficeState>("/api/office/state");
      setState((prev) => {
        if (!prev) return s;
        return {
          ...s,
          events: mergeById(prev.events, s.events, MAX_EVENTS, true),
          messages: mergeById(prev.messages, s.messages, MAX_MESSAGES),
        };
      });
      if (!lastIdRef.current) lastIdRef.current = s.lastEventId;
      setError(null);
      return s;
    } catch (e) {
      setError(e as Error);
      return null;
    }
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let resync: ReturnType<typeof setInterval> | null = null;

    const open = () => {
      if (stopped) return;
      const after = lastIdRef.current ? `?after=${encodeURIComponent(lastIdRef.current)}` : "";
      es = new EventSource(`/api/office/stream${after}`);
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false); // EventSource reconnects automatically (Last-Event-ID)
      es.onmessage = (msg) => {
        if (msg.lastEventId) lastIdRef.current = msg.lastEventId;
        let data: OfficeStreamEvent;
        try { data = JSON.parse(msg.data); } catch { return; }
        if (data.kind === "presence") {
          setState((s) => (s ? { ...s, presence: data.presence as AgentPresence[] } : s));
        } else if (data.kind === "messages") {
          setState((s) => (s ? { ...s, messages: mergeById(s.messages, data.messages, MAX_MESSAGES) } : s));
        } else if (data.kind === "events") {
          setState((s) => (s ? { ...s, events: mergeById(s.events, data.events, MAX_EVENTS, true), lastEventId: data.events.at(-1)?.id ?? s.lastEventId } : s));
          listeners.current.forEach((fn) => fn(data.events));
          // Counts and meeting list change on these business events.
          if (data.events.some((e) => ["meeting_started", "meeting_ended", "task_received", "task_completed", "task_failed", "waiting_approval", "step_completed"].includes(e.type))) {
            void reload();
          }
        }
      };
    };

    void reload().then(() => open());
    resync = setInterval(() => { if (!document.hidden) void reload(); }, 30_000);
    return () => {
      stopped = true;
      es?.close();
      if (resync) clearInterval(resync);
    };
  }, [reload]);

  const onEvents = useCallback((fn: (events: ActivityEvent[]) => void) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);

  return { state, error, connected, reload, onEvents };
}

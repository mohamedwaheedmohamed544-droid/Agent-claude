"use client";

// TEMPORARY visual-verification route driven by generated FIXTURES (not real data). Deleted before hand-off.
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { ActivityEvent, AgentMessage, OfficeZone } from "@/lib/office/types";
import { makeFixture, type Fixture } from "./fixtures";

const OfficeScene = dynamic(() => import("@/components/office/scene/office-scene"), { ssr: false });

type State = Fixture & { events: ActivityEvent[]; messages: AgentMessage[]; selected: string | null; focus: OfficeZone | null; follow: boolean; floor: number | "all"; locale: "en" | "ar"; quality: "auto" | "high" | "low"; dimmed: string[] };

declare global { interface Window { __fixture?: { set: (f: (s: State) => State) => void; make: typeof makeFixture } } }

export default function Preview() {
  const [s, setS] = useState<State>(() => {
    const n = typeof window !== "undefined" ? Number(new URLSearchParams(window.location.search).get("n") ?? 8) : 8;
    return { ...makeFixture(n), events: [], messages: [], selected: null, focus: null, follow: false, floor: 0, locale: "en", quality: "high", dimmed: [] };
  });
  useEffect(() => { window.__fixture = { set: (f) => setS((x) => f(x)), make: makeFixture }; }, []);
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <OfficeScene profiles={s.profiles} presence={s.presence} events={s.events} messages={s.messages} layout={s.layout} floor={s.floor}
        onFloorChange={(f) => setS((p) => ({ ...p, floor: f }))}
        selectedAgent={s.selected} onSelectAgent={(x) => setS((p) => ({ ...p, selected: x }))}
        cameraMode={s.follow ? "follow" : "orbit"} focusZone={s.focus} dimmedAgents={s.dimmed} quality={s.quality} locale={s.locale} />
    </div>
  );
}

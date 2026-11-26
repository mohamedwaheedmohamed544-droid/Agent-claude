"use client";

import { useEffect, useLayoutEffect, useMemo, useState, type JSX } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { AdaptiveDpr, Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import type { ActivityEvent, AgentMessage, AgentPresence, AgentProfile, AgentStatus, OfficeZone } from "@/lib/office/types";
import { SceneContext, type SceneCtx } from "./context";
import { SceneResources, type QualityTier } from "./resources";
import { OfficeSim } from "./simulation";
import { OfficeEnvironment } from "./environment";
import { OfficeDisplays } from "./displays";
import { Characters } from "./characters";
import { CameraRig } from "./camera-rig";
import { AgentOverlay, OverlayRegistry } from "./overlay";
import { OFFICE_ZONE_LABELS as ZONE_LABELS } from "./layout";

export interface OfficeSceneProps {
  profiles: AgentProfile[];
  presence: AgentPresence[];
  /** Ascending by numeric id; only ids newer than the first batch received are acted on. */
  events: ActivityEvent[];
  messages: AgentMessage[];
  selectedAgent: string | null;
  onSelectAgent: (slug: string | null) => void;
  cameraMode: "orbit" | "follow";
  focusZone: OfficeZone | null;
  dimmedAgents: string[];
  quality: "auto" | "high" | "low";
  locale: "en" | "ar";
}

export const OFFICE_ZONE_LABELS: Record<OfficeZone, { en: string; ar: string }> = ZONE_LABELS;

export function isWebGLAvailable(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const ok = Boolean(gl);
    (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function useDarkTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const on = () => setDark(el.getAttribute("data-theme") === "dark");
    on();
    const mo = new MutationObserver(on);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

/** Stops rendering entirely while the tab is hidden. */
function VisibilityLoop() {
  const setFrameloop = useThree((s) => s.setFrameloop);
  useEffect(() => {
    const on = () => setFrameloop(document.hidden ? "never" : "always");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [setFrameloop]);
  return null;
}

function Lighting({ tier, dark }: { tier: QualityTier; dark: boolean }) {
  const shadows = tier !== "low";
  const mapSize = tier === "high" ? 2048 : 1024;
  return (
    <>
      <hemisphereLight args={["#f6f1e7", "#8f8676", dark ? 0.4 : 0.5]} />
      <ambientLight intensity={0.06} />
      <directionalLight
        key={`${tier}`}
        position={[12, 22, 15]}
        intensity={2.6}
        color="#ffe9cc"
        castShadow={shadows}
        shadow-mapSize-width={mapSize}
        shadow-mapSize-height={mapSize}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
        shadow-camera-near={2}
        shadow-camera-far={70}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      {/* Local image-based lighting built from light cards (no network fetch). */}
      <Environment resolution={128} frames={1} environmentIntensity={0.38}>
        <color attach="background" args={["#d8d4cc"]} />
        <Lightformer form="rect" intensity={2.2} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[24, 14, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#dfeaf5" position={[0, 3, -14]} scale={[30, 4, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#fff0dc" position={[16, 4, 10]} rotation-y={-Math.PI / 3} scale={[12, 5, 1]} />
        <Lightformer form="ring" intensity={0.8} position={[-12, 5, 8]} scale={4} />
      </Environment>
    </>
  );
}

function Feeds({ sim, profiles, presence, messages, events }: { sim: OfficeSim; profiles: AgentProfile[]; presence: AgentPresence[]; messages: AgentMessage[]; events: ActivityEvent[] }) {
  // Order matters: roster → placement → message lookup → transient events.
  useLayoutEffect(() => { sim.setProfiles(profiles); }, [sim, profiles]);
  useLayoutEffect(() => { sim.setPresence(presence); }, [sim, presence, profiles]);
  useLayoutEffect(() => { sim.setMessages(messages); }, [sim, messages]);
  useLayoutEffect(() => { sim.ingestEvents(events); }, [sim, events]);
  return null;
}

export default function OfficeScene(props: OfficeSceneProps): JSX.Element {
  const { profiles, presence, events, messages, selectedAgent, onSelectAgent, cameraMode, focusZone, dimmedAgents, quality, locale } = props;
  const reducedMotion = usePrefersReducedMotion();
  const dark = useDarkTheme();
  const [sim] = useState(() => new OfficeSim());
  const [res] = useState(() => new SceneResources());
  const [overlay] = useState(() => new OverlayRegistry());
  useEffect(() => () => res.dispose(), [res]);

  const [autoTier, setAutoTier] = useState<QualityTier>("medium");
  const tier: QualityTier = quality === "high" ? "high" : quality === "low" ? "low" : autoTier;
  const dpr: number | [number, number] = quality === "low" ? 1 : quality === "high" ? [1, 2] : [1, 1.75];

  const ctx = useMemo<SceneCtx>(() => ({ res, sim, overlay, tier, locale, reducedMotion }), [res, sim, overlay, tier, locale, reducedMotion]);

  const zoneColors = useMemo(() => {
    const m: Partial<Record<OfficeZone, string>> = {};
    for (const p of profiles) if (!m[p.deskZone]) m[p.deskZone] = p.color;
    return m;
  }, [profiles]);
  const statusByZone = useMemo(() => {
    const byAgent = new Map(presence.map((p) => [p.agent, p.status]));
    const m: Partial<Record<OfficeZone, AgentStatus>> = {};
    for (const p of profiles) if (!m[p.deskZone]) m[p.deskZone] = byAgent.get(p.slug) ?? "idle";
    return m;
  }, [profiles, presence]);
  const lastStatement = useMemo(() => {
    const live = new Set(presence.filter((p) => p.status === "meeting" && p.meetingId).map((p) => p.meetingId));
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type !== "meeting_message" || (e.meetingId && live.size && !live.has(e.meetingId))) continue;
      const mid = typeof e.payload.messageId === "string" ? e.payload.messageId : null;
      const content = typeof e.payload.content === "string" ? e.payload.content : (mid && messages.find((m) => m.id === mid)?.content) || e.summary;
      return { agent: e.agent, content };
    }
    return null;
  }, [events, messages, presence]);

  const statusBy = useMemo(() => new Map(presence.map((p) => [p.agent, p.status])), [presence]);
  const dimmedSet = useMemo(() => new Set(dimmedAgents), [dimmedAgents]);
  const follow = cameraMode === "follow" && selectedAgent ? selectedAgent : null;
  const bg = dark ? "#1b1d23" : "#e7e3dc";
  const label = locale === "ar" ? "المكتب الافتراضي ثلاثي الأبعاد" : "3D virtual office";

  return (
    <div
      className="relative isolate h-full w-full min-h-0 overflow-hidden"
      role="region"
      aria-label={label}
      onKeyDown={(e) => { if (e.key === "Escape" && selectedAgent) onSelectAgent(null); }}
    >
      <Feeds sim={sim} profiles={profiles} presence={presence} messages={messages} events={events} />
      <Canvas
        shadows="percentage"
        dpr={dpr}
        gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
        camera={{ fov: 38, near: 0.1, far: 240, position: [6, 30, 32] }}
        performance={{ min: 0.5 }}
        style={{ touchAction: "none" }}
      >
        <SceneContext.Provider value={ctx}>
          <color attach="background" args={[bg]} />
          <fog attach="fog" args={[bg, 60, 140]} />
          <VisibilityLoop />
          {quality === "auto" && (
            <>
              <PerformanceMonitor
                flipflops={3}
                onDecline={() => setAutoTier("low")}
                onIncline={() => setAutoTier("medium")}
                onFallback={() => setAutoTier("low")}
              />
              <AdaptiveDpr pixelated={false} />
            </>
          )}
          <Lighting tier={tier} dark={dark} />
          <OfficeEnvironment onFloorClick={() => onSelectAgent(null)} zoneColors={zoneColors} statusByZone={statusByZone} />
          <OfficeDisplays profiles={profiles} presence={presence} lastStatement={lastStatement} />
          <Characters profiles={profiles} presence={presence} selectedAgent={selectedAgent} dimmedAgents={dimmedAgents} onSelectAgent={onSelectAgent} />
          <CameraRig focusZone={focusZone} follow={follow} />
        </SceneContext.Provider>
      </Canvas>
      <AgentOverlay sim={sim} registry={overlay} profiles={profiles} statusBy={statusBy} selectedAgent={selectedAgent} dimmed={dimmedSet} locale={locale} onSelectAgent={onSelectAgent} />
    </div>
  );
}

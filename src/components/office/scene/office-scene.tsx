"use client";

import { useEffect, useLayoutEffect, useMemo, useState, type JSX } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { AdaptiveDpr, Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import type { ActivityEvent, AgentMessage, AgentPresence, AgentProfile, AgentStatus, OfficeLayoutSpec, OfficeZone } from "@/lib/office/types";
import { SceneContext, type SceneCtx } from "./context";
import { SceneResources, type QualityTier } from "./resources";
import { OfficeSim } from "./simulation";
import { OfficeEnvironment } from "./environment";
import { OfficeDisplays } from "./displays";
import { Characters } from "./characters";
import { CameraRig } from "./camera-rig";
import { AgentOverlay, OverlayRegistry } from "./overlay";
import { floorOffset, floorVisible, generateOfficePlan, zoneLabel as planZoneLabel, type OfficePlan, type Rect } from "./plan";

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
  /** Logical office plan from the server; geometry is regenerated only when `layout.revision` changes. */
  layout: OfficeLayoutSpec;
  /** Floor to show (0-based), or "all" for the exploded multi-floor view. */
  floor: number | "all";
  /** Called when the scene needs another floor (follow mode, department focus). */
  onFloorChange?: (floor: number) => void;
}

/** Localised display name for a department, meeting room or lounge key. */
export function zoneLabel(layout: OfficeLayoutSpec, key: OfficeZone, locale: "en" | "ar"): string {
  return planZoneLabel(layout, key, locale);
}

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
  const glDbg = useThree((s) => s.gl); useEffect(() => { (window as unknown as Record<string, unknown>).__DBG_GL = glDbg; }, [glDbg]); // DEBUG-REMOVE
  useEffect(() => {
    const on = () => setFrameloop(document.hidden ? "never" : "always");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [setFrameloop]);
  return null;
}

function Lighting({ tier, dark, bounds }: { tier: QualityTier; dark: boolean; bounds: Rect }) {
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const half = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + 4;
  // Very wide exploded views would need huge shadow maps; skip shadows there.
  const shadows = tier !== "low" && half < 60;
  const mapSize = tier === "high" ? 2048 : 1024;
  const [target] = useState(() => new THREE.Object3D());
  useLayoutEffect(() => { target.position.set(cx, 0, cz); target.updateMatrixWorld(); }, [target, cx, cz]);
  return (
    <>
      <hemisphereLight args={["#f6f1e7", "#8f8676", dark ? 0.4 : 0.5]} />
      <ambientLight intensity={0.06} />
      <primitive object={target} />
      <directionalLight
        key={`${tier}:${half.toFixed(0)}`}
        target={target}
        position={[cx + 12, 26, cz + 15]}
        intensity={2.6}
        color="#ffe9cc"
        castShadow={shadows}
        shadow-mapSize-width={mapSize}
        shadow-mapSize-height={mapSize}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
        shadow-camera-near={2}
        shadow-camera-far={90}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
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

function Feeds({ sim, plan, layout, profiles, presence, messages, events }: {
  sim: OfficeSim; plan: OfficePlan; layout: OfficeLayoutSpec; profiles: AgentProfile[]; presence: AgentPresence[]; messages: AgentMessage[]; events: ActivityEvent[];
}) {
  // Order matters: plan → settings → roster (diffed) → placement → message lookup → transient events.
  useLayoutEffect(() => { sim.setPlan(plan); }, [sim, plan]);
  useLayoutEffect(() => { sim.setSettings({ characterScale: layout.characterScale, ambientLounge: layout.ambientLounge }); }, [sim, layout.characterScale, layout.ambientLounge]);
  useLayoutEffect(() => { sim.setProfiles(profiles); }, [sim, profiles, plan]);
  useLayoutEffect(() => { sim.setPresence(presence); }, [sim, presence, profiles, plan]);
  useLayoutEffect(() => { sim.setMessages(messages); }, [sim, messages]);
  useLayoutEffect(() => { sim.ingestEvents(events); }, [sim, events]);
  return null;
}

function visibleBounds(plan: OfficePlan, view: number | "all", offsets: number[]): Rect {
  const r: Rect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const f of plan.floors) {
    if (!floorVisible(f.index, view)) continue;
    const o = offsets[f.index] ?? 0;
    r.minX = Math.min(r.minX, f.bounds.minX + o); r.maxX = Math.max(r.maxX, f.bounds.maxX + o);
    r.minZ = Math.min(r.minZ, f.bounds.minZ); r.maxZ = Math.max(r.maxZ, f.bounds.maxZ);
  }
  return Number.isFinite(r.minX) ? r : { minX: -10, maxX: 10, minZ: 0, maxZ: 14 };
}

export default function OfficeScene(props: OfficeSceneProps): JSX.Element {
  const { profiles, presence, events, messages, selectedAgent, onSelectAgent, cameraMode, focusZone, dimmedAgents, quality, locale, layout, floor, onFloorChange } = props;
  // Static layout is regenerated only when the server's plan revision changes.
  const plan = useMemo(() => generateOfficePlan(layout), [layout.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const view: number | "all" = floor === "all" && plan.floors.length > 1 ? "all" : Math.min(plan.floors.length - 1, Math.max(0, typeof floor === "number" ? floor : 0));
  const offsets = useMemo(() => plan.floors.map((f) => floorOffset(plan, f.index, view)), [plan, view]);
  const bounds = useMemo(() => visibleBounds(plan, view, offsets), [plan, view, offsets]);
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

  // Desk monitors reflect their occupant's real status (no occupant → screen off).
  const { statusByDesk, accentByDesk } = useMemo(() => {
    const byAgent = new Map(presence.map((p) => [p.agent, p.status]));
    const bySlug = new Map(profiles.map((p) => [p.slug, p]));
    const status = new Map<string, AgentStatus>(), accent = new Map<string, string>();
    for (const d of plan.desks.values()) {
      const occupant = profiles.find((p) => p.workstationId === d.id) ?? (d.agentSlug ? bySlug.get(d.agentSlug) : undefined);
      if (!occupant) continue;
      status.set(d.id, byAgent.get(occupant.slug) ?? "idle");
      accent.set(d.id, occupant.color);
    }
    return { statusByDesk: status, accentByDesk: accent };
  }, [plan, profiles, presence]);
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
      <Feeds sim={sim} plan={plan} layout={layout} profiles={profiles} presence={presence} messages={messages} events={events} />
      <Canvas
        shadows="percentage"
        dpr={dpr}
        gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
        camera={{ fov: 38, near: 0.1, far: 400, position: [6, 30, 32] }}
        performance={{ min: 0.5 }}
        style={{ touchAction: "none" }}
      >
        <SceneContext.Provider value={ctx}>
          <color attach="background" args={[bg]} />
          <fog attach="fog" args={[bg, Math.max(60, (bounds.maxX - bounds.minX) * 1.4), Math.max(140, (bounds.maxX - bounds.minX) * 3.2)]} />
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
          <Lighting tier={tier} dark={dark} bounds={bounds} />
          <OfficeEnvironment plan={plan} view={view} offsets={offsets} onFloorClick={() => onSelectAgent(null)} statusByDesk={statusByDesk} accentByDesk={accentByDesk} />
          <OfficeDisplays plan={plan} view={view} offsets={offsets} profiles={profiles} presence={presence} lastStatement={lastStatement} locale={locale} />
          <Characters presence={presence} selectedAgent={selectedAgent} dimmedAgents={dimmedAgents} view={view} offsets={offsets}
            showLabels={layout.showLabels} characterScale={layout.characterScale} onSelectAgent={onSelectAgent} />
          <CameraRig plan={plan} view={view} offsets={offsets} focusZone={focusZone} follow={follow}
            defaultView={layout.camera?.defaultView ?? "overview"} autoRotate={Boolean(layout.camera?.autoRotate)} onFloorChange={onFloorChange} />
        </SceneContext.Provider>
      </Canvas>
      <AgentOverlay sim={sim} registry={overlay} statusBy={statusBy} selectedAgent={selectedAgent} dimmed={dimmedSet} locale={locale} onSelectAgent={onSelectAgent} />
    </div>
  );
}

"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { AgentPresence, AgentProfile, AgentStatus } from "@/lib/office/types";
import { useScene } from "./context";
import { buildCharacter, HIP_HEIGHT, type CharacterRig } from "./character-model";
import { applyPose } from "./poses";
import type { CharacterSnapshot } from "./simulation";

declare global {
  interface Window {
    __NEXUS_OFFICE__?: { ready: boolean; characters: Record<string, CharacterSnapshot> };
  }
}

interface Registered {
  rig: CharacterRig;
  group: THREE.Group;
  proxy: THREE.Mesh;
  ring: THREE.Mesh;
  alert: THREE.Mesh;
  shadow: THREE.Mesh;
  height: number;
}

type Register = (slug: string, r: Registered | null) => void;

interface SharedGeo { ring: THREE.RingGeometry; alert: THREE.RingGeometry; blob: THREE.PlaneGeometry; proxy: THREE.CylinderGeometry }

interface CharacterProps {
  profile: AgentProfile;
  status: AgentStatus;
  selected: boolean;
  dimmed: boolean;
  geo: SharedGeo;
  register: Register;
  onSelect: (slug: string | null) => void;
}

const Character = memo(function Character({ profile, status, selected, dimmed, geo, register, onSelect }: CharacterProps) {
  const { res, tier } = useScene();
  const rig = useMemo(() => buildCharacter(profile, res), [profile, res]);
  useEffect(() => () => rig.dispose(), [rig]);

  const group = useRef<THREE.Group>(null);
  const proxy = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const alert = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);

  const mats = useMemo(() => ({
    ring: new THREE.MeshBasicMaterial({ color: profile.color, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }),
    alert: new THREE.MeshBasicMaterial({ color: "#ef4444", transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }),
    proxy: new THREE.MeshBasicMaterial({ visible: false }),
  }), [profile.color]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useLayoutEffect(() => {
    const g = group.current!;
    g.add(rig.root);
    register(profile.slug, { rig, group: g, proxy: proxy.current!, ring: ring.current!, alert: alert.current!, shadow: shadow.current!, height: profile.appearance.height });
    return () => { register(profile.slug, null); g.remove(rig.root); };
  }, [rig, register, profile.slug, profile.appearance.height]);

  useEffect(() => { rig.setVariant(dimmed ? "ghost" : status === "paused" ? "muted" : "normal"); }, [rig, dimmed, status]);
  useEffect(() => { rig.setShadows(tier !== "low" && !dimmed); }, [rig, tier, dimmed]);

  const onProxyClick = (e: ThreeEvent<MouseEvent>) => {
    if (dimmed || e.delta > 6) return;
    e.stopPropagation();
    onSelect(profile.slug);
  };

  return (
    <group ref={group}>
      <mesh
        ref={proxy}
        geometry={geo.proxy}
        material={mats.proxy}
        position-y={profile.appearance.height / 2}
        scale={[1, profile.appearance.height, 1]}
        onClick={onProxyClick}
        onPointerOver={(e) => { if (!dimmed) { e.stopPropagation(); document.body.style.cursor = "pointer"; } }}
        onPointerOut={() => { document.body.style.cursor = ""; }}
      />
      <mesh ref={shadow} geometry={geo.blob} material={res.mats.blob} position-y={0.012} rotation-x={-Math.PI / 2} raycast={() => null} renderOrder={1} />
      <mesh ref={ring} geometry={geo.ring} material={mats.ring} position-y={0.02} rotation-x={-Math.PI / 2} visible={selected && !dimmed} raycast={() => null} renderOrder={1} />
      <mesh ref={alert} geometry={geo.alert} material={mats.alert} position-y={0.016} rotation-x={-Math.PI / 2} visible={status === "error" && !dimmed} raycast={() => null} renderOrder={1} />
    </group>
  );
});

export interface CharactersProps {
  profiles: AgentProfile[];
  presence: AgentPresence[];
  selectedAgent: string | null;
  dimmedAgents: string[];
  onSelectAgent: (slug: string | null) => void;
}

export function Characters({ profiles, presence, selectedAgent, dimmedAgents, onSelectAgent }: CharactersProps) {
  const { sim, overlay } = useScene();
  const registry = useRef(new Map<string, Registered>());

  const geo = useMemo<SharedGeo>(() => ({
    ring: new THREE.RingGeometry(0.42, 0.5, 40),
    alert: new THREE.RingGeometry(0.34, 0.4, 32),
    blob: new THREE.PlaneGeometry(0.9, 0.9),
    proxy: new THREE.CylinderGeometry(0.3, 0.3, 1, 8),
  }), []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);

  const register = useMemo<Register>(() => (slug, r) => {
    if (r) registry.current.set(slug, r);
    else registry.current.delete(slug);
  }, []);

  useEffect(() => () => {
    document.body.style.cursor = "";
    if (window.__NEXUS_OFFICE__) window.__NEXUS_OFFICE__ = { ready: false, characters: {} };
  }, []);

  const frames = useRef(0);
  const hookTimer = useRef(0);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, size }, delta) => {
    sim.update(delta);
    const t = sim.time;
    for (const a of sim.list) {
      const r = registry.current.get(a.slug);
      if (!r) continue;
      r.group.position.set(a.x, 0, a.z);
      r.group.rotation.y = a.yaw;
      applyPose(r.rig, a.out, a.gait);
      const drop = (HIP_HEIGHT * a.scale - ((a.seat?.height ?? 0.47) + 0.065)) * a.sit;
      const h = r.height - drop;
      r.proxy.scale.y = h;
      r.proxy.position.y = h / 2;
      r.shadow.scale.setScalar(1 + a.sit * 0.35);
      if (r.ring.visible) r.ring.scale.setScalar(1 + 0.06 * Math.sin(t * 3));
      if (r.alert.visible) {
        const k = 0.5 + 0.5 * Math.sin(t * 5);
        r.alert.scale.setScalar(1 + 0.25 * k);
        (r.alert.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.5 * (1 - k);
      }

      // Screen-space anchors for the HTML label and speech bubble.
      const label = overlay.labels.get(a.slug);
      if (label) {
        v.set(a.x, h + 0.3, a.z).project(camera);
        const on = v.z < 1; // off-screen labels are clipped by the overlay; only hide when behind the camera
        overlay.place(label, (v.x * 0.5 + 0.5) * size.width, (0.5 - v.y * 0.5) * size.height, 100 + Math.round((1 - v.z) * 5000), on);
      }
      const bubble = overlay.bubbles.get(a.slug);
      if (bubble) {
        v.set(a.x, h + 0.52, a.z).project(camera);
        const on = v.z < 1;
        const margin = Math.min(138, size.width * 0.31 + 8); // keep the whole bubble on screen
        const bx = THREE.MathUtils.clamp((v.x * 0.5 + 0.5) * size.width, margin, Math.max(margin, size.width - margin));
        overlay.place(bubble, bx, (0.5 - v.y * 0.5) * size.height, 20000 + Math.round((1 - v.z) * 5000), on);
      }
    }

    // End-to-end test hook (throttled).
    frames.current++;
    hookTimer.current += delta;
    if (frames.current === 2 || hookTimer.current > 0.25) {
      hookTimer.current = 0;
      window.__NEXUS_OFFICE__ = { ready: frames.current >= 2 && sim.list.length > 0, characters: sim.snapshot() };
    }
  });

  const statusBy = useMemo(() => new Map(presence.map((p) => [p.agent, p.status])), [presence]);
  const dimmed = useMemo(() => new Set(dimmedAgents), [dimmedAgents]);

  return (
    <group>
      {profiles.map((p) => (
        <Character
          key={p.slug}
          profile={p}
          status={statusBy.get(p.slug) ?? "idle"}
          selected={selectedAgent === p.slug}
          dimmed={dimmed.has(p.slug)}
          geo={geo}
          register={register}
          onSelect={onSelectAgent}
        />
      ))}
    </group>
  );
}

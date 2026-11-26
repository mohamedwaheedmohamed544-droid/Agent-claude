"use client";

import { useEffect, useMemo, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OfficeZone } from "@/lib/office/types";
import { useScene } from "./context";
import { floorVisible, type OfficePlan, type Rect, type Vec2 } from "./plan";

type Controls = ComponentRef<typeof OrbitControls>;

/** Elevated 3/4 views: from the south on landscape screens, from the east on portrait ones (long axis vertical). */
const VIEW_LANDSCAPE = new THREE.Vector3(0.22, 1.0, 0.95).normalize();
const VIEW_PORTRAIT = new THREE.Vector3(0.95, 1.05, 0.22).normalize();
const MIN_DIST = 3.5;

/** Camera position/target that frames a rect from the standard elevated 3/4 direction. */
function frame(r: Rect, isZone: boolean, camera: THREE.PerspectiveCamera, aspect: number) {
  const portrait = aspect < 0.85;
  const center = new THREE.Vector3((r.minX + r.maxX) / 2, isZone ? 0.6 : 0, (r.minZ + r.maxZ) / 2);
  const w = portrait ? r.maxZ - r.minZ : r.maxX - r.minX;
  const d = portrait ? r.maxX - r.minX : r.maxZ - r.minZ;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const needV = (d * 0.72 + 1.2) / 2 / Math.tan(vfov / 2);
  const needH = (w + 1.0) / 2 / Math.tan(hfov / 2);
  const dist = Math.max(MIN_DIST + 2, Math.max(needV, needH) * (isZone ? 1.15 : 1.2) * (portrait && !isZone ? 1.08 : 1));
  return { target: center, position: center.clone().addScaledVector(portrait ? VIEW_PORTRAIT : VIEW_LANDSCAPE, dist), dist };
}

const ZERO: Vec2 = { x: 0, z: 0 };
export function visibleBounds(plan: OfficePlan, view: number | "all", offsets: Vec2[]): Rect {
  const r: Rect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const f of plan.floors) {
    if (!floorVisible(f.index, view)) continue;
    const o = offsets[f.index] ?? ZERO;
    r.minX = Math.min(r.minX, f.bounds.minX + o.x); r.maxX = Math.max(r.maxX, f.bounds.maxX + o.x);
    r.minZ = Math.min(r.minZ, f.bounds.minZ + o.z); r.maxZ = Math.max(r.maxZ, f.bounds.maxZ + o.z);
  }
  return Number.isFinite(r.minX) ? r : { minX: -10, maxX: 10, minZ: 0, maxZ: 14 };
}

export interface CameraRigProps {
  plan: OfficePlan;
  view: number | "all";
  offsets: Vec2[];
  focusZone: OfficeZone | null;
  follow: string | null;
  defaultView: "overview" | "executive";
  autoRotate: boolean;
  onFloorChange?: (floor: number) => void;
}

export function CameraRig({ plan, view, offsets, focusZone, follow, defaultView, autoRotate, onFloorChange }: CameraRigProps) {
  const { sim, reducedMotion } = useScene();
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const anim = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const initialized = useRef(false);
  const userMoved = useRef(false);
  const tmp = useRef({ v: new THREE.Vector3(), off: new THREE.Vector3(), t: new THREE.Vector3() });
  const floorChange = useRef(onFloorChange);
  floorChange.current = onFloorChange;

  const bounds = useMemo(() => visibleBounds(plan, view, offsets), [plan, view, offsets]);
  const boundsKey = `${bounds.minX.toFixed(1)},${bounds.maxX.toFixed(1)},${bounds.minZ.toFixed(1)},${bounds.maxZ.toFixed(1)}`;
  const overview = useMemo(() => frame(bounds, false, camera, Math.max(0.2, size.width / Math.max(1, size.height))), [bounds, camera, size.width, size.height]);
  const maxDistance = Math.max(48, overview.dist * 1.35);

  // Department focus on another floor → ask the page to switch floors.
  const focusInfo = focusZone ? plan.zones.get(focusZone) ?? null : null;
  useEffect(() => {
    if (focusInfo && !floorVisible(focusInfo.floor, view)) floorChange.current?.(focusInfo.floor);
  }, [focusInfo, view]);

  // Framing: initial (instant), department focus / floor / layout changes (animated unless reduced motion).
  useEffect(() => {
    const c = controls.current;
    if (!c || size.width === 0 || size.height === 0) return;
    const aspect = size.width / size.height;
    let f = overview;
    if (focusInfo && floorVisible(focusInfo.floor, view)) {
      const o = offsets[focusInfo.floor] ?? ZERO;
      f = frame({ minX: focusInfo.rect.minX + o.x, maxX: focusInfo.rect.maxX + o.x, minZ: focusInfo.rect.minZ + o.z, maxZ: focusInfo.rect.maxZ + o.z }, true, camera, aspect);
    } else if (!initialized.current && defaultView === "executive") {
      const exec = [...plan.zones.values()].find((z) => z.kind === "executive" && floorVisible(z.floor, view));
      if (exec) {
        const o = offsets[exec.floor] ?? ZERO;
        f = frame({ minX: exec.rect.minX + o.x - 2, maxX: exec.rect.maxX + o.x + 2, minZ: exec.rect.minZ + o.z - 1, maxZ: exec.rect.maxZ + o.z + 2 }, true, camera, aspect);
      }
    }
    if (!initialized.current || reducedMotion) {
      initialized.current = true;
      camera.position.copy(f.position);
      c.target.copy(f.target);
      c.update();
      anim.current = null;
    } else {
      anim.current = { position: f.position, target: f.target };
    }
    userMoved.current = false;
    // boundsKey captures layout/floor changes without re-framing on unrelated re-renders.
  }, [focusInfo, boundsKey, reducedMotion, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // User input cancels any automatic camera move.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const stop = () => { anim.current = null; userMoved.current = true; };
    c.addEventListener("start", stop);
    return () => c.removeEventListener("start", stop);
  }, []);

  const lastFollowFloor = useRef<number | null>(null);
  useFrame((_, rawDt) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(rawDt, 0.1);
    const { v, off, t } = tmp.current;

    if (follow) {
      const a = sim.agents.get(follow);
      if (a) {
        if (!floorVisible(a.floor, view) && lastFollowFloor.current !== a.floor) {
          lastFollowFloor.current = a.floor;
          floorChange.current?.(a.floor);
        } else if (floorVisible(a.floor, view)) lastFollowFloor.current = a.floor;
        const o = offsets[a.floor] ?? ZERO;
        const fb = plan.floors[a.floor]?.bounds ?? bounds;
        t.set(a.x + o.x, 1.1 - 0.35 * a.sit, a.z + o.z);
        const dist = THREE.MathUtils.clamp(camera.position.distanceTo(c.target), MIN_DIST, 18);
        // Behind and above the character, at the user's zoom distance, staying inside the building.
        off.set(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)).multiplyScalar(dist * 0.62);
        off.y = dist * 0.78;
        v.copy(t).add(off);
        v.x = THREE.MathUtils.clamp(v.x, fb.minX + o.x + 0.6, fb.maxX + o.x - 0.6);
        v.z = THREE.MathUtils.clamp(v.z, fb.minZ + o.z + 0.6, fb.maxZ + o.z + 4);
        const k = reducedMotion ? 1 : 1 - Math.exp(-3.2 * dt);
        c.target.lerp(t, k);
        camera.position.lerp(v, k);
        anim.current = null;
      }
    } else if (anim.current) {
      const k = 1 - Math.exp(-3.5 * dt);
      camera.position.lerp(anim.current.position, k);
      c.target.lerp(anim.current.target, k);
      if (camera.position.distanceTo(anim.current.position) < 0.03 && c.target.distanceTo(anim.current.target) < 0.03) anim.current = null;
    }

    // Keep the orbit target over the visible office and the camera above the floor.
    c.target.x = THREE.MathUtils.clamp(c.target.x, bounds.minX, bounds.maxX);
    c.target.z = THREE.MathUtils.clamp(c.target.z, bounds.minZ, bounds.maxZ);
    c.target.y = THREE.MathUtils.clamp(c.target.y, 0, 3);
    if (camera.position.y < 1.2) camera.position.y = 1.2;
  });

  useEffect(() => {
    camera.far = Math.max(240, maxDistance * 3);
    camera.updateProjectionMatrix();
  }, [camera, maxDistance]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={MIN_DIST}
      maxDistance={maxDistance}
      minPolarAngle={0.12}
      maxPolarAngle={1.32}
      enableRotate={!follow}
      enablePan={!follow}
      screenSpacePanning={false}
      zoomSpeed={0.8}
      rotateSpeed={0.6}
      autoRotate={autoRotate && !follow && !reducedMotion && !focusZone}
      autoRotateSpeed={0.35}
      regress
    />
  );
}

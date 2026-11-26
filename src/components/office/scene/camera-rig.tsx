"use client";

import { useEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OfficeZone } from "@/lib/office/types";
import { useScene } from "./context";
import { FLOOR, framingRect } from "./layout";

type Controls = ComponentRef<typeof OrbitControls>;

/** Elevated 3/4 views: from the south on landscape screens, from the east on portrait ones (long axis vertical). */
const VIEW_LANDSCAPE = new THREE.Vector3(0.22, 1.0, 0.95).normalize();
const VIEW_PORTRAIT = new THREE.Vector3(0.95, 1.05, 0.22).normalize();
const MIN_DIST = 3.5;
const MAX_DIST = 72;

/** Camera position/target that frames a rect from the standard elevated 3/4 direction. */
function frame(zone: OfficeZone | null, camera: THREE.PerspectiveCamera, aspect: number) {
  const r = framingRect(zone);
  const portrait = aspect < 0.85;
  const center = new THREE.Vector3((r.minX + r.maxX) / 2, zone ? 0.6 : 0, (r.minZ + r.maxZ) / 2);
  // Screen-horizontal (w) and screen-depth (d) extents for the chosen view direction.
  const w = portrait ? r.maxZ - r.minZ : r.maxX - r.minX;
  const d = portrait ? r.maxX - r.minX : r.maxZ - r.minZ;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  // Footprint seen at ~45° elevation: depth is foreshortened.
  const needV = (d * 0.72 + 1.2) / 2 / Math.tan(vfov / 2);
  const needH = (w + 1.0) / 2 / Math.tan(hfov / 2);
  const dist = THREE.MathUtils.clamp(Math.max(needV, needH) * (zone ? 1.15 : 1.22) * (portrait && !zone ? 1.08 : 1), MIN_DIST + 2, MAX_DIST);
  return { target: center, position: center.clone().addScaledVector(portrait ? VIEW_PORTRAIT : VIEW_LANDSCAPE, dist) };
}

export function CameraRig({ focusZone, follow }: { focusZone: OfficeZone | null; follow: string | null }) {
  const { sim, reducedMotion } = useScene();
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const anim = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const initialized = useRef(false);
  const tmp = useRef({ v: new THREE.Vector3(), off: new THREE.Vector3(), t: new THREE.Vector3() });

  // Initial framing (instant) and department focus changes (animated unless reduced motion).
  useEffect(() => {
    const c = controls.current;
    if (!c || size.width === 0 || size.height === 0) return;
    const f = frame(focusZone, camera, size.width / size.height);
    if (!initialized.current || reducedMotion) {
      initialized.current = true;
      camera.position.copy(f.position);
      c.target.copy(f.target);
      c.update();
      anim.current = null;
    } else {
      anim.current = f;
    }
  }, [focusZone, camera, reducedMotion, size.width, size.height]);

  // User input cancels any automatic camera move.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const stop = () => { anim.current = null; };
    c.addEventListener("start", stop);
    return () => c.removeEventListener("start", stop);
  }, []);

  useFrame((_, rawDt) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(rawDt, 0.1);
    const { v, off, t } = tmp.current;

    if (follow) {
      const a = sim.agents.get(follow);
      if (a) {
        t.set(a.x, 1.1 - 0.35 * a.sit, a.z);
        const dist = THREE.MathUtils.clamp(camera.position.distanceTo(c.target), MIN_DIST, 18);
        // Behind and above the character, at the user's zoom distance.
        off.set(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)).multiplyScalar(dist * 0.62);
        off.y = dist * 0.78;
        v.copy(t).add(off);
        // Stay inside the building so exterior walls never block the view.
        v.x = THREE.MathUtils.clamp(v.x, FLOOR.minX + 0.6, FLOOR.maxX - 0.6);
        v.z = THREE.MathUtils.clamp(v.z, FLOOR.minZ + 0.6, FLOOR.maxZ + 4);
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

    // Keep the orbit target over the office and the camera above the floor.
    c.target.x = THREE.MathUtils.clamp(c.target.x, FLOOR.minX, FLOOR.maxX);
    c.target.z = THREE.MathUtils.clamp(c.target.z, FLOOR.minZ, FLOOR.maxZ);
    c.target.y = THREE.MathUtils.clamp(c.target.y, 0, 3);
    if (camera.position.y < 1.2) camera.position.y = 1.2;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={MIN_DIST}
      maxDistance={MAX_DIST}
      minPolarAngle={0.12}
      maxPolarAngle={1.32}
      enableRotate={!follow}
      enablePan={!follow}
      screenSpacePanning={false}
      zoomSpeed={0.8}
      rotateSpeed={0.6}
      regress
    />
  );
}

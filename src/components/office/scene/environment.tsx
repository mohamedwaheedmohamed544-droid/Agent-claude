"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { AgentStatus } from "@/lib/office/types";
import { useScene } from "./context";
import { boxAt, cylAt, local, merge, paint, xform } from "./geometry";
import {
  DESK_HEIGHT, GLASS_HEIGHT, LOW_WALL_HEIGHT, PARTITION_HEIGHT, WALL_HEIGHT, WALL_THICKNESS,
  type BoxSpec, type FloorPlan, type OfficePlan, type Vec2, type WallSide,
} from "./plan";

const yawQ = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
const mat4 = (x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), yawQ(yaw), new THREE.Vector3(sx, sy, sz));

/** One InstancedMesh per part, all sharing the same instance transforms (count fixed per layout revision). */
function InstancedParts({ parts, matrices, cast = true, receive = true, colors }: {
  parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material; tinted?: boolean }>;
  matrices: THREE.Matrix4[];
  cast?: boolean;
  receive?: boolean;
  colors?: THREE.Color[];
}) {
  const refs = useRef<Array<THREE.InstancedMesh | null>>([]);
  useLayoutEffect(() => {
    refs.current.forEach((mesh, pi) => {
      if (!mesh) return;
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      if (colors && parts[pi].tinted) {
        colors.forEach((c, i) => mesh.setColorAt(i, c));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      mesh.computeBoundingSphere();
    });
  }, [matrices, colors, parts]);
  if (matrices.length === 0) return null;
  return (
    <>
      {parts.map((p, i) => (
        <instancedMesh
          key={`${i}:${matrices.length}`}
          ref={(el) => { refs.current[i] = el; }}
          args={[p.geometry, p.material, matrices.length]}
          castShadow={cast && !p.tinted}
          receiveShadow={receive}
          raycast={() => null}
        />
      ))}
    </>
  );
}

function useDisposable<T extends { dispose(): void }>(factory: () => T): T {
  const value = useMemo(factory, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

/** Geometries owned by a component instance (re-created on remount, i.e. on layout revision change). */
function useGeometries<T extends Record<string, THREE.BufferGeometry | null>>(factory: () => T): T {
  const value = useMemo(factory, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => Object.values(value).forEach((g) => g?.dispose()), [value]);
  return value;
}

// ───────────────────────── Shell ─────────────────────────

function wallBox(a: Vec2, b: Vec2, height: number, thickness: number, y0 = 0) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  return boxAt(thickness, height, len + thickness, { x: (a.x + b.x) / 2, y: y0 + height / 2, z: (a.z + b.z) / 2, ry: yaw });
}

const INWARD: Record<Exclude<WallSide, "south">, [number, number]> = { north: [0, 1], west: [1, 0], east: [-1, 0] };

/** Exterior wall that fades out when the camera orbits behind it, so the office stays readable. */
function FadingWall({ fp, side, offset }: { fp: FloorPlan; side: Exclude<WallSide, "south">; offset: number }) {
  const seg = fp.walls.find((w) => w.side === side)!;
  const geometry = useDisposable(() => {
    const [nx, nz] = INWARD[side];
    return merge([
      paint(wallBox(seg.a, seg.b, WALL_HEIGHT, WALL_THICKNESS), "#f1eee8"),
      paint(wallBox({ x: seg.a.x + nx * 0.11, z: seg.a.z + nz * 0.11 }, { x: seg.b.x + nx * 0.11, z: seg.b.z + nz * 0.11 }, 0.1, 0.02), "#7d766c"),
    ]);
  });
  const material = useDisposable(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  const opacity = useRef(1);
  useFrame(({ camera }, dt) => {
    const [nx, nz] = INWARD[side];
    const px = seg.a.x + offset, pz = seg.a.z;
    const signed = (camera.position.x - px) * nx + (camera.position.z - pz) * nz;
    const target = signed < -0.5 ? 0.1 : signed < 1.5 ? 0.1 + 0.9 * ((signed + 0.5) / 2) : 1;
    opacity.current += (target - opacity.current) * (1 - Math.exp(-8 * Math.min(dt, 0.1)));
    const o = opacity.current;
    material.opacity = o;
    material.transparent = o < 0.995;
    material.depthWrite = o > 0.9;
  });
  return <mesh geometry={geometry} material={material} castShadow receiveShadow raycast={() => null} />;
}

function Shell({ fp, offset }: { fp: FloorPlan; offset: number }) {
  const { res, tier } = useScene();
  const geo = useGeometries(() => {
    const glassSegs = fp.walls.filter((w) => w.kind === "glass");
    const frames: THREE.BufferGeometry[] = [];
    for (const w of glassSegs) {
      frames.push(wallBox(w.a, w.b, 0.06, 0.06, 0), wallBox(w.a, w.b, 0.07, 0.07, GLASS_HEIGHT - 0.04));
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
      const n = Math.max(1, Math.ceil(len / 1.5));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        frames.push(boxAt(0.05, GLASS_HEIGHT, 0.05, { x: w.a.x + (w.b.x - w.a.x) * t, y: GLASS_HEIGHT / 2, z: w.a.z + (w.b.z - w.a.z) * t }));
      }
    }
    const b = fp.bounds;
    const windows = fp.windows.map((wd) => {
      const width = wd.to - wd.from, mid = (wd.from + wd.to) / 2;
      const g = new THREE.PlaneGeometry(width, 1.9);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (width / 1.6));
      if (wd.side === "north") return xform(g, { x: mid, y: 1.85, z: b.minZ + 0.115 });
      if (wd.side === "west") return xform(g, { x: b.minX + 0.115, y: 1.85, z: mid, ry: Math.PI / 2 });
      return xform(g, { x: b.maxX - 0.115, y: 1.85, z: mid, ry: -Math.PI / 2 });
    });
    const lows = fp.walls.filter((w) => w.kind === "low").map((w) => wallBox(w.a, w.b, LOW_WALL_HEIGHT, WALL_THICKNESS));
    const partitions = fp.walls.filter((w) => w.kind === "partition").map((w) => paint(wallBox(w.a, w.b, PARTITION_HEIGHT, 0.12), "#ece8e1"));
    return {
      glass: glassSegs.length ? merge(glassSegs.map((w) => wallBox(w.a, w.b, GLASS_HEIGHT - 0.1, 0.02, 0.05))) : null,
      frames: frames.length ? merge(frames) : null,
      low: lows.length ? merge(lows) : null,
      partitions: partitions.length ? merge(partitions) : null,
      windows: windows.length ? merge(windows) : null,
    };
  });
  return (
    <group>
      <FadingWall fp={fp} side="north" offset={offset} />
      <FadingWall fp={fp} side="west" offset={offset} />
      <FadingWall fp={fp} side="east" offset={offset} />
      {geo.low && <mesh geometry={geo.low} material={res.mats.lowWall} castShadow receiveShadow raycast={() => null} />}
      {geo.partitions && <mesh geometry={geo.partitions} material={res.mats.decor} castShadow receiveShadow raycast={() => null} />}
      {geo.windows && <mesh geometry={geo.windows} material={res.mats.window} raycast={() => null} />}
      {geo.frames && <mesh geometry={geo.frames} material={res.mats.glassFrame} castShadow raycast={() => null} />}
      {geo.glass && <mesh geometry={geo.glass} material={res.glass(tier)} renderOrder={2} raycast={() => null} />}
    </group>
  );
}

function FloorSlab({ fp, onMiss }: { fp: FloorPlan; onMiss: () => void }) {
  const { res } = useScene();
  const b = fp.bounds;
  const geo = useGeometries(() => {
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 2.4), uv.getY(i) * (d / 2.4));
    return { slab: xform(g, { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, rx: -Math.PI / 2 }) };
  });
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return; // a drag (orbit), not a click
    e.stopPropagation();
    onMiss();
  };
  return <mesh geometry={geo.slab!} material={res.mats.floor} receiveShadow onClick={onClick} />;
}

function Rugs({ fp }: { fp: FloorPlan }) {
  const { res } = useScene();
  const geo = useGeometries(() => ({ plane: xform(new THREE.PlaneGeometry(1, 1), { rx: -Math.PI / 2 }) }));
  const matrices = useMemo(() => fp.rugs.map((r) => mat4(r.center.x, 0.006, r.center.z, 0, r.w, 1, r.d)), [fp]);
  const colors = useMemo(() => {
    const floor = new THREE.Color("#d2cdc5");
    return fp.rugs.map((r) => new THREE.Color(r.color).lerp(floor, r.color === "#9c8a70" ? 0.45 : 0.74));
  }, [fp]);
  const parts = useMemo(() => [{ geometry: geo.plane!, material: res.mats.rug, tinted: true }], [geo, res]);
  return <InstancedParts parts={parts} matrices={matrices} colors={colors} cast={false} />;
}

// ───────────────────────── Furniture ─────────────────────────

function Desks({ fp, statusByDesk, accentByDesk }: { fp: FloorPlan; statusByDesk: Map<string, AgentStatus>; accentByDesk: Map<string, string> }) {
  const { res } = useScene();
  const geo = useGeometries(() => ({
    top: boxAt(1, 0.04, 1, { y: DESK_HEIGHT - 0.02 }),
    legs: merge([
      boxAt(0.03, DESK_HEIGHT - 0.04, 0.9, { x: -0.47, y: (DESK_HEIGHT - 0.04) / 2 }),
      boxAt(0.03, DESK_HEIGHT - 0.04, 0.9, { x: 0.47, y: (DESK_HEIGHT - 0.04) / 2 }),
      boxAt(0.92, 0.32, 0.02, { y: 0.52, z: 0.42 }),
    ]),
    monitor: merge([
      boxAt(0.56, 0.33, 0.03, { y: DESK_HEIGHT + 0.29 }),
      boxAt(0.045, 0.2, 0.03, { y: DESK_HEIGHT + 0.1, z: -0.035 }),
      boxAt(0.22, 0.014, 0.16, { y: DESK_HEIGHT + 0.007, z: -0.02 }),
    ]),
    screen: xform(new THREE.PlaneGeometry(0.52, 0.29), { y: DESK_HEIGHT + 0.29, z: 0.0165 }),
  }));
  const deskMatrices = useMemo(() => fp.desks.map((d) => mat4(d.center.x, 0, d.center.z, d.yaw, d.width, 1, d.depth)), [fp]);
  const deskParts = useMemo(() => [{ geometry: geo.top!, material: res.mats.wood }, { geometry: geo.legs!, material: res.mats.metal }], [geo, res]);
  const monitors = useMemo(() => {
    const out: Array<{ m: THREE.Matrix4; desk: string }> = [];
    for (const d of fp.desks) {
      const offsets = d.monitors >= 3 ? [-0.6, 0, 0.6] : d.monitors === 2 ? [-0.3, 0.3] : d.monitors === 1 ? [0] : [];
      const userZ = -(d.depth / 2 + 0.42);
      for (const lx of offsets) {
        const lz = d.depth / 2 - 0.22;
        const p = local(d.center.x, d.center.z, d.yaw, lx, lz);
        out.push({ m: mat4(p.x, 0, p.z, d.yaw + Math.atan2(0 - lx, userZ - lz)), desk: d.id });
      }
    }
    return out;
  }, [fp]);
  const monitorMatrices = useMemo(() => monitors.map((m) => m.m), [monitors]);
  const screenColors = useMemo(() => monitors.map(({ desk }) => {
    const status = statusByDesk.get(desk);
    const white = new THREE.Color("#ffffff");
    switch (status) {
      case "working": return white.lerp(new THREE.Color(accentByDesk.get(desk) ?? "#6366f1"), 0.28);
      case "thinking": return white.lerp(new THREE.Color("#8b5cf6"), 0.3);
      case "collaborating": return white.lerp(new THREE.Color("#0ea5e9"), 0.3);
      case "waiting": return white.lerp(new THREE.Color("#f59e0b"), 0.4);
      case "error": return white.lerp(new THREE.Color("#ef4444"), 0.5);
      case "meeting": return new THREE.Color("#1d2433");
      case undefined: return new THREE.Color("#0b0d12"); // unoccupied desk: screen off
      default: return new THREE.Color("#3a4356");
    }
  }), [monitors, statusByDesk, accentByDesk]);
  const monitorParts = useMemo(() => [{ geometry: geo.monitor!, material: res.mats.metal }], [geo, res]);
  const screenParts = useMemo(() => [{ geometry: geo.screen!, material: res.mats.screen, tinted: true }], [geo, res]);
  return (
    <>
      <InstancedParts parts={deskParts} matrices={deskMatrices} />
      <InstancedParts parts={monitorParts} matrices={monitorMatrices} />
      <InstancedParts parts={screenParts} matrices={monitorMatrices} colors={screenColors} cast={false} receive={false} />
    </>
  );
}

function Chairs({ fp }: { fp: FloorPlan }) {
  const { res } = useScene();
  const geo = useGeometries(() => ({
    fabric: merge([boxAt(0.5, 0.08, 0.48, { y: 0.44 }), boxAt(0.47, 0.52, 0.07, { y: 0.78, z: -0.23, rx: -0.12 })]),
    frame: merge([
      cylAt(0.028, 0.028, 0.32, 8, { y: 0.24 }),
      ...[0, 1, 2, 3, 4].map((i) => boxAt(0.04, 0.03, 0.3, { y: 0.06, ry: (i / 5) * Math.PI * 2, x: Math.sin((i / 5) * Math.PI * 2) * 0.14, z: Math.cos((i / 5) * Math.PI * 2) * 0.14 })),
      boxAt(0.03, 0.22, 0.03, { y: 0.52, z: -0.23 }),
    ]),
  }));
  const matrices = useMemo(() => fp.chairs.map((s) => mat4(s.x, 0, s.z, s.yaw)), [fp]);
  const parts = useMemo(() => [{ geometry: geo.fabric!, material: res.mats.fabric }, { geometry: geo.frame!, material: res.mats.metal }], [geo, res]);
  return <InstancedParts parts={parts} matrices={matrices} />;
}

function sofaGeometry(width: number) {
  return merge([
    boxAt(width, 0.3, 0.9, { y: 0.2 }),
    boxAt(width - 0.34, 0.12, 0.66, { y: 0.4, z: 0.08 }),
    boxAt(width, 0.5, 0.22, { y: 0.6, z: -0.34 }),
    boxAt(0.17, 0.3, 0.9, { x: width / 2 - 0.085, y: 0.5 }),
    boxAt(0.17, 0.3, 0.9, { x: -width / 2 + 0.085, y: 0.5 }),
  ]);
}

function Seating({ fp }: { fp: FloorPlan }) {
  const { res } = useScene();
  const geo = useGeometries(() => ({ sofa: sofaGeometry(2.3), armchair: sofaGeometry(0.95) }));
  const sofaM = useMemo(() => fp.sofas.filter((s) => s.width > 1.5).map((s) => mat4(s.center.x, 0, s.center.z, s.yaw)), [fp]);
  const armM = useMemo(() => fp.sofas.filter((s) => s.width <= 1.5).map((s) => mat4(s.center.x, 0, s.center.z, s.yaw)), [fp]);
  const sofaParts = useMemo(() => [{ geometry: geo.sofa!, material: res.mats.sofa }], [geo, res]);
  const armParts = useMemo(() => [{ geometry: geo.armchair!, material: res.mats.sofa }], [geo, res]);
  return (
    <>
      <InstancedParts parts={sofaParts} matrices={sofaM} />
      <InstancedParts parts={armParts} matrices={armM} />
    </>
  );
}

function Plants({ fp }: { fp: FloorPlan }) {
  const { res } = useScene();
  const geo = useGeometries(() => ({
    pot: merge([cylAt(0.2, 0.16, 0.42, 14, { y: 0.21 }), cylAt(0.185, 0.185, 0.02, 14, { y: 0.41 })]),
    leaves: merge([
      xform(new THREE.IcosahedronGeometry(0.3, 0), { y: 0.78 }),
      xform(new THREE.IcosahedronGeometry(0.24, 0), { x: 0.12, y: 1.05, z: 0.05, ry: 0.6 }),
      xform(new THREE.IcosahedronGeometry(0.2, 0), { x: -0.1, y: 1.2, z: -0.05, ry: 1.1 }),
      xform(new THREE.IcosahedronGeometry(0.17, 0), { y: 1.38, rx: 0.4 }),
    ]),
  }));
  const matrices = useMemo(() => fp.plants.map((p, i) => mat4(p.x, 0, p.z, i * 1.7, p.scale, p.scale, p.scale)), [fp]);
  const parts = useMemo(() => [{ geometry: geo.pot!, material: res.mats.pot }, { geometry: geo.leaves!, material: res.mats.plant }], [geo, res]);
  return <InstancedParts parts={parts} matrices={matrices} />;
}

function Pendants({ fp }: { fp: FloorPlan }) {
  const { res } = useScene();
  const geo = useGeometries(() => ({
    shade: merge([
      xform(new THREE.CylinderGeometry(0.07, 0.2, 0.14, 20, 1, true), { y: 2.85 }),
      cylAt(0.005, 0.005, WALL_HEIGHT - 2.92, 4, { y: 2.92 + (WALL_HEIGHT - 2.92) / 2 }),
    ]),
    glow: xform(new THREE.CircleGeometry(0.185, 20), { y: 2.79, rx: Math.PI / 2 }),
  }));
  const matrices = useMemo(() => fp.pendants.map((p) => mat4(p.x, 0, p.z, 0)), [fp]);
  const parts = useMemo(() => [{ geometry: geo.shade!, material: res.mats.lampShade }], [geo, res]);
  const glowParts = useMemo(() => [{ geometry: geo.glow!, material: res.mats.lampGlow }], [geo, res]);
  return (
    <>
      <InstancedParts parts={parts} matrices={matrices} receive={false} />
      <InstancedParts parts={glowParts} matrices={matrices} cast={false} receive={false} />
    </>
  );
}

// ───────────────────────── Decor (single merged, vertex-coloured mesh per floor) ─────────────────────────

function boxIn(spec: BoxSpec, w: number, h: number, d: number, lx: number, y: number, lz: number, color: string) {
  const p = local(spec.center.x, spec.center.z, spec.yaw, lx, lz);
  return paint(boxAt(w, h, d, { x: p.x, y, z: p.z, ry: spec.yaw }), color);
}

function buildDecor(fp: FloorPlan): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const metal = "#2d3138", stone = "#eceae5", woodLight = "#b9875c", woodDark = "#6e4a32";

  for (const t of fp.tables) {
    const spec: BoxSpec = { center: t.center, w: t.length, d: t.width, h: DESK_HEIGHT, yaw: 0 };
    parts.push(boxIn(spec, t.length, 0.05, t.width, 0, DESK_HEIGHT - 0.025, 0, woodDark));
    for (const lx of [-t.length / 2 + 0.6, t.length / 2 - 0.6]) parts.push(boxIn(spec, 0.12, DESK_HEIGHT - 0.05, t.width * 0.5, lx, (DESK_HEIGHT - 0.05) / 2, 0, metal));
    parts.push(boxIn(spec, 0.2, 0.012, Math.min(0.6, t.width - 0.4), 0, DESK_HEIGHT + 0.006, 0, "#1f2329"));
  }
  for (const c of fp.coffeeTables) {
    const spec: BoxSpec = { center: c.center, w: c.w, d: c.d, h: 0.42, yaw: 0 };
    parts.push(boxIn(spec, c.w, 0.05, c.d, 0, 0.4, 0, stone));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(boxIn(spec, 0.04, 0.38, 0.04, sx * (c.w / 2 - 0.06), 0.19, sz * (c.d / 2 - 0.06), metal));
  }
  for (const bar of fp.bars) {
    parts.push(boxIn(bar, bar.w, bar.h - 0.04, bar.d, 0, (bar.h - 0.04) / 2, 0, woodLight));
    parts.push(boxIn(bar, bar.w + 0.04, 0.04, bar.d + 0.04, 0, bar.h - 0.02, 0, stone));
    parts.push(boxIn(bar, 0.42, 0.42, 0.38, -1.1, bar.h + 0.21, 0, "#262a30"), boxIn(bar, 0.36, 0.08, 0.02, -1.1, bar.h + 0.3, -0.2, "#9aa3ad"));
    parts.push(boxIn(bar, 0.3, 0.32, 0.3, 1.2, bar.h + 0.16, 0, "#e9e6e0"));
    for (let i = 0; i < 4; i++) parts.push(paint(cylAt(0.04, 0.035, 0.09, 10, { x: bar.center.x - 0.4 + i * 0.16, y: bar.h + 0.045, z: bar.center.z + 0.05 }), "#fafafa"));
  }
  for (const c of fp.credenzas) {
    parts.push(boxIn(c, c.w, c.h - 0.03, c.d, 0, (c.h - 0.03) / 2, 0, "#5c3f2b"));
    parts.push(boxIn(c, c.w + 0.02, 0.03, c.d + 0.02, 0, c.h - 0.015, 0, stone));
    for (const lx of [-c.w / 3, 0, c.w / 3]) parts.push(boxIn(c, 0.3, 0.015, 0.01, lx, c.h - 0.12, c.d / 2 + 0.005, "#c9a24a"));
  }
  // Keyboards, mice and a sheet of paper on every desk.
  for (const d of fp.desks) {
    const kb = local(d.center.x, d.center.z, d.yaw, 0, -d.depth / 2 + 0.2);
    parts.push(paint(boxAt(0.44, 0.018, 0.14, { x: kb.x, y: DESK_HEIGHT + 0.009, z: kb.z, ry: d.yaw }), "#2b2f36"));
    const ms = local(d.center.x, d.center.z, d.yaw, -0.36, -d.depth / 2 + 0.2);
    parts.push(paint(boxAt(0.06, 0.02, 0.1, { x: ms.x, y: DESK_HEIGHT + 0.01, z: ms.z, ry: d.yaw }), "#2b2f36"));
    const pp = local(d.center.x, d.center.z, d.yaw, d.width / 2 - 0.22, -0.05);
    parts.push(paint(boxAt(0.21, 0.012, 0.29, { x: pp.x, y: DESK_HEIGHT + 0.006, z: pp.z, ry: d.yaw + 0.2 }), "#f7f6f2"));
  }
  // Freestanding sign screens: bezel + legs. Wall screens: bezel only.
  for (const ds of [...fp.signs, ...fp.execWalls, ...fp.meetingScreens]) {
    const back = local(ds.x, ds.z, ds.yaw, 0, -0.03);
    parts.push(paint(boxAt(ds.width + 0.08, ds.height + 0.08, 0.05, { x: back.x, y: ds.y, z: back.z, ry: ds.yaw }), "#15181d"));
    if (ds.freestanding) {
      for (const lx of [-ds.width / 2 + 0.12, ds.width / 2 - 0.12]) {
        const lp = local(ds.x, ds.z, ds.yaw, lx, -0.05);
        const h = ds.y - ds.height / 2;
        parts.push(paint(boxAt(0.04, h, 0.04, { x: lp.x, y: h / 2, z: lp.z }), metal));
        parts.push(paint(boxAt(0.07, 0.025, 0.36, { x: lp.x, y: 0.0125, z: lp.z, ry: ds.yaw }), metal));
      }
    }
  }
  // Elevator / stair core.
  if (fp.core) {
    const c = fp.core;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    parts.push(paint(boxAt(w, WALL_HEIGHT, d, { x: cx, y: WALL_HEIGHT / 2, z: cz }), "#d8d2c8"));
    parts.push(paint(boxAt(1.2, 2.2, 0.04, { x: cx, y: 1.1, z: c.maxZ + 0.02 }), "#9aa1aa"));
    parts.push(paint(boxAt(0.02, 2.2, 0.05, { x: cx, y: 1.1, z: c.maxZ + 0.045 }), "#5b616a"));
    parts.push(paint(boxAt(1.5, 0.12, 0.05, { x: cx, y: 2.45, z: c.maxZ + 0.03 }), "#1f2329"));
    parts.push(paint(boxAt(0.12, 0.05, 0.06, { x: cx - 0.3, y: 2.45, z: c.maxZ + 0.06 }), "#5be38c"));
    parts.push(paint(boxAt(0.12, 0.05, 0.06, { x: cx + 0.3, y: 2.45, z: c.maxZ + 0.06 }), "#4fa3ff"));
  }
  if (fp.entrance) {
    // Entrance mat.
    parts.push(paint(boxAt(1.8, 0.012, 1.2, { x: fp.entrance.x, y: 0.006, z: fp.bounds.maxZ - 0.75 }), "#4a4f57"));
  }
  return parts.length ? merge(parts) : null;
}

function Decor({ fp }: { fp: FloorPlan }) {
  const { res } = useScene();
  const geo = useGeometries(() => ({ decor: buildDecor(fp) }));
  if (!geo.decor) return null;
  return <mesh geometry={geo.decor} material={res.mats.decor} castShadow receiveShadow raycast={() => null} />;
}

export interface OfficeEnvironmentProps {
  plan: OfficePlan;
  view: number | "all";
  offsets: number[];
  onFloorClick: () => void;
  statusByDesk: Map<string, AgentStatus>;
  accentByDesk: Map<string, string>;
}

function FloorView({ fp, offset, visible, onFloorClick, statusByDesk, accentByDesk }: {
  fp: FloorPlan; offset: number; visible: boolean; onFloorClick: () => void; statusByDesk: Map<string, AgentStatus>; accentByDesk: Map<string, string>;
}) {
  return (
    <group position-x={offset} visible={visible}>
      <FloorSlab fp={fp} onMiss={onFloorClick} />
      <Rugs fp={fp} />
      <Shell fp={fp} offset={offset} />
      <Desks fp={fp} statusByDesk={statusByDesk} accentByDesk={accentByDesk} />
      <Chairs fp={fp} />
      <Seating fp={fp} />
      <Plants fp={fp} />
      <Pendants fp={fp} />
      <Decor fp={fp} />
    </group>
  );
}

/** All floors of the plan. Static geometry is keyed by layout revision: rebuilt (and the old disposed) only when it changes. */
export function OfficeEnvironment({ plan, view, offsets, onFloorClick, statusByDesk, accentByDesk }: OfficeEnvironmentProps) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.03, 0]} raycast={() => null}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#cfcbc4" roughness={1} />
      </mesh>
      {plan.floors.map((fp) => (
        <FloorView
          key={`${plan.revision}:${fp.index}`}
          fp={fp}
          offset={offsets[fp.index] ?? 0}
          visible={view === "all" || view === fp.index}
          onFloorClick={onFloorClick}
          statusByDesk={statusByDesk}
          accentByDesk={accentByDesk}
        />
      ))}
    </group>
  );
}

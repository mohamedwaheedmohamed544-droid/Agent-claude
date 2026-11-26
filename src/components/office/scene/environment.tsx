"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { AgentStatus, OfficeZone } from "@/lib/office/types";
import { useScene } from "./context";
import { boxAt, cylAt, local, merge, paint, xform } from "./geometry";
import { mulberry32 } from "./resources";
import {
  ARMCHAIRS, BOOKSHELF, COFFEE_BAR, COFFEE_TABLE, CREDENZA, DEPARTMENT_DISPLAYS, DESKS, DESK_HEIGHT, EXECUTIVE_WALL,
  EXTRA_CHAIRS, FILING_CABINETS, FLOOR, GLASS_HEIGHT, LOW_WALL_HEIGHT, MEETING_HEAD_SEAT, MEETING_SCREEN, MEETING_SIDE_SEATS,
  MEETING_TABLE, MOOD_BOARD, PENDANTS, PLANTERS, PLANTS, REVIEW_DESK, ROUND_TABLES, SECONDARY_DESKS, SERVER_RACKS, SOFAS, WALLS, WALL_HEIGHT,
  WALL_THICKNESS, WINDOWS, WRITING_SHELF, ZONE_RUGS, type BoxSpec, type WallSide,
} from "./layout";

const yawQ = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
const mat4 = (x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), yawQ(yaw), new THREE.Vector3(sx, sy, sz));

/** One InstancedMesh per part, all sharing the same instance transforms. */
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
  return (
    <>
      {parts.map((p, i) => (
        <instancedMesh
          key={i}
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

function useGeometries<T extends Record<string, THREE.BufferGeometry>>(factory: () => T): T {
  const value = useMemo(factory, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => Object.values(value).forEach((g) => g.dispose()), [value]);
  return value;
}

// ───────────────────────── Shell: floor, walls, glass, windows, rugs ─────────────────────────

function Floor({ onMiss }: { onMiss: () => void }) {
  const { res } = useScene();
  const w = FLOOR.maxX - FLOOR.minX, d = FLOOR.maxZ - FLOOR.minZ;
  useLayoutEffect(() => { res.floorTex.repeat.set(w / 2.4, d / 2.4); }, [res, w, d]);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return; // a drag (orbit), not a click
    e.stopPropagation();
    onMiss();
  };
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} receiveShadow onClick={onClick}>
        <planeGeometry args={[w, d]} />
        <primitive object={res.mats.floor} attach="material" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.03} raycast={() => null}>
        <planeGeometry args={[220, 220]} />
        <meshStandardMaterial color="#cfcbc4" roughness={1} />
      </mesh>
    </>
  );
}

function wallBox(a: { x: number; z: number }, b: { x: number; z: number }, height: number, thickness: number, y0 = 0) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  return boxAt(thickness, height, len + thickness, { x: (a.x + b.x) / 2, y: y0 + height / 2, z: (a.z + b.z) / 2, ry: yaw });
}

const SIDE_NORMALS: Record<Exclude<WallSide, "south">, { n: [number, number]; p: [number, number] }> = {
  north: { n: [0, 1], p: [0, FLOOR.minZ] },
  west: { n: [1, 0], p: [FLOOR.minX, 0] },
  east: { n: [-1, 0], p: [FLOOR.maxX, 0] },
};

/** Exterior wall that fades out when the camera orbits behind it, so the office stays readable. */
function FadingWall({ side }: { side: Exclude<WallSide, "south"> }) {
  const seg = WALLS.find((w) => w.side === side)!;
  const geometry = useDisposable(() => {
    const g = merge([
      paint(wallBox(seg.a, seg.b, WALL_HEIGHT, WALL_THICKNESS), "#f1eee8"),
      // Baseboard on the inner face.
      paint(wallBox(
        { x: seg.a.x + SIDE_NORMALS[side].n[0] * 0.11, z: seg.a.z + SIDE_NORMALS[side].n[1] * 0.11 },
        { x: seg.b.x + SIDE_NORMALS[side].n[0] * 0.11, z: seg.b.z + SIDE_NORMALS[side].n[1] * 0.11 }, 0.1, 0.02), "#7d766c"),
    ]);
    return g;
  });
  const material = useDisposable(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  const opacity = useRef(1);
  useFrame(({ camera }, dt) => {
    const { n, p } = SIDE_NORMALS[side];
    const signed = (camera.position.x - p[0]) * n[0] + (camera.position.z - p[1]) * n[1];
    const target = signed < -0.5 ? 0.1 : signed < 1.5 ? 0.1 + 0.9 * ((signed + 0.5) / 2) : 1;
    opacity.current += (target - opacity.current) * (1 - Math.exp(-8 * dt));
    const o = opacity.current;
    material.opacity = o;
    material.transparent = o < 0.995;
    material.depthWrite = o > 0.9;
  });
  return <mesh geometry={geometry} material={material} castShadow receiveShadow raycast={() => null} />;
}

function Shell() {
  const { res, tier } = useScene();
  const geo = useGeometries(() => {
    const glassSegs = WALLS.filter((w) => w.kind === "glass");
    const panes = glassSegs.map((w) => wallBox(w.a, w.b, GLASS_HEIGHT - 0.1, 0.02, 0.05));
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
    const south = WALLS.find((w) => w.side === "south")!;
    const windows = WINDOWS.map((wd) => {
      const width = wd.to - wd.from, mid = (wd.from + wd.to) / 2;
      const g = new THREE.PlaneGeometry(width, 1.9);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (width / 1.6));
      if (wd.side === "north") return xform(g, { x: mid, y: 1.85, z: FLOOR.minZ + 0.115 });
      if (wd.side === "west") return xform(g, { x: FLOOR.minX + 0.115, y: 1.85, z: mid, ry: Math.PI / 2 });
      return xform(g, { x: FLOOR.maxX - 0.115, y: 1.85, z: mid, ry: -Math.PI / 2 });
    });
    return {
      glass: merge(panes),
      frames: merge(frames),
      low: wallBox(south.a, south.b, LOW_WALL_HEIGHT, WALL_THICKNESS),
      windows: merge(windows),
    };
  });
  return (
    <group>
      <FadingWall side="north" />
      <FadingWall side="west" />
      <FadingWall side="east" />
      <mesh geometry={geo.low} material={res.mats.lowWall} castShadow receiveShadow raycast={() => null} />
      <mesh geometry={geo.windows} material={res.mats.window} raycast={() => null} />
      <mesh geometry={geo.frames} material={res.mats.glassFrame} castShadow raycast={() => null} />
      <mesh geometry={geo.glass} material={res.glass(tier)} renderOrder={2} raycast={() => null} />
    </group>
  );
}

function Rugs({ zoneColors }: { zoneColors: Partial<Record<OfficeZone, string>> }) {
  const { res } = useScene();
  const geo = useGeometries(() => ({ plane: xform(new THREE.PlaneGeometry(1, 1), { rx: -Math.PI / 2 }) }));
  const matrices = useMemo(() => ZONE_RUGS.map((r) => mat4(r.center.x, 0.006, r.center.z, 0, r.w, 1, r.d)), []);
  const colors = useMemo(() => {
    const floor = new THREE.Color("#d9d5ce");
    return ZONE_RUGS.map((r) => new THREE.Color(zoneColors[r.zone] ?? "#9c8a70").lerp(floor, r.zone === "lounge" ? 0.45 : 0.72));
  }, [zoneColors]);
  const parts = useMemo(() => [{ geometry: geo.plane, material: res.mats.rug, tinted: true }], [geo, res]);
  return <InstancedParts parts={parts} matrices={matrices} colors={colors} cast={false} />;
}

// ───────────────────────── Furniture ─────────────────────────

function Desks({ statusByZone, accentByZone }: { statusByZone: Partial<Record<OfficeZone, AgentStatus>>; accentByZone: Partial<Record<OfficeZone, string>> }) {
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

  const deskList = useMemo(() => [...DESKS, ...SECONDARY_DESKS].map((d) => ({ c: d.center, yaw: d.yaw, w: d.width, d: d.depth })), []);
  const deskMatrices = useMemo(() => deskList.map((d) => mat4(d.c.x, 0, d.c.z, d.yaw, d.w, 1, d.d)), [deskList]);
  const deskParts = useMemo(() => [{ geometry: geo.top, material: res.mats.wood }, { geometry: geo.legs, material: res.mats.metal }], [geo, res]);

  const monitors = useMemo(() => {
    const out: Array<{ m: THREE.Matrix4; zone: OfficeZone }> = [];
    for (const d of [...DESKS, ...SECONDARY_DESKS]) {
      const offsets = d.monitors === 3 ? [-0.6, 0, 0.6] : d.monitors === 2 ? [-0.3, 0.3] : d.monitors === 1 ? [0] : [];
      const userZ = -(d.depth / 2 + 0.42);
      for (const lx of offsets) {
        const lz = d.depth / 2 - 0.22;
        const p = local(d.center.x, d.center.z, d.yaw, lx, lz);
        const yaw = d.yaw + Math.atan2(0 - lx, userZ - lz);
        out.push({ m: mat4(p.x, 0, p.z, yaw), zone: d.zone });
      }
    }
    return out;
  }, []);
  const monitorMatrices = useMemo(() => monitors.map((m) => m.m), [monitors]);
  const screenColors = useMemo(() => monitors.map(({ zone }) => {
    const status = statusByZone[zone] ?? "idle";
    const accent = accentByZone[zone] ?? "#6366f1";
    const white = new THREE.Color("#ffffff");
    switch (status) {
      case "working": return white.lerp(new THREE.Color(accent), 0.28);
      case "waiting": return white.lerp(new THREE.Color("#f59e0b"), 0.4);
      case "error": return white.lerp(new THREE.Color("#ef4444"), 0.5);
      case "paused": return new THREE.Color("#0b0d12");
      case "meeting": return new THREE.Color("#1d2433");
      default: return new THREE.Color("#3a4356");
    }
  }), [monitors, statusByZone, accentByZone]);
  const monitorParts = useMemo(() => [{ geometry: geo.monitor, material: res.mats.metal }], [geo, res]);
  const screenParts = useMemo(() => [{ geometry: geo.screen, material: res.mats.screen, tinted: true }], [geo, res]);

  return (
    <>
      <InstancedParts parts={deskParts} matrices={deskMatrices} />
      <InstancedParts parts={monitorParts} matrices={monitorMatrices} />
      <InstancedParts parts={screenParts} matrices={monitorMatrices} colors={screenColors} cast={false} receive={false} />
    </>
  );
}

function Chairs() {
  const { res } = useScene();
  const geo = useGeometries(() => ({
    fabric: merge([
      boxAt(0.5, 0.08, 0.48, { y: 0.44 }),
      boxAt(0.47, 0.52, 0.07, { y: 0.78, z: -0.23, rx: -0.12 }),
    ]),
    frame: merge([
      cylAt(0.028, 0.028, 0.32, 8, { y: 0.24 }),
      ...[0, 1, 2, 3, 4].map((i) => boxAt(0.04, 0.03, 0.3, { y: 0.06, ry: (i / 5) * Math.PI * 2, x: Math.sin((i / 5) * Math.PI * 2) * 0.14, z: Math.cos((i / 5) * Math.PI * 2) * 0.14 })),
      boxAt(0.03, 0.22, 0.03, { y: 0.52, z: -0.23 }),
    ]),
  }));
  const matrices = useMemo(() => {
    const spots = [
      ...DESKS.map((d) => d.seat), MEETING_HEAD_SEAT, ...MEETING_SIDE_SEATS,
      ...EXTRA_CHAIRS,
    ];
    return spots.map((s) => mat4(s.x, 0, s.z, s.yaw));
  }, []);
  const parts = useMemo(() => [{ geometry: geo.fabric, material: res.mats.fabric }, { geometry: geo.frame, material: res.mats.metal }], [geo, res]);
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

function Seating() {
  const { res } = useScene();
  const geo = useGeometries(() => ({ sofa: sofaGeometry(SOFAS[0].width), armchair: sofaGeometry(ARMCHAIRS[0].width) }));
  const sofaM = useMemo(() => SOFAS.map((s) => mat4(s.center.x, 0, s.center.z, s.yaw)), []);
  const armM = useMemo(() => ARMCHAIRS.map((s) => mat4(s.center.x, 0, s.center.z, s.yaw)), []);
  const sofaParts = useMemo(() => [{ geometry: geo.sofa, material: res.mats.sofa }], [geo, res]);
  const armParts = useMemo(() => [{ geometry: geo.armchair, material: res.mats.sofa }], [geo, res]);
  return (
    <>
      <InstancedParts parts={sofaParts} matrices={sofaM} />
      <InstancedParts parts={armParts} matrices={armM} />
    </>
  );
}

function Plants() {
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
  const matrices = useMemo(() => PLANTS.map((p, i) => mat4(p.x, 0, p.z, i * 1.7, p.scale, p.scale, p.scale)), []);
  const parts = useMemo(() => [{ geometry: geo.pot, material: res.mats.pot }, { geometry: geo.leaves, material: res.mats.plant }], [geo, res]);
  return <InstancedParts parts={parts} matrices={matrices} />;
}

function Pendants() {
  const { res } = useScene();
  const geo = useGeometries(() => ({
    shade: merge([
      xform(new THREE.CylinderGeometry(0.07, 0.2, 0.14, 20, 1, true), { y: 2.85 }),
      cylAt(0.005, 0.005, WALL_HEIGHT - 2.92, 4, { y: 2.92 + (WALL_HEIGHT - 2.92) / 2 }),
    ]),
    glow: xform(new THREE.CircleGeometry(0.185, 20), { y: 2.79, rx: Math.PI / 2 }),
  }));
  const matrices = useMemo(() => PENDANTS.map((p) => mat4(p.x, 0, p.z, 0)), []);
  const parts = useMemo(() => [{ geometry: geo.shade, material: res.mats.lampShade }], [geo, res]);
  const glowParts = useMemo(() => [{ geometry: geo.glow, material: res.mats.lampGlow }], [geo, res]);
  return (
    <>
      <InstancedParts parts={parts} matrices={matrices} receive={false} />
      <InstancedParts parts={glowParts} matrices={matrices} cast={false} receive={false} />
    </>
  );
}

function Tables() {
  const { res } = useScene();
  const geo = useGeometries(() => ({
    meetingTop: boxAt(MEETING_TABLE.length, 0.05, MEETING_TABLE.width, { y: DESK_HEIGHT - 0.025 }),
    meetingBase: merge([
      boxAt(0.12, DESK_HEIGHT - 0.05, 0.7, { x: -1.6, y: (DESK_HEIGHT - 0.05) / 2 }),
      boxAt(0.12, DESK_HEIGHT - 0.05, 0.7, { x: 1.6, y: (DESK_HEIGHT - 0.05) / 2 }),
      boxAt(3.4, 0.06, 0.12, { y: 0.03 }),
      boxAt(0.2, 0.012, 0.6, { x: 0, y: DESK_HEIGHT + 0.006 }), // cable tray lid / centre console
    ]),
    roundTop: cylAt(ROUND_TABLES[0].radius, ROUND_TABLES[0].radius, 0.04, 28, { y: DESK_HEIGHT - 0.02 }),
    roundBase: merge([cylAt(0.04, 0.04, DESK_HEIGHT - 0.04, 10, { y: (DESK_HEIGHT - 0.04) / 2 }), cylAt(0.25, 0.27, 0.03, 20, { y: 0.015 })]),
    coffeeTop: boxAt(COFFEE_TABLE.width, 0.05, COFFEE_TABLE.depth, { y: 0.4 }),
    coffeeLegs: merge([-1, 1].flatMap((sx) => [-1, 1].map((sz) => boxAt(0.04, 0.38, 0.04, { x: sx * (COFFEE_TABLE.width / 2 - 0.06), y: 0.19, z: sz * (COFFEE_TABLE.depth / 2 - 0.06) })))),
  }));
  const roundMatrices = useMemo(() => ROUND_TABLES.map((t) => mat4(t.center.x, 0, t.center.z, 0)), []);
  const roundParts = useMemo(() => [{ geometry: geo.roundTop, material: res.mats.wood }, { geometry: geo.roundBase, material: res.mats.metal }], [geo, res]);
  return (
    <group>
      <mesh geometry={geo.meetingTop} material={res.mats.woodDark} position={[MEETING_TABLE.center.x, 0, MEETING_TABLE.center.z]} castShadow receiveShadow raycast={() => null} />
      <mesh geometry={geo.meetingBase} material={res.mats.metal} position={[MEETING_TABLE.center.x, 0, MEETING_TABLE.center.z]} castShadow raycast={() => null} />
      <InstancedParts parts={roundParts} matrices={roundMatrices} />
      <mesh geometry={geo.coffeeTop} material={res.mats.stone} position={[COFFEE_TABLE.center.x, 0, COFFEE_TABLE.center.z]} castShadow receiveShadow raycast={() => null} />
      <mesh geometry={geo.coffeeLegs} material={res.mats.metal} position={[COFFEE_TABLE.center.x, 0, COFFEE_TABLE.center.z]} raycast={() => null} />
    </group>
  );
}

// ───────────────────────── Decor (single merged, vertex-coloured mesh) ─────────────────────────

function boxIn(spec: BoxSpec, w: number, h: number, d: number, lx: number, y: number, lz: number, color: string) {
  const p = local(spec.center.x, spec.center.z, spec.yaw, lx, lz);
  return paint(boxAt(w, h, d, { x: p.x, y, z: p.z, ry: spec.yaw }), color);
}

function buildDecor(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rnd = mulberry32(42);
  const bookColors = ["#7b2d26", "#1f3a5f", "#c8a24a", "#2f5d50", "#e5ddd0", "#5b4a7a", "#a14a2e", "#344054"];
  const wood = "#8a5f3d", woodLight = "#b9875c", metal = "#2d3138", stone = "#eceae5";

  // Bookshelves.
  for (const [spec, shelves] of [[BOOKSHELF, 5], [WRITING_SHELF, 3]] as Array<[BoxSpec, number]>) {
    const { w, d, h } = spec;
    parts.push(boxIn(spec, 0.04, h, d, -w / 2 + 0.02, h / 2, 0, wood), boxIn(spec, 0.04, h, d, w / 2 - 0.02, h / 2, 0, wood));
    parts.push(boxIn(spec, w, 0.03, d, 0, h - 0.015, 0, wood), boxIn(spec, w, 0.02, d - 0.02, 0, h / 2, -d / 2 + 0.01, "#6b4a31"));
    for (let s = 0; s < shelves; s++) {
      const y = 0.06 + (s * (h - 0.1)) / shelves;
      parts.push(boxIn(spec, w - 0.06, 0.025, d, 0, y, 0, wood));
      let x = -w / 2 + 0.07;
      while (x < w / 2 - 0.12) {
        const bw = 0.025 + rnd() * 0.035, bh = 0.18 + rnd() * 0.12;
        if (rnd() > 0.12) parts.push(boxIn(spec, bw, bh, d * 0.75, x + bw / 2, y + 0.0125 + bh / 2, 0.02, bookColors[Math.floor(rnd() * bookColors.length)]));
        x += bw + 0.004;
      }
    }
  }
  // Executive credenza.
  parts.push(boxIn(CREDENZA, CREDENZA.w, CREDENZA.h - 0.03, CREDENZA.d, 0, (CREDENZA.h - 0.03) / 2, 0, "#5c3f2b"));
  parts.push(boxIn(CREDENZA, CREDENZA.w + 0.02, 0.03, CREDENZA.d + 0.02, 0, CREDENZA.h - 0.015, 0, stone));
  for (const lx of [-1.1, 0, 1.1]) parts.push(boxIn(CREDENZA, 0.3, 0.015, 0.01, lx, CREDENZA.h - 0.12, CREDENZA.d / 2 + 0.005, "#c9a24a"));
  // Filing cabinets.
  for (const fc of FILING_CABINETS) {
    parts.push(boxIn(fc, fc.w, fc.h, fc.d, 0, fc.h / 2, 0, "#c9ccd1"));
    for (let i = 0; i < 4; i++) parts.push(boxIn(fc, fc.w - 0.08, 0.012, 0.01, 0, 0.16 + i * 0.31, fc.d / 2 + 0.004, "#7b8089"));
  }
  // Server racks with status LEDs.
  for (const sr of SERVER_RACKS) {
    parts.push(boxIn(sr, sr.w, sr.h, sr.d, 0, sr.h / 2, 0, "#1d2127"));
    for (let i = 0; i < 9; i++) {
      parts.push(boxIn(sr, sr.w - 0.1, 0.012, 0.01, 0, 0.2 + i * 0.19, sr.d / 2 + 0.004, "#3a414b"));
      parts.push(boxIn(sr, 0.03, 0.02, 0.012, sr.w / 2 - 0.09, 0.24 + i * 0.19, sr.d / 2 + 0.006, i % 3 === 0 ? "#5be38c" : "#4fa3ff"));
    }
  }
  // Marketing mood board (abstract swatches).
  parts.push(boxIn(MOOD_BOARD, MOOD_BOARD.w, MOOD_BOARD.h, MOOD_BOARD.d, 0, 0.55 + MOOD_BOARD.h / 2, 0, "#f4f1ea"));
  parts.push(boxIn(MOOD_BOARD, 0.04, 0.6, 0.04, -0.7, 0.3, 0, metal), boxIn(MOOD_BOARD, 0.04, 0.6, 0.04, 0.7, 0.3, 0, metal));
  const swatches = ["#ca8a04", "#f59e0b", "#1f2937", "#db2777", "#0d9488", "#e5e7eb", "#7c3aed", "#fde68a"];
  for (let i = 0; i < 8; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    parts.push(boxIn(MOOD_BOARD, 0.38, 0.42 + (i % 3) * 0.06, 0.01, -0.66 + col * 0.44, 0.85 + row * 0.62, MOOD_BOARD.d / 2 + 0.006, swatches[i]));
  }
  // Coffee bar.
  const bar = { center: COFFEE_BAR.center, w: COFFEE_BAR.width, d: COFFEE_BAR.depth, h: 1.0, yaw: 0 };
  parts.push(boxIn(bar, bar.w, bar.h - 0.04, bar.d, 0, (bar.h - 0.04) / 2, 0, woodLight));
  parts.push(boxIn(bar, bar.w + 0.04, 0.04, bar.d + 0.04, 0, bar.h - 0.02, 0, stone));
  parts.push(boxIn(bar, 0.42, 0.42, 0.38, -1.1, bar.h + 0.21, 0, "#262a30"), boxIn(bar, 0.36, 0.08, 0.02, -1.1, bar.h + 0.3, -0.2, "#9aa3ad"));
  parts.push(boxIn(bar, 0.3, 0.32, 0.3, 1.2, bar.h + 0.16, 0, "#e9e6e0"));
  for (let i = 0; i < 4; i++) parts.push(paint(cylAt(0.04, 0.035, 0.09, 10, { x: bar.center.x - 0.4 + i * 0.16, y: bar.h + 0.045, z: bar.center.z + 0.05 }), "#fafafa"));
  // Planters between departments.
  for (const pl of PLANTERS) {
    parts.push(boxIn(pl, pl.w, pl.h, pl.d, 0, pl.h / 2, 0, "#d8d2c7"));
    for (let i = 0; i < 5; i++) {
      const p = local(pl.center.x, pl.center.z, pl.yaw, -pl.w / 2 + 0.18 + i * ((pl.w - 0.36) / 4), 0);
      parts.push(paint(xform(new THREE.IcosahedronGeometry(0.2 + rnd() * 0.06, 0), { x: p.x, y: pl.h + 0.12, z: p.z, ry: rnd() * 3 }), "#5c8a4c"));
    }
  }
  // Keyboards, mice and paperwork on desks.
  for (const d of DESKS) {
    const kb = local(d.center.x, d.center.z, d.yaw, 0, -d.depth / 2 + 0.2);
    parts.push(paint(boxAt(0.44, 0.018, 0.14, { x: kb.x, y: DESK_HEIGHT + 0.009, z: kb.z, ry: d.yaw }), "#2b2f36"));
    const ms = local(d.center.x, d.center.z, d.yaw, -0.36, -d.depth / 2 + 0.2);
    parts.push(paint(boxAt(0.06, 0.02, 0.1, { x: ms.x, y: DESK_HEIGHT + 0.01, z: ms.z, ry: d.yaw }), "#2b2f36"));
    const pp = local(d.center.x, d.center.z, d.yaw, 0.62, -0.05);
    parts.push(paint(boxAt(0.21, 0.012, 0.29, { x: pp.x, y: DESK_HEIGHT + 0.006, z: pp.z, ry: d.yaw + 0.2 }), "#f7f6f2"));
  }
  for (let i = 0; i < 4; i++) {
    const pp = local(REVIEW_DESK.center.x, REVIEW_DESK.center.z, REVIEW_DESK.yaw, -0.5 + i * 0.33, -0.05 + (i % 2) * 0.1);
    parts.push(paint(boxAt(0.21, 0.02 + i * 0.01, 0.29, { x: pp.x, y: DESK_HEIGHT + 0.01 + i * 0.005, z: pp.z, ry: REVIEW_DESK.yaw + (i - 1.5) * 0.12 }), i === 2 ? "#7c3aed" : "#f7f6f2"));
  }
  // Writing studio floor lamp.
  parts.push(paint(cylAt(0.015, 0.015, 1.5, 8, { x: -1.4, y: 0.75, z: 9.9 }), metal), paint(cylAt(0.18, 0.18, 0.02, 16, { x: -1.4, y: 0.01, z: 9.9 }), metal));
  parts.push(paint(cylAt(0.12, 0.2, 0.22, 16, { x: -1.4, y: 1.55, z: 9.9 }), "#efe6d6"));
  // Display bezels.
  for (const ds of DEPARTMENT_DISPLAYS) {
    const back = local(ds.x, ds.z, ds.yaw, 0, -0.03);
    parts.push(paint(boxAt(ds.width + 0.08, ds.height + 0.08, 0.05, { x: back.x, y: ds.y, z: back.z, ry: ds.yaw }), "#15181d"));
    if (ds.freestanding) {
      for (const lx of [-ds.width / 2 + 0.15, ds.width / 2 - 0.15]) {
        const lp = local(ds.x, ds.z, ds.yaw, lx, -0.05);
        parts.push(paint(boxAt(0.05, ds.y - ds.height / 2, 0.05, { x: lp.x, y: (ds.y - ds.height / 2) / 2, z: lp.z }), metal));
        parts.push(paint(boxAt(0.08, 0.03, 0.5, { x: lp.x, y: 0.015, z: lp.z, ry: ds.yaw }), metal));
      }
    }
  }
  parts.push(paint(boxAt(EXECUTIVE_WALL.width + 0.12, EXECUTIVE_WALL.height + 0.12, 0.05, { x: EXECUTIVE_WALL.x, y: EXECUTIVE_WALL.y, z: EXECUTIVE_WALL.z - 0.03 }), "#111318"));
  parts.push(paint(boxAt(0.05, MEETING_SCREEN.height + 0.08, MEETING_SCREEN.width + 0.08, { x: MEETING_SCREEN.x + 0.03, y: MEETING_SCREEN.y, z: MEETING_SCREEN.z }), "#15181d"));
  return merge(parts);
}

function Decor() {
  const { res } = useScene();
  const geo = useGeometries(() => ({ decor: buildDecor() }));
  return <mesh geometry={geo.decor} material={res.mats.decor} castShadow receiveShadow raycast={() => null} />;
}

export interface OfficeEnvironmentProps {
  onFloorClick: () => void;
  zoneColors: Partial<Record<OfficeZone, string>>;
  statusByZone: Partial<Record<OfficeZone, AgentStatus>>;
}

export function OfficeEnvironment({ onFloorClick, zoneColors, statusByZone }: OfficeEnvironmentProps) {
  return (
    <group>
      <Floor onMiss={onFloorClick} />
      <Rugs zoneColors={zoneColors} />
      <Shell />
      <Desks statusByZone={statusByZone} accentByZone={zoneColors} />
      <Chairs />
      <Seating />
      <Tables />
      <Plants />
      <Pendants />
      <Decor />
    </group>
  );
}

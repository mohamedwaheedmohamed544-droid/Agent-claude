import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Small helpers for building merged static geometry (optionally vertex-coloured). */

export interface Xform { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number }

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const p = new THREE.Vector3();
const s = new THREE.Vector3();

export function xform(g: THREE.BufferGeometry, t: Xform): THREE.BufferGeometry {
  e.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
  q.setFromEuler(e);
  p.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
  s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  g.applyMatrix4(m4.compose(p, q, s));
  return g;
}

export function boxAt(w: number, h: number, d: number, t: Xform = {}) {
  return xform(new THREE.BoxGeometry(w, h, d), t);
}
export function cylAt(rt: number, rb: number, h: number, seg: number, t: Xform = {}) {
  return xform(new THREE.CylinderGeometry(rt, rb, h, seg), t);
}

export function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Merges and disposes the inputs. All inputs must share the same attribute set. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  parts.forEach((g, i) => { if (normalized[i] !== g) g.dispose(); });
  const out = mergeGeometries(normalized, false);
  normalized.forEach((g) => g.dispose());
  return out;
}

/** Rotates a local offset (x along width, z along depth) by yaw and adds a world origin. */
export function local(ox: number, oz: number, yaw: number, lx: number, lz: number) {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  return { x: ox + lx * c + lz * sn, z: oz - lx * sn + lz * c };
}

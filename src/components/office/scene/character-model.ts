import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { AgentProfile } from "@/lib/office/types";
import type { MaterialVariant, SceneResources } from "./resources";

/**
 * Procedural, articulated adult character (≈7.5 heads tall) built from primitives.
 * All parts are merged into one vertex-coloured, rigidly skinned mesh (each vertex bound to a single joint),
 * so a character is 1–2 draw calls sharing one material per visual variant. Reference proportions are for 1.75 m and the
 * body group is scaled uniformly to the profile height.
 */

export const REF_HEIGHT = 1.75;
export const HIP_HEIGHT = 0.93;
const UPPER_LEG = 0.43;
const LOWER_LEG = 0.42;
const UPPER_ARM = 0.29;
const FOREARM = 0.255;

export interface CharacterRig {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Bone; spine: THREE.Bone; chest: THREE.Bone; neck: THREE.Bone; head: THREE.Bone;
  armL: THREE.Bone; elbowL: THREE.Bone; handL: THREE.Bone;
  armR: THREE.Bone; elbowR: THREE.Bone; handR: THREE.Bone;
  legL: THREE.Bone; kneeL: THREE.Bone; footL: THREE.Bone;
  legR: THREE.Bone; kneeR: THREE.Bone; footR: THREE.Bone;
  robe: THREE.Bone | null;
  prop: THREE.Bone | null;
  scale: number;
  setVariant(variant: MaterialVariant): void;
  setShadows(cast: boolean): void;
  dispose(): void;
}

type V3 = [number, number, number];
interface PartOpts { pos?: V3; rot?: V3; scale?: V3 }

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

/** Accumulates primitives with per-part colour, then merges into one geometry. */
class PartBuilder {
  private parts: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, o: PartOpts = {}) {
    const g = geo;
    tmpP.set(...(o.pos ?? [0, 0, 0]));
    tmpE.set(...(o.rot ?? [0, 0, 0]));
    tmpQ.setFromEuler(tmpE);
    tmpS.set(...(o.scale ?? [1, 1, 1]));
    tmpM.compose(tmpP, tmpQ, tmpS);
    g.applyMatrix4(tmpM);
    const c = new THREE.Color(color);
    const count = g.attributes.position.count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
    return this;
  }
  get empty() { return this.parts.length === 0; }
  build(): THREE.BufferGeometry | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return merged;
  }
}

// Primitive factories (fresh geometry each call; merged and disposed by PartBuilder).
const sphere = (w = 12, h = 8) => new THREE.SphereGeometry(1, w, h);
const partialSphere = (phiStart: number, phiLen: number, thetaStart: number, thetaLen: number, w = 14, h = 8) =>
  new THREE.SphereGeometry(1, w, h, phiStart, phiLen, thetaStart, thetaLen);
const capsule = (r: number, len: number, radial = 10) => new THREE.CapsuleGeometry(r, len, 3, radial);
const cyl = (rt: number, rb: number, h: number, seg = 12, open = false, ts = 0, tl = Math.PI * 2) =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, ts, tl);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const torus = (r: number, tube: number) => new THREE.TorusGeometry(r, tube, 6, 22);
const lathe = (pts: Array<[number, number]>, seg = 14) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const target = amount < 0 ? new THREE.Color(0, 0, 0) : new THREE.Color(1, 1, 1);
  c.lerp(target, Math.abs(amount));
  return `#${c.getHexString()}`;
}

/** Segment-aligned thin strip between two points (used for lanyards). */
function strip(b: PartBuilder, a: V3, c: V3, width: number, color: string) {
  const dir = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const len = dir.length();
  const g = box(width, len, 0.004);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
  b.add(g, color);
}

export function buildCharacter(profile: AgentProfile, res: SceneResources): CharacterRig {
  const ap = profile.appearance;
  const female = ap.gender === "female";
  const robeOutfit = ap.outfit === "thobe" || ap.outfit === "abaya" || ap.outfit === "blazer";
  const sw = female ? 0.9 : 1; // shoulder width factor
  const skin = ap.skin;
  const skinShadow = shade(skin, -0.18);
  const hair = ap.hairColor;
  const accent = profile.color;

  const upper = ap.outfitColor;
  const sleeve = ap.outfit === "shirt" ? shade(upper, -0.04) : upper;
  const lower =
    ap.outfit === "suit" ? shade(upper, -0.12)
    : ap.outfit === "shirt" ? "#2e3443"
    : ap.outfit === "blazer" ? shade(upper, -0.28)
    : upper;
  const shoe = ap.outfit === "thobe" ? "#5b4331" : "#24201e";

  // Parts are collected per bone, then merged into one rigidly-skinned mesh (plus one for textured cloth).
  const parts: Array<{ bone: THREE.Bone; geo: THREE.BufferGeometry; textured: boolean }> = [];
  let clothMap: THREE.Texture | undefined;

  const group = (name: string, parent: THREE.Object3D | null, pos: V3 = [0, 0, 0]) => {
    const g = new THREE.Bone();
    g.name = name;
    g.position.set(...pos);
    parent?.add(g);
    return g;
  };
  const attach = (bone: THREE.Bone, b: PartBuilder, map?: THREE.Texture) => {
    const geo = b.build();
    if (!geo) return;
    parts.push({ bone, geo, textured: Boolean(map) });
    if (map) clothMap = map;
  };

  // ── Hierarchy ──
  const root = new THREE.Group();
  root.name = "character";
  const scale = ap.height / REF_HEIGHT;
  const body = new THREE.Group();
  body.name = "body";
  root.add(body);
  body.scale.setScalar(scale);
  const hips = group("hips", body, [0, HIP_HEIGHT, 0]);
  const spine = group("spine", hips, [0, 0.06, 0]);
  const chest = group("chest", spine, [0, 0.2, 0]);
  const neck = group("neck", chest, [0, 0.25, -0.005]);
  const head = group("head", neck, [0, 0.07, 0.005]);
  const armL = group("armL", chest, [0.185 * sw, 0.212, -0.005]);
  const armR = group("armR", chest, [-0.185 * sw, 0.212, -0.005]);
  armL.rotation.order = "YXZ";
  armR.rotation.order = "YXZ";
  const elbowL = group("elbowL", armL, [0, -UPPER_ARM, 0]);
  const elbowR = group("elbowR", armR, [0, -UPPER_ARM, 0]);
  const handL = group("handL", elbowL, [0, -FOREARM, 0]);
  const handR = group("handR", elbowR, [0, -FOREARM, 0]);
  const hipW = female ? 0.097 : 0.092;
  const legL = group("legL", hips, [hipW, -0.02, 0]);
  const legR = group("legR", hips, [-hipW, -0.02, 0]);
  const kneeL = group("kneeL", legL, [0, -UPPER_LEG, 0]);
  const kneeR = group("kneeR", legR, [0, -UPPER_LEG, 0]);
  const footL = group("footL", kneeL, [0, -LOWER_LEG, 0]);
  const footR = group("footR", kneeR, [0, -LOWER_LEG, 0]);

  // ── Pelvis & torso ──
  const pelvis = new PartBuilder()
    .add(sphere(), lower, { pos: [0, 0.0, 0], scale: [0.158 * (female ? 1.04 : 1), 0.115, 0.105] });
  if (ap.outfit === "shirt" || ap.outfit === "suit") pelvis.add(cyl(0.15, 0.15, 0.035, 14), ap.outfit === "shirt" ? "#1c1a1a" : shade(upper, -0.2), { pos: [0, 0.075, 0], scale: [1, 1, 0.7] });
  attach(hips, pelvis);

  const abdomen = new PartBuilder().add(cyl(0.14 * sw, 0.152, 0.22, 14), upper, { pos: [0, 0.1, 0], scale: [1, 1, 0.68] });
  attach(spine, abdomen);

  const torsoProfile: Array<[number, number]> = [[0.14, 0], [0.152, 0.06], [0.168, 0.14], [0.182, 0.2], [0.174, 0.243], [0.13, 0.272], [0.06, 0.29], [0.001, 0.292]];
  const chestB = new PartBuilder()
    .add(lathe(torsoProfile.map(([r, y]) => [r * sw, y] as [number, number]), 16), upper, { scale: [1, 1, 0.63] })
    .add(sphere(10, 8), sleeve, { pos: [0.183 * sw, 0.208, -0.005], scale: [0.062, 0.06, 0.062] })
    .add(sphere(10, 8), sleeve, { pos: [-0.183 * sw, 0.208, -0.005], scale: [0.062, 0.06, 0.062] });
  const front = 0.108; // torso front surface (z) around the sternum
  if (ap.outfit === "thobe") {
    chestB
      .add(cyl(0.056, 0.06, 0.045, 14), shade(upper, -0.06), { pos: [0, 0.285, 0] })
      .add(box(0.022, 0.17, 0.006), shade(upper, -0.08), { pos: [0, 0.18, front - 0.002] });
  } else if (ap.outfit === "suit" || ap.outfit === "blazer") {
    const shirtC = ap.outfit === "suit" ? "#f3f3f1" : "#efe9e1";
    chestB
      .add(box(0.08, 0.13, 0.006), shirtC, { pos: [0, 0.215, front + 0.004] })
      .add(box(0.03, 0.12, 0.012), shade(upper, -0.18), { pos: [0.045, 0.2, front + 0.005], rot: [0, 0, -0.32] })
      .add(box(0.03, 0.12, 0.012), shade(upper, -0.18), { pos: [-0.045, 0.2, front + 0.005], rot: [0, 0, 0.32] });
    if (ap.outfit === "suit") chestB.add(box(0.026, 0.13, 0.01), shade(accent, -0.25), { pos: [0, 0.195, front + 0.01] });
  } else if (ap.outfit === "shirt") {
    chestB
      .add(cyl(0.058, 0.064, 0.04, 14), shade(upper, 0.3), { pos: [0, 0.285, 0] })
      .add(box(0.012, 0.2, 0.006), shade(upper, -0.12), { pos: [0, 0.16, front] });
  } else if (ap.outfit === "abaya") {
    chestB.add(box(0.016, 0.22, 0.006), shade(upper, 0.12), { pos: [0, 0.15, front] });
  }
  // Staff badge on an accent lanyard.
  const bx = 0.062 * sw;
  strip(chestB, [0.045, 0.272, 0.07], [bx, 0.15, front + 0.01], 0.009, accent);
  strip(chestB, [-0.045, 0.272, 0.07], [bx - 0.012, 0.15, front + 0.01], 0.009, accent);
  chestB
    .add(box(0.048, 0.064, 0.006), "#f6f6f4", { pos: [bx, 0.115, front + 0.012] })
    .add(box(0.048, 0.016, 0.0065), accent, { pos: [bx, 0.14, front + 0.0125] });
  attach(chest, chestB);

  // ── Neck & head ──
  attach(neck, new PartBuilder().add(cyl(0.046, 0.05, 0.11, 10), skin, { pos: [0, 0.035, 0] }));

  const headB = new PartBuilder()
    .add(sphere(16, 12), skin, { pos: [0, 0.11, 0.005], scale: [0.086, 0.112, 0.098] })
    .add(sphere(8, 6), skin, { pos: [0.085, 0.105, 0], scale: [0.016, 0.027, 0.013] })
    .add(sphere(8, 6), skin, { pos: [-0.085, 0.105, 0], scale: [0.016, 0.027, 0.013] })
    .add(sphere(8, 6), skinShadow, { pos: [0, 0.097, 0.1], scale: [0.014, 0.023, 0.017] })
    .add(sphere(8, 6), "#1b1a1f", { pos: [0.031, 0.124, 0.087], scale: [0.0115, 0.0105, 0.008] })
    .add(sphere(8, 6), "#1b1a1f", { pos: [-0.031, 0.124, 0.087], scale: [0.0115, 0.0105, 0.008] })
    .add(box(0.03, 0.006, 0.008), hair, { pos: [0.032, 0.142, 0.092], rot: [0, 0, 0.08] })
    .add(box(0.03, 0.006, 0.008), hair, { pos: [-0.032, 0.142, 0.092], rot: [0, 0, -0.08] })
    .add(box(0.03, 0.005, 0.006), shade(skin, -0.3), { pos: [0, 0.066, 0.099] });
  if (!female) {
    // Neatly trimmed full beard and moustache.
    headB
      .add(partialSphere(0, Math.PI, Math.PI * 0.56, Math.PI * 0.42, 16, 6), hair, { pos: [0, 0.11, 0.005], scale: [0.09, 0.117, 0.103] })
      .add(box(0.046, 0.009, 0.012), hair, { pos: [0, 0.077, 0.1] });
  }
  let headCloth: { b: PartBuilder; map?: THREE.Texture } | null = null;
  if (ap.headwear === "ghutra" || ap.headwear === "shemagh") {
    const cloth = new PartBuilder()
      .add(partialSphere(0, Math.PI * 2, 0, Math.PI * 0.5, 16, 6), ap.headwear === "ghutra" ? ap.headwearColor : "#ffffff", { pos: [0, 0.112, -0.004], rot: [-0.3, 0, 0], scale: [0.1, 0.13, 0.112] })
      .add(cyl(0.104, 0.2, 0.36, 18, true, Math.PI * 0.3, Math.PI * 1.4), ap.headwear === "ghutra" ? ap.headwearColor : "#ffffff", { pos: [0, -0.045, -0.012], scale: [1, 1, 0.95] });
    headCloth = { b: cloth, map: ap.headwear === "shemagh" ? res.shemagh(ap.headwearColor) : undefined };
    headB
      .add(torus(0.092, 0.011), "#141414", { pos: [0, 0.188, -0.012], rot: [Math.PI / 2 - 0.3, 0, 0] })
      .add(torus(0.084, 0.011), "#141414", { pos: [0, 0.209, -0.019], rot: [Math.PI / 2 - 0.3, 0, 0] });
  } else if (ap.headwear === "hijab") {
    const open = 0.6;
    headB
      .add(partialSphere(Math.PI / 2 + open, Math.PI * 2 - open * 2, 0, Math.PI, 18, 12), ap.headwearColor, { pos: [0, 0.108, -0.006], scale: [0.103, 0.132, 0.113] })
      .add(partialSphere(Math.PI / 2 - open - 0.05, open * 2 + 0.1, 0, Math.PI * 0.3, 8, 4), ap.headwearColor, { pos: [0, 0.108, -0.006], scale: [0.103, 0.132, 0.113] })
      .add(cyl(0.088, 0.215, 0.25, 18, true), ap.headwearColor, { pos: [0, -0.085, -0.008], scale: [1, 1, 0.92] })
      .add(cyl(0.085, 0.09, 0.02, 14, true), shade(ap.headwearColor, -0.15), { pos: [0, 0.035, -0.006], scale: [1, 1, 0.95] });
  } else {
    headB
      .add(partialSphere(0, Math.PI * 2, 0, Math.PI * 0.42, 16, 6), hair, { pos: [0, 0.115, -0.002], scale: [0.091, 0.12, 0.104] })
      .add(partialSphere(Math.PI, Math.PI, 0, Math.PI * 0.68, 12, 6), hair, { pos: [0, 0.112, -0.004], scale: [0.09, 0.118, 0.103] });
  }
  if (ap.accessory === "glasses") {
    headB
      .add(torus(0.017, 0.0028), "#1d1d22", { pos: [0.031, 0.124, 0.098] })
      .add(torus(0.017, 0.0028), "#1d1d22", { pos: [-0.031, 0.124, 0.098] })
      .add(box(0.016, 0.003, 0.003), "#1d1d22", { pos: [0, 0.127, 0.099] });
  } else if (ap.accessory === "headset") {
    const r = ap.headwear === "none" ? 0.1 : 0.118;
    headB
      .add(new THREE.TorusGeometry(r, 0.007, 6, 18, Math.PI), "#202226", { pos: [0, 0.12, -0.01] })
      .add(cyl(0.024, 0.024, 0.02, 12), "#202226", { pos: [r, 0.11, -0.01], rot: [0, 0, Math.PI / 2] })
      .add(cyl(0.024, 0.024, 0.02, 12), "#202226", { pos: [-r, 0.11, -0.01], rot: [0, 0, Math.PI / 2] })
      .add(box(0.006, 0.006, 0.09), "#202226", { pos: [-r + 0.01, 0.075, 0.045], rot: [0.35, 0.25, 0] })
      .add(sphere(6, 4), accent, { pos: [-r + 0.03, 0.06, 0.09], scale: [0.011, 0.011, 0.011] });
  }
  attach(head, headB);
  if (headCloth) attach(head, headCloth.b, headCloth.map);

  // ── Arms ──
  const buildArm = (shoulder: THREE.Bone, elbow: THREE.Bone, hand: THREE.Bone, left: boolean) => {
    const wide = ap.outfit === "thobe" || ap.outfit === "abaya";
    attach(shoulder, new PartBuilder().add(capsule(0.047, 0.2), sleeve, { pos: [0, -0.142, 0] }));
    const fore = new PartBuilder().add(capsule(wide ? 0.046 : 0.04, 0.17, 10), sleeve, { pos: [0, -0.115, 0] });
    if (wide) fore.add(cyl(0.05, 0.054, 0.05, 12, true), shade(sleeve, -0.05), { pos: [0, -0.215, 0] });
    if (ap.outfit === "suit") fore.add(cyl(0.039, 0.039, 0.025, 10), "#f3f3f1", { pos: [0, -0.235, 0] });
    if (ap.accessory === "watch" && left) {
      fore
        .add(cyl(0.041, 0.041, 0.018, 12), "#1f1f1f", { pos: [0, -0.222, 0] })
        .add(cyl(0.016, 0.016, 0.008, 12), "#c9a24a", { pos: [0, -0.222, 0.04], rot: [Math.PI / 2, 0, 0] });
    }
    attach(elbow, fore);
    attach(hand, new PartBuilder()
      .add(sphere(10, 8), skin, { pos: [0, -0.052, 0.004], scale: [0.031, 0.06, 0.021] })
      .add(sphere(6, 4), skin, { pos: [left ? -0.02 : 0.02, -0.03, 0.018], scale: [0.011, 0.026, 0.011], rot: [0.3, 0, left ? 0.4 : -0.4] }));
  };
  buildArm(armL, elbowL, handL, true);
  buildArm(armR, elbowR, handR, false);

  // ── Legs ──
  const legC = lower;
  const buildLeg = (leg: THREE.Bone, knee: THREE.Bone, foot: THREE.Bone) => {
    attach(leg, new PartBuilder().add(capsule(robeOutfit ? 0.078 : 0.068, 0.3), legC, { pos: [0, -0.21, 0] }));
    const shin = new PartBuilder().add(capsule(robeOutfit ? 0.066 : 0.052, 0.32), legC, { pos: [0, -0.2, 0] });
    attach(knee, shin);
    attach(foot, new PartBuilder().add(capsule(0.041, 0.13, 8), shoe, { pos: [0, -0.03, 0.045], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.8] }));
  };
  buildLeg(legL, kneeL, footL);
  buildLeg(legR, kneeR, footR);

  // ── Long robe / skirt (thobe, abaya, long skirt) ──
  let robe: THREE.Bone | null = null;
  if (robeOutfit) {
    robe = group("robe", hips, [0, 0.02, 0]);
    const hem: Array<[number, number]> = [[0.162, 0.05], [0.172, -0.08], [0.195, -0.35], [0.228, -0.68], [0.245, -0.84], [0.236, -0.855]];
    const robeB = new PartBuilder().add(lathe(hem.map(([r, y]) => [r * (female ? 1.03 : 1), y] as [number, number]), 18), lower, { scale: [1, 1, 0.82] });
    if (ap.outfit === "abaya") robeB.add(box(0.016, 0.8, 0.006), shade(lower, 0.12), { pos: [0, -0.42, 0.19], rot: [-0.08, 0, 0] });
    attach(robe, robeB);
  }

  // ── Handheld prop (visible while standing) ──
  let prop: THREE.Bone | null = null;
  const propB = new PartBuilder();
  if (ap.accessory === "tablet") propB.add(box(0.16, 0.22, 0.01), "#1e2127", { pos: [0, -0.1, 0.03], rot: [0.2, 0, 0] }).add(box(0.145, 0.2, 0.002), shade(accent, 0.35), { pos: [0, -0.1, 0.037], rot: [0.2, 0, 0] });
  else if (ap.accessory === "folder") propB.add(box(0.23, 0.3, 0.02), accent, { pos: [0, -0.12, 0.03], rot: [0.15, 0, 0] });
  else if (ap.accessory === "laptop") propB.add(box(0.3, 0.21, 0.018), "#b9bcc3", { pos: [0, -0.1, 0.035], rot: [0.1, 0, 0] });
  else if (ap.accessory === "pen") propB.add(cyl(0.004, 0.004, 0.13, 6), "#1c1c1f", { pos: [0.006, -0.07, 0.02], rot: [0.9, 0, 0] });
  if (!propB.empty) {
    prop = group("prop", ap.accessory === "pen" ? handR : handL);
    attach(prop, propB);
  }

  // ── Bind: bake each part into character space and skin it rigidly to its bone ──
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  body.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
  const boneIndex = new Map(bones.map((b, i) => [b, i]));
  const skeleton = new THREE.Skeleton(bones);
  const geometries: THREE.BufferGeometry[] = [];
  const meshes: Array<{ mesh: THREE.SkinnedMesh; map?: THREE.Texture }> = [];
  for (const textured of [false, true]) {
    const list = parts.filter((p) => p.textured === textured);
    if (!list.length) continue;
    for (const p of list) {
      p.geo.applyMatrix4(p.bone.matrixWorld);
      const n = p.geo.attributes.position.count;
      const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
      const bi = boneIndex.get(p.bone)!;
      for (let i = 0; i < n; i++) { idx[i * 4] = bi; w[i * 4] = 1; }
      p.geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
      p.geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(w, 4));
    }
    const geo = mergeGeometries(list.map((p) => p.geo), false);
    list.forEach((p) => p.geo.dispose());
    geometries.push(geo);
    const map = textured ? clothMap : undefined;
    const mesh = new THREE.SkinnedMesh(geo, res.characterMaterial("normal", map));
    mesh.name = textured ? "cloth" : "figure";
    mesh.frustumCulled = false; // poses move limbs outside the bind-pose bounds; 8 characters are always cheap to submit
    mesh.raycast = () => {}; // picking uses a dedicated proxy
    root.add(mesh);
    mesh.bind(skeleton);
    meshes.push({ mesh, map });
  }

  const rig: CharacterRig = {
    root, body, hips, spine, chest, neck, head,
    armL, elbowL, handL, armR, elbowR, handR,
    legL, kneeL, footL, legR, kneeR, footR,
    robe, prop, scale,
    setVariant(variant) {
      for (const { mesh, map } of meshes) mesh.material = res.characterMaterial(variant, map);
    },
    setShadows(cast) {
      for (const { mesh } of meshes) mesh.castShadow = cast;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      skeleton.dispose();
      root.removeFromParent();
    },
  };
  return rig;
}

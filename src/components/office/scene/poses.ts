import type { CharacterAnimation } from "@/lib/office/types";
import { HIP_HEIGHT, type CharacterRig } from "./character-model";

/**
 * Procedural pose system. A pose is a flat array of joint channels. Each frame the behaviour layer picks an
 * animation; we compute a target pose (base posture blended by sit weight + upper-body animation), the
 * current pose is exponentially damped toward it (smooth, frame-rate independent transitions), then
 * additive layers (gait, breathing) are applied before writing to the rig.
 *
 * Stored conventions: *_RX of arms/legs = forward flexion (+), *_RZ = abduction/outward (+),
 * ARM_RY = inward (+), ELBOW/KNEE = flexion (+), HAND = wrist flexion (+), FOOT = toes down (+).
 * Spine/chest/head RX + = lean/look forward-down, RY + = turn toward the character's left.
 */
export const C = {
  HIPS_Y: 0, HIPS_Z: 1, HIPS_RX: 2, HIPS_RY: 3, HIPS_RZ: 4,
  SPINE_RX: 5, SPINE_RY: 6, SPINE_RZ: 7,
  CHEST_RX: 8, CHEST_RY: 9, CHEST_RZ: 10,
  NECK_RX: 11, NECK_RY: 12,
  HEAD_RX: 13, HEAD_RY: 14, HEAD_RZ: 15,
  LARM_RX: 16, LARM_RY: 17, LARM_RZ: 18, LELBOW: 19, LHAND: 20,
  RARM_RX: 21, RARM_RY: 22, RARM_RZ: 23, RELBOW: 24, RHAND: 25,
  LLEG_RX: 26, LLEG_RZ: 27, LKNEE: 28, LFOOT: 29,
  RLEG_RX: 30, RLEG_RZ: 31, RKNEE: 32, RFOOT: 33,
  ROBE_SIT: 34,
} as const;
export const CHANNELS = 35;

/** Preferred idle-at-desk posture (profile.defaultAnimation); deliberately subtle so it never reads as real work. */
export type IdleVariant = "working" | "reading" | "thinking" | null;

export interface PoseContext {
  anim: CharacterAnimation;
  /** 0 = standing, 1 = seated. */
  sit: number;
  /** Hip drop (body-local units) that puts the pelvis on the current seat. */
  sitDrop: number;
  /** Seated at a table (meeting) — forearms rest further forward. */
  atTable: boolean;
  /** Seated on a lounge sofa — relaxed posture. */
  lounge: boolean;
  t: number;
  /** Seconds since the current animation started. */
  animTime: number;
  /** Per-character phase offset so characters never move in lockstep. */
  seed: number;
  /** Relative yaw (rad) toward something to look at, 0 if none. */
  look: number;
  idleVariant?: IdleVariant;
}

type Arm = { rx: number; ry: number; rz: number; elbow: number; hand: number };
const REST_STAND: Arm = { rx: 0.06, ry: 0.02, rz: 0.1, elbow: 0.2, hand: 0.05 };
const REST_SEATED: Arm = { rx: 0.42, ry: 0.12, rz: 0.12, elbow: 0.78, hand: 0.1 };
const LOUNGE_ARM: Arm = { rx: 0.3, ry: 0.05, rz: 0.3, elbow: 0.75, hand: 0.15 };

function setArm(p: Float32Array, left: boolean, a: Arm) {
  if (left) { p[C.LARM_RX] = a.rx; p[C.LARM_RY] = a.ry; p[C.LARM_RZ] = a.rz; p[C.LELBOW] = a.elbow; p[C.LHAND] = a.hand; }
  else { p[C.RARM_RX] = a.rx; p[C.RARM_RY] = a.ry; p[C.RARM_RZ] = a.rz; p[C.RELBOW] = a.elbow; p[C.RHAND] = a.hand; }
}

const SEATED_ANIMS = new Set<CharacterAnimation>(["working", "typing", "reading", "waiting", "meeting", "sitting"]);

/** Writes the target pose for the given context into `out`. */
export function computeTargetPose(out: Float32Array, ctx: PoseContext) {
  out.fill(0);
  const { sit, t, seed } = ctx;
  const s = t + seed * 7.3;

  // Lower body: standing ↔ seated.
  out[C.HIPS_Y] = ctx.sitDrop * sit;
  const legFlex = (ctx.lounge ? 1.42 : 1.52) * sit;
  out[C.LLEG_RX] = legFlex; out[C.RLEG_RX] = legFlex;
  out[C.LLEG_RZ] = 0.02 + 0.06 * sit; out[C.RLEG_RZ] = 0.02 + 0.06 * sit;
  out[C.LKNEE] = 0.04 + 1.46 * sit; out[C.RKNEE] = 0.04 + 1.46 * sit;
  out[C.ROBE_SIT] = sit;

  const seated = sit > 0.5;
  setArm(out, true, seated ? (ctx.lounge ? LOUNGE_ARM : REST_SEATED) : REST_STAND);
  setArm(out, false, seated ? (ctx.lounge ? LOUNGE_ARM : REST_SEATED) : REST_STAND);
  if (seated && ctx.lounge) { out[C.SPINE_RX] = -0.16; out[C.CHEST_RX] = -0.04; out[C.HEAD_RX] = 0.08; }

  let anim = ctx.anim;
  // Desk animations only make sense while seated; fall back to an attentive stand otherwise.
  if (!seated && SEATED_ANIMS.has(anim)) anim = "idle";

  switch (anim) {
    case "idle": {
      if (!seated) {
        out[C.HIPS_RZ] = 0.022 * Math.sin(s * 0.38);
        out[C.LLEG_RZ] += 0.02 * Math.sin(s * 0.38);
        out[C.RLEG_RZ] -= 0.02 * Math.sin(s * 0.38);
        out[C.SPINE_RZ] = -0.015 * Math.sin(s * 0.38);
      }
      out[C.HEAD_RY] += 0.22 * Math.sin(s * 0.17) * Math.sin(s * 0.29 + 1);
      out[C.HEAD_RX] += 0.03 * Math.sin(s * 0.23);
      if (seated && !ctx.lounge && ctx.idleVariant) {
        // Relaxed at the desk: no typing, no gestures — just the agent's preferred resting posture.
        out[C.SPINE_RX] = -0.05;
        if (ctx.idleVariant === "working") {
          setArm(out, true, { rx: 0.5, ry: 0.32, rz: 0.16, elbow: 0.95, hand: 0.15 });
          setArm(out, false, { rx: 0.5, ry: 0.32, rz: 0.16, elbow: 0.95, hand: 0.15 });
        } else if (ctx.idleVariant === "reading") {
          out[C.HEAD_RX] = 0.16;
          setArm(out, true, { rx: 0.45, ry: 0.4, rz: 0.14, elbow: 1.1, hand: 0.05 });
        } else {
          out[C.HEAD_RZ] = 0.06;
          setArm(out, false, { rx: 0.5, ry: 0.45, rz: 0.04, elbow: 2.0, hand: 0.25 });
        }
      }
      break;
    }
    case "walking":
      out[C.HEAD_RX] = 0.04;
      break;
    case "working":
    case "typing": {
      out[C.SPINE_RX] = 0.1; out[C.CHEST_RX] = 0.04;
      out[C.HEAD_RX] = 0.1 + 0.03 * Math.sin(s * 0.7);
      out[C.HEAD_RY] = 0.05 * Math.sin(s * 0.31);
      for (const left of [true, false]) {
        const ph = left ? 0 : 1.9;
        setArm(out, left, { rx: 0.55, ry: 0.3, rz: 0.2, elbow: 1.05 + 0.04 * Math.sin(s * 11 + ph), hand: -0.15 + 0.14 * Math.sin(s * 17 + ph) });
      }
      break;
    }
    case "reading": {
      out[C.SPINE_RX] = 0.06; out[C.CHEST_RX] = 0.02;
      out[C.HEAD_RX] = 0.14 + 0.04 * Math.sin(s * 0.55);
      out[C.HEAD_RY] = 0.07 * Math.sin(s * 0.42);
      setArm(out, false, { rx: 0.52, ry: 0.06, rz: 0.24, elbow: 1.05, hand: -0.1 + 0.08 * Math.max(0, Math.sin(s * 1.8)) });
      setArm(out, true, { rx: 0.45, ry: 0.4, rz: 0.14, elbow: 1.12, hand: 0.05 });
      break;
    }
    case "thinking": {
      out[C.SPINE_RX] = seated ? -0.06 : 0; out[C.CHEST_RX] = -0.02;
      out[C.HEAD_RX] = -0.06; out[C.HEAD_RZ] = 0.09; out[C.HEAD_RY] = 0.14 * Math.sin(s * 0.27);
      setArm(out, false, { rx: 0.62, ry: 0.5, rz: 0.02, elbow: 2.35, hand: 0.35 });
      setArm(out, true, { rx: 0.3, ry: 0.62, rz: 0.0, elbow: 1.6, hand: 0.1 });
      break;
    }
    case "talking": {
      out[C.HEAD_RX] = 0.03 * Math.sin(s * 3.1);
      out[C.HEAD_RY] = 0.12 * Math.sin(s * 0.8);
      out[C.CHEST_RY] = 0.06 * Math.sin(s * 1.1);
      for (const left of [true, false]) {
        const ph = left ? 0 : 1.3;
        setArm(out, left, {
          rx: (seated ? 0.55 : 0.32) + 0.2 * Math.sin(s * 2.2 + ph),
          ry: 0.22,
          rz: 0.18 + 0.06 * Math.sin(s * 1.7 + ph),
          elbow: 1.1 + 0.32 * Math.sin(s * 2.6 + ph * 1.7),
          hand: 0.12 * Math.sin(s * 3 + ph),
        });
      }
      break;
    }
    case "listening": {
      const nod = Math.pow(Math.max(0, Math.sin(s * 1.25)), 6);
      out[C.HEAD_RX] = 0.06 + 0.12 * nod;
      out[C.HEAD_RZ] = 0.04 * Math.sin(s * 0.3);
      if (seated && ctx.atTable) {
        out[C.SPINE_RX] = 0.1;
        setArm(out, true, { rx: 0.75, ry: 0.36, rz: 0.18, elbow: 0.85, hand: 0 });
        setArm(out, false, { rx: 0.75, ry: 0.36, rz: 0.18, elbow: 0.85, hand: 0 });
      } else if (!seated) {
        // Hands loosely clasped in front.
        setArm(out, true, { rx: 0.22, ry: 0.42, rz: 0.06, elbow: 0.75, hand: 0.1 });
        setArm(out, false, { rx: 0.22, ry: 0.42, rz: 0.06, elbow: 0.75, hand: 0.1 });
      }
      break;
    }
    case "meeting": {
      out[C.SPINE_RX] = 0.1; out[C.HEAD_RX] = 0.06;
      setArm(out, true, { rx: 0.75, ry: 0.36, rz: 0.18, elbow: 0.85, hand: 0 });
      setArm(out, false, { rx: 0.75, ry: 0.36, rz: 0.18, elbow: 0.85, hand: 0 });
      break;
    }
    case "waiting": {
      out[C.SPINE_RX] = -0.1; out[C.CHEST_RX] = -0.03;
      const glance = Math.sin(s * 0.33);
      out[C.HEAD_RY] = 0.38 * glance * glance * glance;
      out[C.HEAD_RX] = 0.02;
      setArm(out, false, { rx: 0.5, ry: 0.25, rz: 0.2, elbow: 1.0, hand: 0.25 * Math.max(0, Math.sin(s * 8.5)) });
      break;
    }
    case "celebrating": {
      const pump = Math.sin(ctx.animTime * 8);
      out[C.HEAD_RX] = -0.22; out[C.CHEST_RX] = -0.08; out[C.SPINE_RX] = -0.04;
      setArm(out, true, { rx: 2.55 + 0.12 * pump, ry: 0, rz: 0.42, elbow: 0.35 + 0.2 * pump, hand: -0.2 });
      setArm(out, false, { rx: 2.55 + 0.12 * pump, ry: 0, rz: 0.42, elbow: 0.35 + 0.2 * pump, hand: -0.2 });
      break;
    }
    case "error": {
      const shake = Math.sin(ctx.animTime * 5.5) * Math.exp(-ctx.animTime * 0.7);
      out[C.HEAD_RX] = 0.42; out[C.HEAD_RY] = 0.16 * shake;
      out[C.SPINE_RX] = seated ? 0.18 : 0.12; out[C.CHEST_RX] = 0.08;
      setArm(out, true, { rx: 0.28, ry: -0.15, rz: 0.34, elbow: 1.3, hand: -0.35 });
      setArm(out, false, { rx: 0.28, ry: -0.15, rz: 0.34, elbow: 1.3, hand: -0.35 });
      break;
    }
    case "sitting":
      out[C.SPINE_RX] = -0.04; out[C.HEAD_RX] = 0.12;
      break;
  }

  if (ctx.look) {
    const l = Math.max(-1.3, Math.min(1.3, ctx.look));
    out[C.HEAD_RY] += l * 0.62;
    out[C.CHEST_RY] += l * 0.24;
    out[C.SPINE_RY] += l * 0.12;
  }
}

/** Frame-rate independent exponential approach of `cur` toward `target`. */
export function dampPose(cur: Float32Array, target: Float32Array, lambda: number, dt: number) {
  const k = 1 - Math.exp(-lambda * dt);
  for (let i = 0; i < CHANNELS; i++) cur[i] += (target[i] - cur[i]) * k;
}

/** Adds walking gait (phase in radians, weight 0..1) and breathing on top of a pose. */
export function addLayers(p: Float32Array, phase: number, gait: number, t: number, seed: number) {
  p[C.CHEST_RX] += 0.014 * Math.sin((t + seed * 3) * 1.5);
  if (gait <= 0.001) return;
  const sL = Math.sin(phase), sR = -sL;
  const swing = (x: number) => Math.pow(Math.max(0, x), 1.4);
  p[C.LLEG_RX] += 0.44 * sL * gait;
  p[C.RLEG_RX] += 0.44 * sR * gait;
  p[C.LKNEE] += gait * (0.08 + 0.7 * swing(Math.cos(phase)));
  p[C.RKNEE] += gait * (0.08 + 0.7 * swing(-Math.cos(phase)));
  p[C.LFOOT] += -0.18 * sL * gait;
  p[C.RFOOT] += -0.18 * sR * gait;
  p[C.LARM_RX] += -0.34 * sL * gait;
  p[C.RARM_RX] += -0.34 * sR * gait;
  p[C.LELBOW] += 0.16 * gait + 0.12 * Math.max(0, -sL) * gait;
  p[C.RELBOW] += 0.16 * gait + 0.12 * Math.max(0, -sR) * gait;
  p[C.HIPS_Y] += gait * (0.016 * Math.cos(2 * phase) - 0.018);
  p[C.HIPS_RY] += 0.07 * sL * gait;
  p[C.HIPS_RZ] += 0.025 * Math.cos(phase) * gait;
  p[C.CHEST_RY] -= 0.09 * sL * gait;
  p[C.SPINE_RX] += 0.05 * gait;
}

/** Writes pose channels onto the rig's joints. */
export function applyPose(rig: CharacterRig, p: Float32Array, gait: number) {
  rig.hips.position.set(0, HIP_HEIGHT + p[C.HIPS_Y], p[C.HIPS_Z]);
  rig.hips.rotation.set(p[C.HIPS_RX], p[C.HIPS_RY], p[C.HIPS_RZ]);
  rig.spine.rotation.set(p[C.SPINE_RX], p[C.SPINE_RY], p[C.SPINE_RZ]);
  rig.chest.rotation.set(p[C.CHEST_RX], p[C.CHEST_RY], p[C.CHEST_RZ]);
  rig.neck.rotation.set(p[C.NECK_RX] + p[C.HEAD_RX] * 0.3, p[C.NECK_RY] + p[C.HEAD_RY] * 0.3, 0);
  rig.head.rotation.set(p[C.HEAD_RX] * 0.7, p[C.HEAD_RY] * 0.7, p[C.HEAD_RZ]);
  rig.armL.rotation.set(-p[C.LARM_RX], -p[C.LARM_RY], p[C.LARM_RZ]);
  rig.armR.rotation.set(-p[C.RARM_RX], p[C.RARM_RY], -p[C.RARM_RZ]);
  rig.elbowL.rotation.x = -p[C.LELBOW];
  rig.elbowR.rotation.x = -p[C.RELBOW];
  rig.handL.rotation.x = -p[C.LHAND];
  rig.handR.rotation.x = -p[C.RHAND];
  rig.legL.rotation.set(-p[C.LLEG_RX], 0, p[C.LLEG_RZ]);
  rig.legR.rotation.set(-p[C.RLEG_RX], 0, -p[C.RLEG_RZ]);
  rig.kneeL.rotation.x = p[C.LKNEE];
  rig.kneeR.rotation.x = p[C.RKNEE];
  rig.footL.rotation.x = p[C.LFOOT];
  rig.footR.rotation.x = p[C.RFOOT];
  if (rig.robe) {
    const s = p[C.ROBE_SIT];
    rig.robe.rotation.x = -1.32 * s - 0.03 * Math.sin(p[C.HIPS_RY] * 10) * gait;
    rig.robe.scale.set(1 + 0.05 * gait + 0.08 * s, 1 - 0.46 * s, 1 + 0.06 * gait);
  }
  if (rig.prop) rig.prop.scale.setScalar(p[C.ROBE_SIT] < 0.3 ? 1 : 1e-4); // handheld prop is put away while seated
}

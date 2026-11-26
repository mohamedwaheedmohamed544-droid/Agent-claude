import * as THREE from "three";

export type MaterialVariant = "normal" | "muted" | "ghost";
export type QualityTier = "high" | "medium" | "low";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")!];
}

/** Deterministic PRNG so procedural textures look identical across reloads. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function floorTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = "#cfcac2";
  ctx.fillRect(0, 0, 512, 512);
  const rnd = mulberry32(7);
  // Subtle concrete speckle.
  for (let i = 0; i < 2600; i++) {
    const v = 200 + Math.floor(rnd() * 30);
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.12 + rnd() * 0.12})`;
    const s = 1 + rnd() * 3;
    ctx.fillRect(rnd() * 512, rnd() * 512, s, s);
  }
  // Large-format tile joints (2 × 2 tiles per texture repeat).
  ctx.strokeStyle = "rgba(120,112,100,0.28)";
  ctx.lineWidth = 2;
  for (const p of [0, 256]) {
    ctx.beginPath(); ctx.moveTo(p + 1, 0); ctx.lineTo(p + 1, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p + 1); ctx.lineTo(512, p + 1); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function blobTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.55, "rgba(0,0,0,0.22)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function screenUiTexture(): THREE.CanvasTexture {
  // Neutral, content-free UI chrome (window bars and text lines); tinted per instance by status colour.
  const [c, ctx] = canvas(256, 160);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = "#c9ccd6";
  ctx.fillRect(0, 0, 256, 16);
  ctx.fillStyle = "#e3e5ec";
  ctx.fillRect(0, 16, 54, 144);
  const rnd = mulberry32(11);
  ctx.fillStyle = "#b5b9c6";
  for (let y = 28; y < 150; y += 11) ctx.fillRect(66, y, 60 + rnd() * 120, 4);
  for (let y = 28; y < 140; y += 14) ctx.fillRect(8, y, 34, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function windowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#cfe3f3");
  g.addColorStop(0.65, "#eef4f8");
  g.addColorStop(1, "#dfe7d9");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  // Distant skyline silhouettes.
  const rnd = mulberry32(5);
  ctx.fillStyle = "rgba(150,170,190,0.45)";
  for (let x = 0; x < 256; x += 18) {
    const h = 30 + rnd() * 70;
    ctx.fillRect(x, 200 - h, 14, h + 56);
  }
  ctx.strokeStyle = "#3a3f47";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 250);
  ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 256); ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Red/white (or tone-on-tone) shemagh weave, generated in code. */
function shemaghTexture(color: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const base = new THREE.Color(color);
  const light = base.getHSL({ h: 0, s: 0, l: 0 }).l > 0.8;
  ctx.fillStyle = "#f7f5f0";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = light ? "#cfcac0" : color;
  for (let y = 0; y < 64; y += 8) {
    for (let x = 0; x < 64; x += 8) {
      if (((x + y) / 8) % 2 === 0) ctx.fillRect(x + 1, y + 1, 6, 6);
      else ctx.fillRect(x + 3, y + 3, 2, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/**
 * Every GPU resource shared across the scene. Created once per Canvas mount and disposed on unmount.
 */
export class SceneResources {
  private disposables: Array<{ dispose(): void }> = [];
  private characterMats = new Map<string, THREE.MeshStandardMaterial>();
  private shemaghTextures = new Map<string, THREE.CanvasTexture>();

  readonly floorTex = this.track(floorTexture());
  readonly blobTex = this.track(blobTexture());
  readonly screenTex = this.track(screenUiTexture());
  readonly windowTex = this.track(windowTexture());

  readonly mats = {
    floor: this.track(new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 0.82, metalness: 0 })),
    wood: this.track(new THREE.MeshStandardMaterial({ color: "#b07f55", roughness: 0.55 })),
    woodDark: this.track(new THREE.MeshStandardMaterial({ color: "#6e4a32", roughness: 0.6 })),
    metal: this.track(new THREE.MeshStandardMaterial({ color: "#2c3036", roughness: 0.38, metalness: 0.6 })),
    fabric: this.track(new THREE.MeshStandardMaterial({ color: "#3f4450", roughness: 0.92 })),
    sofa: this.track(new THREE.MeshStandardMaterial({ color: "#8c8579", roughness: 0.95 })),
    stone: this.track(new THREE.MeshStandardMaterial({ color: "#ecebe7", roughness: 0.35 })),
    plant: this.track(new THREE.MeshStandardMaterial({ color: "#4f7d43", roughness: 0.8, flatShading: true })),
    pot: this.track(new THREE.MeshStandardMaterial({ color: "#e7e1d8", roughness: 0.7 })),
    lampShade: this.track(new THREE.MeshStandardMaterial({ color: "#23262c", roughness: 0.5, metalness: 0.4 })),
    lampGlow: this.track(new THREE.MeshBasicMaterial({ color: "#fff4dc", toneMapped: false })),
    decor: this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })),
    rug: this.track(new THREE.MeshStandardMaterial({ roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
    glassFrame: this.track(new THREE.MeshStandardMaterial({ color: "#30343b", roughness: 0.4, metalness: 0.7 })),
    screen: this.track(new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false })),
    window: this.track(new THREE.MeshBasicMaterial({ map: this.windowTex, toneMapped: false })),
    blob: this.track(new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })),
    lowWall: this.track(new THREE.MeshStandardMaterial({ color: "#e4e0d8", roughness: 0.85 })),
  };

  private glassMats = new Map<QualityTier, THREE.Material>();

  track<T extends { dispose(): void }>(r: T): T {
    this.disposables.push(r);
    return r;
  }

  /** Vertex-coloured character material, shared by all characters per visual variant. */
  characterMaterial(variant: MaterialVariant, map?: THREE.Texture): THREE.MeshStandardMaterial {
    const key = `${variant}|${map?.uuid ?? ""}`;
    let m = this.characterMats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, side: THREE.DoubleSide, map: map ?? null });
      if (variant === "muted") { m.color.set("#8e8e96"); m.roughness = 0.9; }
      if (variant === "ghost") { m.color.set("#cdd2da"); m.transparent = true; m.opacity = 0.26; m.depthWrite = false; }
      this.characterMats.set(key, this.track(m));
    }
    return m;
  }

  shemagh(color: string): THREE.CanvasTexture {
    let t = this.shemaghTextures.get(color);
    if (!t) { t = this.track(shemaghTexture(color)); this.shemaghTextures.set(color, t); }
    return t;
  }

  glass(tier: QualityTier): THREE.Material {
    let m = this.glassMats.get(tier);
    if (!m) {
      m = tier === "high"
        ? new THREE.MeshPhysicalMaterial({ color: "#eef6f8", roughness: 0.06, metalness: 0, transmission: 0.92, thickness: 0.05, ior: 1.45, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false })
        : new THREE.MeshStandardMaterial({ color: "#cfe3ea", roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
      this.glassMats.set(tier, this.track(m));
    }
    return m;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.characterMats.clear();
    this.shemaghTextures.clear();
    this.glassMats.clear();
  }
}

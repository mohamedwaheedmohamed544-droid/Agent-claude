"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { AgentPresence, AgentProfile, AgentStatus, OfficeZone } from "@/lib/office/types";
import { DEPARTMENT_DISPLAYS, EXECUTIVE_WALL, MEETING_SCREEN, OFFICE_ZONE_LABELS, type DisplaySpec } from "./layout";
import { truncate } from "./simulation";
import { local } from "./geometry";

/**
 * Wall screens rendered onto canvas textures. Every line of text comes from real presence / meeting data;
 * the only graphics are neutral UI chrome.
 */

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#9ca3af", working: "#6366f1", waiting: "#f59e0b", meeting: "#8b5cf6", error: "#ef4444", paused: "#6b7280",
};
export const STATUS_TEXT: Record<AgentStatus, { en: string; ar: string }> = {
  idle: { en: "Idle", ar: "متفرغ" },
  working: { en: "Working", ar: "يعمل" },
  waiting: { en: "Waiting", ar: "بانتظار" },
  meeting: { en: "In a meeting", ar: "في اجتماع" },
  error: { en: "Error", ar: "خطأ" },
  paused: { en: "Paused", ar: "متوقف" },
};

const ARABIC = /[؀-ۿ]/;

function fontStack(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const cs = getComputedStyle(document.documentElement);
  const fams = [cs.getPropertyValue("--font-inter"), cs.getPropertyValue("--font-arabic")].map((s) => s.trim()).filter(Boolean);
  return [...fams, "system-ui", "'Segoe UI'", "Tahoma", "sans-serif"].join(", ");
}

/** Re-render once web fonts are ready so canvas text uses the app's typefaces. */
function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  return ready;
}

function useCanvasTexture(width: number, height: number) {
  const value = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    return { canvas, ctx, texture, material };
  }, [width, height]);
  useEffect(() => () => { value.texture.dispose(); value.material.dispose(); }, [value]);
  return value;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws wrapped text inside [x, x+w]; right-aligned automatically for Arabic. Returns the next y. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lineH: number, maxLines: number) {
  const rtl = ARABIC.test(text);
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  const ax = rtl ? x + w : x;
  const words = text.split(/\s+/);
  let line = "", lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > w && line) {
      if (lines === maxLines - 1) { ctx.fillText(`${line}…`, ax, y); return y + lineH; }
      ctx.fillText(line, ax, y);
      lines++; y += lineH; line = words[i];
    } else line = test;
  }
  if (line) { ctx.fillText(line, ax, y); y += lineH; }
  ctx.direction = "ltr"; ctx.textAlign = "left";
  return y;
}

function background(ctx: CanvasRenderingContext2D, w: number, h: number, accent: string) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#0f1522");
  g.addColorStop(1, "#151c2c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, w, 8);
}

function statusPill(ctx: CanvasRenderingContext2D, status: AgentStatus, x: number, y: number, size: number, font: string) {
  const label = `${STATUS_TEXT[status].en} · ${STATUS_TEXT[status].ar}`;
  ctx.font = `600 ${size}px ${font}`;
  const w = ctx.measureText(label).width + size * 2.2;
  roundRect(ctx, x, y, w, size * 1.8, size * 0.9);
  ctx.fillStyle = `${STATUS_COLORS[status]}33`;
  ctx.fill();
  ctx.fillStyle = STATUS_COLORS[status];
  ctx.beginPath(); ctx.arc(x + size * 0.9, y + size * 0.9, size * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e5e7eb";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + size * 1.5, y + size * 0.95);
  ctx.textBaseline = "alphabetic";
  return w;
}

function Panel({ spec, material }: { spec: { x: number; y: number; z: number; yaw: number; width: number; height: number }; material: THREE.Material }) {
  const pos = local(spec.x, spec.z, spec.yaw, 0, 0.005);
  return (
    <mesh position={[pos.x, spec.y, pos.z]} rotation-y={spec.yaw} material={material} raycast={() => null}>
      <planeGeometry args={[spec.width, spec.height]} />
    </mesh>
  );
}

function DepartmentDisplay({ spec, profile, presence }: { spec: DisplaySpec; profile: AgentProfile | undefined; presence: AgentPresence | undefined }) {
  const W = 1024, H = Math.round((1024 * spec.height) / spec.width);
  const { ctx, texture, material } = useCanvasTexture(W, H);
  const fonts = useFontsReady();
  useEffect(() => {
    const font = fontStack();
    const accent = profile?.color ?? "#6366f1";
    background(ctx, W, H, accent);
    const label = OFFICE_ZONE_LABELS[spec.zone];
    ctx.fillStyle = "#94a3b8";
    ctx.font = `600 30px ${font}`;
    ctx.fillText(label.en.toUpperCase(), 48, 70);
    ctx.direction = "rtl"; ctx.textAlign = "right";
    ctx.fillText(label.ar, W - 48, 70);
    ctx.direction = "ltr"; ctx.textAlign = "left";

    if (profile) {
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(92, 160, 44, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 44px ${font}`;
      ctx.textAlign = "center"; ctx.direction = "rtl";
      ctx.fillText(Array.from(profile.nameAr)[0] ?? "", 92, 176);
      ctx.textAlign = "left"; ctx.direction = "ltr";
      ctx.fillStyle = "#f8fafc";
      ctx.font = `700 46px ${font}`;
      ctx.fillText(`${profile.nameAr}  ·  ${profile.nameEn}`, 158, 152);
      ctx.fillStyle = "#94a3b8";
      ctx.font = `500 26px ${font}`;
      ctx.fillText(`${profile.titleEn} — ${profile.titleAr}`, 158, 192);
      const status = presence?.status ?? "idle";
      statusPill(ctx, status, 48, 236, 26, font);

      ctx.fillStyle = "rgba(148,163,184,0.18)";
      ctx.fillRect(48, 316, W - 96, 2);
      ctx.fillStyle = "#64748b";
      ctx.font = `600 24px ${font}`;
      ctx.fillText("CURRENT ACTIVITY · النشاط الحالي", 48, 362);
      const activity = presence?.activity || presence?.taskTitle;
      ctx.fillStyle = activity ? "#e2e8f0" : "#64748b";
      ctx.font = `500 34px ${font}`;
      const y = wrapText(ctx, activity ? truncate(activity, 200) : "No active task · لا توجد مهمة حالية", 48, 412, W - 96, 46, 3);
      if (presence?.waitingFor) {
        ctx.fillStyle = "#fbbf24";
        ctx.font = `600 26px ${font}`;
        wrapText(ctx, `Waiting for: ${presence.waitingFor}`, 48, y + 8, W - 96, 34, 1);
      }
    }
    texture.needsUpdate = true;
  }, [ctx, texture, W, H, spec.zone, profile, presence, fonts]);
  return <Panel spec={spec} material={material} />;
}

function ExecutiveWall({ profiles, presence }: { profiles: AgentProfile[]; presence: Map<string, AgentPresence> }) {
  const W = 2048, H = Math.round((2048 * EXECUTIVE_WALL.height) / EXECUTIVE_WALL.width);
  const { ctx, texture, material } = useCanvasTexture(W, H);
  const fonts = useFontsReady();
  useEffect(() => {
    const font = fontStack();
    background(ctx, W, H, "#4f46e5");
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 34px ${font}`;
    ctx.fillText("NEXUS · LIVE OPERATIONS", 40, 58);
    ctx.direction = "rtl"; ctx.textAlign = "right";
    ctx.fillText("العمليات المباشرة", W - 40, 58);
    ctx.direction = "ltr"; ctx.textAlign = "left";
    const counts = new Map<AgentStatus, number>();
    for (const p of profiles) { const s = presence.get(p.slug)?.status ?? "idle"; counts.set(s, (counts.get(s) ?? 0) + 1); }
    ctx.font = `500 24px ${font}`;
    let cx = 520;
    for (const s of ["working", "waiting", "meeting", "error", "idle"] as AgentStatus[]) {
      ctx.fillStyle = STATUS_COLORS[s];
      ctx.beginPath(); ctx.arc(cx, 50, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#cbd5e1";
      const t = `${STATUS_TEXT[s].en} ${counts.get(s) ?? 0}`;
      ctx.fillText(t, cx + 16, 58);
      cx += ctx.measureText(t).width + 56;
    }
    const cols = 4, gap = 20, top = 90;
    const cw = (W - 80 - gap * (cols - 1)) / cols;
    const rows = Math.max(1, Math.ceil(profiles.length / cols));
    const ch = (H - top - 30 - gap * (rows - 1)) / rows;
    profiles.forEach((p, i) => {
      const x = 40 + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (ch + gap);
      const pr = presence.get(p.slug);
      const status = pr?.status ?? "idle";
      roundRect(ctx, x, y, cw, ch, 18);
      ctx.fillStyle = "rgba(30,41,59,0.85)";
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y + 18, 6, ch - 36);
      ctx.fillStyle = "#f8fafc";
      ctx.font = `700 34px ${font}`;
      ctx.fillText(`${p.nameAr} · ${p.nameEn}`, x + 28, y + 50);
      ctx.fillStyle = STATUS_COLORS[status];
      ctx.beginPath(); ctx.arc(x + cw - 34, y + 38, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#94a3b8";
      ctx.font = `500 22px ${font}`;
      ctx.fillText(`${STATUS_TEXT[status].en} · ${STATUS_TEXT[status].ar}`, x + 28, y + 84);
      const act = pr?.activity || pr?.taskTitle;
      ctx.fillStyle = act ? "#e2e8f0" : "#475569";
      ctx.font = `500 24px ${font}`;
      wrapText(ctx, act ? truncate(act, 120) : "—", x + 28, y + 122, cw - 56, 30, 2);
    });
    texture.needsUpdate = true;
  }, [ctx, texture, W, H, profiles, presence, fonts]);
  return <Panel spec={{ ...EXECUTIVE_WALL, yaw: 0 }} material={material} />;
}

function MeetingScreen({ profiles, presence, lastStatement }: { profiles: AgentProfile[]; presence: Map<string, AgentPresence>; lastStatement: { agent: string; content: string } | null }) {
  const W = 1024, H = Math.round((1024 * MEETING_SCREEN.height) / MEETING_SCREEN.width);
  const { ctx, texture, material } = useCanvasTexture(W, H);
  const fonts = useFontsReady();
  useEffect(() => {
    const font = fontStack();
    const participants = profiles.filter((p) => presence.get(p.slug)?.status === "meeting");
    const live = participants.length > 0;
    background(ctx, W, H, live ? "#8b5cf6" : "#334155");
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 40px ${font}`;
    ctx.fillText(live ? "Meeting in progress" : "Meeting room", 48, 84);
    ctx.direction = "rtl"; ctx.textAlign = "right";
    ctx.fillText(live ? "اجتماع جارٍ" : "قاعة الاجتماعات", W - 48, 84);
    ctx.direction = "ltr"; ctx.textAlign = "left";
    if (!live) {
      ctx.fillStyle = "#64748b";
      ctx.font = `500 30px ${font}`;
      ctx.fillText("Available · متاحة", 48, 150);
    } else {
      const objective = participants.map((p) => presence.get(p.slug)?.activity).find(Boolean);
      ctx.fillStyle = "#c4b5fd";
      ctx.font = `600 28px ${font}`;
      let y = objective ? wrapText(ctx, truncate(objective, 120), 48, 140, W - 96, 36, 2) : 140;
      ctx.fillStyle = "#cbd5e1";
      ctx.font = `500 26px ${font}`;
      y = wrapText(ctx, participants.map((p) => p.nameAr).join(" · "), 48, y + 10, W - 96, 34, 2);
      const speaker = lastStatement && participants.find((p) => p.slug === lastStatement.agent);
      if (lastStatement && speaker) {
        ctx.fillStyle = speaker.color;
        ctx.font = `700 28px ${font}`;
        ctx.fillText(`${speaker.nameAr} · ${speaker.nameEn}`, 48, y + 30);
        ctx.fillStyle = "#e2e8f0";
        ctx.font = `500 28px ${font}`;
        wrapText(ctx, truncate(lastStatement.content, 220), 48, y + 72, W - 96, 38, 4);
      }
    }
    texture.needsUpdate = true;
  }, [ctx, texture, W, H, profiles, presence, lastStatement, fonts]);
  return <Panel spec={{ x: MEETING_SCREEN.x, y: MEETING_SCREEN.y, z: MEETING_SCREEN.z, yaw: -Math.PI / 2, width: MEETING_SCREEN.width, height: MEETING_SCREEN.height }} material={material} />;
}

export function OfficeDisplays({ profiles, presence, lastStatement }: {
  profiles: AgentProfile[];
  presence: AgentPresence[];
  lastStatement: { agent: string; content: string } | null;
}) {
  // Redraw canvases only when displayed fields change, not on every presence push.
  const signature = presence.map((p) => [p.agent, p.status, p.activity, p.taskTitle, p.waitingFor, p.meetingId].join("\u0001")).join("\u0002");
  const byAgent = useMemo(
    () => new Map(presence.map((p) => [p.agent, p])),
    [signature], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const ownerByZone = useMemo(() => {
    const m = new Map<OfficeZone, AgentProfile>();
    for (const p of profiles) if (!m.has(p.deskZone)) m.set(p.deskZone, p);
    return m;
  }, [profiles]);
  return (
    <group>
      {DEPARTMENT_DISPLAYS.map((d) => {
        const owner = ownerByZone.get(d.zone);
        return <DepartmentDisplay key={d.zone} spec={d} profile={owner} presence={owner ? byAgent.get(owner.slug) : undefined} />;
      })}
      <ExecutiveWall profiles={profiles} presence={byAgent} />
      <MeetingScreen profiles={profiles} presence={byAgent} lastStatement={lastStatement} />
    </group>
  );
}

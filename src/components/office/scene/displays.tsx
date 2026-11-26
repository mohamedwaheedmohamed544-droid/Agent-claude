"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { AgentPresence, AgentProfile, AgentStatus } from "@/lib/office/types";
import type { Display, OfficePlan } from "./plan";
import { truncate } from "./simulation";
import { local } from "./geometry";

/**
 * Wall screens rendered onto canvas textures. Every line of text comes from real presence / meeting data;
 * the only graphics are neutral UI chrome.
 */

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#9ca3af", working: "#6366f1", thinking: "#a855f7", collaborating: "#0ea5e9", waiting: "#f59e0b", meeting: "#8b5cf6", error: "#ef4444", paused: "#6b7280",
};
export const STATUS_TEXT: Record<AgentStatus, { en: string; ar: string }> = {
  idle: { en: "Idle", ar: "متفرغ" },
  working: { en: "Working", ar: "يعمل" },
  thinking: { en: "Thinking", ar: "يفكّر" },
  collaborating: { en: "Collaborating", ar: "يتعاون" },
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


function Panel({ spec, material }: { spec: { x: number; y: number; z: number; yaw: number; width: number; height: number }; material: THREE.Material }) {
  const pos = local(spec.x, spec.z, spec.yaw, 0, 0.005);
  return (
    <mesh position={[pos.x, spec.y, pos.z]} rotation-y={spec.yaw} material={material} raycast={() => null}>
      <planeGeometry args={[spec.width, spec.height]} />
    </mesh>
  );
}

/** Department sign: name (bilingual per locale), colour, and the live roster of its members. */
function DepartmentSign({ spec, name, nameAr, color, members, presence, locale }: {
  spec: Display; name: string; nameAr: string; color: string; members: AgentProfile[]; presence: Map<string, AgentPresence>; locale: "en" | "ar";
}) {
  const W = 1024, H = Math.round((1024 * spec.height) / spec.width);
  const { ctx, texture, material } = useCanvasTexture(W, H);
  const fonts = useFontsReady();
  useEffect(() => {
    const font = fontStack();
    background(ctx, W, H, color);
    ctx.fillStyle = color;
    ctx.fillRect(0, 8, 14, H - 8);
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 64px ${font}`;
    ctx.direction = "rtl"; ctx.textAlign = "right";
    ctx.fillText(nameAr || name, W - 40, 88);
    ctx.direction = "ltr"; ctx.textAlign = "left";
    if (locale === "en") {
      ctx.fillStyle = "#94a3b8";
      ctx.font = `600 40px ${font}`;
      ctx.fillText(name, 44, 88);
    }
    const rowH = 52, top = 150;
    const maxRows = Math.max(1, Math.floor((H - top - 10) / rowH));
    const shown = members.slice(0, members.length > maxRows ? maxRows - 1 : maxRows);
    shown.forEach((p, i) => {
      const pr = presence.get(p.slug);
      const status = pr?.status ?? "idle";
      const y = top + i * rowH;
      ctx.fillStyle = STATUS_COLORS[status];
      ctx.beginPath(); ctx.arc(60, y - 12, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `600 36px ${font}`;
      ctx.fillText(locale === "en" ? `${p.nameAr} · ${p.nameEn}` : p.nameAr, 90, y);
      ctx.fillStyle = "#94a3b8";
      ctx.font = `500 30px ${font}`;
      ctx.direction = "rtl"; ctx.textAlign = "right";
      ctx.fillText(STATUS_TEXT[status][locale], W - 40, y);
      ctx.direction = "ltr"; ctx.textAlign = "left";
    });
    if (members.length > shown.length) {
      ctx.fillStyle = "#64748b";
      ctx.font = `600 30px ${font}`;
      ctx.fillText(`+${members.length - shown.length}`, 90, top + shown.length * rowH);
    }
    if (members.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = `500 32px ${font}`;
      ctx.fillText(locale === "en" ? "No agents assigned" : "لا يوجد وكلاء", 44, top);
    }
    texture.needsUpdate = true;
  }, [ctx, texture, W, H, name, nameAr, color, members, presence, locale, fonts]);
  return <Panel spec={spec} material={material} />;
}

/** Live operations wall in an executive office: every agent's real status and current activity. */
function ExecutiveWall({ spec, profiles, presence }: { spec: Display; profiles: AgentProfile[]; presence: Map<string, AgentPresence> }) {
  const W = 2048, H = Math.round((2048 * spec.height) / spec.width);
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
    for (const p of profiles) { const st = presence.get(p.slug)?.status ?? "idle"; counts.set(st, (counts.get(st) ?? 0) + 1); }
    ctx.font = `500 24px ${font}`;
    let cx = 520;
    for (const st of ["working", "thinking", "collaborating", "waiting", "meeting", "error", "idle"] as AgentStatus[]) {
      const n = counts.get(st) ?? 0;
      if (!n && st !== "working" && st !== "idle") continue;
      ctx.fillStyle = STATUS_COLORS[st];
      ctx.beginPath(); ctx.arc(cx, 50, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#cbd5e1";
      const t = `${STATUS_TEXT[st].en} ${n}`;
      ctx.fillText(t, cx + 16, 58);
      cx += ctx.measureText(t).width + 52;
    }
    // Grid adapts to the workforce size; overflow is summarised, never invented.
    const n = profiles.length;
    const cols = n <= 8 ? 4 : n <= 18 ? 6 : 8;
    const gap = 16, top = 90;
    const maxRows = n <= 8 ? 2 : 3;
    const capacity = cols * maxRows;
    const shown = profiles.slice(0, n > capacity ? capacity - 1 : capacity);
    const rows = Math.max(1, Math.ceil(Math.min(n, capacity) / cols));
    const cw = (W - 80 - gap * (cols - 1)) / cols;
    const ch = (H - top - 24 - gap * (rows - 1)) / rows;
    const big = cols <= 4;
    shown.forEach((p, i) => {
      const x = 40 + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (ch + gap);
      const pr = presence.get(p.slug);
      const status = pr?.status ?? "idle";
      roundRect(ctx, x, y, cw, ch, 16);
      ctx.fillStyle = "rgba(30,41,59,0.85)";
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y + 14, 6, ch - 28);
      ctx.fillStyle = "#f8fafc";
      ctx.font = `700 ${big ? 34 : 26}px ${font}`;
      ctx.fillText(big ? `${p.nameAr} · ${p.nameEn}` : p.nameAr, x + 22, y + (big ? 50 : 40));
      ctx.fillStyle = STATUS_COLORS[status];
      ctx.beginPath(); ctx.arc(x + cw - 26, y + 30, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#94a3b8";
      ctx.font = `500 ${big ? 22 : 19}px ${font}`;
      ctx.fillText(`${STATUS_TEXT[status].en} · ${STATUS_TEXT[status].ar}`, x + 22, y + (big ? 84 : 68));
      const act = pr?.activity || pr?.taskTitle;
      if (ch > 110) {
        ctx.fillStyle = act ? "#e2e8f0" : "#475569";
        ctx.font = `500 ${big ? 24 : 19}px ${font}`;
        wrapText(ctx, act ? truncate(act, 120) : "—", x + 22, y + (big ? 122 : 100), cw - 44, big ? 30 : 24, 2);
      }
    });
    if (n > shown.length) {
      const i = shown.length;
      const x = 40 + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (ch + gap);
      ctx.fillStyle = "#64748b";
      ctx.font = `600 32px ${font}`;
      ctx.fillText(`+${n - shown.length}`, x + 22, y + ch / 2 + 10);
    }
    texture.needsUpdate = true;
  }, [ctx, texture, W, H, profiles, presence, fonts]);
  return <Panel spec={spec} material={material} />;
}

function MeetingScreen({ spec, roomName, roomNameAr, profiles, presence, lastStatement }: {
  spec: Display; roomName: string; roomNameAr: string; profiles: AgentProfile[]; presence: Map<string, AgentPresence>; lastStatement: { agent: string; content: string } | null;
}) {
  const W = 1024, H = Math.round((1024 * spec.height) / spec.width);
  const { ctx, texture, material } = useCanvasTexture(W, H);
  const fonts = useFontsReady();
  useEffect(() => {
    const font = fontStack();
    const participants = profiles.filter((p) => { const pr = presence.get(p.slug); return pr?.status === "meeting" && pr.zone === spec.zone; });
    const live = participants.length > 0;
    background(ctx, W, H, live ? "#8b5cf6" : "#334155");
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 40px ${font}`;
    ctx.fillText(live ? "Meeting in progress" : roomName, 48, 84);
    ctx.direction = "rtl"; ctx.textAlign = "right";
    ctx.fillText(live ? "اجتماع جارٍ" : roomNameAr, W - 48, 84);
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
  }, [ctx, texture, W, H, spec.zone, roomName, roomNameAr, profiles, presence, lastStatement, fonts]);
  return <Panel spec={spec} material={material} />;
}

/** All live screens of the visible floors. Remounted with the layout revision. */
export function OfficeDisplays({ plan, view, offsets, profiles, presence, lastStatement, locale }: {
  plan: OfficePlan;
  view: number | "all";
  offsets: number[];
  profiles: AgentProfile[];
  presence: AgentPresence[];
  lastStatement: { agent: string; content: string } | null;
  locale: "en" | "ar";
}) {
  // Redraw canvases only when displayed fields change, not on every presence push.
  const signature = presence.map((p) => [p.agent, p.status, p.zone, p.activity, p.taskTitle, p.waitingFor, p.meetingId].join("\u0001")).join("\u0002");
  const byAgent = useMemo(
    () => new Map(presence.map((p) => [p.agent, p])),
    [signature], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rosterKey = profiles.map((p) => `${p.slug}:${p.deskZone}:${p.nameAr}:${p.nameEn}:${p.color}`).join("|");
  const membersByZone = useMemo(() => {
    const m = new Map<string, AgentProfile[]>();
    for (const p of profiles) { const list = m.get(p.deskZone) ?? []; list.push(p); m.set(p.deskZone, list); }
    return m;
  }, [rosterKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const stableProfiles = useMemo(() => profiles, [rosterKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      {plan.floors.map((fp) => (
        <group key={`${plan.revision}:${fp.index}`} position-x={offsets[fp.index] ?? 0} visible={view === "all" || view === fp.index}>
          {fp.signs.map((d) => {
            const z = plan.zones.get(d.zone);
            return <DepartmentSign key={d.zone} spec={d} name={z?.name ?? d.zone} nameAr={z?.nameAr ?? ""} color={z?.color ?? "#6366f1"} members={membersByZone.get(d.zone) ?? EMPTY} presence={byAgent} locale={locale} />;
          })}
          {fp.execWalls.map((d) => <ExecutiveWall key={d.zone} spec={d} profiles={stableProfiles} presence={byAgent} />)}
          {fp.meetingScreens.map((d) => {
            const z = plan.zones.get(d.zone);
            return <MeetingScreen key={d.zone} spec={d} roomName={z?.name ?? d.zone} roomNameAr={z?.nameAr ?? ""} profiles={stableProfiles} presence={byAgent} lastStatement={lastStatement} />;
          })}
        </group>
      ))}
    </group>
  );
}

const EMPTY: AgentProfile[] = [];

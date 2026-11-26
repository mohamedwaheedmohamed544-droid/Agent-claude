import type { AgentStatus } from "@/lib/office/types";

type NamedAgent = { nameAr: string; nameEn: string; titleAr: string; titleEn: string };

export const STATUS_TONE: Record<AgentStatus, "neutral" | "accent" | "warning" | "info" | "danger"> = {
  idle: "neutral", working: "accent", thinking: "accent", collaborating: "info", waiting: "warning", meeting: "info", error: "danger", paused: "neutral",
};

export const STATUS_DOT: Record<AgentStatus, string> = {
  idle: "#9ca3af", working: "#6366f1", thinking: "#818cf8", collaborating: "#0ea5e9", waiting: "#f59e0b", meeting: "#8b5cf6", error: "#ef4444", paused: "#6b7280",
};

export function displayName(p: Pick<NamedAgent, "nameAr" | "nameEn"> | undefined, locale: "en" | "ar", slug?: string): string {
  if (!p) return slug ?? "";
  return locale === "ar" ? p.nameAr : `${p.nameAr} · ${p.nameEn}`;
}

export function displayTitle(p: Pick<NamedAgent, "titleAr" | "titleEn"> | undefined, locale: "en" | "ar"): string {
  if (!p) return "";
  return locale === "ar" ? p.titleAr : p.titleEn;
}


/** Lightweight, optional browser TTS for meeting messages (no external dependency). */
export function speak(text: string, agentIndex: number) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text.slice(0, 400));
  const arabic = /[؀-ۿ]/.test(text);
  u.lang = arabic ? "ar-SA" : "en-US";
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(arabic ? "ar" : "en"));
  if (voices.length) u.voice = voices[agentIndex % voices.length];
  u.pitch = 0.85 + (agentIndex % 4) * 0.1;
  u.rate = 1;
  window.speechSynthesis.speak(u);
}

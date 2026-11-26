"use client";

import { useEffect, useReducer, useState } from "react";
import type { AgentProfile, AgentStatus } from "@/lib/office/types";
import { STATUS_COLORS, STATUS_TEXT } from "./displays";
import type { OfficeSim } from "./simulation";

/**
 * Screen-space HTML for characters (name/status buttons and speech bubbles). A single React tree lives next
 * to the canvas; the render loop projects each character's anchor and writes the transform directly, so no
 * per-label React roots are created and nothing re-renders per frame.
 */
export class OverlayRegistry {
  readonly labels = new Map<string, HTMLElement>();
  readonly bubbles = new Map<string, HTMLElement>();
  private last = new Map<HTMLElement, string>();
  private binders = new Map<string, (el: HTMLElement | null) => void>();

  /** Stable ref callback per (kind, slug). */
  bind(kind: "label" | "bubble", slug: string) {
    const key = `${kind}:${slug}`;
    let fn = this.binders.get(key);
    if (!fn) {
      const map = kind === "label" ? this.labels : this.bubbles;
      fn = (el) => {
        const prev = map.get(slug);
        if (prev) { this.last.delete(prev); this.widths.delete(prev); }
        if (el) map.set(slug, el);
        else map.delete(slug);
      };
      this.binders.set(key, fn);
    }
    return fn;
  }

  private widths = new Map<HTMLElement, { text: string; w: number }>();

  /** Rendered label width in CSS px, measured once per text (labels are laid out even while hidden). */
  labelWidth(el: HTMLElement): number {
    const text = el.textContent ?? "";
    const cached = this.widths.get(el);
    if (cached && cached.text === text) return cached.w;
    const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth || text.length * 7 + 40;
    this.widths.set(el, { text, w });
    return w;
  }

  /** Writes a screen position (CSS px) — skipped when unchanged to avoid style churn. */
  place(el: HTMLElement, x: number, y: number, z: number, visible: boolean) {
    const key = visible ? `${x.toFixed(1)}|${y.toFixed(1)}|${z}` : "hidden";
    if (this.last.get(el) === key) return;
    this.last.set(el, key);
    if (!visible) { el.style.visibility = "hidden"; return; }
    el.style.visibility = "visible";
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    el.style.zIndex = String(z);
  }
}

function SpeechBubble({ bubble, accent, bind }: { bubble: { id: number; text: string } | null; accent: string; bind: (el: HTMLElement | null) => void }) {
  const [shown, setShown] = useState(bubble);
  const [visible, setVisible] = useState(false);
  const id = bubble?.id ?? null;
  if (bubble && bubble.id !== shown?.id) setShown(bubble);
  useEffect(() => {
    if (id !== null) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setShown(null), 450);
    return () => clearTimeout(t);
  }, [id]);
  return (
    <div ref={bind} className="absolute left-0 top-0" style={{ visibility: "hidden" }}>
      {shown && (
        <div
          dir="auto"
          role="status"
          className="absolute bottom-0 left-0 w-max max-w-[min(260px,62vw)] rounded-2xl border bg-white/95 px-3 py-2 text-[12.5px] leading-snug text-slate-800 shadow-lg backdrop-blur transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none"
          style={{ borderColor: `${accent}66`, opacity: visible ? 1 : 0, transform: `translate(-50%, ${visible ? 0 : 8}px)` }}
        >
          <span className="line-clamp-3 break-words">{shown.text}</span>
          <span aria-hidden className="absolute -bottom-[6px] left-1/2 size-3 -translate-x-1/2 rotate-45 border-b border-r bg-white" style={{ borderColor: `${accent}66` }} />
        </div>
      )}
    </div>
  );
}

function AgentLabel({ profile, status, selected, dimmed, speaking, locale, bind, onSelect }: {
  profile: AgentProfile; status: AgentStatus; selected: boolean; dimmed: boolean; speaking: boolean; locale: "en" | "ar";
  bind: (el: HTMLElement | null) => void; onSelect: (slug: string) => void;
}) {
  const name = locale === "en" ? `${profile.nameAr} · ${profile.nameEn}` : profile.nameAr;
  const statusText = STATUS_TEXT[status][locale];
  return (
    <div ref={bind} className="absolute left-0 top-0" style={{ visibility: "hidden" }}>
      <button
        type="button"
        onClick={() => { if (!dimmed) onSelect(profile.slug); }}
        aria-label={`${profile.nameAr} (${profile.nameEn}) — ${statusText}`}
        aria-pressed={selected}
        aria-disabled={dimmed || undefined}
        tabIndex={dimmed ? -1 : 0}
        data-agent-label={profile.slug}
        className={[
          "pointer-events-auto absolute left-0 top-0 flex -translate-x-1/2 -translate-y-1/2 select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold shadow-md backdrop-blur transition-[opacity,scale,box-shadow,background-color] duration-200",
          "outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
          selected ? "scale-110 bg-white text-slate-900" : "bg-white/85 text-slate-800 hover:bg-white",
          dimmed ? "cursor-default opacity-40" : "cursor-pointer",
        ].join(" ")}
        style={{
          borderColor: selected ? profile.color : "rgba(15,23,42,0.12)",
          boxShadow: selected ? `0 0 0 2px ${profile.color}55, 0 4px 14px rgba(15,23,42,0.18)` : undefined,
          ["--tw-ring-color" as string]: profile.color,
        }}
      >
        <span
          aria-hidden
          className={`size-2 shrink-0 rounded-full ${status === "working" || status === "meeting" ? "animate-soft-pulse" : ""}`}
          style={{ background: status === "working" ? profile.color : STATUS_COLORS[status] }}
        />
        <span dir="auto">{name}</span>
        {status === "error" && <span aria-hidden className="grid size-3.5 place-items-center rounded-full bg-red-500 text-[9px] font-bold text-white">!</span>}
        {speaking && (
          <span aria-hidden className="flex h-3 items-end gap-[2px]">
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-[3px] animate-soft-pulse rounded-full" style={{ height: `${6 + i * 3}px`, background: profile.color, animationDelay: `${i * 0.18}s` }} />
            ))}
          </span>
        )}
      </button>
    </div>
  );
}

export function AgentOverlay({ sim, registry, statusBy, selectedAgent, dimmed, locale, onSelectAgent }: {
  sim: OfficeSim;
  registry: OverlayRegistry;
  statusBy: Map<string, AgentStatus>;
  selectedAgent: string | null;
  dimmed: Set<string>;
  locale: "en" | "ar";
  onSelectAgent: (slug: string | null) => void;
}) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => sim.subscribe(bump), [sim]);
  const roster = sim.list.filter((a) => !a.removed);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 1 }}>
      {roster.map((a) => (
        <SpeechBubble key={`b-${a.slug}`} bubble={a.bubble ? { id: a.bubble.id, text: a.bubble.text } : null} accent={a.profile.color} bind={registry.bind("bubble", a.slug)} />
      ))}
      {roster.filter((a) => !a.leaving).map((a) => (
        <AgentLabel
          key={`l-${a.slug}`}
          profile={a.profile}
          status={statusBy.get(a.slug) ?? "idle"}
          selected={selectedAgent === a.slug}
          dimmed={dimmed.has(a.slug)}
          speaking={sim.isSpeaking(a.slug)}
          locale={locale}
          bind={registry.bind("label", a.slug)}
          onSelect={onSelectAgent}
        />
      ))}
    </div>
  );
}
